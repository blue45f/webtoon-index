import type {
  CspSqliteReadContext,
  CspSqliteSnapshot,
} from "../../../../../packages/studio-format-gateway/src/csp-sut";

export const STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION = 1 as const;

export type StudioCspSutSqliteWorkerContext = Omit<CspSqliteReadContext, "signal">;

export interface StudioCspSutSqliteWorkerRequest {
  readonly version: typeof STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly bytes: ArrayBuffer;
  readonly context: StudioCspSutSqliteWorkerContext;
}

export type StudioCspSutSqliteWorkerErrorCode =
  | "aborted"
  | "bounds"
  | "deserialize"
  | "invalid-request"
  | "query"
  | "sqlite-init"
  | "timeout"
  | "worker-unavailable"
  | "worker-failed";

export interface StudioCspSutSqliteWorkerSuccess {
  readonly version: typeof STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly ok: true;
  readonly snapshot: CspSqliteSnapshot;
}

export interface StudioCspSutSqliteWorkerFailure {
  readonly version: typeof STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly ok: false;
  readonly code: StudioCspSutSqliteWorkerErrorCode;
  readonly message: string;
}

export type StudioCspSutSqliteWorkerResponse =
  | StudioCspSutSqliteWorkerSuccess
  | StudioCspSutSqliteWorkerFailure;

export function isStudioCspSutSqliteWorkerRequest(
  value: unknown,
): value is StudioCspSutSqliteWorkerRequest {
  if (value === null || typeof value !== "object") return false;
  const request = value as Partial<StudioCspSutSqliteWorkerRequest>;
  const context = request.context as Partial<StudioCspSutSqliteWorkerContext> | undefined;
  return request.version === STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION
    && Number.isSafeInteger(request.requestId)
    && (request.requestId ?? 0) > 0
    && request.bytes instanceof ArrayBuffer
    && context !== undefined
    && (context.kind === "sut" || context.kind === "sutg")
    && [
      context.maxTables,
      context.maxColumnsPerTable,
      context.maxRows,
      context.maxBlobBytes,
      context.maxTextCharacters,
    ].every((limit) => Number.isSafeInteger(limit) && (limit ?? -1) >= 0);
}

export function isStudioCspSutSqliteWorkerResponse(
  value: unknown,
  requestId: number,
): value is StudioCspSutSqliteWorkerResponse {
  if (value === null || typeof value !== "object") return false;
  const response = value as Partial<StudioCspSutSqliteWorkerResponse>;
  if (
    response.version !== STUDIO_CSP_SUT_SQLITE_WORKER_PROTOCOL_VERSION
    || response.requestId !== requestId
    || typeof response.ok !== "boolean"
  ) {
    return false;
  }
  if (response.ok) {
    return response.snapshot !== null
      && typeof response.snapshot === "object"
      && Array.isArray(response.snapshot.tables);
  }
  const failure = response as Partial<StudioCspSutSqliteWorkerFailure>;
  return typeof failure.code === "string" && typeof failure.message === "string";
}
