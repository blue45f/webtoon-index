import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_OUTPUT_BYTES,
  createStudioCompanionReferenceRasterWorkerProcessor,
  type StudioCompanionReferenceRasterWorkerLike,
} from "./studio-companion-reference-raster-worker-client";

const HASH = `sha256:${"a".repeat(64)}`;

class FakeWorker implements StudioCompanionReferenceRasterWorkerLike {
  readonly messages: unknown[] = [];
  readonly transferCounts: number[] = [];
  terminate = vi.fn();
  private readonly messageListeners = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly errorListeners = new Set<(event: Event) => void>();
  private readonly messageErrorListeners = new Set<(event: Event) => void>();

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.transferCounts.push(transfer.length);
    this.messages.push(structuredClone(message, { transfer }));
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | ((event: Event) => void)
  ): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: MessageEvent<unknown>) => void);
    } else if (type === "error") {
      this.errorListeners.add(listener as (event: Event) => void);
    } else {
      this.messageErrorListeners.add(listener as (event: Event) => void);
    }
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: ((event: MessageEvent<unknown>) => void) | ((event: Event) => void)
  ): void {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: MessageEvent<unknown>) => void);
    } else if (type === "error") {
      this.errorListeners.delete(listener as (event: Event) => void);
    } else {
      this.messageErrorListeners.delete(listener as (event: Event) => void);
    }
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) listener({ data } as MessageEvent<unknown>);
  }

  crash(): void {
    for (const listener of this.errorListeners) listener(new Event("error"));
  }
}

function messageRecord(worker: FakeWorker, index = 0): Record<string, unknown> {
  return worker.messages[index] as Record<string, unknown>;
}

function createHarness(worker = new FakeWorker()) {
  const fallbackHashDataUrl = vi.fn(async () => HASH);
  const fallbackNormalizeRaster = vi.fn((raster: {
    width: number;
    height: number;
    pixels: Uint8ClampedArray;
  }) => raster);
  const createWorker = vi.fn(() => worker);
  const processor = createStudioCompanionReferenceRasterWorkerProcessor({
    createWorker,
    fallbackHashDataUrl,
    fallbackNormalizeRaster,
  });
  return { worker, processor, createWorker, fallbackHashDataUrl, fallbackNormalizeRaster };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Studio companion reference raster worker processor", () => {
  it("creates the worker lazily and ignores stale job responses", async () => {
    const { worker, processor, createWorker, fallbackHashDataUrl } = createHarness();
    expect(createWorker).not.toHaveBeenCalled();

    let settled = false;
    const pending = processor.hashDataUrl("data:text/plain,hello", new AbortController().signal)
      .finally(() => { settled = true; });
    const request = messageRecord(worker);
    expect(createWorker).toHaveBeenCalledOnce();
    expect(request).toMatchObject({ kind: "hash", epoch: 1 });

    worker.emitMessage({
      jobId: `${String(request.jobId)}-stale`,
      epoch: request.epoch,
      kind: "hash-result",
      hash: HASH,
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    worker.emitMessage({
      jobId: request.jobId,
      epoch: request.epoch,
      kind: "hash-result",
      hash: HASH,
    });
    await expect(pending).resolves.toBe(HASH);
    expect(fallbackHashDataUrl).not.toHaveBeenCalled();
  });

  it("transfers exact RGBA ownership and validates the returned output envelope", async () => {
    const { worker, processor, fallbackNormalizeRaster } = createHarness();
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const pending = processor.normalizeRaster(
      { width: 2, height: 1, pixels },
      1,
      new AbortController().signal
    );
    const request = messageRecord(worker);
    expect(worker.transferCounts).toEqual([1]);
    expect(pixels.byteLength).toBe(0);
    expect(request).toMatchObject({ kind: "normalize", width: 2, height: 1 });

    const output = new Uint8ClampedArray([128, 0, 128, 255]);
    worker.emitMessage({
      jobId: request.jobId,
      epoch: request.epoch,
      kind: "normalize-result",
      width: 1,
      height: 1,
      buffer: output.buffer,
    });

    await expect(pending).resolves.toMatchObject({ width: 1, height: 1 });
    const result = await pending;
    expect([...result!.pixels]).toEqual([128, 0, 128, 255]);
    expect(fallbackNormalizeRaster).not.toHaveBeenCalled();
  });

  it("terminates and rejects an in-flight job when its demand aborts", async () => {
    const { worker, processor, fallbackHashDataUrl } = createHarness();
    const controller = new AbortController();
    const pending = processor.hashDataUrl("data:text/plain,hello", controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(fallbackHashDataUrl).not.toHaveBeenCalled();
  });

  it("closes the abort registration race before posting or transferring work", async () => {
    const { worker, processor, fallbackHashDataUrl } = createHarness();
    let reads = 0;
    const removeEventListener = vi.fn();
    const signal = {
      get aborted() {
        reads += 1;
        // hashDataUrl and runWorkerJob perform the two entry checks. Simulate cancellation in
        // the narrow interval immediately before the listener has been registered.
        return reads >= 3;
      },
      addEventListener: vi.fn(),
      removeEventListener,
    } as unknown as AbortSignal;

    await expect(processor.hashDataUrl("data:text/plain,raced", signal))
      .rejects.toMatchObject({ name: "AbortError" });

    expect(worker.messages).toHaveLength(0);
    expect(worker.transferCounts).toHaveLength(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(fallbackHashDataUrl).not.toHaveBeenCalled();
  });

  it("ignores an old retained abort listener after that job has settled", async () => {
    const { worker, processor, fallbackHashDataUrl } = createHarness();
    const retainedAbortListeners = new Set<() => void>();
    const staleSignal = {
      aborted: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        retainedAbortListeners.add(listener);
      }),
      removeEventListener: vi.fn(() => {
        throw new Error("detached signal");
      }),
    } as unknown as AbortSignal;
    const first = processor.hashDataUrl("data:text/plain,first", staleSignal);
    const firstRequest = messageRecord(worker);
    worker.emitMessage({
      jobId: firstRequest.jobId,
      epoch: firstRequest.epoch,
      kind: "hash-result",
      hash: HASH,
    });
    await expect(first).resolves.toBe(HASH);

    const second = processor.hashDataUrl(
      "data:text/plain,second",
      new AbortController().signal
    );
    const secondRequest = messageRecord(worker, 1);
    for (const listener of retainedAbortListeners) listener();
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emitMessage({
      jobId: secondRequest.jobId,
      epoch: secondRequest.epoch,
      kind: "hash-result",
      hash: HASH,
    });

    await expect(second).resolves.toBe(HASH);
    expect(fallbackHashDataUrl).not.toHaveBeenCalled();
  });

  it("terminates a partially initialized worker when listener registration throws", async () => {
    const fallbackHashDataUrl = vi.fn(async () => HASH);
    const worker = new FakeWorker();
    const originalAddEventListener = worker.addEventListener.bind(worker);
    let registrations = 0;
    worker.addEventListener = ((type: "message" | "error" | "messageerror", listener: never) => {
      registrations += 1;
      if (registrations === 2) throw new Error("listener registration failed");
      originalAddEventListener(type as "message", listener);
    }) as StudioCompanionReferenceRasterWorkerLike["addEventListener"];
    const processor = createStudioCompanionReferenceRasterWorkerProcessor({
      createWorker: () => worker,
      fallbackHashDataUrl,
      fallbackNormalizeRaster: (raster) => raster,
    });

    await expect(processor.hashDataUrl(
      "data:text/plain,fallback",
      new AbortController().signal
    )).resolves.toBe(HASH);

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(fallbackHashDataUrl).toHaveBeenCalledOnce();
  });

  it("can lazily create a fresh worker after a normal job cancellation", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const createWorker = vi.fn(() => workers.shift()!);
    const fallbackHashDataUrl = vi.fn(async () => HASH);
    const processor = createStudioCompanionReferenceRasterWorkerProcessor({
      createWorker,
      fallbackHashDataUrl,
      fallbackNormalizeRaster: vi.fn((raster) => raster),
    });
    const controller = new AbortController();
    const cancelled = processor.hashDataUrl("data:text/plain,first", controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    const next = processor.hashDataUrl(
      "data:text/plain,second",
      new AbortController().signal
    );
    const request = messageRecord(second);
    second.emitMessage({
      jobId: request.jobId,
      epoch: request.epoch,
      kind: "hash-result",
      hash: HASH,
    });

    await expect(next).resolves.toBe(HASH);
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(fallbackHashDataUrl).not.toHaveBeenCalled();
  });

  it("ignores a retained failure listener from a retired worker instance", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    first.removeEventListener = vi.fn();
    const workers = [first, second];
    const fallbackHashDataUrl = vi.fn(async () => HASH);
    const processor = createStudioCompanionReferenceRasterWorkerProcessor({
      createWorker: () => workers.shift()!,
      fallbackHashDataUrl,
      fallbackNormalizeRaster: (raster) => raster,
    });
    const firstController = new AbortController();
    const cancelled = processor.hashDataUrl("data:text/plain,first", firstController.signal);
    firstController.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });

    const next = processor.hashDataUrl(
      "data:text/plain,second",
      new AbortController().signal
    );
    const request = messageRecord(second);
    first.crash();
    expect(second.terminate).not.toHaveBeenCalled();
    second.emitMessage({
      jobId: request.jobId,
      epoch: request.epoch,
      kind: "hash-result",
      hash: HASH,
    });

    await expect(next).resolves.toBe(HASH);
    expect(fallbackHashDataUrl).not.toHaveBeenCalled();
  });

  it("uses the bounded main-thread fallback once when worker creation is unavailable", async () => {
    const fallbackHashDataUrl = vi.fn(async () => HASH);
    const fallbackNormalizeRaster = vi.fn((raster) => raster);
    const createWorker = vi.fn(() => { throw new Error("unsupported"); });
    const processor = createStudioCompanionReferenceRasterWorkerProcessor({
      createWorker,
      fallbackHashDataUrl,
      fallbackNormalizeRaster,
    });

    await expect(processor.hashDataUrl("data:text/plain,one", new AbortController().signal))
      .resolves.toBe(HASH);
    await expect(processor.hashDataUrl("data:text/plain,two", new AbortController().signal))
      .resolves.toBe(HASH);

    expect(createWorker).toHaveBeenCalledOnce();
    expect(fallbackHashDataUrl).toHaveBeenCalledTimes(2);
  });

  it("validates fallback raster ownership, dimensions, and output budget before publishing", async () => {
    const offsetPixels = new Uint8ClampedArray(8).subarray(4);
    const fallbackNormalizeRaster = vi.fn()
      .mockReturnValueOnce({ width: 1, height: 1, pixels: offsetPixels })
      .mockReturnValueOnce({
        width: 1_281,
        height: 1,
        pixels: new Uint8ClampedArray(1_281 * 4),
      });
    const processor = createStudioCompanionReferenceRasterWorkerProcessor({
      createWorker: () => { throw new Error("unsupported"); },
      fallbackHashDataUrl: async () => HASH,
      fallbackNormalizeRaster,
    });

    await expect(processor.normalizeRaster(
      { width: 1, height: 1, pixels: new Uint8ClampedArray(4) },
      1,
      new AbortController().signal
    )).rejects.toThrow("fallback response is invalid");
    await expect(processor.normalizeRaster(
      { width: 1, height: 1, pixels: new Uint8ClampedArray(4) },
      1_281,
      new AbortController().signal
    )).rejects.toThrow("fallback response is invalid");

    expect(fallbackNormalizeRaster).toHaveBeenCalledTimes(2);
  });

  it("retires a crashed worker, falls back for hash, and never retries creation", async () => {
    const { worker, processor, createWorker, fallbackHashDataUrl } = createHarness();
    const pending = processor.hashDataUrl("data:text/plain,one", new AbortController().signal);
    worker.crash();

    await expect(pending).resolves.toBe(HASH);
    await expect(processor.hashDataUrl("data:text/plain,two", new AbortController().signal))
      .resolves.toBe(HASH);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledOnce();
    expect(fallbackHashDataUrl).toHaveBeenCalledTimes(2);
  });

  it("falls back immediately when the worker reports a bounded job error", async () => {
    const { worker, processor, fallbackHashDataUrl } = createHarness();
    const pending = processor.hashDataUrl(
      "data:text/plain,malformed",
      new AbortController().signal
    );
    const request = messageRecord(worker);

    worker.emitMessage({
      jobId: request.jobId,
      epoch: request.epoch,
      kind: "job-error",
      code: "invalid-input",
    });

    await expect(pending).resolves.toBe(HASH);
    expect(fallbackHashDataUrl).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("fails closed for a transferred raster on crash and uses fallback for the next raster", async () => {
    const { worker, processor, createWorker, fallbackNormalizeRaster } = createHarness();
    const transferred = new Uint8ClampedArray([1, 2, 3, 255]);
    const pending = processor.normalizeRaster(
      { width: 1, height: 1, pixels: transferred },
      1,
      new AbortController().signal
    );
    expect(transferred.byteLength).toBe(0);

    worker.crash();

    await expect(pending).rejects.toThrow("failed");
    expect(fallbackNormalizeRaster).not.toHaveBeenCalled();

    const fallbackPixels = new Uint8ClampedArray([4, 5, 6, 255]);
    await expect(processor.normalizeRaster(
      { width: 1, height: 1, pixels: fallbackPixels },
      1,
      new AbortController().signal
    )).resolves.toMatchObject({ width: 1, height: 1, pixels: fallbackPixels });
    expect(createWorker).toHaveBeenCalledOnce();
    expect(fallbackNormalizeRaster).toHaveBeenCalledOnce();
  });

  it("enforces one absolute deadline and keeps future jobs on the fallback", async () => {
    vi.useFakeTimers();
    const { worker, processor, createWorker, fallbackHashDataUrl } = createHarness();
    const pending = processor.hashDataUrl("data:text/plain,slow", new AbortController().signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });

    await vi.advanceTimersByTimeAsync(8_000);

    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(processor.hashDataUrl("data:text/plain,next", new AbortController().signal))
      .resolves.toBe(HASH);
    expect(createWorker).toHaveBeenCalledOnce();
    expect(fallbackHashDataUrl).toHaveBeenCalledOnce();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "normalizes non-finite deadline %s to the default budget",
    async (deadlineMs) => {
      vi.useFakeTimers();
      const worker = new FakeWorker();
      const fallbackHashDataUrl = vi.fn(async () => HASH);
      const processor = createStudioCompanionReferenceRasterWorkerProcessor({
        createWorker: () => worker,
        fallbackHashDataUrl,
        fallbackNormalizeRaster: (raster) => raster,
        deadlineMs,
      });
      const pending = processor.hashDataUrl(
        "data:text/plain,slow",
        new AbortController().signal
      );
      let settled = false;
      void pending.then(
        () => { settled = true; },
        () => { settled = true; }
      );

      await vi.advanceTimersByTimeAsync(7_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
      expect(fallbackHashDataUrl).not.toHaveBeenCalled();
    }
  );

  it("rejects oversized output budgets before creating a worker or invoking fallback", async () => {
    const { processor, createWorker, fallbackNormalizeRaster } = createHarness();
    const pixels = new Uint8ClampedArray(4);

    await expect(processor.normalizeRaster(
      { width: 1, height: 1, pixels },
      STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_OUTPUT_BYTES / 4 + 1,
      new AbortController().signal
    )).rejects.toThrow("oversized");

    expect(createWorker).not.toHaveBeenCalled();
    expect(fallbackNormalizeRaster).not.toHaveBeenCalled();
  });

  it("release is idempotent and prevents a late worker response from settling old work", async () => {
    const { worker, processor } = createHarness();
    const pending = processor.hashDataUrl("data:text/plain,hello", new AbortController().signal);
    const request = messageRecord(worker);

    processor.release();
    processor.release();
    worker.emitMessage({
      jobId: request.jobId,
      epoch: request.epoch,
      kind: "hash-result",
      hash: HASH,
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("never starts or publishes fallback work after the processor is released", async () => {
    let resolveFallback!: (value: string) => void;
    const fallbackHashDataUrl = vi.fn(() => new Promise<string>((resolve) => {
      resolveFallback = resolve;
    }));
    const fallbackNormalizeRaster = vi.fn((raster) => raster);
    const processor = createStudioCompanionReferenceRasterWorkerProcessor({
      createWorker: () => { throw new Error("unsupported"); },
      fallbackHashDataUrl,
      fallbackNormalizeRaster,
    });
    const pending = processor.hashDataUrl(
      "data:text/plain,pending",
      new AbortController().signal
    );
    await vi.waitFor(() => expect(fallbackHashDataUrl).toHaveBeenCalledOnce());

    processor.release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolveFallback(HASH);
    await Promise.resolve();
    await expect(processor.hashDataUrl(
      "data:text/plain,late",
      new AbortController().signal
    )).rejects.toMatchObject({ name: "AbortError" });
    await expect(processor.normalizeRaster(
      { width: 1, height: 1, pixels: new Uint8ClampedArray(4) },
      1,
      new AbortController().signal
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(fallbackHashDataUrl).toHaveBeenCalledOnce();
    expect(fallbackNormalizeRaster).not.toHaveBeenCalled();
  });

  it("settles a fallback abort promptly and clears a late raster result", async () => {
    let resolveFallback!: (value: {
      width: number;
      height: number;
      pixels: Uint8ClampedArray;
    }) => void;
    const fallbackNormalizeRaster = vi.fn(() => new Promise<{
      width: number;
      height: number;
      pixels: Uint8ClampedArray;
    }>((resolve) => {
      resolveFallback = resolve;
    }));
    const processor = createStudioCompanionReferenceRasterWorkerProcessor({
      createWorker: () => { throw new Error("unsupported"); },
      fallbackHashDataUrl: async () => HASH,
      fallbackNormalizeRaster,
    });
    const controller = new AbortController();
    const pending = processor.normalizeRaster(
      { width: 1, height: 1, pixels: new Uint8ClampedArray([1, 2, 3, 255]) },
      1,
      controller.signal
    );
    await vi.waitFor(() => expect(fallbackNormalizeRaster).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const latePixels = new Uint8ClampedArray([9, 8, 7, 255]);
    resolveFallback({ width: 1, height: 1, pixels: latePixels });
    await vi.waitFor(() => expect([...latePixels]).toEqual([0, 0, 0, 0]));
  });

  it("settles a hung fallback at its absolute deadline and ignores its late hash", async () => {
    vi.useFakeTimers();
    let resolveFallback!: (value: string) => void;
    const fallbackHashDataUrl = vi.fn(() => new Promise<string>((resolve) => {
      resolveFallback = resolve;
    }));
    const processor = createStudioCompanionReferenceRasterWorkerProcessor({
      createWorker: () => { throw new Error("unsupported"); },
      fallbackHashDataUrl,
      fallbackNormalizeRaster: (raster) => raster,
      deadlineMs: 250,
    });
    const pending = processor.hashDataUrl(
      "data:text/plain,pending",
      new AbortController().signal
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(250);

    await rejection;
    resolveFallback(HASH);
    await Promise.resolve();
    expect(fallbackHashDataUrl).toHaveBeenCalledOnce();
  });
});
