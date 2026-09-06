/**
 * Post-paint batching for the Yjs live-stroke path.
 *
 * Local pixels are drawn in the pointer task. Yjs encoding, observer delivery, and socket update
 * creation are collaboration work, so they run only after the browser has had a paint opportunity.
 * Pointer release can still flush synchronously before the final scene commit, preserving the
 * begin -> append -> finalize ordering required by StudioCrdtDocument.
 */

export interface StudioCrdtLiveStrokePublisherScheduler {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void): number;
  clearTimer(handle: number): void;
}

export interface StudioCrdtLiveStrokeAppend<Snapshot> {
  readonly snapshot: Snapshot;
  readonly startSample: number;
  readonly publish: (snapshot: Snapshot, startSample: number) => void;
}

interface PendingStroke<Snapshot> {
  readonly strokeId: string;
  begin: (() => void) | null;
  append: StudioCrdtLiveStrokeAppend<Snapshot> | null;
}

export interface StudioCrdtLiveStrokePublisherOptions {
  readonly scheduler: StudioCrdtLiveStrokePublisherScheduler;
  readonly onError: (cause: unknown) => void;
}

export class StudioCrdtLiveStrokePublisher<Snapshot> {
  readonly #scheduler: StudioCrdtLiveStrokePublisherScheduler;
  readonly #onError: (cause: unknown) => void;
  #pending: PendingStroke<Snapshot> | null = null;
  #frame: number | null = null;
  #timer: number | null = null;
  #disposed = false;

  constructor(options: StudioCrdtLiveStrokePublisherOptions) {
    this.#scheduler = options.scheduler;
    this.#onError = options.onError;
  }

  get pendingStrokeId(): string | null {
    return this.#pending?.strokeId ?? null;
  }

  begin(strokeId: string, publish: () => void): void {
    if (this.#disposed) return;
    this.#switchStrokeIfNeeded(strokeId);
    this.#pending ??= { strokeId, begin: null, append: null };
    this.#pending.begin = publish;
    this.#scheduleAfterPaint();
  }

  append(strokeId: string, input: StudioCrdtLiveStrokeAppend<Snapshot>): void {
    if (this.#disposed) return;
    this.#switchStrokeIfNeeded(strokeId);
    this.#pending ??= { strokeId, begin: null, append: null };
    const previous = this.#pending.append;
    this.#pending.append = {
      snapshot: input.snapshot,
      startSample: previous
        ? Math.min(previous.startSample, input.startSample)
        : input.startSample,
      publish: input.publish,
    };
    this.#scheduleAfterPaint();
  }

  /** Flushes begin and the coalesced suffix synchronously, normally from pointer release. */
  flush(strokeId?: string): boolean {
    if (strokeId && this.#pending?.strokeId !== strokeId) return true;
    this.#cancelSchedule();
    const pending = this.#pending;
    this.#pending = null;
    if (!pending) return true;
    try {
      pending.begin?.();
      if (pending.append) {
        pending.append.publish(pending.append.snapshot, pending.append.startSample);
      }
      return true;
    } catch (cause) {
      this.#onError(cause);
      return false;
    }
  }

  /** Drops work for an abandoned pointer contact without publishing it. */
  cancel(strokeId?: string): void {
    if (strokeId && this.#pending?.strokeId !== strokeId) return;
    this.#pending = null;
    this.#cancelSchedule();
  }

  dispose(): void {
    this.#disposed = true;
    this.cancel();
  }

  #switchStrokeIfNeeded(strokeId: string): void {
    if (this.#pending && this.#pending.strokeId !== strokeId) this.flush();
  }

  #scheduleAfterPaint(): void {
    if (this.#frame !== null || this.#timer !== null) return;
    this.#frame = this.#scheduler.requestFrame(() => {
      this.#frame = null;
      if (this.#disposed || !this.#pending) return;
      // A timer queued from rAF runs as a later task, after the current rendering opportunity.
      this.#timer = this.#scheduler.setTimer(() => {
        this.#timer = null;
        this.flush();
      });
    });
  }

  #cancelSchedule(): void {
    if (this.#frame !== null) {
      this.#scheduler.cancelFrame(this.#frame);
      this.#frame = null;
    }
    if (this.#timer !== null) {
      this.#scheduler.clearTimer(this.#timer);
      this.#timer = null;
    }
  }
}
