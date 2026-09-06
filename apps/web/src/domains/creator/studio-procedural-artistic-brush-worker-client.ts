import {
  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
  snapshotStudioProceduralArtisticBrushWorkerOutboundMessage,
  snapshotStudioProceduralArtisticBrushWorkerRenderMessage,
  type StudioProceduralArtisticBrushWorkerCapabilityProbe,
  type StudioProceduralArtisticBrushWorkerRenderMessage,
  type StudioProceduralArtisticBrushWorkerRequest,
  type StudioProceduralArtisticBrushWorkerUnavailableReason,
} from "./studio-procedural-artistic-brush-worker-protocol";

import type {
  StudioProceduralArtisticBrushArtifact,
  StudioProceduralArtisticBrushFailureReason,
} from "./studio-procedural-artistic-brush-provider";

export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_STARTUP_TIMEOUT_MS =
  15_000;
export const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_OPERATION_TIMEOUT_MS =
  120_000;

export type StudioProceduralArtisticBrushWorkerClientFailureReason =
  | "invalid-request"
  | "worker-unavailable"
  | "startup-timeout"
  | "operation-timeout"
  | "unsupported-environment"
  | "protocol-error"
  | "worker-error"
  | "provider-rejected"
  | "data-clone-error";

export class StudioProceduralArtisticBrushWorkerClientError extends Error {
  public readonly reason:
    StudioProceduralArtisticBrushWorkerClientFailureReason;
  public readonly providerReason:
    StudioProceduralArtisticBrushFailureReason | null;

  public constructor(
    reason: StudioProceduralArtisticBrushWorkerClientFailureReason,
    message: string,
    providerReason: StudioProceduralArtisticBrushFailureReason | null = null,
  ) {
    super(message);
    this.name = "StudioProceduralArtisticBrushWorkerClientError";
    this.reason = reason;
    this.providerReason = providerReason;
  }
}

interface StudioProceduralArtisticBrushWorkerMessageEvent {
  readonly data: unknown;
}

interface StudioProceduralArtisticBrushWorkerErrorEvent {
  readonly error?: unknown;
  readonly message?: string;
  preventDefault?(): void;
}

export interface StudioProceduralArtisticBrushWorkerLike {
  postMessage(message: StudioProceduralArtisticBrushWorkerRenderMessage): void;
  addEventListener(
    type: "message",
    listener: (
      event: StudioProceduralArtisticBrushWorkerMessageEvent,
    ) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (
      event: StudioProceduralArtisticBrushWorkerErrorEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (
      event: StudioProceduralArtisticBrushWorkerMessageEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (
      event: StudioProceduralArtisticBrushWorkerErrorEvent,
    ) => void,
  ): void;
  terminate(): void;
}

export interface StudioProceduralArtisticBrushWorkerClientOptions {
  readonly signal?: AbortSignal;
  readonly workerFactory?:
    () => StudioProceduralArtisticBrushWorkerLike | null;
  readonly startupTimeoutMilliseconds?: number;
  readonly operationTimeoutMilliseconds?: number;
}

export interface StudioProceduralArtisticBrushWorkerProbeOptions {
  readonly signal?: AbortSignal;
  readonly workerFactory?:
    () => StudioProceduralArtisticBrushWorkerLike | null;
  readonly startupTimeoutMilliseconds?: number;
}

export type StudioProceduralArtisticBrushWorkerProbeResult =
  | Readonly<{
      available: true;
      probe: StudioProceduralArtisticBrushWorkerCapabilityProbe;
    }>
  | Readonly<{
      available: false;
      reason: StudioProceduralArtisticBrushWorkerUnavailableReason;
      detail: string;
    }>;

function defaultWorkerFactory():
  StudioProceduralArtisticBrushWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(
    new URL("./studio-procedural-artistic-brush.worker.ts",
      import.meta.url,
    ),
    {
      type: "module",
      name: "studio-procedural-artistic-brush",
    },
  );
}

function validTimeout(value: number): boolean {
  return (
    Number.isSafeInteger(value)
    && value > 0
    && value <= 300_000
  );
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException(
      "The procedural artistic brush render was aborted.",
      "AbortError",
    );
  }
  const error = new Error(
    "The procedural artistic brush render was aborted.",
  );
  error.name = "AbortError";
  return error;
}

function matchesRequest(
  artifact: StudioProceduralArtisticBrushArtifact,
  request: StudioProceduralArtisticBrushWorkerRequest,
): boolean {
  const receipt = artifact.receipt;
  const requiredCapability = `procedural:${request.plan.technique}`;
  return (
    artifact.width === request.width
    && artifact.height === request.height
    && receipt.requestSequence === request.requestSequence
    && receipt.engineEpoch === request.engineEpoch
    && receipt.strokeId === request.strokeId
    && receipt.seed === request.seed
    && receipt.technique === request.plan.technique
    && receipt.presetId === request.plan.presetId
    && receipt.width === request.width
    && receipt.height === request.height
    && receipt.pixelHash.startsWith("sha256:")
    && receipt.capabilitiesUsed.includes(
      requiredCapability as typeof receipt.capabilitiesUsed[number],
    )
  );
}

/**
 * Probes the exact production module-Worker execution envelope without
 * posting a render request or loading p5.brush. The one-shot Worker is
 * terminated before this promise settles, regardless of outcome.
 */
export function probeStudioProceduralArtisticBrushWorker(
  options: StudioProceduralArtisticBrushWorkerProbeOptions = {},
): Promise<StudioProceduralArtisticBrushWorkerProbeResult> {
  const startupTimeoutMilliseconds =
    options.startupTimeoutMilliseconds
    ?? STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_STARTUP_TIMEOUT_MS;
  if (!validTimeout(startupTimeoutMilliseconds)) {
    return Promise.reject(new TypeError(
      "Procedural artistic brush Worker startup timeout is invalid.",
    ));
  }
  if (options.signal?.aborted) return Promise.reject(abortError());

  let worker: StudioProceduralArtisticBrushWorkerLike | null;
  try {
    worker = (options.workerFactory ?? defaultWorkerFactory)();
  } catch {
    worker = null;
  }
  if (!worker) {
    return Promise.reject(
      new StudioProceduralArtisticBrushWorkerClientError(
        "worker-unavailable",
        "A module Dedicated Worker is required for capability probing.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let firstProbe:
      StudioProceduralArtisticBrushWorkerCapabilityProbe | null = null;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (startupTimer !== null) clearTimeout(startupTimer);
      options.signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      worker.terminate();
    };
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const fail = (
      reason: StudioProceduralArtisticBrushWorkerClientFailureReason,
      detail: string,
    ): void => {
      finish(() => reject(
        new StudioProceduralArtisticBrushWorkerClientError(
          reason,
          detail,
        ),
      ));
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    const onError = (
      event: StudioProceduralArtisticBrushWorkerErrorEvent,
    ): void => {
      event.preventDefault?.();
      fail(
        "worker-error",
        event.error instanceof Error
          ? event.error.message
          : event.message || "The artistic brush capability Worker crashed.",
      );
    };
    const onMessageError = (): void => {
      fail(
        "data-clone-error",
        "The artistic brush capability Worker returned an uncloneable message.",
      );
    };
    const onMessage = (
      event: StudioProceduralArtisticBrushWorkerMessageEvent,
    ): void => {
      const response =
        snapshotStudioProceduralArtisticBrushWorkerOutboundMessage(
          event.data,
        );
      if (!response) {
        fail(
          "protocol-error",
          "The artistic brush capability Worker returned a malformed message.",
        );
        return;
      }
      if (firstProbe !== null) {
        fail(
          "protocol-error",
          "The artistic brush capability Worker returned more than one response.",
        );
        return;
      }
      if (response.type === "studio-procedural-artistic-brush/ready") {
        firstProbe = response.probe;
        // Preserve a narrow fail-closed window for duplicate ready messages
        // already queued in this turn, then terminate before resolving.
        queueMicrotask(() => {
          if (settled || firstProbe === null) return;
          const probe = firstProbe;
          finish(() => resolve(Object.freeze({
            available: true,
            probe,
          })));
        });
        return;
      }
      if (
        response.type
          === "studio-procedural-artistic-brush/unavailable"
      ) {
        finish(() => resolve(Object.freeze({
          available: false,
          reason: response.reason,
          detail: response.detail,
        })));
        return;
      }
      fail(
        "protocol-error",
        "The capability-only Worker returned a render or failure response.",
      );
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    startupTimer = setTimeout(() => {
      fail(
        "startup-timeout",
        "The artistic brush Worker did not complete its capability probe.",
      );
    }, startupTimeoutMilliseconds);
  });
}

/**
 * Runs one settled artistic render in a one-shot module Dedicated Worker.
 *
 * There is deliberately no direct/main-thread fallback. A successful call
 * returns only the provider's plain, validated artifact whose RGBA ArrayBuffer
 * was transferred from the Worker.
 */
export function renderStudioProceduralArtisticBrushInWorker(
  request: StudioProceduralArtisticBrushWorkerRequest,
  options: StudioProceduralArtisticBrushWorkerClientOptions = {},
): Promise<StudioProceduralArtisticBrushArtifact> {
  const startupTimeoutMilliseconds =
    options.startupTimeoutMilliseconds
    ?? STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_STARTUP_TIMEOUT_MS;
  const operationTimeoutMilliseconds =
    options.operationTimeoutMilliseconds
    ?? STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_OPERATION_TIMEOUT_MS;
  if (
    !validTimeout(startupTimeoutMilliseconds)
    || !validTimeout(operationTimeoutMilliseconds)
  ) {
    return Promise.reject(new TypeError(
      "Procedural artistic brush Worker timeouts are invalid.",
    ));
  }
  if (options.signal?.aborted) return Promise.reject(abortError());

  const message = snapshotStudioProceduralArtisticBrushWorkerRenderMessage({
    type: "studio-procedural-artistic-brush/render",
    version: STUDIO_PROCEDURAL_ARTISTIC_BRUSH_WORKER_PROTOCOL_VERSION,
    requestId: 1,
    request,
  });
  if (!message) {
    return Promise.reject(
      new StudioProceduralArtisticBrushWorkerClientError(
        "invalid-request",
        "The procedural artistic brush request is not clone-safe or valid.",
      ),
    );
  }

  let worker: StudioProceduralArtisticBrushWorkerLike | null;
  try {
    worker = (options.workerFactory ?? defaultWorkerFactory)();
  } catch {
    worker = null;
  }
  if (!worker) {
    return Promise.reject(
      new StudioProceduralArtisticBrushWorkerClientError(
        "worker-unavailable",
        "A module Dedicated Worker is required for artistic rendering.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let requestPosted = false;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let operationTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (startupTimer !== null) clearTimeout(startupTimer);
      if (operationTimer !== null) clearTimeout(operationTimer);
      options.signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      worker.terminate();
    };
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const fail = (
      reason: StudioProceduralArtisticBrushWorkerClientFailureReason,
      detail: string,
      providerReason: StudioProceduralArtisticBrushFailureReason | null =
        null,
    ): void => {
      finish(() => reject(
        new StudioProceduralArtisticBrushWorkerClientError(
          reason,
          detail,
          providerReason,
        ),
      ));
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    const onError = (
      event: StudioProceduralArtisticBrushWorkerErrorEvent,
    ): void => {
      event.preventDefault?.();
      const message = event.error instanceof Error
        ? event.error.message
        : event.message || "The artistic brush Worker crashed.";
      fail("worker-error", message);
    };
    const onMessageError = (): void => {
      fail(
        "data-clone-error",
        "The artistic brush Worker returned an uncloneable message.",
      );
    };
    const onMessage = (
      event: StudioProceduralArtisticBrushWorkerMessageEvent,
    ): void => {
      const response =
        snapshotStudioProceduralArtisticBrushWorkerOutboundMessage(
          event.data,
        );
      if (!response) {
        fail(
          "protocol-error",
          "The artistic brush Worker returned a malformed message.",
        );
        return;
      }
      if (response.type === "studio-procedural-artistic-brush/ready") {
        if (requestPosted) {
          fail(
            "protocol-error",
            "The artistic brush Worker repeated its readiness handshake.",
          );
          return;
        }
        if (startupTimer !== null) {
          clearTimeout(startupTimer);
          startupTimer = null;
        }
        try {
          worker.postMessage(message);
          requestPosted = true;
        } catch {
          fail(
            "data-clone-error",
            "The artistic brush request could not be cloned into the Worker.",
          );
          return;
        }
        operationTimer = setTimeout(() => {
          fail(
            "operation-timeout",
            "The artistic brush Worker exceeded its render deadline.",
          );
        }, operationTimeoutMilliseconds);
        return;
      }
      if (
        response.type
          === "studio-procedural-artistic-brush/unavailable"
      ) {
        if (requestPosted) {
          fail(
            "protocol-error",
            "The artistic brush Worker changed capability after startup.",
          );
        } else {
          fail("unsupported-environment", response.detail);
        }
        return;
      }
      if (response.type === "studio-procedural-artistic-brush/failure") {
        if (
          response.requestId !== null
          && response.requestId !== message.requestId
        ) {
          fail(
            "protocol-error",
            "The artistic brush Worker failure belongs to another request.",
          );
        } else {
          fail("worker-error", response.detail);
        }
        return;
      }
      if (
        !requestPosted
        || response.requestId !== message.requestId
        || response.requestSequence !== message.request.requestSequence
        || response.engineEpoch !== message.request.engineEpoch
      ) {
        fail(
          "protocol-error",
          "The artistic brush Worker result does not match the active request.",
        );
        return;
      }
      if (response.result.status === "rejected") {
        fail(
          "provider-rejected",
          response.result.detail,
          response.result.reason,
        );
        return;
      }
      if (!matchesRequest(response.result.artifact, message.request)) {
        fail(
          "protocol-error",
          "The artistic brush artifact receipt does not match its request.",
        );
        return;
      }
      const artifact = response.result.artifact;
      finish(() => resolve(artifact));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    startupTimer = setTimeout(() => {
      fail(
        "startup-timeout",
        "The artistic brush Worker did not complete its capability probe.",
      );
    }, startupTimeoutMilliseconds);
  });
}
