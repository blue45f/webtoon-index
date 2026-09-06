import { describe, expect, it, vi } from "vitest";

import { calculateStudioCrc32 } from "./studio-crc32";
import {
  STUDIO_CRC32_DIRECT_MAX_BYTES,
  createStudioCrc32WorkerSession,
  type StudioCrc32WorkerLike,
} from "./studio-crc32-worker-client";
import {
  studioCrc32SuccessTransfers,
  type StudioCrc32WorkerResponseMessage,
  type StudioCrc32WorkerRunMessage,
  type StudioCrc32WorkerSuccessMessage,
} from "./studio-crc32-worker-protocol";

class ControlledWorker implements StudioCrc32WorkerLike {
  onmessage: StudioCrc32WorkerLike["onmessage"] = null;
  onerror: StudioCrc32WorkerLike["onerror"] = null;
  readonly messages: StudioCrc32WorkerRunMessage[] = [];
  readonly transfers: Transferable[][] = [];
  terminateCount = 0;

  postMessage(message: StudioCrc32WorkerRunMessage, transfer: Transferable[]): void {
    this.transfers.push(transfer);
    this.messages.push(structuredClone(message, { transfer }));
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emitReady(): void {
    this.emit({ type: "studio-crc32/ready", version: 1 });
  }

  emitCalculated(index = 0): void {
    const message = this.messages[index]!;
    const response: StudioCrc32WorkerSuccessMessage = {
      type: "studio-crc32/success",
      version: 1,
      requestId: message.requestId,
      crc32: calculateStudioCrc32(message.data),
      data: message.data,
    };
    this.emit(structuredClone(response, {
      transfer: studioCrc32SuccessTransfers(response),
    }));
  }

  emitFailure(requestId: number, name: string, message: string): void {
    this.emit({
      type: "studio-crc32/failure",
      version: 1,
      requestId,
      error: { name, message },
    });
  }

  emitLoadError(message: string): void {
    this.onerror?.({ message });
  }

  private emit(message: StudioCrc32WorkerResponseMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<StudioCrc32WorkerResponseMessage>);
  }
}

function pattern(length = 128): Uint8Array {
  return Uint8Array.from(
    { length },
    (_, index) => (index * 73 + (index >>> 2) * 11) & 0xff,
  );
}

describe("createStudioCrc32WorkerSession", () => {
  it("uses the bounded direct path only when selected before work", async () => {
    const data = pattern();
    const session = createStudioCrc32WorkerSession({ executionMode: "direct-bounded" });

    await expect(session.run(data)).resolves.toEqual({
      execution: "direct",
      crc32: calculateStudioCrc32(data),
      data,
    });
    expect(data.byteLength).toBe(128);
    session.dispose();
  });

  // Large buffers are compared field by field: a deep-equal over a multi-MiB typed array makes
  // the matcher walk (and on failure, print) tens of millions of elements.
  it.each([
    STUDIO_CRC32_DIRECT_MAX_BYTES - 1,
    STUDIO_CRC32_DIRECT_MAX_BYTES,
    STUDIO_CRC32_DIRECT_MAX_BYTES + 1,
  ])(
    "matches the reference digest across the %d-byte direct slice boundary",
    async (byteLength) => {
      const data = pattern(byteLength);
      const session = createStudioCrc32WorkerSession({ executionMode: "direct-bounded" });

      const result = await session.run(data);
      expect(result.execution).toBe("direct");
      expect(result.crc32).toBe(calculateStudioCrc32(data));
      expect(result.data).toBe(data);
      session.dispose();
    },
  );

  it.each([2, 16, 32])(
    "folds %d MiB in bounded direct mode as yielding slices with the reference digest",
    async (megabytes) => {
      // The bounded WILL v1 profile admits a 32 MiB strokes part, so the bounded direct mode
      // must accept the whole declared range — sliced, not refused after the profile check passed.
      const data = pattern(megabytes * 1024 * 1024);
      const session = createStudioCrc32WorkerSession({ executionMode: "direct-bounded" });
      const yields: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      // Force the macrotask yield path so the slice cadence is observable.
      vi.stubGlobal("scheduler", undefined);
      vi.stubGlobal("setTimeout", ((handler: () => void, delay?: number) => {
        yields.push(delay ?? 0);
        return originalSetTimeout(handler, delay);
      }) as typeof setTimeout);
      let result: Awaited<ReturnType<typeof session.run>>;
      try {
        result = await session.run(data);
      } finally {
        vi.unstubAllGlobals();
      }
      expect(result.execution).toBe("direct");
      expect(result.crc32).toBe(calculateStudioCrc32(data));
      expect(result.data).toBe(data);
      // One yield between every pair of 1 MiB slices, none after the last.
      expect(yields).toHaveLength(megabytes - 1);
      session.dispose();
    },
  );

  it("honours abort between bounded direct slices", async () => {
    const data = pattern(3 * 1024 * 1024);
    const controller = new AbortController();
    const session = createStudioCrc32WorkerSession({ executionMode: "direct-bounded" });
    const originalSetTimeout = globalThis.setTimeout;
    vi.stubGlobal("scheduler", undefined);
    vi.stubGlobal("setTimeout", ((handler: () => void, delay?: number) => {
      controller.abort();
      return originalSetTimeout(handler, delay);
    }) as typeof setTimeout);
    try {
      await expect(session.run(data, { signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
    } finally {
      vi.unstubAllGlobals();
    }
    session.dispose();
  });

  it("allows an explicitly selected large direct mode only for a headless archive runtime", async () => {
    const data = pattern(2 * 1024 * 1024);
    const session = createStudioCrc32WorkerSession({
      executionMode: "direct-headless",
    });

    await expect(session.run(data)).resolves.toEqual({
      execution: "direct",
      crc32: calculateStudioCrc32(data),
      data,
    });
    session.dispose();
  });

  it("rejects direct-headless when a browser DOM is present", async () => {
    vi.stubGlobal("document", {});
    try {
      const session = createStudioCrc32WorkerSession({
        executionMode: "direct-headless",
      });
      await expect(session.run(pattern())).rejects.toThrow(
        "DOM이 없는 실행 환경에서만 사용할 수 있습니다",
      );
      session.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps Worker absence and construction failure terminal for small inputs", async () => {
    const unavailable = createStudioCrc32WorkerSession({
      executionMode: "worker",
      workerFactory: null,
    });
    await expect(unavailable.run(pattern())).rejects.toMatchObject({
      name: "StudioCrc32WorkerError",
      message: "CRC32 계산 Worker를 사용할 수 없습니다.",
    });
    unavailable.dispose();

    const constructionFailure = createStudioCrc32WorkerSession({
      executionMode: "worker",
      workerFactory: () => {
        throw new Error("CSP blocked Worker");
      },
    });
    await expect(constructionFailure.run(pattern())).rejects.toMatchObject({
      name: "StudioCrc32WorkerError",
      message: "CRC32 Worker를 생성하지 못했습니다.",
    });
    constructionFailure.dispose();
  });

  it("keeps Worker ready timeout and post failure terminal without direct execution", async () => {
    vi.useFakeTimers();
    try {
      const neverReady = new ControlledWorker();
      const timedSession = createStudioCrc32WorkerSession({
        executionMode: "worker",
        workerFactory: () => neverReady,
      });
      const timedInput = pattern();
      const timed = timedSession.run(timedInput);
      const timedRejection = expect(timed).rejects.toMatchObject({
        name: "StudioCrc32WorkerError",
        message: "CRC32 Worker 준비 시간이 초과되었습니다.",
      });
      await vi.advanceTimersByTimeAsync(3_000);
      await timedRejection;
      expect(timedInput.byteLength).toBe(128);
      expect(neverReady.terminateCount).toBe(1);
      timedSession.dispose();

      const postFailureWorker = new ControlledWorker();
      Object.defineProperty(postFailureWorker, "postMessage", {
        value: () => {
          throw new DOMException("transfer blocked", "DataCloneError");
        },
      });
      const postFailureSession = createStudioCrc32WorkerSession({
        executionMode: "worker",
        workerFactory: () => postFailureWorker,
      });
      const postInput = pattern();
      const postFailure = postFailureSession.run(postInput);
      postFailureWorker.emitReady();
      await expect(postFailure).rejects.toMatchObject({ name: "DataCloneError" });
      expect(postInput.byteLength).toBe(128);
      expect(postFailureWorker.terminateCount).toBe(1);
      postFailureSession.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("transfers ownership out and back while reusing one warm Worker", async () => {
    const worker = new ControlledWorker();
    let factoryCalls = 0;
    const session = createStudioCrc32WorkerSession({
      executionMode: "worker",
      workerFactory: () => {
        factoryCalls += 1;
        return worker;
      },
    });
    const firstOriginal = pattern(4_096);
    const firstExpected = calculateStudioCrc32(firstOriginal);
    const first = session.run(firstOriginal);

    worker.emitReady();
    expect(firstOriginal.byteLength).toBe(0);
    expect(worker.transfers[0]).toHaveLength(1);
    worker.emitCalculated(0);
    const firstResult = await first;
    expect(firstResult).toMatchObject({
      execution: "worker",
      crc32: firstExpected,
    });
    expect(firstResult.data.byteLength).toBe(4_096);

    const secondOriginal = pattern(8_192);
    const secondExpected = calculateStudioCrc32(secondOriginal);
    const second = session.run(secondOriginal);
    expect(secondOriginal.byteLength).toBe(0);
    worker.emitCalculated(1);
    const secondResult = await second;
    expect(secondResult).toMatchObject({
      execution: "worker",
      crc32: secondExpected,
    });
    expect(secondResult.data.byteLength).toBe(8_192);
    expect(factoryCalls).toBe(1);
    expect(worker.terminateCount).toBe(0);

    session.dispose();
    expect(worker.terminateCount).toBe(1);
  });

  it("copies a partial view into a dedicated transfer without detaching its owner", async () => {
    const owner = new ArrayBuffer(80);
    const partial = new Uint8Array(owner, 8, 64);
    partial.set(pattern(64));
    const expected = calculateStudioCrc32(partial);
    const worker = new ControlledWorker();
    const session = createStudioCrc32WorkerSession({
      executionMode: "worker",
      workerFactory: () => worker,
    });
    const pending = session.run(partial);

    worker.emitReady();
    expect(owner.byteLength).toBe(80);
    expect(partial.byteLength).toBe(64);
    expect(worker.messages[0]!.data.byteOffset).toBe(0);
    expect(worker.messages[0]!.data.buffer.byteLength).toBe(64);
    worker.emitCalculated();
    await expect(pending).resolves.toMatchObject({
      execution: "worker",
      crc32: expected,
    });
    session.dispose();
  });

  it("terminates an aborted epoch, ignores its late response, and creates a fresh Worker", async () => {
    const firstWorker = new ControlledWorker();
    const secondWorker = new ControlledWorker();
    const workers = [firstWorker, secondWorker];
    const session = createStudioCrc32WorkerSession({
      executionMode: "worker",
      workerFactory: () => workers.shift() ?? null,
    });
    const controller = new AbortController();
    const first = session.run(pattern(), { signal: controller.signal });
    workerReadyAndPosted(firstWorker);

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(firstWorker.terminateCount).toBe(1);
    firstWorker.emitCalculated();

    const second = session.run(pattern(256));
    workerReadyAndPosted(secondWorker);
    secondWorker.emitCalculated();
    await expect(second).resolves.toMatchObject({ execution: "worker" });
    session.dispose();
  });

  it("supersedes an active request with a new Worker epoch", async () => {
    const firstWorker = new ControlledWorker();
    const secondWorker = new ControlledWorker();
    const workers = [firstWorker, secondWorker];
    const session = createStudioCrc32WorkerSession({
      executionMode: "worker",
      workerFactory: () => workers.shift() ?? null,
    });
    const first = session.run(pattern());
    workerReadyAndPosted(firstWorker);
    const firstRejection = expect(first).rejects.toMatchObject({ name: "AbortError" });

    const second = session.run(pattern(256));
    await firstRejection;
    expect(firstWorker.terminateCount).toBe(1);
    workerReadyAndPosted(secondWorker);
    secondWorker.emitCalculated();
    await expect(second).resolves.toMatchObject({ execution: "worker" });
    session.dispose();
  });

  it("keeps Worker failures terminal before and after transfer", async () => {
    const loadFailureWorker = new ControlledWorker();
    const directSession = createStudioCrc32WorkerSession({
      executionMode: "worker",
      workerFactory: () => loadFailureWorker,
    });
    const directInput = pattern();
    const direct = directSession.run(directInput);
    loadFailureWorker.emitLoadError("worker chunk blocked");
    await expect(direct).rejects.toThrow("worker chunk blocked");
    expect(directInput.byteLength).toBe(128);
    directSession.dispose();

    const executionFailureWorker = new ControlledWorker();
    const workerSession = createStudioCrc32WorkerSession({
      executionMode: "worker",
      workerFactory: () => executionFailureWorker,
    });
    const posted = workerSession.run(pattern());
    workerReadyAndPosted(executionFailureWorker);
    executionFailureWorker.emitFailure(
      executionFailureWorker.messages[0]!.requestId,
      "RangeError",
      "source is too large",
    );
    await expect(posted).rejects.toMatchObject({
      name: "RangeError",
      message: "source is too large",
    });
    workerSession.dispose();
  });

  it("rejects an already-aborted request before creating or detaching a Worker", async () => {
    const controller = new AbortController();
    controller.abort();
    const input = pattern();
    let factoryCalls = 0;
    const session = createStudioCrc32WorkerSession({
      executionMode: "worker",
      workerFactory: () => {
        factoryCalls += 1;
        return new ControlledWorker();
      },
    });

    await expect(session.run(input, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(factoryCalls).toBe(0);
    expect(input.byteLength).toBe(128);
    session.dispose();
  });
});

function workerReadyAndPosted(worker: ControlledWorker): void {
  worker.emitReady();
  expect(worker.messages).toHaveLength(1);
}
