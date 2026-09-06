import { snapshotStudioPortablePathGeometry } from "./render/studio-canvaskit-portable-geometry";

import type {
  StudioPathOpsResult,
  StudioQualityPathOp,
  StudioStrokeToPathStyle,
} from "./render/studio-canvaskit-adapter";

/**
 * Structured-clone-only boundary for quality geometry specialists.
 *
 * CanvasKit/Skia and its Embind objects are deliberately absent from this contract. Only bounded
 * scalar data and portable SVG path strings may cross the Worker boundary.
 */
export const STUDIO_QUALITY_WORKER_PROTOCOL_REVISION = 2 as const;

export const STUDIO_QUALITY_WORKER_BUDGETS = Object.freeze({
  maxQueuedRequests: 16,
  maxInputPathCodeUnits: 8 * 1024 * 1024,
  maxTotalInputCodeUnits: 12 * 1024 * 1024,
  maxOutputPathCodeUnits: 32 * 1024 * 1024,
  maxRequestTokenCharacters: 128,
  maxBuildIdentifierCharacters: 96,
  maxErrorMessageCharacters: 2_048,
  maxStrokeWidthPx: 1_000_000,
  maxMiterLimit: 10_000,
  maxDashEntries: 2,
  maxDashValue: 1_000_000,
} as const);

export const STUDIO_QUALITY_WORKER_PROVIDER_PROFILE =
  "canvaskit-pathops-stroke-v1" as const;

export interface StudioQualityWorkerInitializeMessage {
  readonly type: "studio-quality/initialize";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number;
  readonly clientBuild: string;
}

export interface StudioQualityWorkerPathBooleanOperation {
  readonly kind: "path-boolean";
  readonly a: string;
  readonly b: string;
  readonly op: StudioQualityPathOp;
}

export interface StudioQualityWorkerStrokeToFillOperation {
  readonly kind: "stroke-to-fill";
  readonly pathData: string;
  readonly style: StudioStrokeToPathStyle;
}

export type StudioQualityWorkerOperation =
  | StudioQualityWorkerPathBooleanOperation
  | StudioQualityWorkerStrokeToFillOperation;

export type StudioQualityWorkerOperationKind = StudioQualityWorkerOperation["kind"];

export interface StudioQualityWorkerRequestMessage {
  readonly type: "studio-quality/request";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number;
  readonly requestId: number;
  readonly requestToken: string;
  readonly operation: StudioQualityWorkerOperation;
}

export interface StudioQualityWorkerCancelMessage {
  readonly type: "studio-quality/cancel";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number;
  readonly requestId: number;
  readonly requestToken: string;
  readonly operationKind: StudioQualityWorkerOperationKind;
}

export interface StudioQualityWorkerDisposeMessage {
  readonly type: "studio-quality/dispose";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number;
}

export type StudioQualityWorkerInboundMessage =
  | StudioQualityWorkerInitializeMessage
  | StudioQualityWorkerRequestMessage
  | StudioQualityWorkerCancelMessage
  | StudioQualityWorkerDisposeMessage;

export interface StudioQualityWorkerLimits {
  readonly maxQueuedRequests: number;
  readonly maxInputPathCodeUnits: number;
  readonly maxTotalInputCodeUnits: number;
  readonly maxOutputPathCodeUnits: number;
}

export interface StudioQualityWorkerReadyMessage {
  readonly type: "studio-quality/ready";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number;
  readonly providerProfile: typeof STUDIO_QUALITY_WORKER_PROVIDER_PROFILE;
  readonly providerId: "canvaskit";
  readonly capabilities: Readonly<{
    pathBoolean: true;
    strokeToPath: true;
  }>;
  readonly limits: StudioQualityWorkerLimits;
}

export interface StudioQualityWorkerResultMessage {
  readonly type: "studio-quality/result";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number;
  readonly requestId: number;
  readonly requestToken: string;
  readonly operationKind: StudioQualityWorkerOperationKind;
  readonly providerId: "canvaskit";
  readonly result: StudioPathOpsResult;
}

export interface StudioQualityWorkerCancelledMessage {
  readonly type: "studio-quality/cancelled";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number;
  readonly requestId: number;
  readonly requestToken: string;
  readonly operationKind: StudioQualityWorkerOperationKind;
}

export type StudioQualityWorkerRequestFailureCode =
  | "already-settled"
  | "not-ready"
  | "operation-mismatch"
  | "output-budget-exceeded"
  | "provider-execution-failed"
  | "provider-result-invalid"
  | "queue-full"
  | "stale-or-duplicate"
  | "unknown-request";

export interface StudioQualityWorkerFailureMessage {
  readonly type: "studio-quality/failure";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number;
  readonly requestId: number;
  readonly requestToken: string;
  readonly operationKind: StudioQualityWorkerOperationKind;
  readonly error: Readonly<{
    code: StudioQualityWorkerRequestFailureCode;
    message: string;
  }>;
}

export type StudioQualityWorkerFatalCode =
  | "disposed"
  | "epoch-mismatch"
  | "invalid-message"
  | "provider-capability-missing"
  | "provider-init-failed"
  | "unsupported-protocol";

export interface StudioQualityWorkerFatalMessage {
  readonly type: "studio-quality/fatal";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number | null;
  readonly requestId: number | null;
  readonly stage: "initialization" | "protocol";
  readonly error: Readonly<{
    code: StudioQualityWorkerFatalCode;
    message: string;
  }>;
}

export interface StudioQualityWorkerDisposedMessage {
  readonly type: "studio-quality/disposed";
  readonly protocolRevision: typeof STUDIO_QUALITY_WORKER_PROTOCOL_REVISION;
  readonly workerEpoch: number;
  readonly acceptedThroughRequestId: number;
}

export type StudioQualityWorkerResponseMessage =
  | StudioQualityWorkerReadyMessage
  | StudioQualityWorkerResultMessage
  | StudioQualityWorkerCancelledMessage
  | StudioQualityWorkerFailureMessage
  | StudioQualityWorkerFatalMessage
  | StudioQualityWorkerDisposedMessage;

export interface StudioQualityWorkerRequestAuthority {
  readonly workerEpoch: number;
  readonly requestId: number;
  readonly requestToken: string;
  readonly operationKind: StudioQualityWorkerOperationKind;
}

export type StudioQualityWorkerInboundValidation =
  | { readonly ok: true; readonly message: StudioQualityWorkerInboundMessage }
  | {
      readonly ok: false;
      readonly code: "invalid-message" | "unsupported-protocol";
      readonly workerEpoch: number | null;
      readonly requestId: number | null;
      readonly message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedString(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string"
    && value.length <= maximum
    && (allowEmpty || value.trim().length > 0)
  );
}

function isRequestToken(value: unknown): value is string {
  return (
    isBoundedString(value, STUDIO_QUALITY_WORKER_BUDGETS.maxRequestTokenCharacters)
    && /^[A-Za-z0-9._:-]+$/u.test(value)
  );
}

function isPathOperation(value: unknown): value is StudioQualityWorkerPathBooleanOperation {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["kind", "a", "b", "op"])
    || value.kind !== "path-boolean"
    || !isBoundedString(value.a, STUDIO_QUALITY_WORKER_BUDGETS.maxInputPathCodeUnits)
    || !isBoundedString(value.b, STUDIO_QUALITY_WORKER_BUDGETS.maxInputPathCodeUnits)
    || value.a.length + value.b.length > STUDIO_QUALITY_WORKER_BUDGETS.maxTotalInputCodeUnits
  ) {
    return false;
  }
  return (
    value.op === "union"
    || value.op === "intersect"
    || value.op === "difference"
    || value.op === "xor"
  );
}

function isDash(
  value: unknown,
): value is NonNullable<StudioStrokeToPathStyle["dash"]> {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["pattern", "phase"])
    || !Array.isArray(value.pattern)
    || value.pattern.length < 1
    || value.pattern.length > STUDIO_QUALITY_WORKER_BUDGETS.maxDashEntries
    || typeof value.phase !== "number"
    || !Number.isFinite(value.phase)
    || Math.abs(value.phase) > STUDIO_QUALITY_WORKER_BUDGETS.maxDashValue
  ) {
    return false;
  }
  return value.pattern.every(
    (entry) =>
      typeof entry === "number"
      && Number.isFinite(entry)
      && entry > 0
      && entry <= STUDIO_QUALITY_WORKER_BUDGETS.maxDashValue,
  );
}

function isStrokeStyle(value: unknown): value is StudioStrokeToPathStyle {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    !keys.every((key) =>
      ["widthPx", "cap", "join", "miterLimit", "dash"].includes(key),
    )
    || !["widthPx", "cap", "join", "miterLimit"].every((key) => keys.includes(key))
    || (
      typeof value.widthPx !== "number"
      || !Number.isFinite(value.widthPx)
      || value.widthPx <= 0
      || value.widthPx > STUDIO_QUALITY_WORKER_BUDGETS.maxStrokeWidthPx
    )
    || (
      typeof value.miterLimit !== "number"
      || !Number.isFinite(value.miterLimit)
      || value.miterLimit <= 0
      || value.miterLimit > STUDIO_QUALITY_WORKER_BUDGETS.maxMiterLimit
    )
    || (value.cap !== "butt" && value.cap !== "round" && value.cap !== "square")
    || (value.join !== "miter" && value.join !== "round" && value.join !== "bevel")
  ) {
    return false;
  }
  return value.dash === undefined || isDash(value.dash);
}

function isStrokeOperation(value: unknown): value is StudioQualityWorkerStrokeToFillOperation {
  return (
    isRecord(value)
    && hasExactKeys(value, ["kind", "pathData", "style"])
    && value.kind === "stroke-to-fill"
    && isBoundedString(
      value.pathData,
      STUDIO_QUALITY_WORKER_BUDGETS.maxInputPathCodeUnits,
    )
    && isStrokeStyle(value.style)
  );
}

export function isStudioQualityWorkerOperation(
  value: unknown,
): value is StudioQualityWorkerOperation {
  return isPathOperation(value) || isStrokeOperation(value);
}

export function validateStudioQualityWorkerInboundMessage(
  value: unknown,
): StudioQualityWorkerInboundValidation {
  const record = isRecord(value) ? value : null;
  const workerEpoch = record && isPositiveSafeInteger(record.workerEpoch)
    ? record.workerEpoch
    : null;
  const requestId = record && isPositiveSafeInteger(record.requestId)
    ? record.requestId
    : null;
  if (
    record
    && "protocolRevision" in record
    && record.protocolRevision !== STUDIO_QUALITY_WORKER_PROTOCOL_REVISION
  ) {
    return {
      ok: false,
      code: "unsupported-protocol",
      workerEpoch,
      requestId,
      message: "지원하지 않는 품질 Worker 프로토콜 버전입니다.",
    };
  }
  if (!record || record.protocolRevision !== STUDIO_QUALITY_WORKER_PROTOCOL_REVISION) {
    return {
      ok: false,
      code: "invalid-message",
      workerEpoch,
      requestId,
      message: "품질 Worker 메시지 형식이 올바르지 않습니다.",
    };
  }

  if (
    hasExactKeys(record, ["type", "protocolRevision", "workerEpoch", "clientBuild"])
    && record.type === "studio-quality/initialize"
    && isPositiveSafeInteger(record.workerEpoch)
    && isBoundedString(
      record.clientBuild,
      STUDIO_QUALITY_WORKER_BUDGETS.maxBuildIdentifierCharacters,
    )
  ) {
    return { ok: true, message: record as unknown as StudioQualityWorkerInitializeMessage };
  }
  if (
    hasExactKeys(record, [
      "type",
      "protocolRevision",
      "workerEpoch",
      "requestId",
      "requestToken",
      "operation",
    ])
    && record.type === "studio-quality/request"
    && isPositiveSafeInteger(record.workerEpoch)
    && isPositiveSafeInteger(record.requestId)
    && isRequestToken(record.requestToken)
    && isStudioQualityWorkerOperation(record.operation)
  ) {
    return { ok: true, message: record as unknown as StudioQualityWorkerRequestMessage };
  }
  if (
    hasExactKeys(record, [
      "type",
      "protocolRevision",
      "workerEpoch",
      "requestId",
      "requestToken",
      "operationKind",
    ])
    && record.type === "studio-quality/cancel"
    && isPositiveSafeInteger(record.workerEpoch)
    && isPositiveSafeInteger(record.requestId)
    && isRequestToken(record.requestToken)
    && (
      record.operationKind === "path-boolean"
      || record.operationKind === "stroke-to-fill"
    )
  ) {
    return { ok: true, message: record as unknown as StudioQualityWorkerCancelMessage };
  }
  if (
    hasExactKeys(record, ["type", "protocolRevision", "workerEpoch"])
    && record.type === "studio-quality/dispose"
    && isPositiveSafeInteger(record.workerEpoch)
  ) {
    return { ok: true, message: record as unknown as StudioQualityWorkerDisposeMessage };
  }
  return {
    ok: false,
    code: "invalid-message",
    workerEpoch,
    requestId,
    message: "품질 Worker 메시지의 필드 또는 안전 예산이 올바르지 않습니다.",
  };
}

function isOperationKind(value: unknown): value is StudioQualityWorkerOperationKind {
  return value === "path-boolean" || value === "stroke-to-fill";
}

function hasResponseCorrelation(
  value: Record<string, unknown>,
): value is Record<string, unknown> & StudioQualityWorkerRequestAuthority {
  return (
    isPositiveSafeInteger(value.workerEpoch)
    && isPositiveSafeInteger(value.requestId)
    && isRequestToken(value.requestToken)
    && isOperationKind(value.operationKind)
  );
}

function isPortableResult(value: unknown): value is StudioPathOpsResult {
  if (!isRecord(value)) return false;
  if (
    (
      hasExactKeys(value, ["ok", "pathData"])
      || hasExactKeys(value, ["ok", "pathData", "geometry"])
    )
    && value.ok === true
    && isBoundedString(
      value.pathData,
      STUDIO_QUALITY_WORKER_BUDGETS.maxOutputPathCodeUnits,
    )
    && (
      !Object.hasOwn(value, "geometry")
      || snapshotStudioPortablePathGeometry(value.geometry) !== null
    )
  ) {
    return true;
  }
  return (
    hasExactKeys(value, ["ok", "reason"])
    && value.ok === false
    && isBoundedString(value.reason, STUDIO_QUALITY_WORKER_BUDGETS.maxErrorMessageCharacters)
  );
}

function isLimits(value: unknown): value is StudioQualityWorkerLimits {
  return (
    isRecord(value)
    && hasExactKeys(value, [
      "maxQueuedRequests",
      "maxInputPathCodeUnits",
      "maxTotalInputCodeUnits",
      "maxOutputPathCodeUnits",
    ])
    && value.maxQueuedRequests === STUDIO_QUALITY_WORKER_BUDGETS.maxQueuedRequests
    && value.maxInputPathCodeUnits === STUDIO_QUALITY_WORKER_BUDGETS.maxInputPathCodeUnits
    && value.maxTotalInputCodeUnits === STUDIO_QUALITY_WORKER_BUDGETS.maxTotalInputCodeUnits
    && value.maxOutputPathCodeUnits === STUDIO_QUALITY_WORKER_BUDGETS.maxOutputPathCodeUnits
  );
}

function isErrorPayload(
  value: unknown,
  codes: readonly string[],
): value is Readonly<{ code: string; message: string }> {
  return (
    isRecord(value)
    && hasExactKeys(value, ["code", "message"])
    && typeof value.code === "string"
    && codes.includes(value.code)
    && isBoundedString(value.message, STUDIO_QUALITY_WORKER_BUDGETS.maxErrorMessageCharacters)
  );
}

const REQUEST_FAILURE_CODES: readonly StudioQualityWorkerRequestFailureCode[] = [
  "already-settled",
  "not-ready",
  "operation-mismatch",
  "output-budget-exceeded",
  "provider-execution-failed",
  "provider-result-invalid",
  "queue-full",
  "stale-or-duplicate",
  "unknown-request",
];

const FATAL_CODES: readonly StudioQualityWorkerFatalCode[] = [
  "disposed",
  "epoch-mismatch",
  "invalid-message",
  "provider-capability-missing",
  "provider-init-failed",
  "unsupported-protocol",
];

export function isStudioQualityWorkerResponseMessage(
  value: unknown,
): value is StudioQualityWorkerResponseMessage {
  if (!isRecord(value)) return false;
  if (
    hasExactKeys(value, [
      "type",
      "protocolRevision",
      "workerEpoch",
      "providerProfile",
      "providerId",
      "capabilities",
      "limits",
    ])
    && value.type === "studio-quality/ready"
    && value.protocolRevision === STUDIO_QUALITY_WORKER_PROTOCOL_REVISION
    && isPositiveSafeInteger(value.workerEpoch)
    && value.providerProfile === STUDIO_QUALITY_WORKER_PROVIDER_PROFILE
    && value.providerId === "canvaskit"
    && isRecord(value.capabilities)
    && hasExactKeys(value.capabilities, ["pathBoolean", "strokeToPath"])
    && value.capabilities.pathBoolean === true
    && value.capabilities.strokeToPath === true
    && isLimits(value.limits)
  ) {
    return true;
  }
  if (
    hasExactKeys(value, [
      "type",
      "protocolRevision",
      "workerEpoch",
      "requestId",
      "requestToken",
      "operationKind",
      "providerId",
      "result",
    ])
    && value.type === "studio-quality/result"
    && value.protocolRevision === STUDIO_QUALITY_WORKER_PROTOCOL_REVISION
    && hasResponseCorrelation(value)
    && value.providerId === "canvaskit"
    && isPortableResult(value.result)
  ) {
    return true;
  }
  if (
    hasExactKeys(value, [
      "type",
      "protocolRevision",
      "workerEpoch",
      "requestId",
      "requestToken",
      "operationKind",
    ])
    && value.type === "studio-quality/cancelled"
    && value.protocolRevision === STUDIO_QUALITY_WORKER_PROTOCOL_REVISION
    && hasResponseCorrelation(value)
  ) {
    return true;
  }
  if (
    hasExactKeys(value, [
      "type",
      "protocolRevision",
      "workerEpoch",
      "requestId",
      "requestToken",
      "operationKind",
      "error",
    ])
    && value.type === "studio-quality/failure"
    && value.protocolRevision === STUDIO_QUALITY_WORKER_PROTOCOL_REVISION
    && hasResponseCorrelation(value)
    && isErrorPayload(value.error, REQUEST_FAILURE_CODES)
  ) {
    return true;
  }
  if (
    hasExactKeys(value, [
      "type",
      "protocolRevision",
      "workerEpoch",
      "requestId",
      "stage",
      "error",
    ])
    && value.type === "studio-quality/fatal"
    && value.protocolRevision === STUDIO_QUALITY_WORKER_PROTOCOL_REVISION
    && (value.workerEpoch === null || isPositiveSafeInteger(value.workerEpoch))
    && (value.requestId === null || isPositiveSafeInteger(value.requestId))
    && (value.stage === "initialization" || value.stage === "protocol")
    && isErrorPayload(value.error, FATAL_CODES)
  ) {
    return true;
  }
  return (
    hasExactKeys(value, [
      "type",
      "protocolRevision",
      "workerEpoch",
      "acceptedThroughRequestId",
    ])
    && value.type === "studio-quality/disposed"
    && value.protocolRevision === STUDIO_QUALITY_WORKER_PROTOCOL_REVISION
    && isPositiveSafeInteger(value.workerEpoch)
    && isNonNegativeSafeInteger(value.acceptedThroughRequestId)
  );
}

export function isStudioQualityWorkerResponseForAuthority(
  value: unknown,
  authority: StudioQualityWorkerRequestAuthority,
): value is
  | StudioQualityWorkerResultMessage
  | StudioQualityWorkerCancelledMessage
  | StudioQualityWorkerFailureMessage {
  if (!isStudioQualityWorkerResponseMessage(value)) return false;
  if (
    value.type !== "studio-quality/result"
    && value.type !== "studio-quality/cancelled"
    && value.type !== "studio-quality/failure"
  ) {
    return false;
  }
  return (
    value.workerEpoch === authority.workerEpoch
    && value.requestId === authority.requestId
    && value.requestToken === authority.requestToken
    && value.operationKind === authority.operationKind
  );
}

export function studioQualityWorkerResponseIdentity(
  value: unknown,
): StudioQualityWorkerRequestAuthority | null {
  if (!isRecord(value) || !hasResponseCorrelation(value)) return null;
  return {
    workerEpoch: value.workerEpoch,
    requestId: value.requestId,
    requestToken: value.requestToken,
    operationKind: value.operationKind,
  };
}
