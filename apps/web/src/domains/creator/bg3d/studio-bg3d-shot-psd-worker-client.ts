import {
  STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_SHOT_PSD_MIME,
  admitStudioBg3dShotPsdLayers,
} from "./studio-bg3d-shot-psd-contract";
import {
  STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotPsdWorkerResponse,
  type StudioBg3dShotPsdWorkerRequest,
} from "./studio-bg3d-shot-psd-worker-protocol";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

export const STUDIO_BG3D_SHOT_PSD_WORKER_TIMEOUT_MS = 90_000;

interface WorkerMessageLike { readonly data: unknown }
interface WorkerErrorLike { preventDefault?(): void }

export interface StudioBg3dShotPsdWorkerLike {
  postMessage(message: StudioBg3dShotPsdWorkerRequest): void;
  addEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  terminate(): void;
}

export interface StudioBg3dShotPsdWorkerOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly workerFactory?: () => StudioBg3dShotPsdWorkerLike;
}

let nextRequestId = 1;

function defaultWorkerFactory(): StudioBg3dShotPsdWorkerLike {
  return new Worker(new URL("./studio-bg3d-shot-psd.worker.ts", import.meta.url), {
    type: "module",
    name: "studio-bg3d-shot-layered-psd",
  });
}

function workerError(name: "AbortError" | "TimeoutError" | "WorkerError" | "ProtocolError"): Error {
  const error = new Error("3D 컷 레이어 PSD Worker를 완료하지 못했습니다.");
  error.name = name;
  return error;
}

async function validPsd(blob: Blob, width: number, height: number): Promise<boolean> {
  if (
    blob.type !== STUDIO_BG3D_SHOT_PSD_MIME ||
    blob.size < 26 ||
    blob.size > STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES
  ) return false;
  const bytes = new Uint8Array(await blob.slice(0, 26).arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53 &&
    bytes[4] === 0 && bytes[5] === 1 &&
    view.getUint32(14, false) === height && view.getUint32(18, false) === width;
}

export function buildStudioBg3dShotLayeredPsdInWorker(
  layers: readonly StudioBg3dLtRasterLayer[],
  options: StudioBg3dShotPsdWorkerOptions = {},
): Promise<Blob> {
  const admission = admitStudioBg3dShotPsdLayers(layers);
  if (!admission.ok) {
    return Promise.reject(workerError("ProtocolError"));
  }
  if (options.signal?.aborted) return Promise.reject(workerError("AbortError"));
  const requestId = nextRequestId;
  nextRequestId = nextRequestId >= Number.MAX_SAFE_INTEGER ? 1 : nextRequestId + 1;
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(5_000, Math.min(120_000, Math.floor(options.timeoutMs!)))
    : STUDIO_BG3D_SHOT_PSD_WORKER_TIMEOUT_MS;

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let worker: StudioBg3dShotPsdWorkerLike;
    const timeout = setTimeout(() => finish(null, workerError("TimeoutError")), timeoutMs);
    const abort = () => finish(null, workerError("AbortError"));
    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      worker?.removeEventListener("message", onMessage);
      worker?.removeEventListener("error", onWorkerError);
      worker?.removeEventListener("messageerror", onWorkerError);
      worker?.terminate();
    };
    const finish = (psd: Blob | null, error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (psd) resolve(psd);
      else reject(error ?? workerError("WorkerError"));
    };
    const onMessage = (event: WorkerMessageLike) => {
      const response = event.data;
      if (!isStudioBg3dShotPsdWorkerResponse(response) || response.requestId !== requestId) {
        finish(null, workerError("ProtocolError"));
        return;
      }
      if (response.kind === "error") {
        finish(null, workerError(response.code === "protocol" ? "ProtocolError" : "WorkerError"));
        return;
      }
      void validPsd(response.psd, admission.width, admission.height).then((valid) => {
        if (valid) finish(response.psd);
        else finish(null, workerError("ProtocolError"));
      }).catch(() => finish(null, workerError("ProtocolError")));
    };
    const onWorkerError = (event: WorkerErrorLike) => {
      event.preventDefault?.();
      finish(null, workerError("WorkerError"));
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      worker = (options.workerFactory ?? defaultWorkerFactory)();
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerError);
      worker.addEventListener("messageerror", onWorkerError);
      worker.postMessage({
        version: STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION,
        kind: "build",
        requestId,
        layers: [...layers],
      });
    } catch {
      finish(null, workerError("WorkerError"));
    }
  });
}
