import {
  STUDIO_BG3D_SHOT_BATCH_MAX_ARTIFACTS,
  STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS,
  isStudioBg3dShotBatchManifestContext,
  type StudioBg3dShotBatchContactSheet,
  type StudioBg3dShotBatchImage,
  type StudioBg3dShotBatchLayeredPsd,
  type StudioBg3dShotBatchManifestContext,
  type StudioBg3dShotBatchProgress,
} from "./studio-bg3d-shot-batch";
import { verifyStudioBg3dShotBatchArchiveBlob } from "./studio-bg3d-shot-batch-archive-verifier";
import {
  STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotBatchWorkerRequest,
  isStudioBg3dShotBatchWorkerResponse,
  type StudioBg3dShotBatchWorkerRequest,
} from "./studio-bg3d-shot-batch-worker-protocol";

export const STUDIO_BG3D_SHOT_BATCH_WORKER_TIMEOUT_MS = 180_000;
export const STUDIO_BG3D_SHOT_BATCH_WORKER_STARTUP_TIMEOUT_MS = 10_000;

interface WorkerMessageLike {
  readonly data: unknown;
}

interface WorkerErrorLike {
  preventDefault?(): void;
}

export interface StudioBg3dShotBatchWorkerLike {
  postMessage(message: StudioBg3dShotBatchWorkerRequest): void;
  addEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  terminate(): void;
}

export interface StudioBg3dShotBatchWorkerOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioBg3dShotBatchProgress) => void;
  readonly timeoutMs?: number;
  readonly startupTimeoutMs?: number;
  readonly workerFactory?: () => StudioBg3dShotBatchWorkerLike;
  readonly manifest?: StudioBg3dShotBatchManifestContext;
  readonly layeredPsds?: readonly StudioBg3dShotBatchLayeredPsd[];
  readonly contactSheets?: readonly StudioBg3dShotBatchContactSheet[];
}

export type StudioBg3dShotBatchWorkerErrorCode =
  | "aborted"
  | "timeout"
  | "worker-unavailable"
  | "worker-failed"
  | "protocol"
  | "build-failed"
  | "archive-invalid";

/** Stable Worker failure discriminator for fail-closed batch export reporting. */
export class StudioBg3dShotBatchWorkerError extends Error {
  constructor(readonly code: StudioBg3dShotBatchWorkerErrorCode) {
    super(`studio-bg3d-shot-batch-worker:${code}`);
    this.name = code === "aborted"
      ? "AbortError"
      : code === "timeout"
        ? "TimeoutError"
        : code === "worker-unavailable"
          ? "WorkerUnavailableError"
          : code === "protocol" || code === "archive-invalid"
            ? "ProtocolError"
            : "WorkerError";
  }
}

let nextRequestId = 1;

function defaultWorkerFactory(): StudioBg3dShotBatchWorkerLike {
  return new Worker(new URL("./studio-bg3d-shot-batch.worker.ts", import.meta.url), {
    type: "module",
    name: "studio-bg3d-shot-batch-archive",
  });
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_BG3D_SHOT_BATCH_WORKER_TIMEOUT_MS;
  return Math.max(5_000, Math.min(300_000, Math.floor(value as number)));
}

function boundedStartupTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_BG3D_SHOT_BATCH_WORKER_STARTUP_TIMEOUT_MS;
  return Math.max(250, Math.min(30_000, Math.floor(value as number)));
}

function snapshotManifest(value: StudioBg3dShotBatchManifestContext | undefined) {
  if (value === undefined) return undefined;
  try {
    const snapshot = JSON.parse(JSON.stringify(value)) as unknown;
    return isStudioBg3dShotBatchManifestContext(snapshot)
      ? snapshot as StudioBg3dShotBatchManifestContext
      : null;
  } catch {
    return null;
  }
}

function snapshotRequest(
  requestId: number,
  images: readonly StudioBg3dShotBatchImage[],
  options: StudioBg3dShotBatchWorkerOptions,
): StudioBg3dShotBatchWorkerRequest | null {
  const manifest = snapshotManifest(options.manifest);
  if (manifest === null) return null;
  try {
    const imageSnapshots = images.map((image): StudioBg3dShotBatchImage => ({
      shotId: image.shotId,
      shotName: image.shotName,
      width: image.width,
      height: image.height,
      ...(image.pass === undefined ? {} : { pass: image.pass }),
      ...(image.output === undefined ? {} : { output: image.output }),
      ...(image.requestedHeight === undefined ? {} : { requestedHeight: image.requestedHeight }),
      ...(image.wasReduced === undefined ? {} : { wasReduced: image.wasReduced }),
      png: image.png,
    }));
    const layeredPsds = options.layeredPsds?.map((artifact): StudioBg3dShotBatchLayeredPsd => ({
      shotId: artifact.shotId,
      shotName: artifact.shotName,
      width: artifact.width,
      height: artifact.height,
      psd: artifact.psd,
    }));
    const contactSheets = options.contactSheets?.map((artifact): StudioBg3dShotBatchContactSheet => ({
      sheetNumber: artifact.sheetNumber,
      fileName: artifact.fileName,
      width: artifact.width,
      height: artifact.height,
      shotIds: [...artifact.shotIds],
      png: artifact.png,
    }));
    const request: StudioBg3dShotBatchWorkerRequest = {
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      kind: "build",
      requestId,
      images: imageSnapshots,
      ...(manifest === undefined ? {} : { manifest }),
      ...(layeredPsds === undefined ? {} : { layeredPsds }),
      ...(contactSheets === undefined ? {} : { contactSheets }),
    };
    return isStudioBg3dShotBatchWorkerRequest(request) ? request : null;
  } catch {
    return null;
  }
}

export function buildStudioBg3dShotBatchArchiveInWorker(
  images: readonly StudioBg3dShotBatchImage[],
  options: StudioBg3dShotBatchWorkerOptions = {},
): Promise<Blob> {
  if (!Array.isArray(images) || images.length < 1 || images.length > STUDIO_BG3D_SHOT_BATCH_MAX_ARTIFACTS) {
    return Promise.reject(new StudioBg3dShotBatchWorkerError("protocol"));
  }
  if (
    options.layeredPsds !== undefined &&
    (!Array.isArray(options.layeredPsds) || options.layeredPsds.length > STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS)
  ) {
    return Promise.reject(new StudioBg3dShotBatchWorkerError("protocol"));
  }
  if (
    options.contactSheets !== undefined &&
    (!Array.isArray(options.contactSheets) || options.contactSheets.length > STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS)
  ) {
    return Promise.reject(new StudioBg3dShotBatchWorkerError("protocol"));
  }
  if (options.signal?.aborted) {
    return Promise.reject(new StudioBg3dShotBatchWorkerError("aborted"));
  }
  const requestId = nextRequestId;
  nextRequestId = nextRequestId >= Number.MAX_SAFE_INTEGER ? 1 : nextRequestId + 1;
  const request = snapshotRequest(requestId, images, options);
  if (!request) return Promise.reject(new StudioBg3dShotBatchWorkerError("protocol"));

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let ready = false;
    let verifying = false;
    let worker: StudioBg3dShotBatchWorkerLike | null = null;
    const verificationAbortController = new AbortController();
    let startupTimeout: ReturnType<typeof setTimeout> | null = null;
    let buildTimeout: ReturnType<typeof setTimeout> | null = null;
    const safely = (callback: () => void) => {
      try {
        callback();
      } catch {
        // A host-provided Worker shim cannot prevent deterministic settlement or cleanup.
      }
    };
    const detachAndTerminateWorker = () => {
      if (!worker) return;
      safely(() => worker?.removeEventListener("message", onMessage));
      safely(() => worker?.removeEventListener("error", onWorkerError));
      safely(() => worker?.removeEventListener("messageerror", onWorkerError));
      safely(() => worker?.terminate());
      worker = null;
    };
    const cleanup = () => {
      if (startupTimeout !== null) clearTimeout(startupTimeout);
      if (buildTimeout !== null) clearTimeout(buildTimeout);
      options.signal?.removeEventListener("abort", abort);
      detachAndTerminateWorker();
      // Blob streams used by the independent ZIP verifier must not continue consuming CPU after
      // a caller abort or the end-to-end timeout has already settled this request.
      verificationAbortController.abort();
    };
    const finish = (archive: Blob | null, error?: StudioBg3dShotBatchWorkerError) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (archive) resolve(archive);
      else reject(error ?? new StudioBg3dShotBatchWorkerError("worker-failed"));
    };
    const fail = (code: StudioBg3dShotBatchWorkerErrorCode) =>
      finish(null, new StudioBg3dShotBatchWorkerError(code));
    const abort = () => fail("aborted");
    const onMessage = (event: WorkerMessageLike) => {
      if (settled) return;
      const response = event.data;
      if (!isStudioBg3dShotBatchWorkerResponse(response)) {
        fail("protocol");
        return;
      }
      if (response.kind === "ready") {
        if (ready || verifying || !worker) {
          fail("protocol");
          return;
        }
        ready = true;
        if (startupTimeout !== null) clearTimeout(startupTimeout);
        startupTimeout = null;
        buildTimeout = setTimeout(() => fail("timeout"), boundedTimeout(options.timeoutMs));
        try {
          worker.postMessage(request);
        } catch {
          fail("worker-failed");
        }
        return;
      }
      if (!ready || verifying || response.requestId !== requestId) {
        fail("protocol");
        return;
      }
      if (response.kind === "progress") {
        try {
          options.onProgress?.(response.progress);
        } catch {
          fail("worker-failed");
        }
        return;
      }
      if (response.kind === "error") {
        fail(response.code === "protocol" ? "protocol" : "build-failed");
        return;
      }
      verifying = true;
      detachAndTerminateWorker();
      void verifyStudioBg3dShotBatchArchiveBlob(response.archive, {
        signal: verificationAbortController.signal,
        expected: {
          images: request.images,
          ...(request.manifest ? { manifest: request.manifest } : {}),
          ...(request.layeredPsds ? { layeredPsds: request.layeredPsds } : {}),
          ...(request.contactSheets ? { contactSheets: request.contactSheets } : {}),
        },
      }).then((valid) => {
        if (!valid) fail("archive-invalid");
        else finish(response.archive);
      }).catch((cause: unknown) => {
        fail(cause instanceof Error && cause.name === "AbortError" ? "aborted" : "archive-invalid");
      });
    };
    const onWorkerError = (event: WorkerErrorLike) => {
      event.preventDefault?.();
      fail(ready ? "worker-failed" : "worker-unavailable");
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    try {
      worker = (options.workerFactory ?? defaultWorkerFactory)();
      if (!worker || typeof worker.postMessage !== "function") {
        fail("worker-unavailable");
        return;
      }
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerError);
      worker.addEventListener("messageerror", onWorkerError);
      startupTimeout = setTimeout(
        () => fail("worker-unavailable"),
        boundedStartupTimeout(options.startupTimeoutMs),
      );
    } catch {
      fail("worker-unavailable");
    }
  });
}
