import {
  replayStudioRasterCrdtPixels,
  type StudioRasterReplayRuntimeDependencies,
  type StudioRasterReplayRuntimeResult,
} from "../live/studio-crdt-raster-replay-runtime";
import {
  STUDIO_PROJECT_ARCHIVE_LIMITS,
  type StudioProjectArchiveLimits,
} from "../studio-project-archive";
import { parseStudioProjectFile, type StudioProjectFile } from "../studio-project-file";

import { materializeStudioFilterMaskReplayPng } from "./studio-filter-mask-surface-hydrator";

import type { StudioRasterOperationLog } from "@/shared/lib/studio-crdt-raster-ops";

import {
  isStudioFilterMaskSurfaceId,
  isStudioFilterMaskSurfaceSpec,
  type StudioFilterMaskSurfaceId,
} from "@/shared/lib/studio-filter-mask-surface-contract";

const FILTER_MASK_ARCHIVE_DEFAULT_CONCURRENCY = 2;
const FILTER_MASK_ARCHIVE_MAX_CONCURRENCY = 4;
const FILTER_MASK_ARCHIVE_MAX_SURFACES = 256;
const FILTER_MASK_ARCHIVE_MAX_REPLAY_RESIDENT_BYTES = 512 * 1_024 * 1_024;
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const SAFE_WORK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;

type MutableRecord = Record<string, unknown>;

export type StudioFilterMaskSurfaceArchiveErrorCode =
  | "aborted"
  | "invalid_input"
  | "invalid_reference"
  | "missing_surface"
  | "non_portable"
  | "resource_limit"
  | "stale"
  | "surface_invalid";

export class StudioFilterMaskSurfaceArchiveError extends Error {
  constructor(
    readonly code: StudioFilterMaskSurfaceArchiveErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StudioFilterMaskSurfaceArchiveError";
  }
}

export interface StudioFilterMaskSurfaceArchiveDocumentReader {
  getRasterOperationLogAsync(
    surfaceId: string,
    options?: { readonly signal?: AbortSignal }
  ): Promise<StudioRasterOperationLog | null>;
}

export interface StudioFilterMaskSurfaceArchiveDependencies {
  /** Work-scoped CRDT document/store. The project JSON itself never contains these operation logs. */
  readonly document: StudioFilterMaskSurfaceArchiveDocumentReader;
  /** Work-scoped immutable raster asset resolver used by the replay runtime. */
  readonly download: StudioRasterReplayRuntimeDependencies["download"];
  readonly replay?: typeof replayStudioRasterCrdtPixels;
  readonly materializePng?: typeof materializeStudioFilterMaskReplayPng;
}

export type StudioFilterMaskSurfaceArchiveGuardPhase =
  | "before-read"
  | "after-read"
  | "after-replay"
  | "after-materialize"
  | "before-return";

export interface StudioFilterMaskSurfaceArchiveGuard {
  readonly workId: string;
  readonly generation: number;
  readonly phase: StudioFilterMaskSurfaceArchiveGuardPhase;
  readonly surfaceId?: StudioFilterMaskSurfaceId;
}

export interface StudioFilterMaskSurfaceArchiveRequest {
  readonly project: unknown;
  readonly workId: string | null;
  readonly generation: number;
  /**
   * Scope/generation authority is owned by the caller. A false result discards every partially
   * materialized PNG and prevents a stale archive from being returned.
   */
  readonly isCurrent: (
    guard: StudioFilterMaskSurfaceArchiveGuard
  ) => boolean | Promise<boolean>;
  readonly signal?: AbortSignal;
  readonly concurrency?: number;
  readonly limits?: Partial<
    Pick<
      StudioProjectArchiveLimits,
      "maxAttachmentBytes" | "maxAttachments" | "maxReferences" | "maxTotalAttachmentBytes"
    >
  >;
}

export interface StudioFilterMaskSurfaceArchiveResult {
  /** Portable snapshot: inline PNG fallbacks are present and every work-scoped surface ref is gone. */
  readonly project: StudioProjectFile;
  readonly surfaceCount: number;
  readonly referenceCount: number;
  readonly materializedPngBytes: number;
}

interface MutableSurfaceReference {
  readonly surfaceId: StudioFilterMaskSurfaceId;
  readonly pointer: string;
  readonly element: MutableRecord;
}

interface PreparedProjectSnapshot {
  readonly project: StudioProjectFile;
  readonly references: readonly MutableSurfaceReference[];
}

interface ResolvedLimits {
  readonly maxAttachmentBytes: number;
  readonly maxAttachments: number;
  readonly maxReferences: number;
  readonly maxTotalAttachmentBytes: number;
}

function fail(
  code: StudioFilterMaskSurfaceArchiveErrorCode,
  message: string,
  cause?: unknown
): never {
  throw new StudioFilterMaskSurfaceArchiveError(code, message, cause);
}

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortError(signal: AbortSignal): StudioFilterMaskSurfaceArchiveError {
  return new StudioFilterMaskSurfaceArchiveError(
    "aborted",
    "필터 마스크 archive materialization이 취소되었습니다.",
    signal.reason
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function positiveBoundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    fail("invalid_input", `${label} 값이 허용 범위를 벗어났습니다.`);
  }
  return resolved;
}

function resolvedLimits(
  value: StudioFilterMaskSurfaceArchiveRequest["limits"]
): ResolvedLimits {
  return {
    maxAttachmentBytes: positiveBoundedInteger(
      value?.maxAttachmentBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachmentBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachmentBytes,
      "개별 mask attachment 한도"
    ),
    maxAttachments: positiveBoundedInteger(
      value?.maxAttachments,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachments,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxAttachments,
      "mask attachment 수 한도"
    ),
    maxReferences: positiveBoundedInteger(
      value?.maxReferences,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxReferences,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxReferences,
      "mask attachment 참조 수 한도"
    ),
    maxTotalAttachmentBytes: positiveBoundedInteger(
      value?.maxTotalAttachmentBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxTotalAttachmentBytes,
      STUDIO_PROJECT_ARCHIVE_LIMITS.maxTotalAttachmentBytes,
      "mask attachment 합계 한도"
    ),
  };
}

function pointerSegment(value: string): string {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function cloneElementsAndCollect(
  elements: readonly unknown[],
  pointer: string,
  references: MutableSurfaceReference[]
): unknown[] {
  return elements.map((candidate, index) => {
    if (!isRecord(candidate) || !Object.hasOwn(candidate, "filterMaskSurfaceId")) {
      return candidate;
    }
    const elementPointer = `${pointer}/${index}`;
    if (
      candidate.type !== "image"
      || typeof candidate.id !== "string"
      || candidate.id.length < 1
      || !isStudioFilterMaskSurfaceId(candidate.filterMaskSurfaceId)
    ) {
      fail(
        "invalid_reference",
        `portable archive로 변환할 수 없는 필터 마스크 참조입니다: ${elementPointer}`
      );
    }
    const cloned: MutableRecord = { ...candidate };
    const surfaceId = candidate.filterMaskSurfaceId;
    delete cloned.filterMaskSurfaceId;
    references.push({
      surfaceId,
      pointer: `${elementPointer}/${pointerSegment("filterMaskSrc")}`,
      element: cloned,
    });
    return cloned;
  });
}

function snapshotProject(value: unknown): PreparedProjectSnapshot {
  let parsed: StudioProjectFile;
  try {
    parsed = parseStudioProjectFile(value);
  } catch (cause) {
    fail("invalid_input", "필터 마스크를 포함한 프로젝트 snapshot이 올바르지 않습니다.", cause);
  }
  const references: MutableSurfaceReference[] = [];
  const pagesList = parsed.pagesList.map((page, pageIndex) => ({
    ...page,
    elements: cloneElementsAndCollect(
      page.elements,
      `/pagesList/${pageIndex}/elements`,
      references
    ),
  }));
  const master = isRecord(parsed.master) && Array.isArray(parsed.master.elements)
    ? {
        ...parsed.master,
        elements: cloneElementsAndCollect(
          parsed.master.elements,
          "/master/elements",
          references
        ),
      }
    : parsed.master;
  return {
    project: {
      ...parsed,
      pagesList,
      ...(master === undefined ? {} : { master }),
    },
    references,
  };
}

function hasOwnSurfaceReference(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.hasOwn(value, "filterMaskSurfaceId");
}

/**
 * Cheap orchestration predicate. Full validation remains inside the materializer, so malformed
 * references also enter the fail-closed path instead of silently reaching project.json.
 */
export function hasStudioFilterMaskSurfaceArchiveReferences(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.pagesList)) {
    for (const page of value.pagesList) {
      if (
        isRecord(page)
        && Array.isArray(page.elements)
        && page.elements.some(hasOwnSurfaceReference)
      ) return true;
    }
  }
  return (
    isRecord(value.master)
    && Array.isArray(value.master.elements)
    && value.master.elements.some(hasOwnSurfaceReference)
  );
}

function assertWorkId(workId: string | null): asserts workId is string {
  if (
    typeof workId !== "string"
    || workId.length < 1
    || workId.length > 160
    || !SAFE_WORK_ID_PATTERN.test(workId)
  ) {
    fail(
      "invalid_input",
      "work-scoped 필터 마스크를 portable archive로 만들 작품 범위가 올바르지 않습니다."
    );
  }
}

function assertMagicLog(
  surfaceId: StudioFilterMaskSurfaceId,
  log: StudioRasterOperationLog
): void {
  if (
    log.surface.surfaceId !== surfaceId
    || !isStudioFilterMaskSurfaceSpec(log.surface)
    || log.operations.length !== 1
    || log.undoOperations.length !== 0
    || log.undoAcknowledgements.length !== 0
  ) {
    fail("surface_invalid", "필터 마스크 CRDT 로그가 불변 Magic v1 계약과 다릅니다.");
  }
  const operation = log.operations[0]!;
  if (
    operation.intent !== "paint"
    || operation.patches.length < 1
    || operation.patches.length > 16
    || operation.patches.some((patch) => (
      patch.selectionMask !== undefined
      || patch.effect.kind !== "composite"
      || patch.effect.blendMode !== "source-over"
      || patch.effect.payload.mediaType !== "image/png"
    ))
  ) {
    fail("surface_invalid", "필터 마스크 CRDT 작업이 허용된 단일 PNG 합성 형식이 아닙니다.");
  }
}

function assertReplayResult(
  surfaceId: StudioFilterMaskSurfaceId,
  log: StudioRasterOperationLog,
  result: StudioRasterReplayRuntimeResult
): void {
  if (
    result.surface.surfaceId !== surfaceId
    || result.surface.width !== log.surface.width
    || result.surface.height !== log.surface.height
    || result.surface.tileSize !== log.surface.tileSize
    || result.appliedOperationIds.length !== 1
    || result.appliedOperationIds[0] !== log.operations[0]!.operationId
    || result.undoneOperationIds.length !== 0
    || result.conflictedOperationIds.length !== 0
    || result.appliedPatchCount !== log.operations[0]!.patches.length
  ) {
    fail("surface_invalid", "필터 마스크 CRDT 재생이 하나의 확정 PNG 결과로 수렴하지 않았습니다.");
  }
}

function readPngDimension(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1_00_00_00
    + bytes[offset + 1]! * 0x1_00_00
    + bytes[offset + 2]! * 0x1_00
    + bytes[offset + 3]!
  );
}

function assertPortablePng(
  blob: Blob,
  bytes: Uint8Array,
  result: StudioRasterReplayRuntimeResult,
  limits: ResolvedLimits
): void {
  if (
    blob.type !== "image/png"
    || bytes.byteLength !== blob.size
    || bytes.byteLength < 24
    || bytes.byteLength > limits.maxAttachmentBytes
    || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
    || readPngDimension(bytes, 16) !== result.surface.width
    || readPngDimension(bytes, 20) !== result.surface.height
  ) {
    fail(
      bytes.byteLength > limits.maxAttachmentBytes ? "resource_limit" : "surface_invalid",
      "필터 마스크 materializer가 archive 계약과 일치하는 단일 PNG를 만들지 못했습니다."
    );
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa !== "function") {
    fail("non_portable", "portable PNG를 인라인 fallback으로 변환할 Base64 기능이 없습니다.");
  }
  const chunks: string[] = [];
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return globalThis.btoa(chunks.join(""));
}

function assertNoEphemeralOrSurfaceReferences(project: StudioProjectFile): void {
  const pending: unknown[] = [project];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (/^blob:/iu.test(value) || isStudioFilterMaskSurfaceId(value)) {
        fail(
          "non_portable",
          "portable project.json에 Blob URL 또는 work-scoped 필터 마스크 참조가 남았습니다."
        );
      }
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    if (visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "filterMaskSurfaceId") {
        fail("non_portable", "portable project.json에 필터 마스크 surface 필드가 남았습니다.");
      }
      pending.push(child);
    }
  }
}

async function assertCurrent(
  request: StudioFilterMaskSurfaceArchiveRequest,
  signal: AbortSignal,
  workId: string,
  phase: StudioFilterMaskSurfaceArchiveGuardPhase,
  surfaceId?: StudioFilterMaskSurfaceId
): Promise<void> {
  throwIfAborted(signal);
  let current: boolean;
  try {
    current = await request.isCurrent({
      workId,
      generation: request.generation,
      phase,
      ...(surfaceId === undefined ? {} : { surfaceId }),
    });
  } catch (cause) {
    throwIfAborted(signal);
    fail("stale", "필터 마스크 archive 범위의 최신 상태를 확인하지 못했습니다.", cause);
  }
  throwIfAborted(signal);
  if (!current) {
    fail("stale", "작품 또는 프로젝트 세대가 바뀌어 오래된 필터 마스크 archive를 폐기했습니다.");
  }
}

async function materializeSurface(
  surfaceId: StudioFilterMaskSurfaceId,
  request: StudioFilterMaskSurfaceArchiveRequest,
  dependencies: StudioFilterMaskSurfaceArchiveDependencies,
  limits: ResolvedLimits,
  signal: AbortSignal,
  workId: string
): Promise<{ readonly dataUrl: string; readonly byteLength: number }> {
  const replay = dependencies.replay ?? replayStudioRasterCrdtPixels;
  const materializePng = dependencies.materializePng ?? materializeStudioFilterMaskReplayPng;
  await assertCurrent(request, signal, workId, "before-read", surfaceId);
  let log: StudioRasterOperationLog | null;
  try {
    log = await dependencies.document.getRasterOperationLogAsync(surfaceId, { signal });
  } catch (cause) {
    throwIfAborted(signal);
    fail("missing_surface", "필터 마스크 CRDT 로그를 읽지 못했습니다.", cause);
  }
  throwIfAborted(signal);
  if (!log) fail("missing_surface", "필터 마스크 CRDT 로그를 찾을 수 없습니다.");
  assertMagicLog(surfaceId, log);
  await assertCurrent(request, signal, workId, "after-read", surfaceId);
  let result: StudioRasterReplayRuntimeResult;
  try {
    result = await replay({
      workId,
      log,
      signal,
      concurrency: 2,
      maxResidentBytes: FILTER_MASK_ARCHIVE_MAX_REPLAY_RESIDENT_BYTES,
    }, {
      download: dependencies.download,
    });
  } catch (cause) {
    throwIfAborted(signal);
    fail("surface_invalid", "필터 마스크 CRDT 재생에 실패했습니다.", cause);
  }
  throwIfAborted(signal);
  assertReplayResult(surfaceId, log, result);
  await assertCurrent(request, signal, workId, "after-replay", surfaceId);
  let blob: Blob;
  try {
    blob = await materializePng(result, signal);
  } catch (cause) {
    throwIfAborted(signal);
    fail("surface_invalid", "필터 마스크 PNG materialization에 실패했습니다.", cause);
  }
  throwIfAborted(signal);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch (cause) {
    throwIfAborted(signal);
    fail("surface_invalid", "materialized 필터 마스크 PNG를 읽지 못했습니다.", cause);
  }
  throwIfAborted(signal);
  assertPortablePng(blob, bytes, result, limits);
  await assertCurrent(request, signal, workId, "after-materialize", surfaceId);
  return {
    dataUrl: `data:image/png;base64,${bytesToBase64(bytes)}`,
    byteLength: bytes.byteLength,
  };
}

/**
 * Converts immutable work-scoped filter-mask surfaces into portable inline PNG fallbacks.
 *
 * `buildStudioProjectArchive` subsequently extracts each `filterMaskSrc` into its existing
 * content-addressed `mask` attachment path. This function deliberately returns no Blob URLs,
 * external surface IDs, or partial result on read/replay/materialization/race failure.
 */
export async function prepareStudioFilterMaskSurfaceArchiveExport(
  request: StudioFilterMaskSurfaceArchiveRequest,
  dependencies: StudioFilterMaskSurfaceArchiveDependencies
): Promise<StudioFilterMaskSurfaceArchiveResult> {
  if (
    !Number.isSafeInteger(request.generation)
    || request.generation < 0
    || typeof request.isCurrent !== "function"
    || !dependencies
    || !dependencies.document
    || typeof dependencies.document.getRasterOperationLogAsync !== "function"
    || typeof dependencies.download !== "function"
  ) {
    fail("invalid_input", "필터 마스크 archive materialization 입력이 올바르지 않습니다.");
  }
  const snapshot = snapshotProject(request.project);
  const limits = resolvedLimits(request.limits);
  if (
    snapshot.references.length > limits.maxReferences
    || snapshot.references.length > STUDIO_PROJECT_ARCHIVE_LIMITS.maxReferences
  ) {
    fail("resource_limit", "필터 마스크 archive 참조 수가 안전 한도를 넘었습니다.");
  }
  const surfaceIds = [...new Set(snapshot.references.map(({ surfaceId }) => surfaceId))];
  if (
    surfaceIds.length > FILTER_MASK_ARCHIVE_MAX_SURFACES
    || surfaceIds.length > limits.maxAttachments
  ) {
    fail("resource_limit", "필터 마스크 surface 수가 archive 안전 한도를 넘었습니다.");
  }
  if (surfaceIds.length === 0) {
    assertNoEphemeralOrSurfaceReferences(snapshot.project);
    return {
      project: snapshot.project,
      surfaceCount: 0,
      referenceCount: 0,
      materializedPngBytes: 0,
    };
  }
  assertWorkId(request.workId);
  const workId = request.workId;
  const controller = new AbortController();
  const sourceSignal = request.signal;
  const relayAbort = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) relayAbort();
  else sourceSignal?.addEventListener("abort", relayAbort, { once: true });
  const signal = controller.signal;
  const concurrency = positiveBoundedInteger(
    request.concurrency,
    FILTER_MASK_ARCHIVE_DEFAULT_CONCURRENCY,
    FILTER_MASK_ARCHIVE_MAX_CONCURRENCY,
    "필터 마스크 materialization 동시 실행 수"
  );
  const materialized = new Map<
    StudioFilterMaskSurfaceId,
    { readonly dataUrl: string; readonly byteLength: number }
  >();
  let nextIndex = 0;
  let totalBytes = 0;
  let firstError: unknown;
  try {
    const workers = Array.from(
      { length: Math.min(concurrency, surfaceIds.length) },
      async () => {
        while (!signal.aborted) {
          const index = nextIndex;
          nextIndex += 1;
          const surfaceId = surfaceIds[index];
          if (!surfaceId) return;
          try {
            const value = await materializeSurface(
              surfaceId,
              request,
              dependencies,
              limits,
              signal,
              workId
            );
            totalBytes += value.byteLength;
            if (totalBytes > limits.maxTotalAttachmentBytes) {
              fail(
                "resource_limit",
                "materialized 필터 마스크 PNG 합계가 archive 안전 한도를 넘었습니다."
              );
            }
            materialized.set(surfaceId, value);
          } catch (cause) {
            firstError ??= cause;
            controller.abort(cause);
            throw cause;
          }
        }
      }
    );
    try {
      await Promise.all(workers);
    } catch {
      throw firstError;
    }
    throwIfAborted(signal);
    for (const reference of snapshot.references) {
      const value = materialized.get(reference.surfaceId);
      if (!value) {
        fail(
          "surface_invalid",
          `필터 마스크 PNG가 누락되어 portable 요소를 만들 수 없습니다: ${reference.pointer}`
        );
      }
      reference.element.filterMaskSrc = value.dataUrl;
    }
    assertNoEphemeralOrSurfaceReferences(snapshot.project);
    await assertCurrent(request, signal, workId, "before-return");
    return {
      project: snapshot.project,
      surfaceCount: surfaceIds.length,
      referenceCount: snapshot.references.length,
      materializedPngBytes: totalBytes,
    };
  } catch (cause) {
    if (cause instanceof StudioFilterMaskSurfaceArchiveError) throw cause;
    if (signal.aborted) {
      if (firstError instanceof StudioFilterMaskSurfaceArchiveError) throw firstError;
      throw abortError(signal);
    }
    throw new StudioFilterMaskSurfaceArchiveError(
      "surface_invalid",
      "필터 마스크 portable archive를 만들지 못했습니다.",
      cause
    );
  } finally {
    sourceSignal?.removeEventListener("abort", relayAbort);
    controller.abort();
    materialized.clear();
  }
}
