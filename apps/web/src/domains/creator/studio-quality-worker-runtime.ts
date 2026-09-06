import { snapshotStudioPortablePathGeometry } from "./render/studio-canvaskit-portable-geometry";
import {
  STUDIO_QUALITY_WORKER_BUDGETS,
  STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
  STUDIO_QUALITY_WORKER_PROVIDER_PROFILE,
  validateStudioQualityWorkerInboundMessage,
  type StudioQualityWorkerCancelMessage,
  type StudioQualityWorkerFatalCode,
  type StudioQualityWorkerFatalMessage,
  type StudioQualityWorkerOperation,
  type StudioQualityWorkerRequestFailureCode,
  type StudioQualityWorkerRequestMessage,
  type StudioQualityWorkerResponseMessage,
} from "./studio-quality-worker-protocol";

import type {
  StudioPathOpsResult,
  StudioQualityEngine,
  StudioStrokeToPathStyle,
} from "./render/studio-canvaskit-adapter";

export interface StudioQualityWorkerPort {
  postMessage(message: StudioQualityWorkerResponseMessage): void;
}

export type StudioQualityWorkerProviderFactory =
  () => Promise<StudioQualityEngine> | StudioQualityEngine;

export interface StudioQualityWorkerRuntimeOptions {
  readonly port: StudioQualityWorkerPort;
  readonly providerFactory: StudioQualityWorkerProviderFactory;
}

export interface StudioQualityWorkerRuntimeSnapshot {
  readonly state:
    | "awaiting-initialize"
    | "initializing"
    | "ready"
    | "fatal"
    | "disposed";
  readonly workerEpoch: number | null;
  readonly acceptedThroughRequestId: number;
  readonly queuedRequests: number;
  readonly activeRequestId: number | null;
  readonly providerFactoryCalls: number;
}

export interface StudioQualityWorkerRuntime {
  handleMessage(value: unknown): void;
  dispose(): void;
  snapshot(): StudioQualityWorkerRuntimeSnapshot;
}

interface QueuedRequest {
  readonly request: StudioQualityWorkerRequestMessage;
  cancelled: boolean;
}

type RuntimeState = StudioQualityWorkerRuntimeSnapshot["state"];

class StudioQualityProviderCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioQualityProviderCapabilityError";
  }
}

function boundedMessage(value: unknown, fallback: string): string {
  const message = value instanceof Error && value.message ? value.message : fallback;
  return message.slice(0, STUDIO_QUALITY_WORKER_BUDGETS.maxErrorMessageCharacters);
}

function cloneStyle(style: StudioStrokeToPathStyle): StudioStrokeToPathStyle {
  return {
    widthPx: style.widthPx,
    cap: style.cap,
    join: style.join,
    miterLimit: style.miterLimit,
    ...(style.dash
      ? {
          dash: {
            pattern: Array.from(style.dash.pattern),
            phase: style.dash.phase,
          },
        }
      : {}),
  };
}

function cloneOperation(
  operation: StudioQualityWorkerOperation,
): StudioQualityWorkerOperation {
  if (operation.kind === "path-boolean") {
    return {
      kind: "path-boolean",
      a: operation.a,
      b: operation.b,
      op: operation.op,
    };
  }
  return {
    kind: "stroke-to-fill",
    pathData: operation.pathData,
    style: cloneStyle(operation.style),
  };
}

function portableResult(
  result: StudioPathOpsResult,
): StudioPathOpsResult | "invalid" | "oversized" {
  if (!result || typeof result !== "object") return "invalid";
  if (result.ok === true) {
    if (
      typeof result.pathData !== "string"
      || result.pathData.trim().length === 0
    ) {
      return "invalid";
    }
    if (
      result.pathData.length
      > STUDIO_QUALITY_WORKER_BUDGETS.maxOutputPathCodeUnits
    ) {
      return "oversized";
    }
    if (result.geometry === undefined) {
      return { ok: true, pathData: result.pathData };
    }
    const geometry = snapshotStudioPortablePathGeometry(result.geometry);
    if (geometry === null) return "invalid";
    return { ok: true, pathData: result.pathData, geometry };
  }
  if (
    result.ok === false
    && typeof result.reason === "string"
    && result.reason.trim().length > 0
  ) {
    return {
      ok: false,
      reason: result.reason.slice(
        0,
        STUDIO_QUALITY_WORKER_BUDGETS.maxErrorMessageCharacters,
      ),
    };
  }
  return "invalid";
}

function executeProviderOperation(
  provider: StudioQualityEngine,
  operation: StudioQualityWorkerOperation,
): StudioPathOpsResult {
  if (operation.kind === "path-boolean") {
    return provider.pathOp(operation.a, operation.b, operation.op);
  }
  return provider.strokeToPath(operation.pathData, operation.style);
}

/**
 * Serial, fail-closed quality Worker actor.
 *
 * Provider construction starts only after a valid initialize message, and that promise is created
 * once for the lifetime of the Worker epoch. Every provider result is projected into a fresh plain
 * object before posting, so accidental CanvasKit/Embind handles cannot cross the boundary.
 */
export function createStudioQualityWorkerRuntime(
  options: StudioQualityWorkerRuntimeOptions,
): StudioQualityWorkerRuntime {
  let state: RuntimeState = "awaiting-initialize";
  let workerEpoch: number | null = null;
  let provider: StudioQualityEngine | null = null;
  let providerPromise: Promise<StudioQualityEngine> | null = null;
  let providerFactoryCalls = 0;
  let acceptedThroughRequestId = 0;
  let active: QueuedRequest | null = null;
  let draining = false;
  const queue: QueuedRequest[] = [];
  const admitted = new Map<number, QueuedRequest>();

  const post = (message: StudioQualityWorkerResponseMessage): void => {
    options.port.postMessage(message);
  };

  const fatal = (
    stage: StudioQualityWorkerFatalMessage["stage"],
    code: StudioQualityWorkerFatalCode,
    message: string,
    identity?: Readonly<{ workerEpoch: number | null; requestId: number | null }>,
  ): void => {
    if (state === "fatal" || state === "disposed") return;
    state = "fatal";
    queue.length = 0;
    admitted.clear();
    active = null;
    post({
      type: "studio-quality/fatal",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: identity?.workerEpoch ?? workerEpoch,
      requestId: identity?.requestId ?? null,
      stage,
      error: {
        code,
        message: message.slice(
          0,
          STUDIO_QUALITY_WORKER_BUDGETS.maxErrorMessageCharacters,
        ),
      },
    });
  };

  const failure = (
    request:
      | StudioQualityWorkerRequestMessage
      | StudioQualityWorkerCancelMessage,
    code: StudioQualityWorkerRequestFailureCode,
    message: string,
  ): void => {
    post({
      type: "studio-quality/failure",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: request.workerEpoch,
      requestId: request.requestId,
      requestToken: request.requestToken,
      operationKind:
        "operation" in request
          ? request.operation.kind
          : request.operationKind,
      error: {
        code,
        message: message.slice(
          0,
          STUDIO_QUALITY_WORKER_BUDGETS.maxErrorMessageCharacters,
        ),
      },
    });
  };

  const cancelled = (task: QueuedRequest): void => {
    post({
      type: "studio-quality/cancelled",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: task.request.workerEpoch,
      requestId: task.request.requestId,
      requestToken: task.request.requestToken,
      operationKind: task.request.operation.kind,
    });
  };

  const drain = async (): Promise<void> => {
    if (draining || state !== "ready" || !provider) return;
    draining = true;
    try {
      while (state === "ready") {
        const task = queue.shift();
        if (!task) break;
        if (task.cancelled) continue;
        active = task;
        let result: StudioPathOpsResult;
        try {
          result = executeProviderOperation(provider, task.request.operation);
        } catch (error) {
          admitted.delete(task.request.requestId);
          active = null;
          failure(
            task.request,
            "provider-execution-failed",
            boundedMessage(error, "고품질 지오메트리 제공자 실행에 실패했습니다."),
          );
          continue;
        }
        if (task.cancelled || state !== "ready") {
          admitted.delete(task.request.requestId);
          active = null;
          continue;
        }
        const sanitized = portableResult(result);
        admitted.delete(task.request.requestId);
        active = null;
        if (sanitized === "oversized") {
          failure(
            task.request,
            "output-budget-exceeded",
            "고품질 지오메트리 결과가 Worker 출력 안전 예산을 초과했습니다.",
          );
          continue;
        }
        if (sanitized === "invalid") {
          failure(
            task.request,
            "provider-result-invalid",
            "고품질 지오메트리 제공자가 이식 가능한 SVG 결과를 반환하지 않았습니다.",
          );
          continue;
        }
        post({
          type: "studio-quality/result",
          protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
          workerEpoch: task.request.workerEpoch,
          requestId: task.request.requestId,
          requestToken: task.request.requestToken,
          operationKind: task.request.operation.kind,
          providerId: "canvaskit",
          result: sanitized,
        });
      }
    } finally {
      active = null;
      draining = false;
      if (state === "ready" && queue.some((task) => !task.cancelled)) {
        queueMicrotask(() => {
          void drain();
        });
      }
    }
  };

  const initialize = (
    epoch: number,
  ): void => {
    workerEpoch = epoch;
    state = "initializing";
    providerFactoryCalls += 1;
    providerPromise = Promise.resolve()
      .then(options.providerFactory)
      .then((loaded) => {
        if (
          loaded.id !== "canvaskit"
          || loaded.capabilities.pathBoolean !== true
          || loaded.capabilities.strokeToPath !== true
        ) {
          throw new StudioQualityProviderCapabilityError(
            "CanvasKit PathOps와 stroke-to-path 기능이 모두 필요합니다.",
          );
        }
        return loaded;
      });
    void providerPromise.then(
      (loaded) => {
        if (state !== "initializing" || workerEpoch !== epoch) return;
        provider = loaded;
        state = "ready";
        post({
          type: "studio-quality/ready",
          protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
          workerEpoch: epoch,
          providerProfile: STUDIO_QUALITY_WORKER_PROVIDER_PROFILE,
          providerId: "canvaskit",
          capabilities: {
            pathBoolean: true,
            strokeToPath: true,
          },
          limits: {
            maxQueuedRequests:
              STUDIO_QUALITY_WORKER_BUDGETS.maxQueuedRequests,
            maxInputPathCodeUnits:
              STUDIO_QUALITY_WORKER_BUDGETS.maxInputPathCodeUnits,
            maxTotalInputCodeUnits:
              STUDIO_QUALITY_WORKER_BUDGETS.maxTotalInputCodeUnits,
            maxOutputPathCodeUnits:
              STUDIO_QUALITY_WORKER_BUDGETS.maxOutputPathCodeUnits,
          },
        });
      },
      (error) => {
        if (state !== "initializing" || workerEpoch !== epoch) return;
        fatal(
          "initialization",
          error instanceof StudioQualityProviderCapabilityError
            ? "provider-capability-missing"
            : "provider-init-failed",
          boundedMessage(error, "CanvasKit 품질 제공자 초기화에 실패했습니다."),
          { workerEpoch: epoch, requestId: null },
        );
      },
    );
  };

  const handleRequest = (request: StudioQualityWorkerRequestMessage): void => {
    if (state !== "ready") {
      failure(request, "not-ready", "품질 Worker가 아직 요청을 받을 준비가 되지 않았습니다.");
      return;
    }
    if (request.requestId <= acceptedThroughRequestId) {
      failure(
        request,
        "stale-or-duplicate",
        "품질 Worker 요청 ID는 이전 요청보다 커야 합니다.",
      );
      return;
    }
    acceptedThroughRequestId = request.requestId;
    const occupancy = queue.length + (active ? 1 : 0);
    if (occupancy >= STUDIO_QUALITY_WORKER_BUDGETS.maxQueuedRequests) {
      failure(
        request,
        "queue-full",
        "품질 Worker 요청 큐가 가득 찼습니다. 처리 완료 후 다시 시도해 주세요.",
      );
      return;
    }
    const snapshot: StudioQualityWorkerRequestMessage = {
      ...request,
      operation: cloneOperation(request.operation),
    };
    const task: QueuedRequest = { request: snapshot, cancelled: false };
    admitted.set(request.requestId, task);
    queue.push(task);
    queueMicrotask(() => {
      void drain();
    });
  };

  const handleCancel = (message: StudioQualityWorkerCancelMessage): void => {
    if (state !== "ready") {
      failure(message, "not-ready", "품질 Worker가 아직 취소 요청을 받을 준비가 되지 않았습니다.");
      return;
    }
    const task = admitted.get(message.requestId);
    if (!task) {
      failure(
        message,
        message.requestId <= acceptedThroughRequestId
          ? "already-settled"
          : "unknown-request",
        message.requestId <= acceptedThroughRequestId
          ? "해당 품질 Worker 요청은 이미 종료되었습니다."
          : "취소할 품질 Worker 요청을 찾을 수 없습니다.",
      );
      return;
    }
    if (
      task.request.requestToken !== message.requestToken
      || task.request.operation.kind !== message.operationKind
    ) {
      failure(
        message,
        "operation-mismatch",
        "취소 요청의 상관키가 원래 품질 연산과 일치하지 않습니다.",
      );
      return;
    }
    task.cancelled = true;
    admitted.delete(message.requestId);
    cancelled(task);
  };

  const disposeRuntime = (postReceipt: boolean): void => {
    if (state === "disposed") return;
    const epoch = workerEpoch;
    for (const task of admitted.values()) {
      if (!task.cancelled) {
        task.cancelled = true;
        cancelled(task);
      }
    }
    admitted.clear();
    queue.length = 0;
    active = null;
    state = "disposed";
    if (postReceipt && epoch !== null) {
      post({
        type: "studio-quality/disposed",
        protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
        workerEpoch: epoch,
        acceptedThroughRequestId,
      });
    }
  };

  return {
    handleMessage(value) {
      if (state === "fatal" || state === "disposed") return;
      const validation = validateStudioQualityWorkerInboundMessage(value);
      if (!validation.ok) {
        fatal(
          "protocol",
          validation.code,
          validation.message,
          {
            workerEpoch: validation.workerEpoch,
            requestId: validation.requestId,
          },
        );
        return;
      }
      const message = validation.message;
      if (message.type === "studio-quality/initialize") {
        if (state !== "awaiting-initialize") {
          fatal(
            "protocol",
            "invalid-message",
            "품질 Worker는 한 epoch에서 한 번만 초기화할 수 있습니다.",
            { workerEpoch: message.workerEpoch, requestId: null },
          );
          return;
        }
        initialize(message.workerEpoch);
        return;
      }
      if (workerEpoch === null) {
        fatal(
          "protocol",
          "invalid-message",
          "품질 Worker 요청 전에 initialize 메시지가 필요합니다.",
          {
            workerEpoch: message.workerEpoch,
            requestId: "requestId" in message ? message.requestId : null,
          },
        );
        return;
      }
      if (message.workerEpoch !== workerEpoch) {
        fatal(
          "protocol",
          "epoch-mismatch",
          "품질 Worker 메시지 epoch가 현재 세션과 일치하지 않습니다.",
          {
            workerEpoch: message.workerEpoch,
            requestId: "requestId" in message ? message.requestId : null,
          },
        );
        return;
      }
      if (message.type === "studio-quality/request") {
        handleRequest(message);
        return;
      }
      if (message.type === "studio-quality/cancel") {
        handleCancel(message);
        return;
      }
      disposeRuntime(true);
    },
    dispose() {
      disposeRuntime(false);
    },
    snapshot() {
      return {
        state,
        workerEpoch,
        acceptedThroughRequestId,
        queuedRequests: queue.filter((task) => !task.cancelled).length,
        activeRequestId: active?.request.requestId ?? null,
        providerFactoryCalls,
      };
    },
  };
}
