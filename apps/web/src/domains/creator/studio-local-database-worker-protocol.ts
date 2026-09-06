/**
 * Clone-safe RPC contract shared by the Studio SQLite DedicatedWorker and its page client.
 *
 * SQLite records are already plain structured-clone values, so this protocol intentionally does
 * not assume ArrayBuffer payloads or transfer ownership. Adding a binary method later requires an
 * explicit protocol revision and transfer policy instead of silently detaching caller memory.
 */

export const STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION = 1 as const;

export const STUDIO_LOCAL_DATABASE_WORKER_METHODS = Object.freeze([
  "kvGet",
  "kvSet",
  "kvDelete",
  "putTournamentWinner",
  "getTournamentWinner",
  "listTournamentWinners",
  "listTournamentWinnerCandidates",
  "replaceTournamentWinners",
  "evictTournamentProvider",
  "recordCostSample",
  "listCostSamples",
  "appendJournalEntry",
  "listJournalEntries",
  "deleteJournalEntriesBefore",
  "putJournalSnapshot",
  "listJournalSnapshots",
  "queryBrushLibraryRecords",
  "getBrushLibraryRecord",
  "putBrushLibraryRecord",
  "putBrushLibraryRecords",
  "compareAndRestoreBrushLibraryRecords",
  "insertMissingBrushLibraryRecords",
  "deleteBrushLibraryRecord",
  "listBrushLibraryNames",
  "queryFilterLibraryRecords",
  "getFilterLibraryRecord",
  "putFilterLibraryRecord",
  "putFilterLibraryRecords",
  "compareAndRestoreFilterLibraryRecords",
  "insertMissingFilterLibraryRecords",
  "deleteFilterLibraryRecord",
  "deleteFilterLibraryRecords",
  "listCrdtOutboxCandidates",
  "enqueueCrdtOutboxRecord",
  "acknowledgeCrdtOutboxRecord",
  "recordCrdtOutboxRetry",
  "listCrdtRecoveryCandidates",
  "getCrdtRecoveryCandidate",
  "putCrdtRecoveryRecord",
] as const);

export type StudioLocalDatabaseWorkerMethod =
  (typeof STUDIO_LOCAL_DATABASE_WORKER_METHODS)[number];

/**
 * Calls whose durable commit may have completed before a Worker/response-channel crash. This is
 * deliberately explicit: callers must preserve old+new blob references when the outcome is
 * unknowable instead of treating transport loss as a definitive rollback.
 */
const METHOD_EFFECT = Object.freeze({
  kvGet: "read",
  kvSet: "mutation",
  kvDelete: "mutation",
  putTournamentWinner: "mutation",
  getTournamentWinner: "read",
  listTournamentWinners: "read",
  listTournamentWinnerCandidates: "read",
  replaceTournamentWinners: "mutation",
  evictTournamentProvider: "mutation",
  recordCostSample: "mutation",
  listCostSamples: "read",
  appendJournalEntry: "mutation",
  listJournalEntries: "read",
  deleteJournalEntriesBefore: "mutation",
  putJournalSnapshot: "mutation",
  listJournalSnapshots: "read",
  queryBrushLibraryRecords: "read",
  getBrushLibraryRecord: "read",
  putBrushLibraryRecord: "mutation",
  putBrushLibraryRecords: "mutation",
  compareAndRestoreBrushLibraryRecords: "mutation",
  insertMissingBrushLibraryRecords: "mutation",
  deleteBrushLibraryRecord: "mutation",
  listBrushLibraryNames: "read",
  queryFilterLibraryRecords: "read",
  getFilterLibraryRecord: "read",
  putFilterLibraryRecord: "mutation",
  putFilterLibraryRecords: "mutation",
  compareAndRestoreFilterLibraryRecords: "mutation",
  insertMissingFilterLibraryRecords: "mutation",
  deleteFilterLibraryRecord: "mutation",
  deleteFilterLibraryRecords: "mutation",
  listCrdtOutboxCandidates: "read",
  enqueueCrdtOutboxRecord: "mutation",
  acknowledgeCrdtOutboxRecord: "mutation",
  recordCrdtOutboxRetry: "mutation",
  listCrdtRecoveryCandidates: "read",
  getCrdtRecoveryCandidate: "read",
  putCrdtRecoveryRecord: "mutation",
} as const satisfies Record<StudioLocalDatabaseWorkerMethod, "read" | "mutation">);

export const STUDIO_LOCAL_DATABASE_WORKER_MUTATION_METHODS: readonly StudioLocalDatabaseWorkerMethod[] =
  Object.freeze(
    STUDIO_LOCAL_DATABASE_WORKER_METHODS.filter(
      (method) => METHOD_EFFECT[method] === "mutation",
    ),
  );

export function isStudioLocalDatabaseWorkerMutationMethod(
  method: StudioLocalDatabaseWorkerMethod,
): boolean {
  return METHOD_EFFECT[method] === "mutation";
}

export type StudioLocalDatabaseWorkerRequest =
  | {
      readonly version: typeof STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION;
      readonly kind: "initialize";
      readonly requestId: number;
    }
  | {
      readonly version: typeof STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION;
      readonly kind: "call";
      readonly requestId: number;
      readonly method: StudioLocalDatabaseWorkerMethod;
      readonly args: readonly unknown[];
    }
  | {
      readonly version: typeof STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION;
      readonly kind: "close";
      readonly requestId: number;
    };

export type StudioLocalDatabaseWorkerErrorDetail = string | number | boolean | null;

export interface StudioLocalDatabaseWorkerSerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly details?: Readonly<Record<string, StudioLocalDatabaseWorkerErrorDetail>>;
  readonly cause?: StudioLocalDatabaseWorkerSerializedError;
  readonly truncated?: true;
}

export type StudioLocalDatabaseWorkerResponse =
  | {
      readonly version: typeof STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION;
      readonly kind: "success";
      readonly requestId: number;
      readonly value: unknown;
    }
  | {
      readonly version: typeof STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION;
      readonly kind: "failure";
      readonly requestId: number;
      readonly error: StudioLocalDatabaseWorkerSerializedError;
    };

const ERROR_DETAIL_KEYS = Object.freeze([
  "code",
  "method",
  "reason",
  "entryCount",
  "rowCount",
  "totalBytes",
] as const);
const MAX_ERROR_CAUSE_DEPTH = 5;
const MAX_ERROR_DETAILS = ERROR_DETAIL_KEYS.length;
const METHOD_SET: ReadonlySet<string> = new Set(STUDIO_LOCAL_DATABASE_WORKER_METHODS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface OwnDataProperty {
  readonly exists: boolean;
  readonly value?: unknown;
}

function ownDataProperty(value: object, key: string): OwnDataProperty {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return { exists: false };
    return { exists: true, value: descriptor.value };
  } catch {
    return { exists: false };
  }
}

function isPlainRecordWithAllowedOwnKeys(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !allowedKeys.has(key) ||
        !ownDataProperty(value, key).exists,
    )
  ) {
    return false;
  }
  return requiredKeys.every((key) => ownDataProperty(value, key).exists);
}

function ownDataValue(value: object, key: string): unknown {
  return ownDataProperty(value, key).value;
}

function isRequestId(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function readProperty(value: object, key: PropertyKey): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function safeText(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

function circularCauseError(): StudioLocalDatabaseWorkerSerializedError {
  return Object.freeze({
    name: "Error",
    message: "remote error cause graph was circular",
    truncated: true,
  });
}

function serializeErrorAtDepth(
  error: unknown,
  seen: Set<object>,
  depth: number,
): StudioLocalDatabaseWorkerSerializedError {
  if (typeof error !== "object" || error === null) {
    return Object.freeze({
      name: "NonErrorThrown",
      message: safeText(error, "remote code threw a non-Error value"),
    });
  }
  if (seen.has(error)) return circularCauseError();
  seen.add(error);

  const name = safeText(readProperty(error, "name"), "Error");
  const message = safeText(readProperty(error, "message"), "remote operation failed");
  const stackValue = readProperty(error, "stack");
  const details: Record<string, StudioLocalDatabaseWorkerErrorDetail> = {};
  for (const key of ERROR_DETAIL_KEYS) {
    const detail = readProperty(error, key);
    if (
      detail === null ||
      typeof detail === "string" ||
      typeof detail === "number" ||
      typeof detail === "boolean"
    ) {
      details[key] = detail;
    }
  }

  const causeValue = readProperty(error, "cause");
  const hasCause = causeValue !== undefined;
  const serialized: {
    name: string;
    message: string;
    stack?: string;
    details?: Readonly<Record<string, StudioLocalDatabaseWorkerErrorDetail>>;
    cause?: StudioLocalDatabaseWorkerSerializedError;
    truncated?: true;
  } = { name, message };
  if (typeof stackValue === "string") serialized.stack = stackValue;
  if (Object.keys(details).length > 0) serialized.details = Object.freeze(details);
  if (hasCause && depth < MAX_ERROR_CAUSE_DEPTH) {
    serialized.cause = serializeErrorAtDepth(causeValue, seen, depth + 1);
  } else if (hasCause) {
    serialized.truncated = true;
  }
  return Object.freeze(serialized);
}

/** Serializes only bounded primitive metadata and a bounded cause chain. */
export function serializeStudioLocalDatabaseWorkerError(
  error: unknown,
): StudioLocalDatabaseWorkerSerializedError {
  return serializeErrorAtDepth(error, new Set<object>(), 0);
}

export function isStudioLocalDatabaseWorkerMethod(
  value: unknown,
): value is StudioLocalDatabaseWorkerMethod {
  return typeof value === "string" && METHOD_SET.has(value);
}

export function studioLocalDatabaseWorkerRequestId(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const requestId = ownDataValue(value, "requestId");
  return isRequestId(requestId) ? requestId : null;
}

const INITIALIZE_OR_CLOSE_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "version",
  "kind",
  "requestId",
]);
const CALL_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "version",
  "kind",
  "requestId",
  "method",
  "args",
]);
const REQUEST_REQUIRED_KEYS = Object.freeze(["version", "kind", "requestId"] as const);

export function isStudioLocalDatabaseWorkerRequest(
  value: unknown,
): value is StudioLocalDatabaseWorkerRequest {
  if (!isRecord(value)) return false;
  const kind = ownDataValue(value, "kind");
  const allowedKeys =
    kind === "initialize" || kind === "close"
      ? INITIALIZE_OR_CLOSE_REQUEST_KEYS
      : kind === "call"
        ? CALL_REQUEST_KEYS
        : null;
  if (
    !allowedKeys ||
    !isPlainRecordWithAllowedOwnKeys(
      value,
      allowedKeys,
      kind === "call" ? [...REQUEST_REQUIRED_KEYS, "method", "args"] : REQUEST_REQUIRED_KEYS,
    ) ||
    ownDataValue(value, "version") !== STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION ||
    !isRequestId(ownDataValue(value, "requestId"))
  ) {
    return false;
  }
  if (kind === "initialize" || kind === "close") return true;
  return (
    isStudioLocalDatabaseWorkerMethod(ownDataValue(value, "method")) &&
    Array.isArray(ownDataValue(value, "args"))
  );
}

const ERROR_DETAIL_KEY_SET: ReadonlySet<string> = new Set(ERROR_DETAIL_KEYS);
const SERIALIZED_ERROR_KEYS: ReadonlySet<string> = new Set([
  "name",
  "message",
  "stack",
  "details",
  "cause",
  "truncated",
]);
const SERIALIZED_ERROR_REQUIRED_KEYS = Object.freeze(["name", "message"] as const);
const SUCCESS_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "version",
  "kind",
  "requestId",
  "value",
]);
const FAILURE_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "version",
  "kind",
  "requestId",
  "error",
]);

function isErrorDetails(
  value: unknown,
): value is Readonly<Record<string, StudioLocalDatabaseWorkerErrorDetail>> {
  if (!isPlainRecordWithAllowedOwnKeys(value, ERROR_DETAIL_KEY_SET, [])) return false;
  let keys: readonly string[];
  try {
    keys = Object.keys(value);
  } catch {
    return false;
  }
  if (keys.length > MAX_ERROR_DETAILS) return false;
  return keys.every((key) => {
    const detail = ownDataValue(value, key);
    return (
      detail === null ||
      typeof detail === "string" ||
      typeof detail === "number" ||
      typeof detail === "boolean"
    );
  });
}

function isSerializedError(value: unknown, depth: number): value is StudioLocalDatabaseWorkerSerializedError {
  if (!isPlainRecordWithAllowedOwnKeys(
    value,
    SERIALIZED_ERROR_KEYS,
    SERIALIZED_ERROR_REQUIRED_KEYS,
  )) {
    return false;
  }
  const name = ownDataValue(value, "name");
  const message = ownDataValue(value, "message");
  const stack = ownDataValue(value, "stack");
  const details = ownDataValue(value, "details");
  const truncated = ownDataValue(value, "truncated");
  const cause = ownDataValue(value, "cause");
  if (
    typeof name !== "string" ||
    typeof message !== "string" ||
    (stack !== undefined && typeof stack !== "string") ||
    (details !== undefined && !isErrorDetails(details)) ||
    (truncated !== undefined && truncated !== true)
  ) {
    return false;
  }
  if (cause === undefined) return true;
  return depth < MAX_ERROR_CAUSE_DEPTH && isSerializedError(cause, depth + 1);
}

export function isStudioLocalDatabaseWorkerResponse(
  value: unknown,
): value is StudioLocalDatabaseWorkerResponse {
  if (!isRecord(value)) return false;
  const kind = ownDataValue(value, "kind");
  const allowedKeys =
    kind === "success"
      ? SUCCESS_RESPONSE_KEYS
      : kind === "failure"
        ? FAILURE_RESPONSE_KEYS
        : null;
  if (
    !allowedKeys ||
    !isPlainRecordWithAllowedOwnKeys(
      value,
      allowedKeys,
      kind === "success"
        ? ["version", "kind", "requestId", "value"]
        : ["version", "kind", "requestId", "error"],
    ) ||
    ownDataValue(value, "version") !== STUDIO_LOCAL_DATABASE_WORKER_PROTOCOL_VERSION ||
    !isRequestId(ownDataValue(value, "requestId"))
  ) {
    return false;
  }
  if (kind === "success") return true;
  return isSerializedError(ownDataValue(value, "error"), 0);
}
