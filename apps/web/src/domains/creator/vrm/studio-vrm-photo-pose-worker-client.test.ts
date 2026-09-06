import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION } from "./studio-vrm-photo-pose";
import {
  StudioVrmPhotoPosePreprocessor,
  type StudioVrmPhotoPoseReadableFile,
  type StudioVrmPhotoPoseWorkerLike,
} from "./studio-vrm-photo-pose-worker-client";

import type {
  StudioVrmPhotoPoseWorkerRequest,
  StudioVrmPhotoPoseWorkerResponse,
} from "./studio-vrm-photo-pose-worker-protocol";

class FakeWorker implements StudioVrmPhotoPoseWorkerLike {
  readonly messages: { message: StudioVrmPhotoPoseWorkerRequest; transfer?: Transferable[] }[] = [];
  readonly messageListeners = new Set<(event: { readonly data: unknown }) => void>();
  readonly errorListeners = new Set<(event: { preventDefault?(): void }) => void>();
  readonly messageErrorListeners = new Set<(event: { preventDefault?(): void }) => void>();
  terminated = false;

  postMessage(message: StudioVrmPhotoPoseWorkerRequest, transfer?: Transferable[]): void {
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

function pngBytes(width = 32, height = 16): ArrayBuffer {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes.buffer;
}

function readableFile(overrides: Partial<StudioVrmPhotoPoseReadableFile> = {}): StudioVrmPhotoPoseReadableFile {
  const bytes = pngBytes();
  return {
    name: "pose.png",
    type: "image/png",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice(0),
    ...overrides,
  };
}

function fakeBitmap(width = 32, height = 16): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

function successResponse(
  request: Extract<StudioVrmPhotoPoseWorkerRequest, { readonly kind: "preprocess" }>,
  bitmap = fakeBitmap(),
): StudioVrmPhotoPoseWorkerResponse {
  return {
    version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
    kind: "result",
    requestId: request.requestId,
    generationId: request.generationId,
    result: {
      generationId: request.generationId,
      bitmap,
      source: {
        mimeType: "image/png",
        width: 32,
        height: 16,
        pixelCount: 512,
        exifOrientation: 1,
        byteSize: 24,
      },
      output: {
        outputWidth: 32,
        outputHeight: 16,
        scale: 1,
        appliedExifOrientation: 1,
        rotation: 0,
        mirrorHorizontal: false,
      },
    },
  };
}

async function postedRequest(worker: FakeWorker): Promise<Extract<StudioVrmPhotoPoseWorkerRequest, { readonly kind: "preprocess" }>> {
  await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
  return worker.messages[0]!.message as Extract<StudioVrmPhotoPoseWorkerRequest, { readonly kind: "preprocess" }>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("StudioVrmPhotoPosePreprocessor", () => {
  it("transfers local bytes, reports correlated progress, validates the result, and leaves bitmap ownership to the caller", async () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const preprocessor = new StudioVrmPhotoPosePreprocessor({ workerFactory: () => worker });
    const job = preprocessor.start(readableFile(), {}, { onProgress: progress });
    const request = await postedRequest(worker);

    expect(request).toMatchObject({
      version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
      kind: "preprocess",
      requestId: 1,
      generationId: job.generationId,
      admission: { mimeType: "image/png", byteSize: 24 },
    });
    expect(worker.messages[0]!.transfer).toEqual([request.bytes]);
    worker.emitMessage({
      version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
      kind: "progress",
      requestId: request.requestId,
      generationId: request.generationId,
      stage: "decoding",
      progress: 0.3,
    });
    const bitmap = fakeBitmap();
    worker.emitMessage(successResponse(request, bitmap));

    await expect(job.result).resolves.toMatchObject({ generationId: job.generationId, bitmap });
    expect(progress.mock.calls.map(([entry]) => entry.stage)).toEqual([
      "admission",
      "reading",
      "decoding",
      "ready",
    ]);
    expect(worker.terminated).toBe(true);
    expect(bitmap.close).not.toHaveBeenCalled();
    preprocessor.dispose();
  });

  it("supersedes the prior generation and terminates its worker before accepting newer output", async () => {
    const workers: FakeWorker[] = [];
    const preprocessor = new StudioVrmPhotoPosePreprocessor({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = preprocessor.start(readableFile());
    const firstOutcome = first.result.catch((error: unknown) => error);
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    await postedRequest(workers[0]!);
    const second = preprocessor.start(readableFile());

    await expect(firstOutcome).resolves.toMatchObject({ code: "stale-generation" });
    expect(workers[0]!.messages.map(({ message }) => message.kind)).toEqual(["preprocess", "cancel"]);
    expect(workers[0]!.terminated).toBe(true);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const secondRequest = await postedRequest(workers[1]!);
    workers[1]!.emitMessage(successResponse(secondRequest));
    await expect(second.result).resolves.toMatchObject({ generationId: second.generationId });
    expect(second.generationId).toBe(first.generationId + 1);
    preprocessor.dispose();
  });

  it("honors pre-abort without reading or creating a worker", async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    const arrayBuffer = vi.fn(async () => pngBytes());
    const controller = new AbortController();
    controller.abort();
    const preprocessor = new StudioVrmPhotoPosePreprocessor({ workerFactory });
    const job = preprocessor.start(readableFile({ arrayBuffer }), {}, { signal: controller.signal });

    await expect(job.result).rejects.toMatchObject({ code: "aborted" });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
    preprocessor.dispose();
  });

  it("terminates and rejects a timed-out worker", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const preprocessor = new StudioVrmPhotoPosePreprocessor({
      workerFactory: () => worker,
      timeoutMs: 1_000,
    });
    const job = preprocessor.start(readableFile());
    const outcome = job.result.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await outcome).toMatchObject({ code: "timeout" });
    expect(worker.terminated).toBe(true);
    preprocessor.dispose();
  });

  it("fails closed on malformed worker output and closes a bitmap hidden in that payload", async () => {
    const worker = new FakeWorker();
    const preprocessor = new StudioVrmPhotoPosePreprocessor({ workerFactory: () => worker });
    const job = preprocessor.start(readableFile());
    const request = await postedRequest(worker);
    const bitmap = fakeBitmap();
    worker.emitMessage({
      ...successResponse(request, bitmap),
      generationId: request.generationId + 1,
    });

    await expect(job.result).rejects.toMatchObject({ code: "protocol" });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(worker.terminated).toBe(true);
    preprocessor.dispose();
  });

  it("rejects a file whose asynchronous byte length differs from admitted metadata", async () => {
    const workerFactory = vi.fn(() => new FakeWorker());
    const preprocessor = new StudioVrmPhotoPosePreprocessor({ workerFactory });
    const job = preprocessor.start(readableFile({ arrayBuffer: async () => new ArrayBuffer(12) }));

    await expect(job.result).rejects.toMatchObject({ code: "protocol" });
    expect(workerFactory).not.toHaveBeenCalled();
    preprocessor.dispose();
  });

  it("maps worker errors and explicit cancellation without accepting late results", async () => {
    const worker = new FakeWorker();
    const preprocessor = new StudioVrmPhotoPosePreprocessor({ workerFactory: () => worker });
    const job = preprocessor.start(readableFile());
    const request = await postedRequest(worker);
    const outcome = job.result.catch((error: unknown) => error);
    job.cancel();
    expect(await outcome).toMatchObject({ code: "aborted" });
    expect(worker.terminated).toBe(true);

    const lateBitmap = fakeBitmap();
    worker.emitMessage(successResponse(request, lateBitmap));
    expect(lateBitmap.close).toHaveBeenCalledOnce();
    preprocessor.dispose();
  });
});
