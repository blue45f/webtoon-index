/**
 * Primary-owned coordinator for the detached Reference companion.
 *
 * Source decoding and preview composition are both demand-loaded. The coordinator never exposes
 * source RGBA or editable reference records: callers receive only bounded projection metadata,
 * encoded preview frames, or an exact sampled color.
 */

import type {
  StudioCompanionReferenceSourceRuntime,
  StudioCompanionReferenceSourceSnapshot,
} from "./studio-companion-reference-source-runtime";
import type {
  StudioCompanionReferencePreviewDependencies,
  StudioCompanionReferencePreviewFrameInput,
  StudioCompanionReferencePreviewItem,
} from "@/src/domains/creator/studio-companion-reference-preview";
import type {
  StudioCompanionReferenceCaptureCursor,
  StudioCompanionReferencePoint,
  StudioCompanionReferencePreviewFrame,
  StudioCompanionReferenceProjection,
} from "@/src/domains/creator/studio-companion-reference-projection";

import {
  STUDIO_COMPANION_REFERENCE_FAILURE_BACKOFF_MS,
  STUDIO_COMPANION_REFERENCE_MAX_ITEMS,
} from "@/src/domains/creator/studio-companion-reference-projection";

export interface StudioCompanionReferenceCaptureSnapshot {
  readonly document: unknown;
  /** Positive, monotonically increasing committed revision of the editable Reference board. */
  readonly revision: number;
  /** Bounded public item count paired with the exact same committed document and revision. */
  readonly itemCount: number;
}

export interface StudioCompanionReferenceCaptureRuntimeCallbacks {
  /** Atomically reads one committed document/revision/count generation from the primary editor. */
  getSnapshot(): StudioCompanionReferenceCaptureSnapshot;
  /** True while a stroke or another primary-only canvas mutation makes capture unsafe. */
  isCaptureBlocked(): boolean;
  /** Requests a primary protocol publish after a new source projection becomes ready. */
  onProjectionChanged(): void;
}

export interface StudioCompanionReferenceSourceRuntimeModule {
  createStudioCompanionReferenceSourceRuntime(): StudioCompanionReferenceSourceRuntime;
}

export interface StudioCompanionReferencePreviewRuntimeModule {
  createStudioCompanionReferencePreviewFrame(
    input: StudioCompanionReferencePreviewFrameInput,
    options?: { signal?: AbortSignal },
    dependencies?: Pick<StudioCompanionReferencePreviewDependencies, "encoderScope">
  ): Promise<StudioCompanionReferencePreviewFrame | null>;
  sampleStudioCompanionReferenceColor(
    items: readonly StudioCompanionReferencePreviewItem[],
    point: StudioCompanionReferencePoint,
    boardWidth: number,
    boardHeight: number
  ): string | null;
}

export interface StudioCompanionReferenceCaptureRuntimeDependencies {
  loadSourceRuntime?: () => Promise<StudioCompanionReferenceSourceRuntimeModule>;
  loadPreviewRuntime?: () => Promise<StudioCompanionReferencePreviewRuntimeModule>;
}

export type StudioCompanionReferenceCaptureRequest = Readonly<
  StudioCompanionReferenceCaptureCursor & {
    sequence: number;
    signal: AbortSignal;
  }
>;

export type StudioCompanionReferenceColorSampleRequest = Readonly<{
  current: StudioCompanionReferenceCaptureCursor;
  point: StudioCompanionReferencePoint;
  sequence: number;
  signal: AbortSignal;
}>;

export interface StudioCompanionReferenceCaptureRuntime {
  setDemand(active: boolean): Promise<boolean>;
  getProjection(generation: number): StudioCompanionReferenceProjection | null;
  captureFrame(
    request: StudioCompanionReferenceCaptureRequest
  ): Promise<StudioCompanionReferencePreviewFrame | null>;
  sampleColor(request: StudioCompanionReferenceColorSampleRequest): Promise<string | null>;
  release(): void;
}

type ReadySource = Readonly<{
  epoch: number;
  projectionRevision: number;
  referenceRevision: number;
  itemCount: number;
  snapshot: StudioCompanionReferenceSourceSnapshot;
}>;

type UnresolvedSource = Readonly<{
  epoch: number;
  projectionRevision: number;
  referenceRevision: number;
  itemCount: number;
}>;

type PreparingSource = Readonly<{
  epoch: number;
  referenceRevision: number;
  promise: Promise<boolean>;
}>;

type SourcePreparationFailure = Readonly<{
  referenceRevision: number;
  projectionRevision: number;
  count: number;
}>;

type IssuedProjection = Readonly<{
  epoch: number;
  projection: StudioCompanionReferenceProjection;
}>;

type CaptureSnapshot = Readonly<{
  ready: ReadySource;
  cursor: StudioCompanionReferenceCaptureCursor;
}>;

const MAX_ISSUED_GENERATIONS = 32;
const MAX_SOURCE_PREPARATION_FAILURES =
  STUDIO_COMPANION_REFERENCE_FAILURE_BACKOFF_MS.length + 1;
const COLOR_PATTERN = /^#[\da-f]{6}(?:[\da-f]{2})?$/iu;
const ABORTED_AWAIT = Symbol("studio-companion-reference-aborted-await");

async function loadDefaultSourceRuntime(): Promise<StudioCompanionReferenceSourceRuntimeModule> {
  return import("./studio-companion-reference-source-runtime");
}

async function loadDefaultPreviewRuntime(): Promise<StudioCompanionReferencePreviewRuntimeModule> {
  return import("@/src/domains/creator/studio-companion-reference-preview");
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function exactOwnData(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length
      || ownKeys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  try {
    return Boolean(
      value
      && typeof value === "object"
      && typeof (value as AbortSignal).aborted === "boolean"
      && typeof (value as AbortSignal).addEventListener === "function"
      && typeof (value as AbortSignal).removeEventListener === "function"
    );
  } catch {
    return false;
  }
}

function parseCursor(value: unknown): StudioCompanionReferenceCaptureCursor | null {
  const exact = exactOwnData(value, ["generation", "revision", "referenceRevision"]);
  if (
    !exact
    || !positiveSafeInteger(exact.generation)
    || !positiveSafeInteger(exact.revision)
    || !positiveSafeInteger(exact.referenceRevision)
  ) return null;
  return Object.freeze({
    generation: exact.generation,
    revision: exact.revision,
    referenceRevision: exact.referenceRevision,
  });
}

function parsePoint(value: unknown): StudioCompanionReferencePoint | null {
  const exact = exactOwnData(value, ["x", "y"]);
  if (
    !exact
    || typeof exact.x !== "number"
    || !Number.isFinite(exact.x)
    || exact.x < 0
    || exact.x > 1
    || typeof exact.y !== "number"
    || !Number.isFinite(exact.y)
    || exact.y < 0
    || exact.y > 1
  ) return null;
  return Object.freeze({ x: exact.x, y: exact.y });
}

function parseCaptureRequest(value: unknown): StudioCompanionReferenceCaptureRequest | null {
  const exact = exactOwnData(value, [
    "generation",
    "revision",
    "referenceRevision",
    "sequence",
    "signal",
  ]);
  if (!exact || !positiveSafeInteger(exact.sequence) || !isAbortSignal(exact.signal)) return null;
  const cursor = parseCursor({
    generation: exact.generation,
    revision: exact.revision,
    referenceRevision: exact.referenceRevision,
  });
  return cursor ? Object.freeze({ ...cursor, sequence: exact.sequence, signal: exact.signal }) : null;
}

function parseColorRequest(value: unknown): StudioCompanionReferenceColorSampleRequest | null {
  const exact = exactOwnData(value, ["current", "point", "sequence", "signal"]);
  if (!exact || !positiveSafeInteger(exact.sequence) || !isAbortSignal(exact.signal)) return null;
  const current = parseCursor(exact.current);
  const point = parsePoint(exact.point);
  return current && point
    ? Object.freeze({ current, point, sequence: exact.sequence, signal: exact.signal })
    : null;
}

function sameCursor(
  left: StudioCompanionReferenceCaptureCursor,
  right: StudioCompanionReferenceCaptureCursor
): boolean {
  return left.generation === right.generation
    && left.revision === right.revision
    && left.referenceRevision === right.referenceRevision;
}

function nextPositiveRevision(current: number): number | null {
  return current < Number.MAX_SAFE_INTEGER ? current + 1 : null;
}

function linkedAbortSignal(
  runtimeSignal: AbortSignal,
  requestSignal: AbortSignal
): { signal: AbortSignal; cleanup: () => void } | null {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let runtimeRegistrationAttempted = false;
  let requestRegistrationAttempted = false;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (runtimeRegistrationAttempted) {
      try {
        runtimeSignal.removeEventListener("abort", abort);
      } catch {
        // Best-effort cleanup for a hostile structural signal.
      }
    }
    if (requestRegistrationAttempted) {
      try {
        requestSignal.removeEventListener("abort", abort);
      } catch {
        // Best-effort cleanup for a hostile structural signal.
      }
    }
  };
  try {
    if (runtimeSignal.aborted || requestSignal.aborted) controller.abort();
    if (!controller.signal.aborted) {
      runtimeRegistrationAttempted = true;
      runtimeSignal.addEventListener("abort", abort, { once: true });
      requestRegistrationAttempted = true;
      requestSignal.addEventListener("abort", abort, { once: true });
      // Close the read/register race, including a signal aborted synchronously by registration.
      if (runtimeSignal.aborted || requestSignal.aborted) controller.abort();
    }
  } catch {
    cleanup();
    controller.abort();
    return null;
  }
  return { signal: controller.signal, cleanup };
}

/**
 * Lets the coordinator release request/lifecycle listeners even when a dynamic import or an
 * adapter-owned promise ignores AbortSignal forever. The underlying work may still settle later,
 * but it can no longer keep this public operation pending or retain its linked abort listeners.
 */
function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T | typeof ABORTED_AWAIT> {
  try {
    if (signal.aborted) return Promise.resolve(ABORTED_AWAIT);
  } catch {
    return Promise.resolve(ABORTED_AWAIT);
  }
  return new Promise<T | typeof ABORTED_AWAIT>((resolve, reject) => {
    let settled = false;
    let registrationAttempted = false;
    const cleanup = () => {
      if (!registrationAttempted) return;
      registrationAttempted = false;
      try {
        signal.removeEventListener("abort", onAbort);
      } catch {
        // The operation has already settled; cleanup remains best effort.
      }
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ABORTED_AWAIT);
    };
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    );
    try {
      registrationAttempted = true;
      signal.addEventListener("abort", onAbort, { once: true });
      // Close the read/register race and hostile synchronous registration callbacks.
      if (signal.aborted) onAbort();
    } catch {
      cleanup();
      if (!settled) {
        settled = true;
        resolve(ABORTED_AWAIT);
      }
    }
  });
}

/**
 * Creates the bridge consumed by `startStudioCompanionPrimaryRuntime()` callbacks. The source and
 * preview chunks remain outside the default Studio route until Reference demand actually begins.
 */
export function createStudioCompanionReferenceCaptureRuntime(
  callbacks: StudioCompanionReferenceCaptureRuntimeCallbacks,
  dependencies: StudioCompanionReferenceCaptureRuntimeDependencies = {}
): StudioCompanionReferenceCaptureRuntime {
  const sourceLoader = dependencies.loadSourceRuntime ?? loadDefaultSourceRuntime;
  const previewLoader = dependencies.loadPreviewRuntime ?? loadDefaultPreviewRuntime;
  const previewRuntimeDependencies = Object.freeze({
    encoderScope: Object.freeze({}),
  }) satisfies Pick<StudioCompanionReferencePreviewDependencies, "encoderScope">;
  let sourceModulePromise: Promise<StudioCompanionReferenceSourceRuntimeModule> | null = null;
  let sourceModuleValue: StudioCompanionReferenceSourceRuntimeModule | null = null;
  let previewModulePromise: Promise<StudioCompanionReferencePreviewRuntimeModule> | null = null;
  let sourceRuntime: StudioCompanionReferenceSourceRuntime | null = null;
  let lifecycleController: AbortController | null = null;
  let active = false;
  let permanentlyReleased = false;
  let epoch = 0;
  let highestReferenceRevision = 0;
  // Revision 1 is reserved for StudioPage's lightweight, unresolved bootstrap projection. The
  // first source-backed projection must advance even when the editable reference revision is the
  // same, otherwise the protocol correctly rejects it as a duplicate.
  let projectionRevision = 1;
  let ready: ReadySource | null = null;
  let unresolved: UnresolvedSource | null = null;
  let preparing: PreparingSource | null = null;
  let sourcePreparationFailure: SourcePreparationFailure | null = null;
  let sourcePreparationRetryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const issuedProjections = new Map<number, IssuedProjection>();

  const loadSourceModule = (): Promise<StudioCompanionReferenceSourceRuntimeModule> => {
    if (sourceModuleValue) return Promise.resolve(sourceModuleValue);
    const promise = sourceModulePromise ??= sourceLoader();
    void promise.then(
      (value) => {
        if (sourceModulePromise === promise) sourceModuleValue = value;
      },
      () => {
        if (sourceModulePromise === promise) sourceModulePromise = null;
      }
    );
    return promise;
  };

  const loadPreviewModule = (): Promise<StudioCompanionReferencePreviewRuntimeModule> => {
    const promise = previewModulePromise ??= previewLoader();
    void promise.catch(() => {
      if (previewModulePromise === promise) previewModulePromise = null;
    });
    return promise;
  };

  const clearSourcePreparationRetry = () => {
    if (sourcePreparationRetryTimer === null) return;
    globalThis.clearTimeout(sourcePreparationRetryTimer);
    sourcePreparationRetryTimer = null;
  };

  const releaseOwnedSource = () => {
    const ownedSourceRuntime = sourceRuntime;
    epoch += 1;
    clearSourcePreparationRetry();
    lifecycleController?.abort();
    lifecycleController = null;
    ready = null;
    unresolved = null;
    preparing = null;
    sourcePreparationFailure = null;
    issuedProjections.clear();
    try {
      ownedSourceRuntime?.release();
    } catch {
      // A cleanup adapter cannot prevent the coordinator from forgetting primary-owned pixels.
    } finally {
      sourceRuntime = null;
      if (!ownedSourceRuntime && !sourceModuleValue) sourceModulePromise = null;
    }
  };

  const readReferenceSnapshot = (): StudioCompanionReferenceCaptureSnapshot | null => {
    try {
      const snapshot = callbacks.getSnapshot();
      const revision = snapshot?.revision;
      if (!positiveSafeInteger(revision) || revision < highestReferenceRevision) return null;
      const itemCount = snapshot.itemCount;
      if (!Number.isSafeInteger(itemCount) || itemCount < 0) return null;
      highestReferenceRevision = revision;
      return Object.freeze({
        document: snapshot.document,
        revision,
        itemCount: Math.min(itemCount, STUDIO_COMPANION_REFERENCE_MAX_ITEMS),
      });
    } catch {
      return null;
    }
  };

  const notifyProjectionChanged = () => {
    try {
      callbacks.onProjectionChanged();
    } catch {
      // Publishing is an observer side effect and cannot take ownership of source resources.
    }
  };

  function scheduleSourcePreparationRetry(
    failedEpoch: number,
    referenceRevision: number
  ): void {
    if (
      !active
      || permanentlyReleased
      || epoch !== failedEpoch
      || unresolved?.referenceRevision !== referenceRevision
    ) return;
    const current = sourcePreparationFailure;
    const count = current
      && current.referenceRevision === referenceRevision
      && current.projectionRevision === unresolved.projectionRevision
        ? current.count + 1
        : 1;
    sourcePreparationFailure = Object.freeze({
      referenceRevision,
      projectionRevision: unresolved.projectionRevision,
      count,
    });
    clearSourcePreparationRetry();
    if (count >= MAX_SOURCE_PREPARATION_FAILURES) return;
    const delayMs = STUDIO_COMPANION_REFERENCE_FAILURE_BACKOFF_MS[count - 1]!;
    const scheduledEpoch = epoch;
    const scheduledProjectionRevision = unresolved.projectionRevision;
    sourcePreparationRetryTimer = globalThis.setTimeout(() => {
      sourcePreparationRetryTimer = null;
      if (
        !active
        || permanentlyReleased
        || epoch !== scheduledEpoch
        || unresolved?.referenceRevision !== referenceRevision
        || unresolved.projectionRevision !== scheduledProjectionRevision
      ) return;
      const latestSnapshot = readReferenceSnapshot();
      if (latestSnapshot?.revision !== referenceRevision) return;
      void prepareRevision(latestSnapshot);
    }, delayMs);
  }

  const prepareRevision = (
    referenceSnapshot: StudioCompanionReferenceCaptureSnapshot
  ): Promise<boolean> => {
    const referenceRevision = referenceSnapshot.revision;
    if (!active || permanentlyReleased) return Promise.resolve(false);
    if (ready?.referenceRevision === referenceRevision) return Promise.resolve(true);
    if (preparing?.referenceRevision === referenceRevision) return preparing.promise;
    clearSourcePreparationRetry();

    const retryProjection = unresolved?.referenceRevision === referenceRevision
      ? unresolved
      : null;
    if (retryProjection) {
      if (
        sourcePreparationFailure?.referenceRevision === referenceRevision
        && sourcePreparationFailure.projectionRevision === retryProjection.projectionRevision
        && sourcePreparationFailure.count >= MAX_SOURCE_PREPARATION_FAILURES
      ) return Promise.resolve(false);
      // A retry for the same editable revision keeps the public cursor stable. Otherwise every
      // failed decode would reset the protocol's bounded failure budget and could spin forever.
      epoch += 1;
      lifecycleController?.abort();
      lifecycleController = null;
      ready = null;
      preparing = null;
      issuedProjections.clear();
      try {
        sourceRuntime?.release();
      } catch {
        // The next source demand still owns a fresh lifecycle epoch.
      } finally {
        sourceRuntime = null;
      }
      unresolved = Object.freeze({ ...retryProjection, epoch });
    } else {
      releaseOwnedSource();
      const unresolvedRevision = nextPositiveRevision(projectionRevision);
      if (unresolvedRevision === null) return Promise.resolve(false);
      projectionRevision = unresolvedRevision;
      unresolved = Object.freeze({
        epoch,
        projectionRevision,
        referenceRevision,
        itemCount: referenceSnapshot.itemCount,
      });
      // Publish a monotonic, source-free projection immediately. This invalidates any preview that
      // belongs to the previous editable revision even when decoding the replacement later fails.
      notifyProjectionChanged();
    }
    const ownEpoch = epoch;
    const controller = new AbortController();
    lifecycleController = controller;

    const run = async (): Promise<boolean> => {
      let refreshSnapshot: StudioCompanionReferenceCaptureSnapshot | null = null;
      let preparationFailed = false;
      try {
        if (!sourceRuntime) {
          const sourceModuleFlight = loadSourceModule();
          const loadedSourceModule = await awaitWithAbort(sourceModuleFlight, controller.signal);
          if (loadedSourceModule === ABORTED_AWAIT) {
            if (sourceModulePromise === sourceModuleFlight) sourceModulePromise = null;
            return false;
          }
          if (!active || permanentlyReleased || epoch !== ownEpoch || controller.signal.aborted) {
            return false;
          }
          sourceRuntime = loadedSourceModule.createStudioCompanionReferenceSourceRuntime();
        }
        const demandedSource = await awaitWithAbort(
          sourceRuntime.setDemand({
            active: true,
            document: referenceSnapshot.document,
            signal: controller.signal,
          }),
          controller.signal
        );
        if (demandedSource === ABORTED_AWAIT) return false;
        const result = demandedSource;
        if (
          result.status !== "ready"
          || !result.snapshot
          || !active
          || permanentlyReleased
          || epoch !== ownEpoch
          || controller.signal.aborted
        ) {
          preparationFailed = active
            && !permanentlyReleased
            && epoch === ownEpoch
            && !controller.signal.aborted;
          return false;
        }

        const latestSnapshot = readReferenceSnapshot();
        if (latestSnapshot?.revision !== referenceRevision) {
          try {
            sourceRuntime.release();
          } catch {
            // The stale source is forgotten below even when its adapter cleanup is best effort.
          } finally {
            sourceRuntime = null;
          }
          refreshSnapshot = latestSnapshot;
          return false;
        }
        if (referenceSnapshot.itemCount > 0 && result.snapshot.resolvedItemCount === 0) {
          // A contentful board that decoded zero sources is not the same as a genuinely empty
          // board. Keep the already-published unresolved cursor and retry within its shared budget
          // instead of publishing a ready-0 projection that the primary can never capture.
          preparationFailed = true;
          try {
            sourceRuntime.release();
          } catch {
            // The bounded retry starts from a new runtime demand either way.
          } finally {
            sourceRuntime = null;
          }
          return false;
        }
        const nextRevision = nextPositiveRevision(projectionRevision);
        if (nextRevision === null) {
          try {
            sourceRuntime.release();
          } finally {
            sourceRuntime = null;
          }
          return false;
        }
        projectionRevision = nextRevision;
        unresolved = null;
        sourcePreparationFailure = null;
        ready = Object.freeze({
          epoch: ownEpoch,
          projectionRevision,
          referenceRevision,
          itemCount: result.snapshot.itemCount,
          snapshot: result.snapshot,
        });
        notifyProjectionChanged();
        return true;
      } catch {
        preparationFailed = active
          && !permanentlyReleased
          && epoch === ownEpoch
          && !controller.signal.aborted;
        return false;
      } finally {
        if (preparing?.epoch === ownEpoch) preparing = null;
        if (
          refreshSnapshot !== null
          && active
          && !permanentlyReleased
          && refreshSnapshot.revision >= highestReferenceRevision
        ) void prepareRevision(refreshSnapshot);
        else if (preparationFailed) {
          scheduleSourcePreparationRetry(ownEpoch, referenceRevision);
        }
      }
    };

    const promise = run();
    preparing = Object.freeze({ epoch: ownEpoch, referenceRevision, promise });
    return promise;
  };

  const synchronizeRevision = (): number | null => {
    if (!active || permanentlyReleased) return null;
    const referenceSnapshot = readReferenceSnapshot();
    if (referenceSnapshot === null) {
      releaseOwnedSource();
      return null;
    }
    const referenceRevision = referenceSnapshot.revision;
    if (
      ready?.referenceRevision !== referenceRevision
      && unresolved?.referenceRevision !== referenceRevision
    ) {
      void prepareRevision(referenceSnapshot);
    }
    return referenceRevision;
  };

  const projectionForGeneration = (
    generation: number
  ): StudioCompanionReferenceProjection | null => {
    const synchronizedRevision = synchronizeRevision();
    if (!positiveSafeInteger(generation) || synchronizedRevision === null) return null;
    const current = ready?.referenceRevision === synchronizedRevision
      ? ready
      : unresolved?.referenceRevision === synchronizedRevision
        ? unresolved
        : null;
    if (!current) return null;
    const existing = issuedProjections.get(generation);
    if (
      existing?.epoch === current.epoch
      && existing.projection.revision === current.projectionRevision
      && existing.projection.referenceRevision === current.referenceRevision
    ) return existing.projection;
    const snapshot = ready && current === ready ? ready.snapshot : null;
    const projection = Object.freeze({
      generation,
      revision: current.projectionRevision,
      referenceRevision: current.referenceRevision,
      itemCount: current.itemCount,
      resolvedItemCount: snapshot?.resolvedItemCount ?? 0,
      canPickColor: snapshot?.canPickColor ?? false,
    }) satisfies StudioCompanionReferenceProjection;
    issuedProjections.set(generation, Object.freeze({ epoch: current.epoch, projection }));
    while (issuedProjections.size > MAX_ISSUED_GENERATIONS) {
      const oldest = issuedProjections.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      issuedProjections.delete(oldest);
    }
    return projection;
  };

  const exactReadyCapture = (
    cursor: StudioCompanionReferenceCaptureCursor
  ): CaptureSnapshot | null => {
    if (synchronizeRevision() === null || !ready) return null;
    const issued = issuedProjections.get(cursor.generation);
    if (
      !issued
      || issued.epoch !== ready.epoch
      || issued.projection.revision !== ready.projectionRevision
      || issued.projection.referenceRevision !== ready.referenceRevision
      || !sameCursor(issued.projection, cursor)
    ) return null;
    return Object.freeze({ ready, cursor });
  };

  const captureIsBlocked = (): boolean => {
    try {
      return callbacks.isCaptureBlocked() !== false;
    } catch {
      return true;
    }
  };

  const setDemand = async (nextActive: boolean): Promise<boolean> => {
    if (permanentlyReleased) return false;
    if (nextActive !== true) {
      active = false;
      releaseOwnedSource();
      return false;
    }
    active = true;
    const referenceSnapshot = readReferenceSnapshot();
    if (referenceSnapshot === null) {
      releaseOwnedSource();
      return false;
    }
    return prepareRevision(referenceSnapshot);
  };

  const captureFrame = async (
    requestInput: StudioCompanionReferenceCaptureRequest
  ): Promise<StudioCompanionReferencePreviewFrame | null> => {
    const request = parseCaptureRequest(requestInput);
    if (!request || request.signal.aborted || captureIsBlocked()) return null;
    const cursor = Object.freeze({
      generation: request.generation,
      revision: request.revision,
      referenceRevision: request.referenceRevision,
    });
    const captured = exactReadyCapture(cursor);
    if (!captured || !lifecycleController) return null;
    const linked = linkedAbortSignal(lifecycleController.signal, request.signal);
    if (!linked) return null;
    try {
      if (linked.signal.aborted) return null;
      const previewModuleFlight = loadPreviewModule();
      const loadedPreview = await awaitWithAbort(previewModuleFlight, linked.signal);
      if (loadedPreview === ABORTED_AWAIT) {
        if (previewModulePromise === previewModuleFlight) previewModulePromise = null;
        return null;
      }
      const preview = loadedPreview;
      if (
        linked.signal.aborted
        || captureIsBlocked()
        || exactReadyCapture(cursor)?.ready !== captured.ready
      ) return null;
      const encodedFrame = await awaitWithAbort(
        preview.createStudioCompanionReferencePreviewFrame({
          ...captured.ready.snapshot.previewInput,
          ...cursor,
          sequence: request.sequence,
        }, { signal: linked.signal }, previewRuntimeDependencies),
        linked.signal
      );
      if (encodedFrame === ABORTED_AWAIT) return null;
      const frame = encodedFrame;
      if (
        !frame
        || linked.signal.aborted
        || captureIsBlocked()
        || exactReadyCapture(cursor)?.ready !== captured.ready
        || frame.generation !== cursor.generation
        || frame.revision !== cursor.revision
        || frame.referenceRevision !== cursor.referenceRevision
        || frame.sequence !== request.sequence
      ) return null;
      return frame;
    } catch {
      return null;
    } finally {
      linked.cleanup();
    }
  };

  const sampleColor = async (
    requestInput: StudioCompanionReferenceColorSampleRequest
  ): Promise<string | null> => {
    const request = parseColorRequest(requestInput);
    if (!request || request.signal.aborted) return null;
    const captured = exactReadyCapture(request.current);
    if (!captured || !captured.ready.snapshot.canPickColor || !lifecycleController) return null;
    const linked = linkedAbortSignal(lifecycleController.signal, request.signal);
    if (!linked) return null;
    try {
      if (linked.signal.aborted) return null;
      const previewModuleFlight = loadPreviewModule();
      const loadedPreview = await awaitWithAbort(previewModuleFlight, linked.signal);
      if (loadedPreview === ABORTED_AWAIT) {
        if (previewModulePromise === previewModuleFlight) previewModulePromise = null;
        return null;
      }
      const preview = loadedPreview;
      if (
        linked.signal.aborted
        || exactReadyCapture(request.current)?.ready !== captured.ready
      ) return null;
      const sampling = captured.ready.snapshot.colorSamplingInput;
      const color = preview.sampleStudioCompanionReferenceColor(
        sampling.items,
        request.point,
        sampling.boardWidth,
        sampling.boardHeight
      );
      if (
        typeof color !== "string"
        || !COLOR_PATTERN.test(color)
        || linked.signal.aborted
        || exactReadyCapture(request.current)?.ready !== captured.ready
      ) return null;
      return color;
    } catch {
      return null;
    } finally {
      linked.cleanup();
    }
  };

  const release = () => {
    if (permanentlyReleased) return;
    permanentlyReleased = true;
    active = false;
    releaseOwnedSource();
    sourceRuntime = null;
    sourceModulePromise = null;
    sourceModuleValue = null;
    previewModulePromise = null;
  };

  return Object.freeze({
    setDemand,
    getProjection: projectionForGeneration,
    captureFrame,
    sampleColor,
    release,
  });
}
