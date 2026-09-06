import {
  resolveStudioBg3dShotContactSheetLayout,
  validateStudioBg3dShotContactSheetImages,
  validateStudioBg3dShotContactSheetResult,
  type StudioBg3dShotContactSheetImage,
  type StudioBg3dShotContactSheetLayoutOptions,
  type StudioBg3dShotContactSheetProgress,
  type StudioBg3dShotContactSheetResult,
} from "./studio-bg3d-shot-contact-sheet-contract";
import {
  STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotContactSheetWorkerResponse,
  type StudioBg3dShotContactSheetWorkerRequest,
} from "./studio-bg3d-shot-contact-sheet-worker-protocol";

export const STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_TIMEOUT_MS = 120_000;

interface WorkerMessageLike {
  readonly data: unknown;
}

interface WorkerErrorLike {
  preventDefault?(): void;
}

export interface StudioBg3dShotContactSheetWorkerLike {
  postMessage(message: StudioBg3dShotContactSheetWorkerRequest): void;
  addEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  terminate(): void;
}

export interface StudioBg3dShotContactSheetWorkerOptions {
  readonly layout?: StudioBg3dShotContactSheetLayoutOptions;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioBg3dShotContactSheetProgress) => void;
  readonly timeoutMs?: number;
  readonly workerFactory?: () => StudioBg3dShotContactSheetWorkerLike;
}

let nextRequestId = 1;

function defaultWorkerFactory(): StudioBg3dShotContactSheetWorkerLike {
  return new Worker(new URL("./studio-bg3d-shot-contact-sheet.worker.ts", import.meta.url), {
    type: "module",
    name: "studio-bg3d-shot-contact-sheet",
  });
}

function jobError(
  name: "AbortError" | "TimeoutError" | "WorkerError" | "ProtocolError" | "NotSupportedError",
): Error {
  const error = new Error("컷 콘택트 시트 Worker를 완료하지 못했습니다.");
  error.name = name;
  return error;
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_TIMEOUT_MS;
  return Math.max(5_000, Math.min(300_000, Math.floor(value as number)));
}

function normalizedLayoutOptions(
  layout: ReturnType<typeof resolveStudioBg3dShotContactSheetLayout>,
): StudioBg3dShotContactSheetLayoutOptions {
  return {
    columns: layout.columns,
    rows: layout.rows,
    cellWidth: layout.cellWidth,
    cellHeight: layout.cellHeight,
    gap: layout.gap,
    padding: layout.padding,
    labelHeight: layout.labelHeight,
    background: layout.background,
  };
}

export async function buildStudioBg3dShotContactSheetsInWorker(
  images: readonly StudioBg3dShotContactSheetImage[],
  options: StudioBg3dShotContactSheetWorkerOptions = {},
): Promise<StudioBg3dShotContactSheetResult> {
  try {
    await validateStudioBg3dShotContactSheetImages(images, options.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw jobError("AbortError");
    throw jobError("ProtocolError");
  }
  if (options.signal?.aborted) throw jobError("AbortError");
  let layout: ReturnType<typeof resolveStudioBg3dShotContactSheetLayout>;
  try {
    layout = resolveStudioBg3dShotContactSheetLayout(images.length, options.layout);
  } catch {
    throw jobError("ProtocolError");
  }
  const requestId = nextRequestId;
  nextRequestId = nextRequestId >= Number.MAX_SAFE_INTEGER ? 1 : nextRequestId + 1;

  return new Promise<StudioBg3dShotContactSheetResult>((resolve, reject) => {
    let worker: StudioBg3dShotContactSheetWorkerLike | undefined;
    let settled = false;
    let verifyingResult = false;
    let lastProgress: StudioBg3dShotContactSheetProgress = {
      completedShots: 0,
      totalShots: layout.shotCount,
      completedSheets: 0,
      totalSheets: layout.sheetCount,
    };
    const timeout = setTimeout(() => finish(undefined, jobError("TimeoutError")), boundedTimeout(options.timeoutMs));
    const abort = () => finish(undefined, jobError("AbortError"));
    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      worker?.removeEventListener("message", onMessage);
      worker?.removeEventListener("error", onWorkerError);
      worker?.removeEventListener("messageerror", onWorkerError);
      worker?.terminate();
    };
    const finish = (result?: StudioBg3dShotContactSheetResult, error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result) resolve(result);
      else reject(error ?? jobError("WorkerError"));
    };
    const onMessage = (event: WorkerMessageLike) => {
      if (verifyingResult) {
        finish(undefined, jobError("ProtocolError"));
        return;
      }
      const response = event.data;
      if (!isStudioBg3dShotContactSheetWorkerResponse(response) || response.requestId !== requestId) {
        finish(undefined, jobError("ProtocolError"));
        return;
      }
      if (response.kind === "progress") {
        const progress = response.progress;
        if (
          progress.totalShots !== layout.shotCount ||
          progress.totalSheets !== layout.sheetCount ||
          progress.completedShots < lastProgress.completedShots ||
          progress.completedSheets < lastProgress.completedSheets
        ) {
          finish(undefined, jobError("ProtocolError"));
          return;
        }
        lastProgress = progress;
        try {
          options.onProgress?.(progress);
        } catch {
          // A UI progress observer cannot invalidate a completed render.
        }
        return;
      }
      if (response.kind === "error") {
        const name = response.code === "protocol"
          ? "ProtocolError"
          : response.code === "unsupported-runtime"
            ? "NotSupportedError"
            : "WorkerError";
        finish(undefined, jobError(name));
        return;
      }
      verifyingResult = true;
      void validateStudioBg3dShotContactSheetResult(
        response.result,
        images,
        layout,
        options.signal,
      ).then(() => finish(response.result)).catch((error: unknown) => {
        const name = error instanceof Error && error.name === "AbortError" ? "AbortError" : "ProtocolError";
        finish(undefined, jobError(name));
      });
    };
    const onWorkerError = (event: WorkerErrorLike) => {
      event.preventDefault?.();
      finish(undefined, jobError("WorkerError"));
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      worker = (options.workerFactory ?? defaultWorkerFactory)();
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerError);
      worker.addEventListener("messageerror", onWorkerError);
      worker.postMessage({
        version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
        kind: "build",
        requestId,
        images: [...images],
        layout: normalizedLayoutOptions(layout),
      });
    } catch {
      finish(undefined, jobError("WorkerError"));
    }
  });
}
