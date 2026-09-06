import {
  STUDIO_VRM_AVATAR_REFERENCE_LIMITS,
  STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
  StudioVrmAvatarReferenceError,
  admitStudioVrmAvatarReferenceCatalogue,
  type StudioVrmAvatarReferenceCatalogue,
  type StudioVrmAvatarReferenceErrorCode,
  type StudioVrmAvatarReferenceRecommendationReceipt,
} from "./studio-vrm-avatar-reference-recommendation";
import {
  isStudioVrmAvatarReferenceWorkerResponse,
  studioVrmAvatarReferenceRequestTransfers,
  type StudioVrmAvatarReferenceWorkerRequest,
} from "./studio-vrm-avatar-reference-worker-protocol";
import { StudioVrmPhotoPoseError } from "./studio-vrm-photo-pose";
import {
  StudioVrmPhotoPosePreprocessor,
  type StudioVrmPhotoPosePreprocessJob,
  type StudioVrmPhotoPoseProgress,
  type StudioVrmPhotoPoseReadableFile,
} from "./studio-vrm-photo-pose-worker-client";

export const STUDIO_VRM_AVATAR_REFERENCE_TIMEOUT_MS = 45_000;

export type StudioVrmAvatarReferenceProgressStage =
  | "admission"
  | "reading"
  | "inspecting"
  | "decoding"
  | "transforming"
  | "model"
  | "embedding"
  | "ranking"
  | "ready";

export interface StudioVrmAvatarReferenceProgress {
  readonly generationId: number;
  readonly stage: StudioVrmAvatarReferenceProgressStage;
  readonly progress: number;
}

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  preventDefault?(): void;
}

export interface StudioVrmAvatarReferenceWorkerLike {
  postMessage(message: StudioVrmAvatarReferenceWorkerRequest, transfers?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorEventLike) => void): void;
  terminate(): void;
}

export interface StudioVrmAvatarReferencePreprocessorLike {
  readonly currentGenerationId: number;
  start(
    file: StudioVrmPhotoPoseReadableFile,
    options: {
      readonly exifMode: "apply";
      readonly maxOutputDimension: number;
      readonly maxOutputPixels: number;
    },
    startOptions: {
      readonly signal?: AbortSignal;
      readonly onProgress?: (progress: StudioVrmPhotoPoseProgress) => void;
    },
  ): StudioVrmPhotoPosePreprocessJob;
  dispose(): void;
}

export interface StudioVrmAvatarReferenceAnalyzeOptions {
  readonly signal?: AbortSignal;
  readonly topK?: number;
  readonly timeoutMs?: number;
  readonly onProgress?: (progress: StudioVrmAvatarReferenceProgress) => void;
  /** Host/test seam. Product code uses the dedicated Vite-managed module Worker. */
  readonly workerFactory?: () => StudioVrmAvatarReferenceWorkerLike;
  /** Host/test seam. Product code uses the existing bounded photo preprocessing Worker. */
  readonly preprocessorFactory?: () => StudioVrmAvatarReferencePreprocessorLike;
}

let requestCounter = 0;

function nextRequestId(): number {
  requestCounter = requestCounter >= Number.MAX_SAFE_INTEGER ? 1 : requestCounter + 1;
  return requestCounter;
}

function defaultWorkerFactory(): StudioVrmAvatarReferenceWorkerLike {
  // Vite dev serves Worker entries as native ESM while production emits the configured bundled
  // entry. Keep the constructor explicitly module-typed in both modes; the Worker selects
  // MediaPipe's official module WASM loader, whose global ModuleFactory hand-off is compatible
  // with tasks-vision's module-worker fallback without evaluating unbundled ESM as classic code.
  return new Worker(new URL("./studio-vrm-avatar-reference.worker.ts", import.meta.url), {
    type: "module",
    name: "studio-vrm-avatar-reference-image-embedder",
  });
}

function boundedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return STUDIO_VRM_AVATAR_REFERENCE_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.min(120_000, Math.floor(timeoutMs)));
}

function mapPreprocessError(error: unknown): StudioVrmAvatarReferenceError {
  if (!(error instanceof StudioVrmPhotoPoseError)) {
    return new StudioVrmAvatarReferenceError("decode-failed", { cause: error });
  }
  const exact: Partial<Record<typeof error.code, StudioVrmAvatarReferenceErrorCode>> = {
    aborted: "aborted",
    disposed: "disposed",
    "stale-generation": "stale-generation",
    timeout: "timeout",
    "unsupported-browser": "unsupported-browser",
    "worker-failed": "worker-failed",
    "decode-failed": "decode-failed",
  };
  return new StudioVrmAvatarReferenceError(exact[error.code] ?? "file-invalid", { cause: error });
}

function closeBitmap(bitmap: ImageBitmap): void {
  try {
    bitmap.close();
  } catch {
    // Cleanup is best effort; the result is rejected independently.
  }
}

function expectedCataloguePresetIds(
  catalogue: StudioVrmAvatarReferenceCatalogue,
): readonly string[] {
  return catalogue.entries.map((entry) => entry.presetId).sort((left, right) =>
    left.localeCompare(right, "en")
  );
}

function hasExactCatalogueAuthority(
  receipt: StudioVrmAvatarReferenceRecommendationReceipt,
  catalogue: StudioVrmAvatarReferenceCatalogue,
): boolean {
  if (receipt.catalogueRevision !== catalogue.catalogueRevision) return false;
  const expectedIds = expectedCataloguePresetIds(catalogue);
  return receipt.cataloguePresetIds.length === expectedIds.length
    && receipt.cataloguePresetIds.every((presetId, index) => presetId === expectedIds[index]);
}

function runInferenceWorker(input: {
  readonly bitmap: ImageBitmap;
  readonly catalogue: StudioVrmAvatarReferenceCatalogue;
  readonly generationId: number;
  readonly topK: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioVrmAvatarReferenceProgress) => void;
  readonly workerFactory: () => StudioVrmAvatarReferenceWorkerLike;
}): Promise<StudioVrmAvatarReferenceRecommendationReceipt> {
  if (input.signal?.aborted) {
    closeBitmap(input.bitmap);
    return Promise.reject(new StudioVrmAvatarReferenceError("aborted"));
  }
  const requestId = nextRequestId();
  return new Promise((resolve, reject) => {
    let worker: StudioVrmAvatarReferenceWorkerLike;
    let settled = false;
    let ownershipTransferred = false;
    try {
      worker = input.workerFactory();
    } catch (cause) {
      closeBitmap(input.bitmap);
      reject(new StudioVrmAvatarReferenceError("worker-failed", { cause }));
      return;
    }

    const settle = (
      receipt?: StudioVrmAvatarReferenceRecommendationReceipt,
      error?: StudioVrmAvatarReferenceError,
    ) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      input.signal?.removeEventListener("abort", handleAbort);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleWorkerFailure);
      worker.removeEventListener("messageerror", handleWorkerFailure);
      worker.terminate();
      if (!ownershipTransferred) closeBitmap(input.bitmap);
      if (error) reject(error);
      else if (receipt) resolve(receipt);
      else reject(new StudioVrmAvatarReferenceError("protocol"));
    };
    const cancelWorker = () => {
      try {
        worker.postMessage({
          version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
          kind: "cancel",
          requestId,
          generationId: input.generationId,
        });
      } catch {
        // The Worker is terminated during settlement regardless.
      }
    };
    const handleAbort = () => {
      cancelWorker();
      settle(undefined, new StudioVrmAvatarReferenceError("aborted"));
    };
    const handleWorkerFailure = (event: WorkerErrorEventLike) => {
      event.preventDefault?.();
      settle(undefined, new StudioVrmAvatarReferenceError("worker-failed"));
    };
    const handleMessage = (event: WorkerMessageEventLike) => {
      const response = event.data;
      if (
        !isStudioVrmAvatarReferenceWorkerResponse(response)
        || response.requestId !== requestId
        || response.generationId !== input.generationId
      ) {
        settle(undefined, new StudioVrmAvatarReferenceError("protocol"));
        return;
      }
      if (response.kind === "progress") {
        try {
          input.onProgress?.({
            generationId: input.generationId,
            stage: response.stage,
            progress: 0.5 + response.progress * 0.49,
          });
        } catch {
          // Progress is observational and cannot change request ownership.
        }
        return;
      }
      if (response.kind === "error") {
        settle(undefined, new StudioVrmAvatarReferenceError(response.code));
        return;
      }
      if (!hasExactCatalogueAuthority(response.receipt, input.catalogue)) {
        settle(undefined, new StudioVrmAvatarReferenceError("protocol"));
        return;
      }
      settle(response.receipt);
    };
    const timeout = globalThis.setTimeout(() => {
      cancelWorker();
      settle(undefined, new StudioVrmAvatarReferenceError("timeout"));
    }, input.timeoutMs);

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleWorkerFailure);
    worker.addEventListener("messageerror", handleWorkerFailure);
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    const request: StudioVrmAvatarReferenceWorkerRequest = {
      version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
      kind: "recommend",
      requestId,
      generationId: input.generationId,
      bitmap: input.bitmap,
      catalogue: input.catalogue,
      topK: input.topK,
    };
    try {
      worker.postMessage(request, studioVrmAvatarReferenceRequestTransfers(request));
      ownershipTransferred = true;
    } catch (cause) {
      settle(undefined, new StudioVrmAvatarReferenceError("worker-failed", { cause }));
    }
  });
}

export function supportsStudioVrmAvatarReferenceRecommendations(): boolean {
  return typeof globalThis.Worker === "function"
    && typeof globalThis.createImageBitmap === "function"
    && typeof globalThis.OffscreenCanvas === "function";
}

/**
 * Full ephemeral pipeline: bounded decode/resize Worker -> dedicated MediaPipe ImageEmbedder
 * Worker -> immutable recommendation receipt. Neither bytes nor bitmaps are persisted.
 */
export async function analyzeStudioVrmAvatarReferenceImage(
  file: StudioVrmPhotoPoseReadableFile,
  catalogueInput: StudioVrmAvatarReferenceCatalogue,
  options: StudioVrmAvatarReferenceAnalyzeOptions = {},
): Promise<StudioVrmAvatarReferenceRecommendationReceipt> {
  if (options.signal?.aborted) throw new StudioVrmAvatarReferenceError("aborted");
  const catalogue = admitStudioVrmAvatarReferenceCatalogue(catalogueInput);
  const topK = options.topK ?? 3;
  if (
    !Number.isSafeInteger(topK)
    || topK < 1
    || topK > STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxTopK
  ) throw new StudioVrmAvatarReferenceError("protocol");
  const preprocessor = options.preprocessorFactory?.() ?? new StudioVrmPhotoPosePreprocessor();
  let bitmap: ImageBitmap | null = null;
  try {
    let job: StudioVrmPhotoPosePreprocessJob;
    try {
      job = preprocessor.start(
        file,
        {
          exifMode: "apply",
          maxOutputDimension: STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxOutputDimension,
          maxOutputPixels: STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxOutputPixels,
        },
        {
          signal: options.signal,
          onProgress: (progress) => {
            try {
              options.onProgress?.({
                generationId: progress.generationId,
                stage: progress.stage,
                progress: progress.progress * 0.48,
              });
            } catch {
              // Progress is observational and cannot change preprocessing ownership.
            }
          },
        },
      );
    } catch (error) {
      throw mapPreprocessError(error);
    }
    let preprocessed: Awaited<typeof job.result>;
    try {
      preprocessed = await job.result;
    } catch (error) {
      throw mapPreprocessError(error);
    }
    bitmap = preprocessed.bitmap;
    if (
      options.signal?.aborted
      || preprocessed.generationId !== job.generationId
      || job.generationId !== preprocessor.currentGenerationId
    ) throw new StudioVrmAvatarReferenceError("stale-generation");
    const transferableBitmap = bitmap;
    bitmap = null;
    const receipt = await runInferenceWorker({
      bitmap: transferableBitmap,
      catalogue,
      generationId: job.generationId,
      topK,
      timeoutMs: boundedTimeout(options.timeoutMs),
      signal: options.signal,
      onProgress: options.onProgress,
      workerFactory: options.workerFactory ?? defaultWorkerFactory,
    });
    try {
      options.onProgress?.({
        generationId: job.generationId,
        stage: "ready",
        progress: 1,
      });
    } catch {
      // Progress is observational.
    }
    return receipt;
  } finally {
    if (bitmap) closeBitmap(bitmap);
    preprocessor.dispose();
  }
}
