import { describe, expect, it, vi } from "vitest";

import {
  analyzeStudioVrmAvatarReferenceImage,
  type StudioVrmAvatarReferencePreprocessorLike,
  type StudioVrmAvatarReferenceWorkerLike,
} from "./studio-vrm-avatar-reference-inference";
import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
  StudioVrmAvatarReferenceError,
  rankStudioVrmAvatarReferenceRecommendations,
  type StudioVrmAvatarReferenceCatalogue,
} from "./studio-vrm-avatar-reference-recommendation";

import type {
  StudioVrmAvatarReferenceWorkerRequest,
  StudioVrmAvatarReferenceWorkerResponse,
} from "./studio-vrm-avatar-reference-worker-protocol";

function catalogue(): StudioVrmAvatarReferenceCatalogue {
  return {
    version: 1,
    providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
    modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
    modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
    modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    catalogueRevision: "catalogue-v1",
    entries: [{
      presetId: "natural-short",
      embedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0] },
    }],
  };
}

function receipt() {
  return rankStudioVrmAvatarReferenceRecommendations({
    catalogue: catalogue(),
    queryEmbedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0] },
    queryEmbeddingSha256: "a".repeat(64),
    topK: 1,
    cosineSimilarity: () => 1,
  });
}

function file() {
  return {
    name: "reference.png",
    size: 128,
    type: "image/png",
    arrayBuffer: async () => new ArrayBuffer(128),
  };
}

function preprocessor(options: { generation?: number; currentGeneration?: number } = {}) {
  const close = vi.fn();
  const generation = options.generation ?? 7;
  const start = vi.fn(() => ({
    generationId: generation,
    result: Promise.resolve({
      generationId: generation,
      bitmap: { width: 512, height: 384, close } as unknown as ImageBitmap,
      source: {
        mimeType: "image/png" as const,
        width: 1_000,
        height: 750,
        pixelCount: 750_000,
        exifOrientation: 1,
        byteSize: 128,
      },
      output: {
        outputWidth: 512,
        outputHeight: 384,
        scale: 0.512,
        appliedExifOrientation: 1,
        rotation: 0 as const,
        mirrorHorizontal: false,
      },
    }),
    cancel: vi.fn(),
  }));
  const dispose = vi.fn();
  const instance = {
    currentGenerationId: options.currentGeneration ?? generation,
    start,
    dispose,
  } as unknown as StudioVrmAvatarReferencePreprocessorLike;
  return { instance, start, dispose, close };
}

class FakeWorker {
  readonly posted: StudioVrmAvatarReferenceWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  readonly terminate = vi.fn();
  private readonly messageListeners = new Set<(event: { data: unknown }) => void>();
  private readonly errorListeners = new Set<(event: { preventDefault?(): void }) => void>();

  constructor(
    private readonly behavior: (
      worker: FakeWorker,
      message: StudioVrmAvatarReferenceWorkerRequest,
    ) => void,
  ) {}

  postMessage(message: StudioVrmAvatarReferenceWorkerRequest, transfers: Transferable[] = []): void {
    this.posted.push(message);
    this.transfers.push(transfers);
    this.behavior(this, message);
  }

  addEventListener(type: string, listener: unknown): void {
    if (type === "message") {
      this.messageListeners.add(listener as (event: { data: unknown }) => void);
    } else {
      this.errorListeners.add(listener as (event: { preventDefault?(): void }) => void);
    }
  }

  removeEventListener(type: string, listener: unknown): void {
    if (type === "message") {
      this.messageListeners.delete(listener as (event: { data: unknown }) => void);
    } else {
      this.errorListeners.delete(listener as (event: { preventDefault?(): void }) => void);
    }
  }

  emit(response: StudioVrmAvatarReferenceWorkerResponse): void {
    for (const listener of this.messageListeners) listener({ data: response });
  }

  asWorker(): StudioVrmAvatarReferenceWorkerLike {
    return this as unknown as StudioVrmAvatarReferenceWorkerLike;
  }
}

describe("Avatar reference inference pipeline", () => {
  it("reuses bounded preprocessing and transfers the bitmap to one dedicated Worker", async () => {
    const preprocess = preprocessor();
    const progress = vi.fn();
    const worker = new FakeWorker((self, message) => {
      if (message.kind !== "recommend") return;
      queueMicrotask(() => {
        self.emit({
          version: 1,
          kind: "progress",
          requestId: message.requestId,
          generationId: message.generationId,
          stage: "embedding",
          progress: 0.7,
        });
        self.emit({
          version: 1,
          kind: "result",
          requestId: message.requestId,
          generationId: message.generationId,
          receipt: receipt(),
        });
      });
    });

    const result = await analyzeStudioVrmAvatarReferenceImage(file(), catalogue(), {
      preprocessorFactory: () => preprocess.instance,
      workerFactory: () => worker.asWorker(),
      onProgress: progress,
    });

    expect(result.modelSha256).toBe(STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256);
    expect(preprocess.start).toHaveBeenCalledWith(
      expect.objectContaining({ name: "reference.png", size: 128, type: "image/png" }),
      expect.objectContaining({ maxOutputDimension: 1_024, maxOutputPixels: 1_048_576 }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(worker.posted[0]).toMatchObject({ kind: "recommend", generationId: 7, topK: 3 });
    expect(worker.transfers[0]).toEqual([expect.objectContaining({ width: 512, height: 384 })]);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(preprocess.dispose).toHaveBeenCalledOnce();
    expect(preprocess.close).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: "embedding" }));
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "ready", progress: 1 }));
  });

  it("rejects stale preprocessing output before constructing the inference Worker", async () => {
    const preprocess = preprocessor({ generation: 7, currentGeneration: 8 });
    const workerFactory = vi.fn();

    await expect(analyzeStudioVrmAvatarReferenceImage(file(), catalogue(), {
      preprocessorFactory: () => preprocess.instance,
      workerFactory,
    })).rejects.toMatchObject({ code: "stale-generation" });
    expect(workerFactory).not.toHaveBeenCalled();
    expect(preprocess.close).toHaveBeenCalledOnce();
    expect(preprocess.dispose).toHaveBeenCalledOnce();
  });

  it("fails closed on a mismatched Worker generation", async () => {
    const preprocess = preprocessor();
    const worker = new FakeWorker((self, message) => {
      if (message.kind !== "recommend") return;
      queueMicrotask(() => self.emit({
        version: 1,
        kind: "result",
        requestId: message.requestId,
        generationId: message.generationId + 1,
        receipt: receipt(),
      }));
    });

    await expect(analyzeStudioVrmAvatarReferenceImage(file(), catalogue(), {
      preprocessorFactory: () => preprocess.instance,
      workerFactory: () => worker.asWorker(),
    })).rejects.toMatchObject({ code: "protocol" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects a receipt whose catalogue identity does not exactly match the request", async () => {
    const preprocess = preprocessor();
    const worker = new FakeWorker((self, message) => {
      if (message.kind !== "recommend") return;
      const validReceipt = receipt();
      queueMicrotask(() => self.emit({
        version: 1,
        kind: "result",
        requestId: message.requestId,
        generationId: message.generationId,
        receipt: {
          ...validReceipt,
          catalogueRevision: "different-revision",
        },
      }));
    });

    await expect(analyzeStudioVrmAvatarReferenceImage(file(), catalogue(), {
      preprocessorFactory: () => preprocess.instance,
      workerFactory: () => worker.asWorker(),
    })).rejects.toMatchObject({ code: "protocol" });
  });

  it("terminates the Worker and rejects when the active generation is aborted", async () => {
    const preprocess = preprocessor();
    const controller = new AbortController();
    const worker = new FakeWorker(() => undefined);
    const pending = analyzeStudioVrmAvatarReferenceImage(file(), catalogue(), {
      signal: controller.signal,
      preprocessorFactory: () => preprocess.instance,
      workerFactory: () => worker.asWorker(),
    });
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("surfaces an honest model-unavailable state from the Worker", async () => {
    const preprocess = preprocessor();
    const worker = new FakeWorker((self, message) => {
      if (message.kind !== "recommend") return;
      queueMicrotask(() => self.emit({
        version: 1,
        kind: "error",
        requestId: message.requestId,
        generationId: message.generationId,
        code: "model-unavailable",
      }));
    });

    await expect(analyzeStudioVrmAvatarReferenceImage(file(), catalogue(), {
      preprocessorFactory: () => preprocess.instance,
      workerFactory: () => worker.asWorker(),
    })).rejects.toEqual(expect.objectContaining<Partial<StudioVrmAvatarReferenceError>>({
      code: "model-unavailable",
      message: expect.stringContaining("MediaPipe"),
    }));
  });
});
