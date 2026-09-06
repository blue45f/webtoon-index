import {
  STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION,
  STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
  isStudioHokusaiLiveSha256,
  packStudioHokusaiLiveSamples,
  studioHokusaiLiveInboundTransfers,
  type StudioHokusaiLiveBrushCapabilities,
  type StudioHokusaiLiveBrushConfig,
  type StudioHokusaiLiveCanonicalReceipt,
  type StudioHokusaiLiveSampleLike,
  type StudioHokusaiLiveWorkerInboundMessage,
} from "./studio-hokusai-live-brush-protocol";
import {
  resolveStudioHokusaiLiveRoute,
  studioHokusaiLiveSampleFitsPinnedSegment,
  type StudioHokusaiLiveRouteInput,
  type StudioHokusaiLiveRouteResult,
} from "./studio-hokusai-live-brush-router";
import {
  STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION,
} from "./studio-hokusai-natural-media-worker-protocol";

export const STUDIO_HOKUSAI_LIVE_STARTUP_TIMEOUT_MS = 30_000 as const;
export const STUDIO_HOKUSAI_LIVE_FINISH_TIMEOUT_MS = 60_000 as const;

export interface StudioHokusaiLiveFrame {
  readonly sequence: number;
  readonly phase: "canonical" | "live" | "settle-tail";
  readonly segmentIndex: number;
  readonly dirtyBounds: readonly [number, number, number, number];
  readonly logicalPlacement: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  /** Ownership was transferred from the Worker; no main-thread full-frame copy is made. */
  readonly pixels: Uint8Array;
  readonly pixelHash: `sha256:${string}`;
}

export interface StudioHokusaiLiveCanonicalResult {
  readonly finalFrame: StudioHokusaiLiveFrame;
  readonly pngBytes: ArrayBuffer;
  readonly receipt: StudioHokusaiLiveCanonicalReceipt;
}

export interface StudioHokusaiLiveWorkerLike {
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "messageerror", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  terminate(): void;
}

export interface StudioHokusaiLiveBrushProviderOptions {
  readonly workerFactory?: () => StudioHokusaiLiveWorkerLike;
  readonly startupTimeoutMs?: number;
  readonly finishTimeoutMs?: number;
}

export interface StudioHokusaiLiveStrokeOptions {
  readonly strokeId: string;
  readonly signal: AbortSignal;
  readonly onFrame: (frame: StudioHokusaiLiveFrame) => void;
}

type ProviderState = "failed" | "idle" | "loading" | "ready" | "unavailable";

interface MessageRecord extends Record<string, unknown> {
  readonly type: string;
  readonly version: number;
}

function isRecord(value: unknown): value is MessageRecord {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { type?: unknown }).type === "string"
    && typeof (value as { version?: unknown }).version === "number";
}

function arrayBuffer(value: unknown): value is ArrayBuffer {
  return typeof value === "object"
    && value !== null
    && Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function integer(value: unknown, minimum = 1): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function validBounds(
  value: unknown,
  width: number,
  height: number,
): value is readonly [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [x, y, dirtyWidth, dirtyHeight] = value;
  return integer(x, 0)
    && integer(y, 0)
    && integer(dirtyWidth)
    && integer(dirtyHeight)
    && x + dirtyWidth <= width
    && y + dirtyHeight <= height;
}

function validPlacement(value: unknown): value is StudioHokusaiLiveFrame["logicalPlacement"] {
  if (typeof value !== "object" || value === null) return false;
  const placement = value as Partial<StudioHokusaiLiveFrame["logicalPlacement"]>;
  return [placement.x, placement.y, placement.width, placement.height]
    .every((entry) => typeof entry === "number" && Number.isFinite(entry))
    && (placement.width ?? 0) > 0
    && (placement.height ?? 0) > 0;
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("Hokusai live stroke was aborted.", "AbortError");
  }
  const error = new Error("Hokusai live stroke was aborted.");
  error.name = "AbortError";
  return error;
}

function prewarmClosedError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException(
      "Hokusai live Worker prewarm was cancelled because the provider closed.",
      "AbortError",
    );
  }
  const error = new Error(
    "Hokusai live Worker prewarm was cancelled because the provider closed.",
  );
  error.name = "AbortError";
  return error;
}

function smoothstep(value: number): number {
  const normalized = Math.max(0, Math.min(1, value));
  return normalized * normalized * (3 - 2 * normalized);
}

function defaultWorkerFactory(): StudioHokusaiLiveWorkerLike {
  if (typeof Worker !== "function") {
    throw new Error("Dedicated Worker is unavailable.");
  }
  return new Worker(
    new URL("./studio-hokusai-live-brush.worker.ts", import.meta.url),
    { type: "module", name: "studio-hokusai-live-brush" },
  );
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

async function sha256(buffer: ArrayBuffer): Promise<`sha256:${string}`> {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    throw new Error("Web Crypto is unavailable for canonical Hokusai validation.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

function readyCapabilities(value: unknown): StudioHokusaiLiveBrushCapabilities | null {
  if (!isRecord(value) || value.type !== "studio-hokusai-live/ready") return null;
  const capabilities = value.capabilities;
  if (typeof capabilities !== "object" || capabilities === null) return null;
  const candidate = capabilities as Partial<StudioHokusaiLiveBrushCapabilities>;
  return candidate.engine === "reearth-hokusai"
    && candidate.engineVersion === "0.3.0"
    && candidate.surfaceAdapterVersion === STUDIO_HOKUSAI_WORKER_ADAPTER_VERSION
    && candidate.liveAdapterVersion === STUDIO_HOKUSAI_LIVE_ADAPTER_VERSION
    && candidate.wasm === true
    && candidate.dedicatedWorker === true
    && candidate.packedDirtyFrames === true
    && candidate.transferableFrames === true
    && candidate.epochCancellation === true
    && candidate.canonicalPng === true
    && candidate.liveCommitParityReceipt === true
    && candidate.materialTexture === "studio-hokusai-material-texture-v2"
    && candidate.materialProfileRouting === "identity-profile-v1"
    && candidate.endpointPolicy === "tapered-start-no-dab-carrier-v1"
    && candidate.mainThreadFullFrameCopy === false
    ? candidate as StudioHokusaiLiveBrushCapabilities
    : null;
}

let nextRequestId = 0;

function requestId(): number {
  nextRequestId += 1;
  if (!Number.isSafeInteger(nextRequestId)) {
    throw new Error("Hokusai live request id exhausted.");
  }
  return nextRequestId;
}

interface StudioHokusaiLivePrewarmAttempt {
  readonly generation: number;
  readonly worker: StudioHokusaiLiveWorkerLike;
  cancel(cause: Error): void;
}

export class StudioHokusaiLiveBrushProvider {
  readonly #workerFactory: () => StudioHokusaiLiveWorkerLike;
  readonly #startupTimeoutMs: number;
  readonly #finishTimeoutMs: number;
  #worker: StudioHokusaiLiveWorkerLike | null = null;
  #state: ProviderState = "idle";
  #capabilities: StudioHokusaiLiveBrushCapabilities | null = null;
  #prewarmPromise: Promise<StudioHokusaiLiveBrushCapabilities> | null = null;
  #prewarmAttempt: StudioHokusaiLivePrewarmAttempt | null = null;
  #prewarmGeneration = 0;
  #active: StudioHokusaiLiveStrokeSession | null = null;
  #epoch = 0;

  constructor(options: StudioHokusaiLiveBrushProviderOptions = {}) {
    this.#workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.#startupTimeoutMs = options.startupTimeoutMs
      ?? STUDIO_HOKUSAI_LIVE_STARTUP_TIMEOUT_MS;
    this.#finishTimeoutMs = options.finishTimeoutMs
      ?? STUDIO_HOKUSAI_LIVE_FINISH_TIMEOUT_MS;
  }

  get state(): ProviderState {
    return this.#state;
  }

  get capabilities(): StudioHokusaiLiveBrushCapabilities | null {
    return this.#capabilities;
  }

  prewarm(): Promise<StudioHokusaiLiveBrushCapabilities> {
    if (this.#prewarmPromise) return this.#prewarmPromise;
    const generation = this.#prewarmGeneration + 1;
    this.#prewarmGeneration = generation;
    this.#state = "loading";
    let worker: StudioHokusaiLiveWorkerLike;
    try {
      worker = this.#workerFactory();
    } catch (error) {
      if (this.#prewarmGeneration === generation) {
        this.#state = "unavailable";
      }
      const failed = Promise.reject<StudioHokusaiLiveBrushCapabilities>(error);
      this.#prewarmPromise = failed;
      return failed;
    }
    this.#worker = worker;
    const attempt: StudioHokusaiLivePrewarmAttempt = {
      generation,
      worker,
      cancel: () => undefined,
    };
    this.#prewarmAttempt = attempt;
    const promise = new Promise<StudioHokusaiLiveBrushCapabilities>((resolve, reject) => {
      let settled = false;
      const timer = globalThis.setTimeout(() => {
        finish((owned) => {
          worker.terminate();
          if (owned) {
            this.#state = "failed";
            this.#worker = null;
          }
          reject(new Error("Hokusai live Worker prewarm timed out."));
        });
      }, this.#startupTimeoutMs);
      const cleanup = (): void => {
        globalThis.clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
      };
      const finish = (callback: (owned: boolean) => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const owned = this.#prewarmAttempt === attempt
          && this.#prewarmGeneration === generation
          && this.#worker === worker;
        if (this.#prewarmAttempt === attempt) this.#prewarmAttempt = null;
        callback(owned);
      };
      const onMessage = (event: MessageEvent<unknown>): void => {
        const capabilities = readyCapabilities(event.data);
        if (!capabilities) {
          finish((owned) => {
            worker.terminate();
            if (owned) {
              this.#state = "failed";
              this.#worker = null;
            }
            reject(new Error("Hokusai live Worker capability receipt is invalid."));
          });
          return;
        }
        finish((owned) => {
          if (!owned) {
            worker.terminate();
            reject(prewarmClosedError());
            return;
          }
          this.#capabilities = capabilities;
          this.#state = "ready";
          worker.addEventListener("message", this.#onMessage);
          worker.addEventListener("error", this.#onError);
          worker.addEventListener("messageerror", this.#onMessageError);
          resolve(capabilities);
        });
      };
      const onError = (event: ErrorEvent): void => finish((owned) => {
        worker.terminate();
        if (owned) {
          this.#state = "failed";
          this.#worker = null;
        }
        reject(new Error(event.message || "Hokusai live Worker failed during prewarm."));
      });
      const onMessageError = (): void => finish((owned) => {
        worker.terminate();
        if (owned) {
          this.#state = "failed";
          this.#worker = null;
        }
        reject(new Error("Hokusai live Worker prewarm response could not be cloned."));
      });
      attempt.cancel = (cause: Error): void => finish(() => {
        worker.terminate();
        reject(cause);
      });
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
    });
    this.#prewarmPromise = promise;
    return promise;
  }

  admitStroke(input: Omit<StudioHokusaiLiveRouteInput, "capabilities" | "providerState">):
  StudioHokusaiLiveRouteResult {
    return resolveStudioHokusaiLiveRoute({
      ...input,
      providerState: this.#state === "idle" ? "loading" : this.#state,
      capabilities: this.#capabilities,
    });
  }

  async beginStroke(
    route: Extract<StudioHokusaiLiveRouteResult, { status: "ready" }>,
    options: StudioHokusaiLiveStrokeOptions,
  ): Promise<StudioHokusaiLiveStrokeSession> {
    if (this.#state !== "ready" || !this.#worker || this.#active) {
      throw new Error("Hokusai live provider is not ready at the stroke boundary.");
    }
    if (options.signal.aborted) throw abortError();
    this.#epoch += 1;
    const session = new StudioHokusaiLiveStrokeSession({
      provider: this,
      worker: this.#worker,
      requestId: requestId(),
      engineEpoch: this.#epoch,
      strokeId: options.strokeId,
      config: route.config,
      signal: options.signal,
      onFrame: options.onFrame,
      finishTimeoutMs: this.#finishTimeoutMs,
    });
    this.#active = session;
    try {
      await session.begin();
      return session;
    } catch (error) {
      this.#release(session);
      throw error;
    }
  }

  close(): void {
    this.#active?.cancel("user-cancelled");
    this.#prewarmGeneration += 1;
    const prewarmAttempt = this.#prewarmAttempt;
    prewarmAttempt?.cancel(prewarmClosedError());
    const worker = this.#worker;
    if (worker) {
      worker.removeEventListener("message", this.#onMessage);
      worker.removeEventListener("error", this.#onError);
      worker.removeEventListener("messageerror", this.#onMessageError);
      if (worker !== prewarmAttempt?.worker) worker.terminate();
    }
    this.#prewarmAttempt = null;
    this.#worker = null;
    this.#capabilities = null;
    this.#prewarmPromise = null;
    this.#state = "idle";
  }

  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    this.#active?.handleMessage(event.data);
  };

  readonly #onError = (event: ErrorEvent): void => {
    event.preventDefault();
    this.#state = "failed";
    this.#active?.fail(new Error(event.message || "Hokusai live Worker failed."));
  };

  readonly #onMessageError = (): void => {
    this.#state = "failed";
    this.#active?.fail(new Error("Hokusai live Worker response could not be cloned."));
  };

  #release(session: StudioHokusaiLiveStrokeSession): void {
    if (this.#active === session) this.#active = null;
  }

  release(session: StudioHokusaiLiveStrokeSession): void {
    this.#release(session);
  }
}

interface SessionConstructorInput {
  readonly provider: StudioHokusaiLiveBrushProvider;
  readonly worker: StudioHokusaiLiveWorkerLike;
  readonly requestId: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly config: StudioHokusaiLiveBrushConfig;
  readonly signal: AbortSignal;
  readonly onFrame: (frame: StudioHokusaiLiveFrame) => void;
  readonly finishTimeoutMs: number;
}

export class StudioHokusaiLiveStrokeSession {
  readonly #provider: StudioHokusaiLiveBrushProvider;
  readonly #worker: StudioHokusaiLiveWorkerLike;
  readonly #requestId: number;
  readonly #engineEpoch: number;
  readonly #strokeId: string;
  readonly #config: StudioHokusaiLiveBrushConfig;
  readonly #signal: AbortSignal;
  readonly #onFrame: (frame: StudioHokusaiLiveFrame) => void;
  readonly #finishTimeoutMs: number;
  #sequence = 0;
  #lastInputTimeMilliseconds: number | null = null;
  #startTaperTravelPixels = 0;
  #startTaperLastPoint: Readonly<{ x: number; y: number }> | null = null;
  #startTaperComplete = false;
  #lastPresentedSequence = 0;
  #settleTailPresented = false;
  #begun = false;
  #closed = false;
  #finishRequested = false;
  #beginResolve: (() => void) | null = null;
  #beginReject: ((reason: unknown) => void) | null = null;
  #finishResolve: ((result: StudioHokusaiLiveCanonicalResult) => void) | null = null;
  #finishReject: ((reason: unknown) => void) | null = null;
  #finishTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  constructor(input: SessionConstructorInput) {
    this.#provider = input.provider;
    this.#worker = input.worker;
    this.#requestId = input.requestId;
    this.#engineEpoch = input.engineEpoch;
    this.#strokeId = input.strokeId;
    this.#config = input.config;
    this.#signal = input.signal;
    this.#onFrame = input.onFrame;
    this.#finishTimeoutMs = input.finishTimeoutMs;
    this.#signal.addEventListener("abort", this.#onAbort, { once: true });
  }

  begin(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#beginResolve = resolve;
      this.#beginReject = reject;
      this.#post({
        type: "studio-hokusai-live/begin",
        version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
        requestId: this.#requestId,
        engineEpoch: this.#engineEpoch,
        strokeId: this.#strokeId,
        config: this.#config,
      });
    });
  }

  append(samples: readonly StudioHokusaiLiveSampleLike[]): number {
    if (!this.#begun || this.#closed || this.#finishRequested) {
      throw new Error("Hokusai live stroke is not accepting input.");
    }
    if (!samples.every((sample) => (
      studioHokusaiLiveSampleFitsPinnedSegment(this.#config, sample)
    ))) {
      const error = new Error(
        "Hokusai live stroke left its pinned 4096px segment. The stroke was cancelled before "
        + "transfer because a mid-stroke renderer fallback would break live/commit, undo and save parity.",
      );
      this.#post({
        type: "studio-hokusai-live/cancel",
        version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
        requestId: this.#requestId,
        engineEpoch: this.#engineEpoch,
        strokeId: this.#strokeId,
        reason: "epoch-replaced",
      });
      this.fail(error);
      throw error;
    }
    // Taper the physical carrier through pressure provenance rather than a
    // post-render spatial mask. A mask cannot distinguish a later crossing
    // from the first dab and used to punch holes in figure-eight strokes.
    const taperLength = Math.max(
      1,
      this.#config.radiusPixels * (this.#config.presetId === "oil" ? 1.45 : 1.1),
    );
    const rendererSamples = samples.map((sample) => {
      if (this.#startTaperComplete) return sample;
      if (this.#startTaperLastPoint) {
        this.#startTaperTravelPixels += Math.hypot(
          sample.x - this.#startTaperLastPoint.x,
          sample.y - this.#startTaperLastPoint.y,
        );
      }
      this.#startTaperLastPoint = { x: sample.x, y: sample.y };
      const progress = this.#startTaperTravelPixels / taperLength;
      if (progress >= 1) {
        this.#startTaperComplete = true;
        return sample;
      }
      return {
        ...sample,
        pressure: (sample.pressure ?? 0.5) * smoothstep(progress),
      };
    });
    const packed = packStudioHokusaiLiveSamples(
      rendererSamples,
      this.#lastInputTimeMilliseconds,
    );
    this.#sequence += 1;
    this.#post({
      type: "studio-hokusai-live/append",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      requestId: this.#requestId,
      engineEpoch: this.#engineEpoch,
      strokeId: this.#strokeId,
      sequence: this.#sequence,
      sampleCount: samples.length,
      sampleStride: 6,
      samples: packed.buffer,
    });
    this.#lastInputTimeMilliseconds = packed.lastTimeMilliseconds;
    return this.#sequence;
  }

  finish(): Promise<StudioHokusaiLiveCanonicalResult> {
    if (!this.#begun || this.#closed || this.#finishRequested || this.#sequence <= 0) {
      return Promise.reject(new Error("Hokusai live stroke cannot be finished."));
    }
    this.#finishRequested = true;
    this.#finishTimer = globalThis.setTimeout(() => {
      this.fail(new Error("Hokusai live canonical finish timed out."));
    }, this.#finishTimeoutMs);
    const result = new Promise<StudioHokusaiLiveCanonicalResult>((resolve, reject) => {
      this.#finishResolve = resolve;
      this.#finishReject = reject;
    });
    this.#postFinishWhenPresented();
    return result;
  }

  cancel(reason: "abort" | "epoch-replaced" | "user-cancelled" = "user-cancelled"): void {
    if (this.#closed) return;
    this.#post({
      type: "studio-hokusai-live/cancel",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      requestId: this.#requestId,
      engineEpoch: this.#engineEpoch,
      strokeId: this.#strokeId,
      reason,
    });
    this.fail(reason === "abort" ? abortError() : new Error("Hokusai live stroke cancelled."));
  }

  handleMessage(candidate: unknown): void {
    if (!isRecord(candidate) || candidate.version !== STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION) {
      this.fail(new Error("Hokusai live Worker response is invalid."));
      return;
    }
    if (candidate.type === "studio-hokusai-live/failure") {
      if (
        candidate.requestId === null
        || (
          candidate.requestId === this.#requestId
          && candidate.engineEpoch === this.#engineEpoch
          && candidate.strokeId === this.#strokeId
        )
      ) this.fail(new Error(String(candidate.detail ?? candidate.reason ?? "Hokusai failure")));
      return;
    }
    if (
      candidate.requestId !== this.#requestId
      || candidate.engineEpoch !== this.#engineEpoch
      || candidate.strokeId !== this.#strokeId
    ) return;
    if (candidate.type === "studio-hokusai-live/begun") {
      this.#begun = true;
      this.#beginResolve?.();
      this.#beginResolve = null;
      this.#beginReject = null;
      return;
    }
    if (candidate.type === "studio-hokusai-live/accepted") {
      if (
        !integer(candidate.sequence)
        || candidate.presentation !== "no-dirty-pixels"
        || candidate.sequence <= this.#lastPresentedSequence
        || candidate.sequence > this.#sequence
      ) {
        this.fail(new Error("Hokusai no-dirty input acknowledgement is invalid or stale."));
        return;
      }
      // A slow-tracking first contact can consume input without producing a
      // transferable dirty patch. It still advances the exact input prefix so
      // finish can flush the pointer-up tail instead of timing out.
      this.#lastPresentedSequence = candidate.sequence;
      this.#postFinishWhenPresented();
      return;
    }
    if (candidate.type === "studio-hokusai-live/frame") {
      const frame = this.#snapshotFrame(candidate);
      const liveFrameIsOrdered = frame?.phase === "live"
        && frame.sequence > this.#lastPresentedSequence;
      const settleTailIsOrdered = frame?.phase === "settle-tail"
        && this.#finishRequested
        && !this.#settleTailPresented
        && frame.sequence === this.#sequence;
      if (!frame || (!liveFrameIsOrdered && !settleTailIsOrdered)) {
        this.fail(new Error("Hokusai live frame failed validation or ordering."));
        return;
      }
      if (frame.phase === "live") this.#lastPresentedSequence = frame.sequence;
      else this.#settleTailPresented = true;
      try {
        this.#onFrame(frame);
      } finally {
        this.#post({
          type: "studio-hokusai-live/frame-ack",
          version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
          requestId: this.#requestId,
          engineEpoch: this.#engineEpoch,
          strokeId: this.#strokeId,
          sequence: frame.sequence,
        });
      }
      if (frame.phase === "live") this.#postFinishWhenPresented();
      return;
    }
    if (candidate.type === "studio-hokusai-live/complete") {
      void this.#acceptComplete(candidate);
      return;
    }
    if (candidate.type === "studio-hokusai-live/cancelled") {
      this.fail(new Error("Hokusai live stroke cancelled."));
    }
  }

  fail(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#cleanup();
    this.#beginReject?.(error);
    this.#finishReject?.(error);
    this.#beginResolve = null;
    this.#beginReject = null;
    this.#finishResolve = null;
    this.#finishReject = null;
    this.#provider.release(this);
  }

  #post(message: StudioHokusaiLiveWorkerInboundMessage): void {
    this.#worker.postMessage(message, studioHokusaiLiveInboundTransfers(message));
  }

  #postFinishWhenPresented(): void {
    if (
      !this.#finishRequested
      || this.#closed
      || this.#lastPresentedSequence !== this.#sequence
    ) return;
    this.#post({
      type: "studio-hokusai-live/finish",
      version: STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION,
      requestId: this.#requestId,
      engineEpoch: this.#engineEpoch,
      strokeId: this.#strokeId,
      finalSequence: this.#sequence,
    });
    // Posting exactly once is controlled by moving beyond the equality sentinel.
    this.#lastPresentedSequence = -this.#lastPresentedSequence;
  }

  #snapshotFrame(candidate: MessageRecord): StudioHokusaiLiveFrame | null {
    if (
      !integer(candidate.sequence)
      || !["canonical", "live", "settle-tail"].includes(String(candidate.phase))
      || !integer(candidate.segmentIndex, 0)
      || !validBounds(
        candidate.dirtyBounds,
        this.#config.surfaceWidth,
        this.#config.surfaceHeight,
      )
      || !validPlacement(candidate.logicalPlacement)
      || candidate.pixelLayout !== "packed-dirty-rgba8"
      || !arrayBuffer(candidate.pixels)
      || candidate.pixels.byteLength
        !== candidate.dirtyBounds[2] * candidate.dirtyBounds[3] * 4
      || !isStudioHokusaiLiveSha256(candidate.pixelHash)
    ) return null;
    return {
      sequence: candidate.sequence,
      phase: candidate.phase as StudioHokusaiLiveFrame["phase"],
      segmentIndex: candidate.segmentIndex,
      dirtyBounds: candidate.dirtyBounds,
      logicalPlacement: candidate.logicalPlacement,
      pixels: new Uint8Array(candidate.pixels),
      pixelHash: candidate.pixelHash,
    };
  }

  async #acceptComplete(candidate: MessageRecord): Promise<void> {
    if (
      !this.#finishRequested
      || !integer(candidate.finalSequence)
      || candidate.finalSequence !== this.#sequence
      || !arrayBuffer(candidate.pixels)
      || !arrayBuffer(candidate.pngBytes)
      || typeof candidate.receipt !== "object"
      || candidate.receipt === null
    ) {
      this.fail(new Error("Hokusai canonical result is structurally invalid."));
      return;
    }
    const receipt = candidate.receipt as Partial<StudioHokusaiLiveCanonicalReceipt>;
    const frame = this.#snapshotFrame({
      ...candidate,
      type: "studio-hokusai-live/frame",
      phase: "canonical",
      sequence: candidate.finalSequence,
      pixelHash: receipt.settledPixelHash,
    });
    if (
      !frame
      || receipt.kind !== "studio-hokusai-live/canonical-receipt"
      || receipt.version !== STUDIO_HOKUSAI_LIVE_BRUSH_PROTOCOL_VERSION
      || receipt.requestId !== this.#requestId
      || receipt.engineEpoch !== this.#engineEpoch
      || receipt.strokeId !== this.#strokeId
      || receipt.presetId !== this.#config.presetId
      || receipt.materialProfileId !== this.#config.materialProfileId
      || receipt.finalSequence !== this.#sequence
      || receipt.exactLiveCommitParity !== true
      || receipt.lastLivePixelHash !== receipt.settledPixelHash
      || receipt.materialTexture !== "studio-hokusai-material-texture-v2"
      || receipt.endpointPolicy !== "tapered-start-no-dab-carrier-v1"
      || receipt.colorOpacityApplication !== "worker-once-before-material-transfer-v1"
      || !isStudioHokusaiLiveSha256(receipt.settledPixelHash)
      || !isStudioHokusaiLiveSha256(receipt.pngHash)
      || !isStudioHokusaiLiveSha256(receipt.inputHash)
      || receipt.canonicalAuthority !== "settled-png-receipt-v1"
      || receipt.undoAuthority !== "single-stroke-transaction-v1"
      || receipt.saveAuthority !== "canonical-png-plus-versioned-receipt-v1"
      || receipt.complete !== true
    ) {
      this.fail(new Error("Hokusai canonical parity receipt is invalid."));
      return;
    }
    try {
      const [pixelHash, pngHash] = await Promise.all([
        sha256(candidate.pixels),
        sha256(candidate.pngBytes),
      ]);
      if (pixelHash !== receipt.settledPixelHash || pngHash !== receipt.pngHash) {
        throw new Error("Hokusai transferred canonical bytes do not match the receipt.");
      }
      if (this.#closed) return;
      this.#closed = true;
      this.#cleanup();
      this.#finishResolve?.({
        finalFrame: frame,
        pngBytes: candidate.pngBytes,
        receipt: receipt as StudioHokusaiLiveCanonicalReceipt,
      });
      this.#finishResolve = null;
      this.#finishReject = null;
      this.#provider.release(this);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error("Hokusai hash validation failed."));
    }
  }

  readonly #onAbort = (): void => this.cancel("abort");

  #cleanup(): void {
    this.#signal.removeEventListener("abort", this.#onAbort);
    if (this.#finishTimer !== null) globalThis.clearTimeout(this.#finishTimer);
    this.#finishTimer = null;
  }
}
