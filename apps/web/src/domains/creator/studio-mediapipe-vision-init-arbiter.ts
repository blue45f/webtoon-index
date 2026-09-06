/**
 * Process-wide authority for MediaPipe Vision module loading and Task creation.
 *
 * tasks-vision uses the ambient `Module`/`ModuleFactory` globals while createFromOptions settles.
 * Different Task classes therefore cannot initialize concurrently, even when each feature owns a
 * separate singleton promise. This FIFO keeps the entire factory settlement exclusive without
 * touching MediaPipe's globals itself.
 */

export type StudioMediaPipeVisionInitOwner =
  | "foreground-image-segmenter"
  | "mannequin-video-pose"
  | "vrm-avatar-reference-image"
  | "vrm-photo-hand"
  | "vrm-photo-pose"
  | "vrm-video-face"
  | "vrm-video-hand"
  | "vrm-video-pose";

export type StudioMediaPipeVisionRuntimeErrorCode =
  | "aborted"
  | "module-import-failed";

export class StudioMediaPipeVisionRuntimeError extends Error {
  readonly code: StudioMediaPipeVisionRuntimeErrorCode;

  constructor(
    code: StudioMediaPipeVisionRuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioMediaPipeVisionRuntimeError";
    this.code = code;
  }
}

export type StudioMediaPipeVisionModule = typeof import("@mediapipe/tasks-vision");

export interface StudioMediaPipeVisionTaskCreationInput<T> {
  readonly owner: StudioMediaPipeVisionInitOwner;
  readonly signal?: AbortSignal;
  readonly create: () => Promise<T>;
}

export interface StudioMediaPipeVisionInitArbiter {
  loadModule(): Promise<StudioMediaPipeVisionModule>;
  runTaskCreation<T>(input: StudioMediaPipeVisionTaskCreationInput<T>): Promise<T>;
}

export interface StudioMediaPipeVisionInitArbiterOptions {
  readonly loadModule?: () => Promise<StudioMediaPipeVisionModule>;
}

interface QueuedCreation<T> {
  readonly create: () => Promise<T>;
  readonly reject: (cause: unknown) => void;
  readonly resolve: (value: T) => void;
  readonly signal?: AbortSignal;
  abortListener: (() => void) | null;
  started: boolean;
}

function abortedError(signal?: AbortSignal): StudioMediaPipeVisionRuntimeError {
  return new StudioMediaPipeVisionRuntimeError(
    "aborted",
    "MediaPipe Vision Task initialization was cancelled before it started.",
    signal?.reason === undefined ? undefined : { cause: signal.reason },
  );
}

function defaultModuleLoader(): Promise<StudioMediaPipeVisionModule> {
  return import("@mediapipe/tasks-vision");
}

export function createStudioMediaPipeVisionInitArbiter(
  options: StudioMediaPipeVisionInitArbiterOptions = {},
): StudioMediaPipeVisionInitArbiter {
  const loadModule = options.loadModule ?? defaultModuleLoader;
  let modulePromise: Promise<StudioMediaPipeVisionModule> | null = null;
  const queue: QueuedCreation<unknown>[] = [];
  let active = false;

  const pump = (): void => {
    if (active) return;
    const queued = queue.shift();
    if (!queued) return;
    if (queued.signal?.aborted) {
      queued.signal.removeEventListener("abort", queued.abortListener!);
      queued.abortListener = null;
      queued.reject(abortedError(queued.signal));
      pump();
      return;
    }

    active = true;
    queued.started = true;
    if (queued.abortListener) {
      queued.signal?.removeEventListener("abort", queued.abortListener);
      queued.abortListener = null;
    }
    void Promise.resolve()
      .then(queued.create)
      .then(queued.resolve, queued.reject)
      .finally(() => {
        active = false;
        pump();
      });
  };

  return Object.freeze({
    loadModule(): Promise<StudioMediaPipeVisionModule> {
      if (modulePromise) return modulePromise;
      const pending = Promise.resolve()
        .then(loadModule)
        .catch((cause: unknown) => {
          if (modulePromise === pending) modulePromise = null;
          throw new StudioMediaPipeVisionRuntimeError(
            "module-import-failed",
            "MediaPipe Vision runtime module failed to load.",
            { cause },
          );
        });
      modulePromise = pending;
      return pending;
    },

    runTaskCreation<T>(input: StudioMediaPipeVisionTaskCreationInput<T>): Promise<T> {
      if (input.signal?.aborted) return Promise.reject(abortedError(input.signal));
      return new Promise<T>((resolve, reject) => {
        const queued: QueuedCreation<T> = {
          create: input.create,
          reject,
          resolve,
          signal: input.signal,
          abortListener: null,
          started: false,
        };
        const abortListener = () => {
          if (queued.started) return;
          const index = queue.indexOf(queued as QueuedCreation<unknown>);
          if (index >= 0) queue.splice(index, 1);
          queued.abortListener = null;
          reject(abortedError(input.signal));
          pump();
        };
        queued.abortListener = abortListener;
        input.signal?.addEventListener("abort", abortListener, { once: true });
        queue.push(queued as QueuedCreation<unknown>);
        pump();
      });
    },
  });
}

const productArbiter = createStudioMediaPipeVisionInitArbiter();

export function loadStudioMediaPipeVisionModule(): Promise<StudioMediaPipeVisionModule> {
  return productArbiter.loadModule();
}

export function runStudioMediaPipeVisionTaskCreation<T>(
  input: StudioMediaPipeVisionTaskCreationInput<T>,
): Promise<T> {
  return productArbiter.runTaskCreation(input);
}
