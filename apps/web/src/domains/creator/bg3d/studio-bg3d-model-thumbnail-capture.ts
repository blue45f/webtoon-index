import {
  createBg3dModelThumbnailCaptureRevision,
  isSafeBg3dModelStorageId,
  saveBg3dModelThumbnailIfCurrentV12 as saveBg3dModelThumbnailIfCurrent,
} from "./bg3d-model-library";
import {
  captureStudioBg3dRaster,
  type StudioBg3dCapturedRaster,
  type StudioBg3dCaptureAdapter,
  type StudioBg3dCaptureRequest,
} from "./studio-bg3d-capture-adapter";
import { verifyStudioBg3dRgba8PngFile } from "./studio-bg3d-file-integrity";
import {
  STUDIO_BG3D_MODEL_THUMBNAIL_HEIGHT,
  STUDIO_BG3D_MODEL_THUMBNAIL_MAX_BYTES,
  STUDIO_BG3D_MODEL_THUMBNAIL_WIDTH,
  inspectStudioBg3dModelThumbnailDataUrl,
} from "./studio-bg3d-model-thumbnail-data";
import { encodeStudioBg3dModelThumbnailPng } from "./studio-bg3d-model-thumbnail-encode";
import { StudioBg3dShotPngWorkerError } from "./studio-bg3d-shot-png-worker-client";

export const STUDIO_BG3D_MODEL_THUMBNAIL_MAX_QUEUED_JOBS = 4;
export const STUDIO_BG3D_MODEL_THUMBNAIL_DEFAULT_TIMEOUT_MS = 30_000;

export type StudioBg3dModelThumbnailCaptureStage =
  | "queued"
  | "capturing"
  | "encoding"
  | "verifying"
  | "persisting"
  | "ready";

export interface StudioBg3dModelThumbnailCaptureProgress {
  readonly generationId: number;
  readonly requestId: number;
  readonly stage: StudioBg3dModelThumbnailCaptureStage;
  readonly progress: number;
}

export interface StudioBg3dModelThumbnailCaptureInput {
  readonly storageModelId: string;
  /** The UI adapter must expose an isolated, fitted view of this one model before enqueueing. */
  readonly adapter: StudioBg3dCaptureAdapter;
  readonly background?: {
    readonly color: string;
    readonly alpha: number;
  };
  /** Session/scene fence owned by the integrating modal. */
  readonly isCurrent?: () => boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioBg3dModelThumbnailCaptureProgress) => void;
}

export interface StudioBg3dModelThumbnailCaptureResult {
  readonly storageModelId: string;
  readonly generationId: number;
  readonly requestId: number;
  readonly captureRevision: number;
  readonly dataUrl: string;
  readonly byteLength: number;
  readonly width: typeof STUDIO_BG3D_MODEL_THUMBNAIL_WIDTH;
  readonly height: typeof STUDIO_BG3D_MODEL_THUMBNAIL_HEIGHT;
}

export type StudioBg3dModelThumbnailCaptureErrorCode =
  | "aborted"
  | "capacity-exceeded"
  | "capture-failed"
  | "disposed"
  | "encode-failed"
  | "environment-unsupported"
  | "invalid-request"
  | "persistence-failed"
  | "stale"
  | "timeout"
  | "verification-failed";

export class StudioBg3dModelThumbnailCaptureError extends Error {
  constructor(readonly code: StudioBg3dModelThumbnailCaptureErrorCode, options?: ErrorOptions) {
    super(`studio-bg3d-model-thumbnail:${code}`, options);
    this.name = code === "aborted"
      ? "AbortError"
      : code === "timeout"
        ? "TimeoutError"
        : "StudioBg3dModelThumbnailCaptureError";
  }
}

interface CaptureEncodeIdentity {
  readonly generationId: number;
  readonly requestId: number;
}

export interface StudioBg3dModelThumbnailCaptureDependencies {
  readonly capture?: (
    adapter: StudioBg3dCaptureAdapter,
    request: StudioBg3dCaptureRequest,
    options: { readonly signal: AbortSignal; readonly timeoutMs: number },
  ) => Promise<StudioBg3dCapturedRaster>;
  readonly encode?: (
    raster: StudioBg3dCapturedRaster,
    identity: CaptureEncodeIdentity,
    signal: AbortSignal,
  ) => Promise<Blob>;
  readonly verify?: (
    png: Blob,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly toDataUrl?: (png: Blob, signal: AbortSignal) => Promise<string>;
  readonly persist?: (
    storageModelId: string,
    dataUrl: string,
    captureRevision: number,
  ) => Promise<boolean>;
  readonly revisionFactory?: () => number;
}

export interface StudioBg3dModelThumbnailCaptureControllerOptions {
  readonly timeoutMs?: number;
  readonly dependencies?: StudioBg3dModelThumbnailCaptureDependencies;
}

interface PendingCaptureJob {
  readonly input: StudioBg3dModelThumbnailCaptureInput;
  readonly generationId: number;
  readonly requestId: number;
  readonly captureRevision: number;
  readonly controller: AbortController;
  readonly resolve: (result: StudioBg3dModelThumbnailCaptureResult) => void;
  readonly reject: (error: StudioBg3dModelThumbnailCaptureError) => void;
  abortListener?: () => void;
  timeout: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  stageOrder: number;
  progress: number;
}

const STAGE_ORDER: Readonly<Record<StudioBg3dModelThumbnailCaptureStage, number>> = {
  queued: 0,
  capturing: 1,
  encoding: 2,
  verifying: 3,
  persisting: 4,
  ready: 5,
};

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_BG3D_MODEL_THUMBNAIL_DEFAULT_TIMEOUT_MS;
  return Math.max(250, Math.min(120_000, Math.floor(value ?? 0)));
}

function safely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Observer and host cleanup failures never change operation ownership.
  }
}

function isCurrent(input: StudioBg3dModelThumbnailCaptureInput): boolean {
  try {
    return input.isCurrent?.() ?? true;
  } catch {
    return false;
  }
}

async function defaultVerify(png: Blob, signal: AbortSignal): Promise<void> {
  await verifyStudioBg3dRgba8PngFile(png, {
    expectedWidth: STUDIO_BG3D_MODEL_THUMBNAIL_WIDTH,
    expectedHeight: STUDIO_BG3D_MODEL_THUMBNAIL_HEIGHT,
    maxBytes: STUDIO_BG3D_MODEL_THUMBNAIL_MAX_BYTES,
    signal,
  });
}

function defaultBlobToDataUrl(png: Blob, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(new StudioBg3dModelThumbnailCaptureError("aborted"));
  if (typeof FileReader !== "function") {
    return Promise.reject(new StudioBg3dModelThumbnailCaptureError("environment-unsupported"));
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = () => {
      try {
        reader.abort();
      } catch {
        // The signal still owns the terminal outcome when FileReader is already done.
      }
      finish(() => reject(new StudioBg3dModelThumbnailCaptureError("aborted")));
    };
    const handleReaderAbort = () => finish(() => reject(
      new StudioBg3dModelThumbnailCaptureError("aborted"),
    ));
    signal.addEventListener("abort", abort, { once: true });
    reader.onload = () => finish(() => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new StudioBg3dModelThumbnailCaptureError("verification-failed"));
    });
    reader.onerror = () => finish(() => reject(
      new StudioBg3dModelThumbnailCaptureError("verification-failed"),
    ));
    reader.onabort = handleReaderAbort;
    try {
      reader.readAsDataURL(png);
    } catch (cause) {
      finish(() => reject(new StudioBg3dModelThumbnailCaptureError("verification-failed", { cause })));
    }
  });
}

async function defaultPersist(
  storageModelId: string,
  dataUrl: string,
  captureRevision: number,
): Promise<boolean> {
  return saveBg3dModelThumbnailIfCurrent(storageModelId, dataUrl, { captureRevision });
}

function mapOperationError(error: unknown): StudioBg3dModelThumbnailCaptureError {
  if (error instanceof StudioBg3dModelThumbnailCaptureError) return error;
  if (error instanceof StudioBg3dShotPngWorkerError) {
    if (error.code === "aborted") return new StudioBg3dModelThumbnailCaptureError("aborted");
    if (error.code === "timeout") return new StudioBg3dModelThumbnailCaptureError("timeout");
    if (error.code === "worker-unavailable" || error.code === "offscreen-unavailable") {
      return new StudioBg3dModelThumbnailCaptureError("environment-unsupported", { cause: error });
    }
    return new StudioBg3dModelThumbnailCaptureError("encode-failed", { cause: error });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new StudioBg3dModelThumbnailCaptureError("aborted", { cause: error });
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new StudioBg3dModelThumbnailCaptureError("timeout", { cause: error });
  }
  return new StudioBg3dModelThumbnailCaptureError("capture-failed", { cause: error });
}

/**
 * Capacity-one capture lane. GPU readback remains adapter-owned and async; compression runs in a
 * fresh OffscreenCanvas Worker; only a strictly verified, current-generation result can reach IDB.
 */
export class StudioBg3dModelThumbnailCaptureController {
  readonly #timeoutMs: number;
  readonly #capture: NonNullable<StudioBg3dModelThumbnailCaptureDependencies["capture"]>;
  readonly #encode: NonNullable<StudioBg3dModelThumbnailCaptureDependencies["encode"]>;
  readonly #verify: NonNullable<StudioBg3dModelThumbnailCaptureDependencies["verify"]>;
  readonly #toDataUrl: NonNullable<StudioBg3dModelThumbnailCaptureDependencies["toDataUrl"]>;
  readonly #persist: NonNullable<StudioBg3dModelThumbnailCaptureDependencies["persist"]>;
  readonly #revisionFactory: NonNullable<StudioBg3dModelThumbnailCaptureDependencies["revisionFactory"]>;
  readonly #queue: PendingCaptureJob[] = [];
  #active: PendingCaptureJob | null = null;
  #generationId = 1;
  #nextRequestId = 1;
  #disposed = false;

  constructor(options: StudioBg3dModelThumbnailCaptureControllerOptions = {}) {
    const dependencies = options.dependencies ?? {};
    this.#timeoutMs = boundedTimeout(options.timeoutMs);
    this.#capture = dependencies.capture ?? captureStudioBg3dRaster;
    this.#encode = dependencies.encode ?? encodeStudioBg3dModelThumbnailPng;
    this.#verify = dependencies.verify ?? defaultVerify;
    this.#toDataUrl = dependencies.toDataUrl ?? defaultBlobToDataUrl;
    this.#persist = dependencies.persist ?? defaultPersist;
    this.#revisionFactory = dependencies.revisionFactory ?? createBg3dModelThumbnailCaptureRevision;
  }

  captureAndStore(
    input: StudioBg3dModelThumbnailCaptureInput,
  ): Promise<StudioBg3dModelThumbnailCaptureResult> {
    if (
      !input
      || typeof input !== "object"
      || !isSafeBg3dModelStorageId(input.storageModelId)
      || !input.adapter
      || typeof input.adapter !== "object"
      || (input.isCurrent !== undefined && typeof input.isCurrent !== "function")
      || (input.onProgress !== undefined && typeof input.onProgress !== "function")
    ) return Promise.reject(new StudioBg3dModelThumbnailCaptureError("invalid-request"));
    if (this.#disposed) {
      return Promise.reject(new StudioBg3dModelThumbnailCaptureError("disposed"));
    }
    if (input.signal?.aborted) {
      return Promise.reject(new StudioBg3dModelThumbnailCaptureError("aborted"));
    }
    if (this.#queue.length + (this.#active ? 1 : 0) >= STUDIO_BG3D_MODEL_THUMBNAIL_MAX_QUEUED_JOBS + 1) {
      return Promise.reject(new StudioBg3dModelThumbnailCaptureError("capacity-exceeded"));
    }
    let captureRevision: number;
    try {
      captureRevision = this.#revisionFactory();
    } catch (cause) {
      return Promise.reject(new StudioBg3dModelThumbnailCaptureError("invalid-request", { cause }));
    }
    if (!Number.isSafeInteger(captureRevision) || captureRevision < 1) {
      return Promise.reject(new StudioBg3dModelThumbnailCaptureError("invalid-request"));
    }
    const requestId = this.#nextRequestId;
    this.#nextRequestId = requestId >= Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
    return new Promise((resolve, reject) => {
      const job: PendingCaptureJob = {
        input,
        generationId: this.#generationId,
        requestId,
        captureRevision,
        controller: new AbortController(),
        resolve,
        reject,
        timeout: null,
        settled: false,
        stageOrder: 0,
        progress: 0,
      };
      job.abortListener = () => this.#settle(
        job,
        new StudioBg3dModelThumbnailCaptureError("aborted"),
      );
      input.signal?.addEventListener("abort", job.abortListener, { once: true });
      if (input.signal?.aborted) {
        this.#settle(job, new StudioBg3dModelThumbnailCaptureError("aborted"));
        return;
      }
      this.#queue.push(job);
      this.#emitProgress(job, "queued", 0);
      this.#drain();
    });
  }

  /** Invalidates active and queued work after a scene/modal epoch change. */
  invalidate(): void {
    if (this.#disposed) return;
    this.#generationId = this.#generationId >= Number.MAX_SAFE_INTEGER ? 1 : this.#generationId + 1;
    const active = this.#active;
    if (active) this.#settle(active, new StudioBg3dModelThumbnailCaptureError("stale"), false);
    while (this.#queue.length > 0) {
      const queued = this.#queue.shift();
      if (queued) this.#settle(queued, new StudioBg3dModelThumbnailCaptureError("stale"), false);
    }
    this.#active = null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const active = this.#active;
    if (active) this.#settle(active, new StudioBg3dModelThumbnailCaptureError("disposed"), false);
    while (this.#queue.length > 0) {
      const queued = this.#queue.shift();
      if (queued) this.#settle(queued, new StudioBg3dModelThumbnailCaptureError("disposed"), false);
    }
    this.#active = null;
  }

  #drain(): void {
    if (this.#disposed || this.#active) return;
    let job = this.#queue.shift();
    while (job?.settled) job = this.#queue.shift();
    if (!job) return;
    if (job.input.signal?.aborted) {
      this.#settle(job, new StudioBg3dModelThumbnailCaptureError("aborted"));
      return;
    }
    if (job.generationId !== this.#generationId || !isCurrent(job.input)) {
      this.#settle(job, new StudioBg3dModelThumbnailCaptureError("stale"));
      return;
    }
    this.#active = job;
    job.timeout = setTimeout(() => {
      if (this.#active === job) {
        this.#settle(job, new StudioBg3dModelThumbnailCaptureError("timeout"));
      }
    }, this.#timeoutMs);
    void this.#execute(job).then(
      (result) => this.#settle(job, result),
      (error: unknown) => this.#settle(job, mapOperationError(error)),
    );
  }

  async #execute(job: PendingCaptureJob): Promise<StudioBg3dModelThumbnailCaptureResult> {
    this.#assertAuthority(job);
    this.#emitProgress(job, "capturing", 0.08);
    let raster: StudioBg3dCapturedRaster;
    try {
      raster = await this.#capture(job.input.adapter, {
        width: STUDIO_BG3D_MODEL_THUMBNAIL_WIDTH,
        height: STUDIO_BG3D_MODEL_THUMBNAIL_HEIGHT,
        includeDepth: false,
        background: job.input.background ?? { color: "#f5f3ef", alpha: 1 },
      }, { signal: job.controller.signal, timeoutMs: this.#timeoutMs });
    } catch (cause) {
      const mapped = mapOperationError(cause);
      if (mapped.code === "aborted" || mapped.code === "timeout") throw mapped;
      throw new StudioBg3dModelThumbnailCaptureError("capture-failed", { cause });
    }
    this.#assertAuthority(job);
    this.#emitProgress(job, "encoding", 0.42);
    let png: Blob;
    try {
      png = await this.#encode(raster, {
        generationId: job.generationId,
        requestId: job.requestId,
      }, job.controller.signal);
    } catch (cause) {
      const mapped = mapOperationError(cause);
      if (
        mapped.code === "aborted"
        || mapped.code === "timeout"
        || mapped.code === "environment-unsupported"
      ) throw mapped;
      throw new StudioBg3dModelThumbnailCaptureError("encode-failed", { cause });
    }
    this.#assertAuthority(job);
    this.#emitProgress(job, "verifying", 0.7);
    try {
      await this.#verify(png, job.controller.signal);
    } catch (cause) {
      if (job.controller.signal.aborted) throw new StudioBg3dModelThumbnailCaptureError("aborted");
      throw new StudioBg3dModelThumbnailCaptureError("verification-failed", { cause });
    }
    this.#assertAuthority(job);
    const dataUrl = await this.#toDataUrl(png, job.controller.signal);
    const inspected = inspectStudioBg3dModelThumbnailDataUrl(dataUrl);
    if (
      !inspected
      || inspected.mime !== "image/png"
      || inspected.byteLength !== png.size
      || inspected.width !== STUDIO_BG3D_MODEL_THUMBNAIL_WIDTH
      || inspected.height !== STUDIO_BG3D_MODEL_THUMBNAIL_HEIGHT
    ) throw new StudioBg3dModelThumbnailCaptureError("verification-failed");
    this.#assertAuthority(job);
    this.#emitProgress(job, "persisting", 0.9);
    let persisted: boolean;
    try {
      persisted = await this.#persist(job.input.storageModelId, dataUrl, job.captureRevision);
    } catch (cause) {
      throw new StudioBg3dModelThumbnailCaptureError("persistence-failed", { cause });
    }
    if (!persisted) throw new StudioBg3dModelThumbnailCaptureError("stale");
    this.#assertAuthority(job);
    this.#emitProgress(job, "ready", 1);
    return Object.freeze({
      storageModelId: job.input.storageModelId,
      generationId: job.generationId,
      requestId: job.requestId,
      captureRevision: job.captureRevision,
      dataUrl,
      byteLength: inspected.byteLength,
      width: STUDIO_BG3D_MODEL_THUMBNAIL_WIDTH,
      height: STUDIO_BG3D_MODEL_THUMBNAIL_HEIGHT,
    });
  }

  #assertAuthority(job: PendingCaptureJob): void {
    if (job.controller.signal.aborted) {
      throw new StudioBg3dModelThumbnailCaptureError("aborted");
    }
    if (
      this.#active !== job
      || job.settled
      || job.generationId !== this.#generationId
      || !isCurrent(job.input)
    ) throw new StudioBg3dModelThumbnailCaptureError("stale");
  }

  #emitProgress(
    job: PendingCaptureJob,
    stage: StudioBg3dModelThumbnailCaptureStage,
    progress: number,
  ): void {
    const order = STAGE_ORDER[stage];
    if (order < job.stageOrder || progress < job.progress) return;
    job.stageOrder = order;
    job.progress = progress;
    safely(() => job.input.onProgress?.({
      generationId: job.generationId,
      requestId: job.requestId,
      stage,
      progress,
    }));
  }

  #settle(
    job: PendingCaptureJob,
    outcome: StudioBg3dModelThumbnailCaptureResult | StudioBg3dModelThumbnailCaptureError,
    continueQueue = true,
  ): void {
    if (job.settled) return;
    job.settled = true;
    if (job.timeout !== null) clearTimeout(job.timeout);
    if (!job.controller.signal.aborted) job.controller.abort();
    if (job.abortListener) job.input.signal?.removeEventListener("abort", job.abortListener);
    if (this.#active === job) this.#active = null;
    const queuedIndex = this.#queue.indexOf(job);
    if (queuedIndex >= 0) this.#queue.splice(queuedIndex, 1);
    if (outcome instanceof StudioBg3dModelThumbnailCaptureError) job.reject(outcome);
    else job.resolve(outcome);
    if (continueQueue) queueMicrotask(() => this.#drain());
  }
}
