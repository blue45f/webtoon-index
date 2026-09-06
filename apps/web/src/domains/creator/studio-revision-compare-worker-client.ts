import studioRevisionCompareWorkerBootstrapSource from "./studio-revision-compare.worker-bootstrap.ts?raw";
import studioRevisionCompareWorkerRuntimeUrl from "./studio-revision-compare.worker.ts?worker&url";
import {
  STUDIO_REVISION_CHANGE_DETAIL_LIMIT,
  STUDIO_REVISION_CHANGE_FIELD_LIMIT,
  STUDIO_REVISION_CHANGE_KINDS,
  STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT,
  type StudioRevisionChange,
  type StudioRevisionChangeKind,
  type StudioRevisionChangeScope,
  type StudioRevisionDiff,
  type StudioRevisionNumericSnapshot,
} from "./studio-revision-diff";
import {
  buildStudioServerRevisionComparison,
  type StudioServerRevisionComparison,
  type StudioServerRevisionComparisonInput,
  type StudioRevisionPublicationImpact,
} from "./studio-server-revision-comparison";

import { projectRevisionComparisonValue } from "@/shared/lib/revision-comparison-projection";

const STUDIO_REVISION_COMPARE_WORKER_VERSION = 1 as const;
const STUDIO_REVISION_COMPARE_RUNTIME_MODULE_URL_TOKEN =
  "__TOONSPECTRUM_REVISION_COMPARE_RUNTIME_MODULE_URL__";
const STUDIO_REVISION_COMPARE_BOOTSTRAP_READY_TYPE =
  "studio-revision-compare/bootstrap-ready";
export const STUDIO_REVISION_COMPARE_DIRECT_MAX_ELEMENTS = 50_000;
/** Shared clone/compute ceiling used even when a module Worker is available. */
export const STUDIO_REVISION_COMPARE_MAX_ELEMENTS = 250_000;
export const STUDIO_REVISION_COMPARE_MAX_NODES = 2_000_000;
export const STUDIO_REVISION_COMPARE_MAX_ARRAY_ITEMS = 500_000;
export const STUDIO_REVISION_COMPARE_MAX_OBJECT_KEYS = 2_000_000;
export const STUDIO_REVISION_COMPARE_MAX_KEYS_PER_OBJECT = 4_096;
export const STUDIO_REVISION_COMPARE_MAX_DEPTH = 64;
/** One server payload is capped at 15 MiB; three compare inputs get a bounded aggregate budget. */
export const STUDIO_REVISION_COMPARE_MAX_STRING_CODE_UNITS = 48 * 1024 * 1024;
export const STUDIO_REVISION_COMPARE_MAX_INDIVIDUAL_STRING_CODE_UNITS = 16 * 1024 * 1024;
export const STUDIO_REVISION_COMPARE_MAX_REVISION = 2_147_483_647;
export const STUDIO_REVISION_COMPARE_MAX_PAGE_ID_LIST = 200;
export const STUDIO_REVISION_COMPARE_MAX_PAGE_LABELS = 600;
export const STUDIO_REVISION_COMPARE_MAX_WORKER_ERROR_NAME = 120;
export const STUDIO_REVISION_COMPARE_MAX_WORKER_ERROR_MESSAGE = 2_000;

const WORKER_CONTRACT_ERROR_MESSAGE = "버전 비교 Worker 응답 계약이 올바르지 않습니다.";

interface StudioRevisionCompareInputComplexity {
  elements: number;
  nodes: number;
  arrayItems: number;
  objectKeys: number;
  stringCodeUnits: number;
}

export interface StudioRevisionCompareWorkerLike {
  onmessage: ((event: MessageEvent<StudioRevisionCompareWorkerResponse>) => void) | null;
  onerror: ((event: { error?: unknown; message?: string; preventDefault?(): void }) => void) | null;
  postMessage(message: StudioRevisionCompareWorkerRequest): void;
  terminate(): void;
}

interface StudioRevisionCompareNativeWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: StudioRevisionCompareWorkerLike["onerror"];
  postMessage(message: StudioRevisionCompareWorkerRequest): void;
  terminate(): void;
}

export type StudioRevisionCompareWorkerFactory = () => StudioRevisionCompareWorkerLike | null;
export type StudioRevisionCompareExecutionBackend = "worker" | "direct";

export interface StudioRevisionCompareRunOptions {
  /** Fixed before projection/comparison begins. Browser product callers select `worker`. */
  readonly executionBackend?: StudioRevisionCompareExecutionBackend;
  readonly signal?: AbortSignal;
  /** Test/platform seam for the selected Worker backend. */
  readonly workerFactory?: StudioRevisionCompareWorkerFactory | null;
}

interface StudioRevisionCompareWorkerRequest {
  type: "studio-revision-compare/run";
  version: typeof STUDIO_REVISION_COMPARE_WORKER_VERSION;
  input: StudioServerRevisionComparisonInput;
}

interface StudioRevisionCompareWorkerSuccess {
  type: "studio-revision-compare/success";
  version: typeof STUDIO_REVISION_COMPARE_WORKER_VERSION;
  comparison: StudioServerRevisionComparison;
}

interface StudioRevisionCompareWorkerFailure {
  type: "studio-revision-compare/failure";
  version: typeof STUDIO_REVISION_COMPARE_WORKER_VERSION;
  error: { name: string; message: string };
}

export type StudioRevisionCompareWorkerResponse =
  | StudioRevisionCompareWorkerSuccess
  | StudioRevisionCompareWorkerFailure;

function isStudioRevisionCompareBootstrapReady(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === STUDIO_REVISION_COMPARE_BOOTSTRAP_READY_TYPE && message.version === 1;
}

function createIdempotentBlobUrlRevoker(
  bootstrapUrl: string,
  revokeObjectURL: (url: string) => void
): () => void {
  let revoked = false;
  return () => {
    if (revoked) return;
    revoked = true;
    revokeObjectURL(bootstrapUrl);
  };
}

class StudioRevisionCompareOwnedModuleWorker implements StudioRevisionCompareWorkerLike {
  onmessage: StudioRevisionCompareWorkerLike["onmessage"] = null;
  onerror: StudioRevisionCompareWorkerLike["onerror"] = null;
  private terminated = false;

  constructor(
    private readonly worker: StudioRevisionCompareNativeWorkerLike,
    private readonly revokeBootstrapUrl: () => void
  ) {
    worker.onmessage = (event) => {
      if (isStudioRevisionCompareBootstrapReady(event.data)) {
        this.revokeBootstrapUrl();
        return;
      }
      this.onmessage?.(event as MessageEvent<StudioRevisionCompareWorkerResponse>);
    };
    worker.onerror = (event) => {
      this.revokeBootstrapUrl();
      this.onerror?.(event);
    };
  }

  postMessage(message: StudioRevisionCompareWorkerRequest): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    this.revokeBootstrapUrl();
    if (this.terminated) return;
    this.terminated = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
  }
}

export function createStudioRevisionCompareModuleWorker(): StudioRevisionCompareWorkerLike | null {
  if (
    typeof Worker !== "function" ||
    typeof Blob !== "function" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    return null;
  }
  const tokenParts = studioRevisionCompareWorkerBootstrapSource.split(
    STUDIO_REVISION_COMPARE_RUNTIME_MODULE_URL_TOKEN
  );
  if (tokenParts.length !== 2) {
    throw new Error("Revision comparison Worker bootstrap contract is invalid.");
  }
  const runtimeUrl = new URL(studioRevisionCompareWorkerRuntimeUrl, import.meta.url).href;
  const bootstrapUrl = URL.createObjectURL(new Blob([
    tokenParts[0],
    runtimeUrl,
    tokenParts[1],
  ], { type: "text/javascript;charset=utf-8" }));
  const revokeBootstrapUrl = createIdempotentBlobUrlRevoker(
    bootstrapUrl,
    URL.revokeObjectURL.bind(URL)
  );
  let worker: StudioRevisionCompareNativeWorkerLike | undefined;
  try {
    worker = new Worker(bootstrapUrl, {
      type: "module",
      name: "toonspectrum-revision-compare",
    }) as unknown as StudioRevisionCompareNativeWorkerLike;
    return new StudioRevisionCompareOwnedModuleWorker(worker, revokeBootstrapUrl);
  } catch (error) {
    revokeBootstrapUrl();
    worker?.terminate();
    throw error;
  }
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("버전 비교를 취소했습니다.", "AbortError");
  }
  const error = new Error("버전 비교를 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function complexityError(message: string): RangeError {
  return new RangeError(`버전 비교 입력이 안전 한도를 넘었습니다: ${message}`);
}

function incrementBudget(
  current: number,
  increment: number,
  maximum: number,
  label: string
): number {
  if (!Number.isSafeInteger(increment) || increment < 0 || current > maximum - increment) {
    throw complexityError(`${label} 최대 ${maximum.toLocaleString("en-US")}`);
  }
  return current + increment;
}

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (key === "") return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

/**
 * Structured clone is not a validation boundary. Walk the same graph before either Worker or
 * direct execution so a hostile legacy/extension snapshot cannot allocate or recurse without a
 * deterministic ceiling. Shared references are accepted, but actual cycles fail closed.
 */
function assertStudioRevisionCompareInputComplexity(
  input: StudioServerRevisionComparisonInput
): StudioRevisionCompareInputComplexity {
  if (!isPlainRecord(input)) throw complexityError("입력 객체 형식");
  if (!isRevision(input.targetRevision) || !isRevision(input.baseRevision)) {
    throw complexityError("revision 형식");
  }

  const complexity: StudioRevisionCompareInputComplexity = {
    elements: 0,
    nodes: 0,
    arrayItems: 0,
    objectKeys: 0,
    stringCodeUnits: 0,
  };
  const seen = new WeakSet<object>();
  const active = new WeakSet<object>();
  const countedElementArrays = new WeakSet<object>();

  const consumeString = (value: string): void => {
    if (value.length > STUDIO_REVISION_COMPARE_MAX_INDIVIDUAL_STRING_CODE_UNITS) {
      throw complexityError(
        `개별 문자열 최대 ${STUDIO_REVISION_COMPARE_MAX_INDIVIDUAL_STRING_CODE_UNITS.toLocaleString("en-US")}자`
      );
    }
    complexity.stringCodeUnits = incrementBudget(
      complexity.stringCodeUnits,
      value.length,
      STUDIO_REVISION_COMPARE_MAX_STRING_CODE_UNITS,
      "문자열 총 길이"
    );
  };

  const visit = (value: unknown, depth: number, propertyName?: string): void => {
    if (depth > STUDIO_REVISION_COMPARE_MAX_DEPTH) {
      throw complexityError(`중첩 깊이 최대 ${STUDIO_REVISION_COMPARE_MAX_DEPTH}`);
    }
    complexity.nodes = incrementBudget(
      complexity.nodes,
      1,
      STUDIO_REVISION_COMPARE_MAX_NODES,
      "노드 수"
    );

    if (typeof value === "string") {
      consumeString(value);
      return;
    }
    if (
      value === null ||
      value === undefined ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      return;
    }
    if (typeof value !== "object") throw complexityError("복제할 수 없는 값");
    if (Array.isArray(value) && propertyName === "elements" && !countedElementArrays.has(value)) {
      countedElementArrays.add(value);
      complexity.elements = incrementBudget(
        complexity.elements,
        value.length,
        STUDIO_REVISION_COMPARE_MAX_ELEMENTS,
        "페이지·마스터 요소 수"
      );
    }
    if (active.has(value)) throw complexityError("순환 참조는 허용되지 않음");
    if (seen.has(value)) return;
    seen.add(value);
    active.add(value);

    try {
      if (Array.isArray(value)) {
        complexity.arrayItems = incrementBudget(
          complexity.arrayItems,
          value.length,
          STUDIO_REVISION_COMPARE_MAX_ARRAY_ITEMS,
          "배열 항목 수"
        );

        const keys = Object.keys(value);
        const ownNames = Object.getOwnPropertyNames(value);
        if (ownNames.length !== keys.length + 1 || !ownNames.includes("length")) {
          throw complexityError("배열 비열거 속성은 허용되지 않음");
        }
        for (const key of keys) {
          if (!isCanonicalArrayIndex(key, value.length)) {
            throw complexityError("배열 사용자 정의 속성은 허용되지 않음");
          }
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw complexityError("배열 속성 형식");
          }
          consumeString(key);
          visit(descriptor.value, depth + 1);
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
          throw complexityError("Symbol 속성은 허용되지 않음");
        }
        return;
      }

      if (!isPlainRecord(value)) throw complexityError("일반 객체가 아닌 값");
      const keys = Object.keys(value);
      if (Object.getOwnPropertyNames(value).length !== keys.length) {
        throw complexityError("비열거 속성은 허용되지 않음");
      }
      if (keys.length > STUDIO_REVISION_COMPARE_MAX_KEYS_PER_OBJECT) {
        throw complexityError(
          `객체당 키 수 최대 ${STUDIO_REVISION_COMPARE_MAX_KEYS_PER_OBJECT.toLocaleString("en-US")}`
        );
      }
      complexity.objectKeys = incrementBudget(
        complexity.objectKeys,
        keys.length,
        STUDIO_REVISION_COMPARE_MAX_OBJECT_KEYS,
        "객체 키 수"
      );
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw complexityError("Symbol 속성은 허용되지 않음");
      }
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw complexityError("접근자 속성은 허용되지 않음");
        }
        consumeString(key);
        visit(descriptor.value, depth + 1, key);
      }
    } finally {
      active.delete(value);
    }
  };

  try {
    visit(input, 0);
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw complexityError("검증할 수 없는 객체 구조");
  }
  return complexity;
}

function runDirect(
  input: StudioServerRevisionComparisonInput,
  complexity: StudioRevisionCompareInputComplexity,
  signal?: AbortSignal
): StudioServerRevisionComparison {
  throwIfAborted(signal);
  if (complexity.elements > STUDIO_REVISION_COMPARE_DIRECT_MAX_ELEMENTS) {
    throw new RangeError(
      `선택한 direct 버전 비교는 안전 상한(${STUDIO_REVISION_COMPARE_DIRECT_MAX_ELEMENTS.toLocaleString("en-US")}개 요소)을 적용합니다.`
    );
  }
  const comparison = buildStudioServerRevisionComparison(input);
  throwIfAborted(signal);
  return comparison;
}

function revisionWorkerFailure(
  message: string,
  name = "StudioRevisionCompareWorkerError",
): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function workerError(response: StudioRevisionCompareWorkerFailure): Error {
  const error = new Error(response.error.message || "버전 비교 Worker 실행에 실패했습니다.");
  error.name = response.error.name || "Error";
  return error;
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= STUDIO_REVISION_COMPARE_MAX_REVISION;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hasOnlyDataKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[] = []
): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const keys = Object.keys(value);
  if (Object.getOwnPropertyNames(value).length !== keys.length) return false;
  if (keys.some((key) => !allowed.has(key))) return false;
  if (required.some((key) => !Object.hasOwn(value, key))) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && "value" in descriptor && descriptor.enumerable);
  });
}

function isBoundedDescriptorString(value: unknown, allowEmpty = true): value is string {
  return typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= STUDIO_REVISION_DESCRIPTOR_STRING_LIMIT;
}

function isDenseDataArray(value: unknown, maximumItems: number): value is readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximumItems) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== value.length ||
    Object.getOwnPropertyNames(value).length !== keys.length + 1 ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return false;
  }
  return keys.every((key, index) => {
    if (key !== String(index)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor && "value" in descriptor && descriptor.enumerable);
  });
}

function isBoundedStringArray(value: unknown, maximumItems: number): value is readonly string[] {
  return isDenseDataArray(value, maximumItems) &&
    value.every((item) => isBoundedDescriptorString(item));
}

function isNumericSnapshot(value: unknown): value is StudioRevisionNumericSnapshot {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > STUDIO_REVISION_CHANGE_FIELD_LIMIT) return false;
  if (!hasOnlyDataKeys(value, new Set(keys))) return false;
  return keys.every((key) =>
    isBoundedDescriptorString(key) &&
    (value[key] === null || (typeof value[key] === "number" && Number.isFinite(value[key])))
  );
}

const CHANGE_KEYS = new Set([
  "kind",
  "scope",
  "pageId",
  "previousPageId",
  "elementId",
  "elementType",
  "previousElementType",
  "field",
  "fields",
  "fieldCount",
  "beforeIndex",
  "afterIndex",
  "before",
  "after",
  "beforePageIds",
  "afterPageIds",
  "elementCount",
  "commonElementCount",
  "firstChangedElementId",
]);
const CHANGE_KIND_SET = new Set<string>(STUDIO_REVISION_CHANGE_KINDS);
const CHANGE_SCOPES = new Set<StudioRevisionChangeScope>(["document", "page", "element"]);

function expectedScope(kind: StudioRevisionChangeKind): StudioRevisionChangeScope {
  if (kind.startsWith("page-")) return "page";
  if (kind.startsWith("element-")) return "element";
  return "document";
}

function isStudioRevisionChange(value: unknown): value is StudioRevisionChange {
  if (!isPlainRecord(value) || !hasOnlyDataKeys(value, CHANGE_KEYS, ["kind", "scope"])) return false;
  if (typeof value.kind !== "string" || !CHANGE_KIND_SET.has(value.kind)) return false;
  if (typeof value.scope !== "string" || !CHANGE_SCOPES.has(value.scope as StudioRevisionChangeScope)) {
    return false;
  }
  const kind = value.kind as StudioRevisionChangeKind;
  if (value.scope !== expectedScope(kind)) return false;

  for (const key of [
    "pageId",
    "previousPageId",
    "elementId",
    "elementType",
    "previousElementType",
    "firstChangedElementId",
  ] as const) {
    if (value[key] !== undefined && !isBoundedDescriptorString(value[key], false)) return false;
  }
  if (value.field !== undefined && !isBoundedDescriptorString(value.field)) return false;
  if (value.fields !== undefined && !isBoundedStringArray(value.fields, STUDIO_REVISION_CHANGE_FIELD_LIMIT)) {
    return false;
  }
  if (value.fieldCount !== undefined) {
    if (!isNonNegativeInteger(value.fieldCount) || !Array.isArray(value.fields)) return false;
    if (value.fieldCount < value.fields.length) return false;
  }
  for (const key of [
    "beforeIndex",
    "afterIndex",
    "elementCount",
    "commonElementCount",
  ] as const) {
    if (value[key] !== undefined && !isNonNegativeInteger(value[key])) return false;
  }
  if (value.before !== undefined && !isNumericSnapshot(value.before)) return false;
  if (value.after !== undefined && !isNumericSnapshot(value.after)) return false;
  if (
    value.beforePageIds !== undefined &&
    !isBoundedStringArray(value.beforePageIds, STUDIO_REVISION_COMPARE_MAX_PAGE_ID_LIST)
  ) {
    return false;
  }
  if (
    value.afterPageIds !== undefined &&
    !isBoundedStringArray(value.afterPageIds, STUDIO_REVISION_COMPARE_MAX_PAGE_ID_LIST)
  ) {
    return false;
  }
  return true;
}

const DIFF_KEYS = new Set(["hasChanges", "totalChanges", "truncated", "summary", "changes"]);

function isStudioRevisionDiff(value: unknown): value is StudioRevisionDiff {
  if (
    !isPlainRecord(value) ||
    !hasOnlyDataKeys(value, DIFF_KEYS, ["hasChanges", "totalChanges", "truncated", "summary", "changes"]) ||
    typeof value.hasChanges !== "boolean" ||
    !isNonNegativeInteger(value.totalChanges) ||
    typeof value.truncated !== "boolean"
  ) {
    return false;
  }
  const summary = value.summary;
  const changes = value.changes;
  if (!isPlainRecord(summary) || !isDenseDataArray(changes, STUDIO_REVISION_CHANGE_DETAIL_LIMIT)) {
    return false;
  }

  const summaryKeys = new Set<string>(STUDIO_REVISION_CHANGE_KINDS);
  if (!hasOnlyDataKeys(summary, summaryKeys, STUDIO_REVISION_CHANGE_KINDS)) return false;
  let summaryTotal = 0;
  const summaryCounts = Object.fromEntries(
    STUDIO_REVISION_CHANGE_KINDS.map((kind) => [kind, 0])
  ) as Record<StudioRevisionChangeKind, number>;
  const detailedCounts = Object.fromEntries(
    STUDIO_REVISION_CHANGE_KINDS.map((kind) => [kind, 0])
  ) as Record<StudioRevisionChangeKind, number>;
  for (const kind of STUDIO_REVISION_CHANGE_KINDS) {
    const count = summary[kind];
    if (!isNonNegativeInteger(count) || summaryTotal > Number.MAX_SAFE_INTEGER - count) return false;
    summaryCounts[kind] = count;
    summaryTotal += count;
  }
  for (const change of changes) {
    if (!isStudioRevisionChange(change)) return false;
    detailedCounts[change.kind] += 1;
  }
  if (summaryTotal !== value.totalChanges) return false;
  if (value.hasChanges !== (value.totalChanges > 0)) return false;
  if (changes.length !== Math.min(value.totalChanges, STUDIO_REVISION_CHANGE_DETAIL_LIMIT)) {
    return false;
  }
  if (value.truncated !== (value.totalChanges > changes.length)) return false;
  return STUDIO_REVISION_CHANGE_KINDS.every(
    (kind) => summaryCounts[kind] >= detailedCounts[kind]
  );
}

const PUBLICATION_IMPACT_KEYS = new Set(["statusChange", "changedRelations"]);
const STATUS_CHANGE_KEYS = new Set(["before", "after"]);
const PUBLICATION_RELATION_FIELDS = new Set([
  "titleId",
  "seriesId",
  "challengeId",
  "episodeNo",
  "remixFromId",
]);

function isPublicationStatus(value: unknown): value is "draft" | "published" | null {
  return value === null || value === "draft" || value === "published";
}

function isStudioRevisionPublicationImpact(value: unknown): value is StudioRevisionPublicationImpact {
  if (
    !isPlainRecord(value) ||
    !hasOnlyDataKeys(value, PUBLICATION_IMPACT_KEYS, ["statusChange", "changedRelations"]) ||
    !isDenseDataArray(value.changedRelations, PUBLICATION_RELATION_FIELDS.size) ||
    !value.changedRelations.every(
      (field) => typeof field === "string" && PUBLICATION_RELATION_FIELDS.has(field)
    ) ||
    new Set(value.changedRelations).size !== value.changedRelations.length
  ) {
    return false;
  }
  if (value.statusChange === null) return true;
  return isPlainRecord(value.statusChange) &&
    hasOnlyDataKeys(value.statusChange, STATUS_CHANGE_KEYS, ["before", "after"]) &&
    isPublicationStatus(value.statusChange.before) &&
    isPublicationStatus(value.statusChange.after) &&
    value.statusChange.before !== value.statusChange.after;
}

function isStudioRevisionPageLabels(value: unknown): value is Readonly<Record<string, string>> {
  if (!isPlainRecord(value)) return false;
  const pageIds = Object.keys(value);
  if (pageIds.length > STUDIO_REVISION_COMPARE_MAX_PAGE_LABELS) return false;
  if (!hasOnlyDataKeys(value, new Set(pageIds))) return false;
  return pageIds.every((pageId) =>
    isBoundedDescriptorString(pageId, false) &&
    typeof value[pageId] === "string" &&
    value[pageId].length <= 80
  );
}

const COMPARISON_KEYS = new Set([
  "targetRevision",
  "baseRevision",
  "localToTarget",
  "serverToLocal",
  "publicationImpact",
  "pageLabels",
]);

function isStudioServerRevisionComparison(value: unknown): value is StudioServerRevisionComparison {
  return isPlainRecord(value) &&
    hasOnlyDataKeys(
      value,
      COMPARISON_KEYS,
      [
        "targetRevision",
        "baseRevision",
        "localToTarget",
        "serverToLocal",
        "publicationImpact",
        "pageLabels",
      ]
    ) &&
    isRevision(value.targetRevision) &&
    isRevision(value.baseRevision) &&
    isStudioRevisionDiff(value.localToTarget) &&
    isStudioRevisionDiff(value.serverToLocal) &&
    isStudioRevisionPublicationImpact(value.publicationImpact) &&
    isStudioRevisionPageLabels(value.pageLabels);
}

const SUCCESS_KEYS = new Set(["type", "version", "comparison"]);
const FAILURE_KEYS = new Set(["type", "version", "error"]);
const ERROR_KEYS = new Set(["name", "message"]);

function parseWorkerResponse(value: unknown): StudioRevisionCompareWorkerResponse {
  let versionMismatch = false;
  try {
    if (!isPlainRecord(value) || typeof value.type !== "string") {
      throw new Error(WORKER_CONTRACT_ERROR_MESSAGE);
    }
    if (value.version !== STUDIO_REVISION_COMPARE_WORKER_VERSION) {
      versionMismatch = true;
      throw new Error("버전 비교 Worker 응답 버전이 올바르지 않습니다.");
    }
    if (value.type === "studio-revision-compare/success") {
      if (
        !hasOnlyDataKeys(value, SUCCESS_KEYS, ["type", "version", "comparison"]) ||
        !isStudioServerRevisionComparison(value.comparison)
      ) {
        throw new Error(WORKER_CONTRACT_ERROR_MESSAGE);
      }
      return value as unknown as StudioRevisionCompareWorkerSuccess;
    }
    if (value.type === "studio-revision-compare/failure") {
      if (
        !hasOnlyDataKeys(value, FAILURE_KEYS, ["type", "version", "error"]) ||
        !isPlainRecord(value.error) ||
        !hasOnlyDataKeys(value.error, ERROR_KEYS, ["name", "message"]) ||
        typeof value.error.name !== "string" ||
        value.error.name.length === 0 ||
        value.error.name.length > STUDIO_REVISION_COMPARE_MAX_WORKER_ERROR_NAME ||
        typeof value.error.message !== "string" ||
        value.error.message.length === 0 ||
        value.error.message.length > STUDIO_REVISION_COMPARE_MAX_WORKER_ERROR_MESSAGE
      ) {
        throw new Error(WORKER_CONTRACT_ERROR_MESSAGE);
      }
      return value as unknown as StudioRevisionCompareWorkerFailure;
    }
    throw new Error(WORKER_CONTRACT_ERROR_MESSAGE);
  } catch {
    if (versionMismatch) throw new Error("버전 비교 Worker 응답 버전이 올바르지 않습니다.");
    throw new Error(WORKER_CONTRACT_ERROR_MESSAGE);
  }
}

function comparisonMatchesRequest(
  comparison: StudioServerRevisionComparison,
  input: StudioServerRevisionComparisonInput
): boolean {
  return comparison.targetRevision === input.targetRevision && comparison.baseRevision === input.baseRevision;
}

async function projectStudioRevisionComparisonInput(
  input: StudioServerRevisionComparisonInput
): Promise<StudioServerRevisionComparisonInput> {
  const projected = await projectRevisionComparisonValue(input);
  if (
    !isPlainRecord(projected) ||
    !isRevision(projected.targetRevision) ||
    !isRevision(projected.baseRevision) ||
    !isPlainRecord(projected.targetSnapshot) ||
    !isPlainRecord(projected.baseSnapshot) ||
    !isPlainRecord(projected.localProject)
  ) {
    throw complexityError("안전 투영 결과 형식");
  }
  return projected as unknown as StudioServerRevisionComparisonInput;
}

function runWithWorker(
  worker: StudioRevisionCompareWorkerLike,
  input: StudioServerRevisionComparisonInput,
  signal?: AbortSignal
): Promise<StudioServerRevisionComparison> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(() => reject(revisionWorkerFailure(
        "버전 비교 시간이 너무 오래 걸려 중단했습니다.",
        "TimeoutError",
      )));
    }, 30_000);
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(createAbortError()));

    worker.onmessage = (event) => {
      let response: StudioRevisionCompareWorkerResponse;
      try {
        response = parseWorkerResponse(event.data);
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      if (response.type === "studio-revision-compare/failure") {
        finish(() => reject(workerError(response)));
        return;
      }
      if (!comparisonMatchesRequest(response.comparison, input)) {
        finish(() => reject(new Error("버전 비교 Worker가 다른 revision 결과를 반환했습니다.")));
        return;
      }
      finish(() => resolve(response.comparison));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      finish(() => reject(revisionWorkerFailure(
        "버전 비교 Worker 실행에 실패했습니다.",
      )));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      worker.postMessage({
        type: "studio-revision-compare/run",
        version: STUDIO_REVISION_COMPARE_WORKER_VERSION,
        input,
      });
    } catch {
      finish(() => reject(revisionWorkerFailure(
        "버전 비교 Worker 요청을 시작하지 못했습니다.",
      )));
    }
  });
}

/** Runs the potentially large semantic comparison away from the canvas/UI main thread. */
export async function runStudioRevisionComparison(
  input: StudioServerRevisionComparisonInput,
  options: StudioRevisionCompareRunOptions = {},
): Promise<StudioServerRevisionComparison> {
  const executionBackend = options.executionBackend ?? "worker";
  if (executionBackend !== "worker" && executionBackend !== "direct") {
    throw new TypeError("버전 비교 실행 backend가 올바르지 않습니다.");
  }
  throwIfAborted(options.signal);
  // Validate the raw graph before the projection itself allocates, then ensure no data:/blob:
  // resource string can cross the Worker boundary or diverge from projected server revisions.
  const complexity = assertStudioRevisionCompareInputComplexity(input);
  const projectedInput = await projectStudioRevisionComparisonInput(input);
  throwIfAborted(options.signal);
  assertStudioRevisionCompareInputComplexity(projectedInput);
  if (executionBackend === "direct") {
    return runDirect(projectedInput, complexity, options.signal);
  }
  const factory = options.workerFactory === undefined
    ? createStudioRevisionCompareModuleWorker
    : options.workerFactory;
  if (!factory) {
    throw revisionWorkerFailure("버전 비교 Worker를 사용할 수 없습니다.");
  }

  let worker: StudioRevisionCompareWorkerLike | null;
  try {
    worker = factory();
  } catch {
    throw revisionWorkerFailure("버전 비교 Worker를 생성하지 못했습니다.");
  }
  if (!worker) {
    throw revisionWorkerFailure("버전 비교 Worker를 사용할 수 없습니다.");
  }
  return runWithWorker(worker, projectedInput, options.signal);
}

export type {
  StudioRevisionCompareWorkerFailure,
  StudioRevisionCompareWorkerRequest,
  StudioRevisionCompareWorkerSuccess,
};
