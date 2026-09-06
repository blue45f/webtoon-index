import { calculateStudioCrc32 } from "./studio-crc32";

import type { StudioOpfsFileSystem } from "./studio-opfs-filesystem";

/**
 * Durable, storage-only crash journal for large Studio documents.
 *
 * Command semantics, undo/redo validation, and application-state checkpoints belong to
 * `studio-command-journal`. This module deliberately stores those already-serialized bytes as
 * opaque immutable operation/checkpoint payloads. That keeps one source of truth for replay
 * semantics while adding OPFS durability, torn-write detection, fencing, and bounded retention.
 */
export const STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT =
  "toonspectrum:studio-opfs-recovery-journal" as const;
export const STUDIO_OPFS_RECOVERY_JOURNAL_VERSION = 1 as const;
export const STUDIO_OPFS_RECOVERY_DEFAULT_ROOT = "recovery-journals";

export const STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS = Object.freeze({
  // Matches the existing CRC32 client's bounded direct-computation budget.
  maxChunkBytes: 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxEntries: 2_048,
  maxCheckpoints: 64,
  maxJournalBytes: 512 * 1024 * 1024,
  quotaReserveBytes: 64 * 1024 * 1024,
  maxEvictionsPerPass: 128,
  leaseTtlMs: 30_000,
});

const FRAME_MAGIC = new Uint8Array([0x54, 0x53, 0x52, 0x4a]); // TSRJ
const FRAME_END_MAGIC = new Uint8Array([0x4a, 0x45, 0x4e, 0x44]); // JEND
const FRAME_HEADER_BYTES = 16;
const FRAME_TRAILER_BYTES = 8;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const ENTRY_QUOTA_METADATA_ALLOWANCE_BYTES = 64 * 1024;
const OPFS_FILESYSTEM_MAX_PATH_CHARS = 200;
const SAFE_STORAGE_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const SAFE_ENGINE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+:-]{0,95}$/u;
const SAFE_OWNER_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/u;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

type FrameKind = "lease" | "manifest" | "head" | "descriptor";

export type StudioOpfsRecoveryManifestSlot = "a" | "b";
export type StudioOpfsRecoveryEntryKind = "operation" | "checkpoint";
type ManifestSlot = StudioOpfsRecoveryManifestSlot;
type EntryKind = StudioOpfsRecoveryEntryKind;

const FRAME_KIND_CODE: Readonly<Record<FrameKind, number>> = Object.freeze({
  lease: 1,
  manifest: 2,
  head: 3,
  descriptor: 4,
});

export type StudioOpfsRecoveryJournalErrorCode =
  | "ABORTED"
  | "INVALID_ARGUMENT"
  | "OPFS_UNAVAILABLE"
  | "LOCK_UNAVAILABLE"
  | "LEASE_BUSY"
  | "LEASE_LOST"
  | "IMMUTABLE_CONFLICT"
  | "ENTRY_TOO_LARGE"
  | "JOURNAL_LIMIT_EXCEEDED"
  | "COMPACTION_REQUIRED"
  | "QUOTA_EXCEEDED"
  | "STORAGE_FAILED"
  | "CORRUPT_ENTRY"
  | "CORRUPT_MANIFEST"
  | "UNSUPPORTED_VERSION";

export class StudioOpfsRecoveryJournalError extends Error {
  readonly code: StudioOpfsRecoveryJournalErrorCode;
  readonly path: string | null;
  /**
   * 내부 식별자(writer ownerId, epoch, 토큰 …)를 담는 진단 전용 자리.
   *
   * `message` 는 저장 강등 배너처럼 **사용자 화면에 그대로 흘러가는** 문자열이다
   * (`studio-storage-recovery-runtime`의 `causeMessage`). 그래서 사람이 읽을 문장만
   * 남기고, 사람이 읽을 수 없는 식별자는 지우는 대신 이 필드로 옮긴다 — 진단 가치는
   * 로그·버그리포트 쪽에 그대로 두고 청중만 나눈다.
   */
  readonly diagnostics: string | null;
  override readonly cause?: unknown;

  constructor(
    code: StudioOpfsRecoveryJournalErrorCode,
    message: string,
    options: {
      readonly path?: string;
      readonly cause?: unknown;
      readonly diagnostics?: string;
    } = {},
  ) {
    super(message);
    this.name = "StudioOpfsRecoveryJournalError";
    this.code = code;
    this.path = options.path ?? null;
    this.diagnostics = options.diagnostics ?? null;
    this.cause = options.cause;
  }
}

/**
 * 로그·버그리포트용 한 줄. 사용자 문구 + 코드 + 내부 진단을 한 번에 붙인다.
 * 화면에 쓰지 말 것 — 화면은 `error.message` 만 쓴다.
 */
export function describeStudioOpfsRecoveryJournalError(
  error: StudioOpfsRecoveryJournalError,
): string {
  const parts = [`[${error.code}] ${error.message}`];
  if (error.path) parts.push(`path=${error.path}`);
  if (error.diagnostics) parts.push(error.diagnostics);
  return parts.join(" ");
}

export interface StudioOpfsRecoveryJournalLimits {
  readonly maxChunkBytes: number;
  readonly maxEntryBytes: number;
  readonly maxEntries: number;
  readonly maxCheckpoints: number;
  readonly maxJournalBytes: number;
  readonly quotaReserveBytes: number;
  readonly maxEvictionsPerPass: number;
  readonly leaseTtlMs: number;
}

export interface StudioOpfsRecoveryJournalIdentity {
  readonly documentId: string;
  /** Version of the persisted Studio document schema, not the journal framing version. */
  readonly documentVersion: number;
  /** Exact replay/render engine version required by the opaque payload. */
  readonly engineVersion: string;
}

export type StudioOpfsRecoveryByteSource =
  | Uint8Array
  | Blob
  | AsyncIterable<Uint8Array>;

export interface StudioOpfsRecoveryQuotaEstimate {
  readonly usage: number;
  readonly quota: number;
}

/**
 * Minimal OPFS surface used by the journal. `withExclusiveLock` must coordinate every browser
 * context sharing this origin (normally Web Locks); an in-process mutex is insufficient.
 */
export interface StudioOpfsRecoveryJournalAdapter {
  readonly kind: "opfs" | "fake-opfs";
  read(path: string): Promise<Uint8Array | null>;
  writeAtomic(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
  size(path: string): Promise<number | null>;
  estimateQuota(): Promise<StudioOpfsRecoveryQuotaEstimate | null>;
  withExclusiveLock<T>(
    name: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T>;
}

export interface StudioOpfsRecoveryLockManagerLike {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive"; readonly signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T>;
}

export interface StudioOpfsRecoveryQuotaEstimatorLike {
  estimate(): Promise<{ readonly usage?: number; readonly quota?: number }>;
}

export interface StudioOpfsRecoveryWriterLease {
  readonly documentId: string;
  readonly ownerId: string;
  readonly token: string;
  readonly epoch: number;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

export interface StudioOpfsRecoveryChunkReference {
  readonly path: string;
  readonly byteLength: number;
  readonly crc32: number;
}

export interface StudioOpfsRecoveryEntry {
  readonly kind: EntryKind;
  readonly id: string;
  readonly sequence: number;
  readonly pageId: string;
  readonly revision: number;
  readonly documentId: string;
  readonly documentVersion: number;
  readonly engineVersion: string;
  readonly writerEpoch: number;
  readonly createdAt: number;
  readonly byteLength: number;
  readonly chunks: readonly StudioOpfsRecoveryChunkReference[];
  readonly compactThroughSequence: number | null;
  readonly descriptorPath: string;
  readonly descriptorCrc32: number;
}

export interface StudioOpfsRecoveryScan {
  readonly generation: number;
  readonly writerEpoch: number;
  readonly lastSequence: number;
  readonly totalPayloadBytes: number;
  readonly entries: readonly StudioOpfsRecoveryEntry[];
  readonly selectedSlot: ManifestSlot | null;
  readonly ignoredSlots: readonly ManifestSlot[];
}

export interface StudioOpfsRecoveryAppendInput {
  readonly id: string;
  readonly pageId: string;
  readonly revision: number;
  readonly payload: StudioOpfsRecoveryByteSource;
  /**
   * Required for a one-shot AsyncIterable. Blob and Uint8Array lengths are known directly.
   * An incorrect value is rejected before a descriptor or manifest can become visible.
   */
  readonly byteLength?: number;
  readonly createdAt?: number;
}

export interface StudioOpfsRecoveryCheckpointInput
extends StudioOpfsRecoveryAppendInput {
  /** Operations on the same page at or below this sequence are replaced by the checkpoint. */
  readonly compactThroughSequence: number;
}

export interface StudioOpfsRecoveryMutationOptions {
  readonly signal?: AbortSignal;
}

export interface StudioOpfsRecoveryEvictionResult {
  readonly removedPaths: readonly string[];
  readonly freedBytes: number;
}

export type StudioOpfsRecoveryBackendDecision =
  | {
      readonly mode: "opfs-journal";
      readonly durable: true;
      readonly reason: "native-opfs-and-origin-lock";
    }
  | {
      readonly mode: "existing-recovery-vault";
      readonly durable: true;
      readonly reason: "opfs-unavailable-explicit-vault-fallback";
    }
  | {
      readonly mode: "fail-closed";
      readonly durable: false;
      readonly reason:
        | "opfs-unavailable-no-compatible-vault"
        | "origin-lock-unavailable";
    };

export interface StudioOpfsRecoveryJournalOptions {
  readonly adapter: StudioOpfsRecoveryJournalAdapter;
  readonly identity: StudioOpfsRecoveryJournalIdentity;
  readonly rootPath?: string;
  readonly limits?: Partial<StudioOpfsRecoveryJournalLimits>;
  readonly now?: () => number;
  readonly randomToken?: () => string;
}

interface StoredChunkReference {
  path: string;
  byteLength: number;
  crc32: number;
}

interface StoredDescriptor {
  format: typeof STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT;
  version: typeof STUDIO_OPFS_RECOVERY_JOURNAL_VERSION;
  kind: EntryKind;
  id: string;
  sequence: number;
  pageId: string;
  revision: number;
  documentId: string;
  documentVersion: number;
  engineVersion: string;
  writerEpoch: number;
  createdAt: number;
  byteLength: number;
  chunks: StoredChunkReference[];
  compactThroughSequence: number | null;
}

interface ManifestEntryReference {
  kind: EntryKind;
  sequence: number;
  descriptorPath: string;
  descriptorCrc32: number;
  storedBytes: number;
}

interface StoredManifest {
  format: typeof STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT;
  version: typeof STUDIO_OPFS_RECOVERY_JOURNAL_VERSION;
  phase: "prepared";
  generation: number;
  previousGeneration: number;
  writerEpoch: number;
  documentId: string;
  documentVersion: number;
  engineVersion: string;
  lastSequence: number;
  totalPayloadBytes: number;
  totalStoredBytes: number;
  createdAt: number;
  entries: ManifestEntryReference[];
}

interface StoredHead {
  format: typeof STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT;
  version: typeof STUDIO_OPFS_RECOVERY_JOURNAL_VERSION;
  phase: "committed";
  slot: ManifestSlot;
  generation: number;
  manifestPath: string;
  manifestCrc32: number;
}

interface StoredLease {
  format: typeof STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT;
  version: typeof STUDIO_OPFS_RECOVERY_JOURNAL_VERSION;
  documentId: string;
  ownerId: string;
  token: string;
  epoch: number;
  acquiredAt: number;
  expiresAt: number;
}

interface ManifestCandidate {
  readonly slot: ManifestSlot;
  readonly headPath: string;
  readonly manifestPath: string;
  readonly head: StoredHead;
  readonly manifest: StoredManifest;
  readonly manifestBytes: Uint8Array;
}

interface InternalScan {
  readonly publicScan: StudioOpfsRecoveryScan;
  readonly selected: ManifestCandidate | null;
  readonly candidates: readonly ManifestCandidate[];
  readonly manifest: StoredManifest;
}

interface StagedEntry {
  readonly entry: StudioOpfsRecoveryEntry;
  readonly reference: ManifestEntryReference;
}

function journalError(
  code: StudioOpfsRecoveryJournalErrorCode,
  message: string,
  options?: {
    readonly path?: string;
    readonly cause?: unknown;
    readonly diagnostics?: string;
  },
): never {
  const error = new StudioOpfsRecoveryJournalError(code, message, options);
  // 진단이 붙은 오류는 삼켜지더라도(강등 폴백 경로) 개발자 콘솔에는 남는다 —
  // 화면에서 뺀 내부 식별자가 어디에도 없어지지 않게 하는 반대편 절반.
  if (error.diagnostics) {
    console.warn(describeStudioOpfsRecoveryJournalError(error));
  }
  throw error;
}

function createAbortError(): StudioOpfsRecoveryJournalError {
  return new StudioOpfsRecoveryJournalError("ABORTED", "OPFS 복구 저널 작업을 취소했습니다.");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum;
}

function isCrc32(value: unknown): value is number {
  return isSafeInteger(value) && value <= 0xffff_ffff;
}

function assertStorageId(value: string, label: string): void {
  if (!SAFE_STORAGE_ID.test(value)) {
    journalError(
      "INVALID_ARGUMENT",
      `${label}은 소문자 영숫자로 시작하는 1~96자의 안전한 저장소 ID여야 합니다.`,
    );
  }
}

function assertEntryId(value: string, label: string): void {
  if (!SAFE_OWNER_ID.test(value)) {
    journalError(
      "INVALID_ARGUMENT",
      `${label}은 영숫자로 시작하는 1~160자의 안전한 ID여야 합니다.`,
    );
  }
}

function normalizeIdentity(
  identity: StudioOpfsRecoveryJournalIdentity,
): StudioOpfsRecoveryJournalIdentity {
  assertStorageId(identity.documentId, "documentId");
  if (!Number.isSafeInteger(identity.documentVersion) || identity.documentVersion < 1) {
    journalError("INVALID_ARGUMENT", "documentVersion은 1 이상의 안전한 정수여야 합니다.");
  }
  if (!SAFE_ENGINE_VERSION.test(identity.engineVersion)) {
    journalError(
      "INVALID_ARGUMENT",
      "engineVersion은 영숫자로 시작하는 1~96자의 버전 문자열이어야 합니다.",
    );
  }
  return Object.freeze({ ...identity });
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    journalError(
      "INVALID_ARGUMENT",
      `${label}은 ${minimum.toLocaleString("en-US")}~${maximum.toLocaleString("en-US")} 범위여야 합니다.`,
    );
  }
  return resolved;
}

function normalizeLimits(
  limits: Partial<StudioOpfsRecoveryJournalLimits> | undefined,
): StudioOpfsRecoveryJournalLimits {
  const maxChunkBytes = boundedInteger(
    limits?.maxChunkBytes,
    STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS.maxChunkBytes,
    "maxChunkBytes",
    4 * 1024,
    STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS.maxChunkBytes,
  );
  const maxEntryBytes = boundedInteger(
    limits?.maxEntryBytes,
    STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS.maxEntryBytes,
    "maxEntryBytes",
    maxChunkBytes,
    256 * 1024 * 1024,
  );
  const maxJournalBytes = boundedInteger(
    limits?.maxJournalBytes,
    STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS.maxJournalBytes,
    "maxJournalBytes",
    maxEntryBytes,
    2 * 1024 * 1024 * 1024,
  );
  return Object.freeze({
    maxChunkBytes,
    maxEntryBytes,
    maxEntries: boundedInteger(
      limits?.maxEntries,
      STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS.maxEntries,
      "maxEntries",
      1,
      100_000,
    ),
    maxCheckpoints: boundedInteger(
      limits?.maxCheckpoints,
      STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS.maxCheckpoints,
      "maxCheckpoints",
      1,
      10_000,
    ),
    maxJournalBytes,
    quotaReserveBytes: boundedInteger(
      limits?.quotaReserveBytes,
      STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS.quotaReserveBytes,
      "quotaReserveBytes",
      0,
      2 * 1024 * 1024 * 1024,
    ),
    maxEvictionsPerPass: boundedInteger(
      limits?.maxEvictionsPerPass,
      STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS.maxEvictionsPerPass,
      "maxEvictionsPerPass",
      1,
      10_000,
    ),
    leaseTtlMs: boundedInteger(
      limits?.leaseTtlMs,
      STUDIO_OPFS_RECOVERY_DEFAULT_LIMITS.leaseTtlMs,
      "leaseTtlMs",
      1_000,
      5 * 60_000,
    ),
  });
}

function validQuotaEstimate(
  value: StudioOpfsRecoveryQuotaEstimate | null,
): value is StudioOpfsRecoveryQuotaEstimate {
  return value !== null
    && Number.isFinite(value.usage)
    && Number.isFinite(value.quota)
    && value.usage >= 0
    && value.quota > 0;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob === "function" && value instanceof Blob;
}

function frameKindFromCode(value: number): FrameKind | null {
  for (const [kind, code] of Object.entries(FRAME_KIND_CODE) as Array<[FrameKind, number]>) {
    if (code === value) return kind;
  }
  return null;
}

function encodeFrame(kind: FrameKind, value: unknown): Uint8Array {
  const body = TEXT_ENCODER.encode(JSON.stringify(value));
  if (body.byteLength > MAX_METADATA_BYTES) {
    journalError("JOURNAL_LIMIT_EXCEEDED", "복구 저널 메타데이터가 허용 크기를 초과했습니다.");
  }
  const output = new Uint8Array(FRAME_HEADER_BYTES + body.byteLength + FRAME_TRAILER_BYTES);
  output.set(FRAME_MAGIC, 0);
  const view = new DataView(output.buffer);
  view.setUint8(4, STUDIO_OPFS_RECOVERY_JOURNAL_VERSION);
  view.setUint8(5, FRAME_KIND_CODE[kind]);
  view.setUint16(6, 0, true);
  view.setUint32(8, body.byteLength, true);
  view.setUint32(12, calculateStudioCrc32(body), true);
  output.set(body, FRAME_HEADER_BYTES);
  output.set(FRAME_END_MAGIC, FRAME_HEADER_BYTES + body.byteLength);
  view.setUint32(
    FRAME_HEADER_BYTES + body.byteLength + FRAME_END_MAGIC.byteLength,
    body.byteLength ^ 0xffff_ffff,
    true,
  );
  return output;
}

function decodeFrame(path: string, bytes: Uint8Array, expectedKind: FrameKind): unknown {
  const fail = (message: string): never => journalError(
    expectedKind === "manifest" || expectedKind === "head"
      ? "CORRUPT_MANIFEST"
      : "CORRUPT_ENTRY",
    message,
    { path },
  );
  if (bytes.byteLength < FRAME_HEADER_BYTES + FRAME_TRAILER_BYTES) {
    fail("복구 저널 frame이 중간에서 끊겼습니다.");
  }
  if (!bytesEqual(bytes.subarray(0, FRAME_MAGIC.byteLength), FRAME_MAGIC)) {
    fail("복구 저널 frame magic이 올바르지 않습니다.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(4);
  if (version !== STUDIO_OPFS_RECOVERY_JOURNAL_VERSION) {
    journalError("UNSUPPORTED_VERSION", "지원하지 않는 OPFS 복구 저널 frame 버전입니다.", {
      path,
    });
  }
  const actualKind = frameKindFromCode(view.getUint8(5));
  if (actualKind !== expectedKind || view.getUint16(6, true) !== 0) {
    fail("복구 저널 frame 종류 또는 예약 영역이 올바르지 않습니다.");
  }
  const bodyLength = view.getUint32(8, true);
  const expectedLength = FRAME_HEADER_BYTES + bodyLength + FRAME_TRAILER_BYTES;
  if (bytes.byteLength !== expectedLength) {
    fail("복구 저널 frame 길이가 기록된 길이와 다릅니다.");
  }
  const trailerOffset = FRAME_HEADER_BYTES + bodyLength;
  if (!bytesEqual(
    bytes.subarray(trailerOffset, trailerOffset + FRAME_END_MAGIC.byteLength),
    FRAME_END_MAGIC,
  )) {
    fail("복구 저널 frame 끝 표식이 없어 torn write로 판단했습니다.");
  }
  if (view.getUint32(trailerOffset + FRAME_END_MAGIC.byteLength, true)
    !== (bodyLength ^ 0xffff_ffff) >>> 0) {
    fail("복구 저널 frame 길이 보수가 일치하지 않습니다.");
  }
  const body = bytes.subarray(FRAME_HEADER_BYTES, trailerOffset);
  if (calculateStudioCrc32(body) !== view.getUint32(12, true)) {
    fail("복구 저널 frame CRC32가 일치하지 않습니다.");
  }
  try {
    return JSON.parse(TEXT_DECODER.decode(body)) as unknown;
  } catch (cause) {
    return fail(`복구 저널 frame JSON을 해석할 수 없습니다: ${
      cause instanceof Error ? cause.message : "unknown"
    }`);
  }
}

function validateStoredLease(
  value: unknown,
  identity: StudioOpfsRecoveryJournalIdentity,
  path: string,
): StoredLease {
  if (!isRecord(value) || !hasExactKeys(value, [
    "format",
    "version",
    "documentId",
    "ownerId",
    "token",
    "epoch",
    "acquiredAt",
    "expiresAt",
  ])) {
    journalError("CORRUPT_ENTRY", "복구 저널 writer lease 구조가 손상되었습니다.", { path });
  }
  if (
    value.format !== STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT
    || value.version !== STUDIO_OPFS_RECOVERY_JOURNAL_VERSION
  ) {
    journalError("UNSUPPORTED_VERSION", "지원하지 않는 복구 저널 writer lease입니다.", { path });
  }
  if (
    value.documentId !== identity.documentId
    || typeof value.ownerId !== "string"
    || !SAFE_OWNER_ID.test(value.ownerId)
    || typeof value.token !== "string"
    || !SAFE_OWNER_ID.test(value.token)
    || !isSafeInteger(value.epoch, 1)
    || !isSafeInteger(value.acquiredAt)
    || !isSafeInteger(value.expiresAt)
    || value.expiresAt <= value.acquiredAt
  ) {
    journalError("CORRUPT_ENTRY", "복구 저널 writer lease 값이 손상되었습니다.", { path });
  }
  return value as unknown as StoredLease;
}

function validateManifestReference(
  value: unknown,
  path: string,
): ManifestEntryReference {
  if (!isRecord(value) || !hasExactKeys(value, [
    "kind",
    "sequence",
    "descriptorPath",
    "descriptorCrc32",
    "storedBytes",
  ])) {
    journalError("CORRUPT_MANIFEST", "manifest entry 참조 구조가 손상되었습니다.", { path });
  }
  if (
    (value.kind !== "operation" && value.kind !== "checkpoint")
    || !isSafeInteger(value.sequence, 1)
    || typeof value.descriptorPath !== "string"
    || !isCrc32(value.descriptorCrc32)
    || !isSafeInteger(value.storedBytes, 1)
  ) {
    journalError("CORRUPT_MANIFEST", "manifest entry 참조 값이 손상되었습니다.", { path });
  }
  return value as unknown as ManifestEntryReference;
}

function validateStoredManifest(
  value: unknown,
  identity: StudioOpfsRecoveryJournalIdentity,
  path: string,
): StoredManifest {
  if (!isRecord(value) || !hasExactKeys(value, [
    "format",
    "version",
    "phase",
    "generation",
    "previousGeneration",
    "writerEpoch",
    "documentId",
    "documentVersion",
    "engineVersion",
    "lastSequence",
    "totalPayloadBytes",
    "totalStoredBytes",
    "createdAt",
    "entries",
  ])) {
    journalError("CORRUPT_MANIFEST", "복구 저널 manifest 구조가 손상되었습니다.", { path });
  }
  if (
    value.format !== STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT
    || value.version !== STUDIO_OPFS_RECOVERY_JOURNAL_VERSION
  ) {
    journalError("UNSUPPORTED_VERSION", "지원하지 않는 OPFS 복구 저널 manifest입니다.", {
      path,
    });
  }
  if (
    value.documentId !== identity.documentId
    || value.documentVersion !== identity.documentVersion
    || value.engineVersion !== identity.engineVersion
  ) {
    journalError(
      "UNSUPPORTED_VERSION",
      "문서 또는 replay engine 버전이 현재 복구 저널과 일치하지 않습니다.",
      { path },
    );
  }
  if (
    value.phase !== "prepared"
    || !isSafeInteger(value.generation, 1)
    || !isSafeInteger(value.previousGeneration)
    || value.previousGeneration !== value.generation - 1
    || !isSafeInteger(value.writerEpoch, 1)
    || !isSafeInteger(value.lastSequence)
    || !isSafeInteger(value.totalPayloadBytes)
    || !isSafeInteger(value.totalStoredBytes)
    || !isSafeInteger(value.createdAt)
    || !Array.isArray(value.entries)
  ) {
    journalError("CORRUPT_MANIFEST", "복구 저널 manifest 값이 손상되었습니다.", { path });
  }
  const entries = value.entries.map((entry, index) =>
    validateManifestReference(entry, `${path}#entry-${index}`));
  let previousSequence = 0;
  let storedBytes = 0;
  for (const entry of entries) {
    if (entry.sequence <= previousSequence) {
      journalError("CORRUPT_MANIFEST", "manifest entry 순서가 결정적 증가 순서가 아닙니다.", {
        path,
      });
    }
    previousSequence = entry.sequence;
    storedBytes += entry.storedBytes;
  }
  if (
    (entries.at(-1)?.sequence ?? 0) > value.lastSequence
    || storedBytes !== value.totalStoredBytes
  ) {
    journalError("CORRUPT_MANIFEST", "manifest 집계 값이 entry 목록과 일치하지 않습니다.", {
      path,
    });
  }
  return {
    ...(value as unknown as StoredManifest),
    entries,
  };
}

function validateStoredHead(
  value: unknown,
  slot: ManifestSlot,
  expectedManifestPath: string,
  path: string,
): StoredHead {
  if (!isRecord(value) || !hasExactKeys(value, [
    "format",
    "version",
    "phase",
    "slot",
    "generation",
    "manifestPath",
    "manifestCrc32",
  ])) {
    journalError("CORRUPT_MANIFEST", "복구 저널 head 구조가 손상되었습니다.", { path });
  }
  if (
    value.format !== STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT
    || value.version !== STUDIO_OPFS_RECOVERY_JOURNAL_VERSION
  ) {
    journalError("UNSUPPORTED_VERSION", "지원하지 않는 OPFS 복구 저널 head입니다.", { path });
  }
  if (
    value.phase !== "committed"
    || value.slot !== slot
    || !isSafeInteger(value.generation, 1)
    || value.manifestPath !== expectedManifestPath
    || !isCrc32(value.manifestCrc32)
  ) {
    journalError("CORRUPT_MANIFEST", "복구 저널 head 값이 손상되었습니다.", { path });
  }
  return value as unknown as StoredHead;
}

function validateStoredChunk(
  value: unknown,
  basePath: string,
  path: string,
): StoredChunkReference {
  if (!isRecord(value) || !hasExactKeys(value, ["path", "byteLength", "crc32"])) {
    journalError("CORRUPT_ENTRY", "복구 저널 chunk 참조 구조가 손상되었습니다.", { path });
  }
  if (
    typeof value.path !== "string"
    || !value.path.startsWith(`${basePath}/`)
    || !isSafeInteger(value.byteLength, 1)
    || !isCrc32(value.crc32)
  ) {
    journalError("CORRUPT_ENTRY", "복구 저널 chunk 참조 값이 손상되었습니다.", { path });
  }
  return value as unknown as StoredChunkReference;
}

function validateStoredDescriptor(
  value: unknown,
  identity: StudioOpfsRecoveryJournalIdentity,
  basePath: string,
  reference: ManifestEntryReference,
  path: string,
): StoredDescriptor {
  if (!isRecord(value) || !hasExactKeys(value, [
    "format",
    "version",
    "kind",
    "id",
    "sequence",
    "pageId",
    "revision",
    "documentId",
    "documentVersion",
    "engineVersion",
    "writerEpoch",
    "createdAt",
    "byteLength",
    "chunks",
    "compactThroughSequence",
  ])) {
    journalError("CORRUPT_ENTRY", "복구 저널 descriptor 구조가 손상되었습니다.", { path });
  }
  if (
    value.format !== STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT
    || value.version !== STUDIO_OPFS_RECOVERY_JOURNAL_VERSION
  ) {
    journalError("UNSUPPORTED_VERSION", "지원하지 않는 복구 저널 descriptor입니다.", { path });
  }
  if (
    value.documentId !== identity.documentId
    || value.documentVersion !== identity.documentVersion
    || value.engineVersion !== identity.engineVersion
  ) {
    journalError(
      "UNSUPPORTED_VERSION",
      "복구 entry의 문서 또는 engine 버전이 현재 저널과 일치하지 않습니다.",
      { path },
    );
  }
  if (
    value.kind !== reference.kind
    || value.sequence !== reference.sequence
    || (value.kind !== "operation" && value.kind !== "checkpoint")
    || typeof value.id !== "string"
    || !SAFE_OWNER_ID.test(value.id)
    || typeof value.pageId !== "string"
    || !SAFE_STORAGE_ID.test(value.pageId)
    || !isSafeInteger(value.revision)
    || !isSafeInteger(value.writerEpoch, 1)
    || !isSafeInteger(value.createdAt)
    || !isSafeInteger(value.byteLength)
    || !Array.isArray(value.chunks)
  ) {
    journalError("CORRUPT_ENTRY", "복구 저널 descriptor 값이 손상되었습니다.", { path });
  }
  if (
    (value.kind === "operation" && value.compactThroughSequence !== null)
    || (
      value.kind === "checkpoint"
      && (
        !isSafeInteger(value.compactThroughSequence)
        || value.compactThroughSequence >= value.sequence
      )
    )
  ) {
    journalError("CORRUPT_ENTRY", "복구 checkpoint 경계가 올바르지 않습니다.", { path });
  }
  const chunks = value.chunks.map((chunk, index) =>
    validateStoredChunk(chunk, basePath, `${path}#chunk-${index}`));
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (byteLength !== value.byteLength || (byteLength === 0) !== (chunks.length === 0)) {
    journalError("CORRUPT_ENTRY", "복구 descriptor의 payload 길이가 chunk 합계와 다릅니다.", {
      path,
    });
  }
  return {
    ...(value as unknown as StoredDescriptor),
    chunks,
  };
}

function emptyManifest(
  identity: StudioOpfsRecoveryJournalIdentity,
): StoredManifest {
  return {
    format: STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT,
    version: STUDIO_OPFS_RECOVERY_JOURNAL_VERSION,
    phase: "prepared",
    generation: 0,
    previousGeneration: 0,
    writerEpoch: 0,
    documentId: identity.documentId,
    documentVersion: identity.documentVersion,
    engineVersion: identity.engineVersion,
    lastSequence: 0,
    totalPayloadBytes: 0,
    totalStoredBytes: 0,
    createdAt: 0,
    entries: [],
  };
}

function sourceByteLength(
  source: StudioOpfsRecoveryByteSource,
  declared: number | undefined,
): number {
  const known = source instanceof Uint8Array
    ? source.byteLength
    : isBlob(source)
      ? source.size
      : declared;
  if (!Number.isSafeInteger(known) || (known as number) < 0) {
    journalError(
      "INVALID_ARGUMENT",
      "AsyncIterable payload는 정확한 byteLength를 함께 제공해야 합니다.",
    );
  }
  if (declared !== undefined && declared !== known) {
    journalError("INVALID_ARGUMENT", "선언한 payload byteLength가 실제 길이와 다릅니다.");
  }
  return known as number;
}

async function* sourceChunks(
  source: StudioOpfsRecoveryByteSource,
  maxChunkBytes: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
  let stream: AsyncIterable<Uint8Array>;
  if (source instanceof Uint8Array) {
    stream = (async function* byteArrayStream() {
      yield source;
    })();
  } else if (isBlob(source)) {
    stream = source.stream() as unknown as AsyncIterable<Uint8Array>;
  } else {
    stream = source;
  }
  let pending = new Uint8Array(0);
  for await (const rawChunk of stream) {
    throwIfAborted(signal);
    if (!(rawChunk instanceof Uint8Array)) {
      journalError("INVALID_ARGUMENT", "payload stream은 Uint8Array chunk만 반환해야 합니다.");
    }
    let offset = 0;
    if (pending.byteLength > 0) {
      const required = maxChunkBytes - pending.byteLength;
      const taken = Math.min(required, rawChunk.byteLength);
      const joined = new Uint8Array(pending.byteLength + taken);
      joined.set(pending);
      joined.set(rawChunk.subarray(0, taken), pending.byteLength);
      pending = joined;
      offset = taken;
      if (pending.byteLength === maxChunkBytes) {
        yield pending;
        pending = new Uint8Array(0);
      }
    }
    while (rawChunk.byteLength - offset >= maxChunkBytes) {
      yield new Uint8Array(rawChunk.subarray(offset, offset + maxChunkBytes));
      offset += maxChunkBytes;
    }
    if (offset < rawChunk.byteLength) {
      pending = new Uint8Array(rawChunk.subarray(offset));
    }
  }
  throwIfAborted(signal);
  if (pending.byteLength > 0) yield pending;
}

function defaultRandomToken(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid !== "function") {
    journalError(
      "LOCK_UNAVAILABLE",
      "보안 난수 생성기를 사용할 수 없어 OPFS writer lease를 만들 수 없습니다.",
    );
  }
  return `lease-${randomUuid.call(globalThis.crypto)}`;
}

function mapStorageError(error: unknown, path?: string): never {
  if (error instanceof StudioOpfsRecoveryJournalError) throw error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : null;
  const name = typeof error === "object" && error !== null && "name" in error
    ? (error as { readonly name?: unknown }).name
    : null;
  if (code === "QUOTA_EXCEEDED" || name === "QuotaExceededError") {
    journalError("QUOTA_EXCEEDED", "OPFS 복구 저널 저장 공간이 부족합니다.", {
      path,
      cause: error,
    });
  }
  journalError("STORAGE_FAILED", "OPFS 복구 저널 저장소 작업에 실패했습니다.", {
    path,
    cause: error,
  });
}

/**
 * Makes the fallback policy explicit. A memory/localStorage filesystem is never treated as a
 * durable large-document journal, and the existing IndexedDB recovery vault is selected only
 * when the caller confirms that it can represent this exact recovery payload.
 */
export function decideStudioOpfsRecoveryBackend(input: {
  readonly fileSystemKind: "opfs" | "memory" | "local-storage" | "unavailable";
  readonly originLockAvailable: boolean;
  readonly existingRecoveryVaultCompatible: boolean;
}): StudioOpfsRecoveryBackendDecision {
  if (input.fileSystemKind === "opfs" && input.originLockAvailable) {
    return {
      mode: "opfs-journal",
      durable: true,
      reason: "native-opfs-and-origin-lock",
    };
  }
  if (input.fileSystemKind === "opfs" && !input.originLockAvailable) {
    return {
      mode: "fail-closed",
      durable: false,
      reason: "origin-lock-unavailable",
    };
  }
  if (input.existingRecoveryVaultCompatible) {
    return {
      mode: "existing-recovery-vault",
      durable: true,
      reason: "opfs-unavailable-explicit-vault-fallback",
    };
  }
  return {
    mode: "fail-closed",
    durable: false,
    reason: "opfs-unavailable-no-compatible-vault",
  };
}

/**
 * Adapts the repository's atomic OPFS filesystem to the recovery journal.
 *
 * Native OPFS and an origin-wide lock manager are both mandatory. The existing filesystem's
 * memory/localStorage fallbacks remain useful for assets but are intentionally rejected here.
 */
export function createStudioOpfsRecoveryJournalAdapter(input: {
  readonly fileSystem: StudioOpfsFileSystem;
  readonly lockManager: StudioOpfsRecoveryLockManagerLike | null;
  readonly quotaEstimator?: StudioOpfsRecoveryQuotaEstimatorLike | null;
}): StudioOpfsRecoveryJournalAdapter {
  if (input.fileSystem.kind !== "opfs") {
    journalError(
      "OPFS_UNAVAILABLE",
      "대형 작품 복구 저널에는 native OPFS가 필요합니다. 기존 recovery vault 사용 여부를 명시적으로 결정하세요.",
    );
  }
  if (input.lockManager === null) {
    journalError(
      "LOCK_UNAVAILABLE",
      "origin-wide Web Lock이 없어 OPFS writer epoch를 안전하게 fence할 수 없습니다.",
    );
  }
  const fileSystem = input.fileSystem;
  const lockManager = input.lockManager;
  return {
    kind: "opfs",
    read(path) {
      return fileSystem.read(path);
    },
    writeAtomic(path, bytes) {
      return fileSystem.write(path, bytes);
    },
    async remove(path) {
      await fileSystem.remove(path);
    },
    list(prefix) {
      return fileSystem.list(prefix);
    },
    size(path) {
      return fileSystem.size(path);
    },
    async estimateQuota() {
      if (!input.quotaEstimator) return null;
      try {
        const estimate = await input.quotaEstimator.estimate();
        if (
          typeof estimate.usage !== "number"
          || typeof estimate.quota !== "number"
          || !Number.isFinite(estimate.usage)
          || !Number.isFinite(estimate.quota)
          || estimate.usage < 0
          || estimate.quota <= 0
        ) return null;
        return { usage: estimate.usage, quota: estimate.quota };
      } catch {
        return null;
      }
    },
    withExclusiveLock(name, signal, operation) {
      return lockManager.request(
        name,
        signal ? { mode: "exclusive", signal } : { mode: "exclusive" },
        operation,
      );
    },
  };
}

export class StudioOpfsRecoveryJournal {
  readonly #adapter: StudioOpfsRecoveryJournalAdapter;
  readonly #identity: StudioOpfsRecoveryJournalIdentity;
  readonly #limits: StudioOpfsRecoveryJournalLimits;
  readonly #basePath: string;
  readonly #lockName: string;
  readonly #now: () => number;
  readonly #randomToken: () => string;
  readonly #stagingAttempts = new Map<string, number>();

  constructor(options: StudioOpfsRecoveryJournalOptions) {
    this.#adapter = options.adapter;
    this.#identity = normalizeIdentity(options.identity);
    this.#limits = normalizeLimits(options.limits);
    const rootPath = options.rootPath ?? STUDIO_OPFS_RECOVERY_DEFAULT_ROOT;
    assertStorageId(rootPath, "rootPath");
    this.#basePath = `${rootPath}/${this.#identity.documentId}`;
    const longestEntryPath =
      `${this.#basePath}/cp-999999999999-e${Number.MAX_SAFE_INTEGER}-a${
        Number.MAX_SAFE_INTEGER
      }-c99999.bin`;
    if (longestEntryPath.length > OPFS_FILESYSTEM_MAX_PATH_CHARS) {
      journalError(
        "INVALID_ARGUMENT",
        `rootPath와 documentId 조합은 OPFS 경로 ${OPFS_FILESYSTEM_MAX_PATH_CHARS}자 한도를 넘을 수 없습니다.`,
      );
    }
    this.#lockName = `toonspectrum-opfs-recovery:${this.#identity.documentId}`;
    this.#now = options.now ?? (() => Date.now());
    this.#randomToken = options.randomToken ?? defaultRandomToken;
  }

  get identity(): StudioOpfsRecoveryJournalIdentity {
    return this.#identity;
  }

  get limits(): StudioOpfsRecoveryJournalLimits {
    return this.#limits;
  }

  #headPath(slot: ManifestSlot): string {
    return `${this.#basePath}/head-${slot}.bin`;
  }

  #manifestPath(slot: ManifestSlot): string {
    return `${this.#basePath}/manifest-${slot}.bin`;
  }

  #leasePath(): string {
    return `${this.#basePath}/writer-lease.bin`;
  }

  #stagingAttemptKey(kind: EntryKind, sequence: number, epoch: number): string {
    return `${kind}:${sequence}:${epoch}`;
  }

  #reserveStagingAttempt(kind: EntryKind, sequence: number, epoch: number): number {
    const key = this.#stagingAttemptKey(kind, sequence, epoch);
    const attempt = this.#stagingAttempts.get(key) ?? 0;
    if (attempt >= Number.MAX_SAFE_INTEGER) {
      journalError(
        "JOURNAL_LIMIT_EXCEEDED",
        "복구 entry staging attempt 공간을 모두 사용했습니다.",
      );
    }
    this.#stagingAttempts.set(key, attempt + 1);
    return attempt;
  }

  #descriptorPath(
    kind: EntryKind,
    sequence: number,
    epoch: number,
    attempt: number,
  ): string {
    const prefix = kind === "operation" ? "op" : "cp";
    const attemptSuffix = attempt === 0 ? "" : `-a${attempt}`;
    return `${this.#basePath}/${prefix}-${sequence.toString(10).padStart(12, "0")}-e${epoch}${
      attemptSuffix
    }.meta`;
  }

  #chunkPath(
    kind: EntryKind,
    sequence: number,
    epoch: number,
    attempt: number,
    index: number,
  ): string {
    const prefix = kind === "operation" ? "op" : "cp";
    const attemptSuffix = attempt === 0 ? "" : `-a${attempt}`;
    return `${this.#basePath}/${prefix}-${sequence.toString(10).padStart(12, "0")}-e${epoch}${
      attemptSuffix
    }-c${index.toString(10).padStart(5, "0")}.bin`;
  }

  async #read(path: string, signal?: AbortSignal): Promise<Uint8Array | null> {
    throwIfAborted(signal);
    try {
      const bytes = await this.#adapter.read(path);
      throwIfAborted(signal);
      return bytes;
    } catch (error) {
      return mapStorageError(error, path);
    }
  }

  async #write(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    try {
      await this.#adapter.writeAtomic(path, bytes);
      throwIfAborted(signal);
    } catch (error) {
      mapStorageError(error, path);
    }
  }

  async #writeImmutable(
    path: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    const existing = await this.#read(path, signal);
    if (existing !== null) {
      if (bytesEqual(existing, bytes)) return;
      journalError(
        "IMMUTABLE_CONFLICT",
        "같은 OPFS 복구 entry 경로에 다른 immutable 내용이 이미 존재합니다.",
        { path },
      );
    }
    await this.#write(path, bytes, signal);
  }

  async #readLease(signal?: AbortSignal): Promise<StoredLease | null> {
    const path = this.#leasePath();
    const bytes = await this.#read(path, signal);
    if (bytes === null) return null;
    return validateStoredLease(decodeFrame(path, bytes, "lease"), this.#identity, path);
  }

  async #assertLease(
    writer: StudioOpfsRecoveryWriterLease,
    signal?: AbortSignal,
  ): Promise<StoredLease> {
    if (
      writer.documentId !== this.#identity.documentId
      || !isSafeInteger(writer.epoch, 1)
      || !isSafeInteger(writer.expiresAt)
    ) {
      journalError("LEASE_LOST", "writer lease가 다른 복구 저널에 속합니다.");
    }
    const stored = await this.#readLease(signal);
    const now = this.#now();
    if (
      stored === null
      || stored.ownerId !== writer.ownerId
      || stored.token !== writer.token
      || stored.epoch !== writer.epoch
      || stored.expiresAt !== writer.expiresAt
      || stored.expiresAt <= now
    ) {
      journalError("LEASE_LOST", "OPFS 복구 저널 writer lease가 만료되었거나 교체되었습니다.");
    }
    return stored;
  }

  async #readCandidate(
    slot: ManifestSlot,
    signal?: AbortSignal,
  ): Promise<ManifestCandidate | null> {
    const headPath = this.#headPath(slot);
    const manifestPath = this.#manifestPath(slot);
    const headBytes = await this.#read(headPath, signal);
    if (headBytes === null) return null;
    const head = validateStoredHead(
      decodeFrame(headPath, headBytes, "head"),
      slot,
      manifestPath,
      headPath,
    );
    const manifestBytes = await this.#read(manifestPath, signal);
    if (manifestBytes === null) {
      journalError("CORRUPT_MANIFEST", "committed head가 가리키는 manifest가 없습니다.", {
        path: manifestPath,
      });
    }
    if (calculateStudioCrc32(manifestBytes) !== head.manifestCrc32) {
      journalError("CORRUPT_MANIFEST", "head의 manifest CRC32가 실제 파일과 다릅니다.", {
        path: manifestPath,
      });
    }
    const manifest = validateStoredManifest(
      decodeFrame(manifestPath, manifestBytes, "manifest"),
      this.#identity,
      manifestPath,
    );
    if (manifest.generation !== head.generation) {
      journalError("CORRUPT_MANIFEST", "head와 manifest generation이 일치하지 않습니다.", {
        path: manifestPath,
      });
    }
    return { slot, headPath, manifestPath, head, manifest, manifestBytes };
  }

  async #validateEntry(
    reference: ManifestEntryReference,
    signal?: AbortSignal,
  ): Promise<StudioOpfsRecoveryEntry> {
    const descriptorBytes = await this.#read(reference.descriptorPath, signal);
    if (descriptorBytes === null) {
      journalError("CORRUPT_ENTRY", "manifest가 가리키는 immutable descriptor가 없습니다.", {
        path: reference.descriptorPath,
      });
    }
    if (calculateStudioCrc32(descriptorBytes) !== reference.descriptorCrc32) {
      journalError("CORRUPT_ENTRY", "immutable descriptor CRC32가 manifest와 다릅니다.", {
        path: reference.descriptorPath,
      });
    }
    const descriptor = validateStoredDescriptor(
      decodeFrame(reference.descriptorPath, descriptorBytes, "descriptor"),
      this.#identity,
      this.#basePath,
      reference,
      reference.descriptorPath,
    );
    let storedBytes = descriptorBytes.byteLength;
    for (const chunk of descriptor.chunks) {
      const bytes = await this.#read(chunk.path, signal);
      if (bytes === null) {
        journalError("CORRUPT_ENTRY", "복구 entry payload chunk가 없습니다.", {
          path: chunk.path,
        });
      }
      if (
        bytes.byteLength !== chunk.byteLength
        || calculateStudioCrc32(bytes) !== chunk.crc32
      ) {
        journalError(
          "CORRUPT_ENTRY",
          "복구 entry payload chunk가 부분 기록되었거나 CRC32가 손상되었습니다.",
          { path: chunk.path },
        );
      }
      storedBytes += bytes.byteLength;
    }
    if (storedBytes !== reference.storedBytes) {
      journalError("CORRUPT_ENTRY", "manifest의 저장 크기와 실제 entry 크기가 다릅니다.", {
        path: reference.descriptorPath,
      });
    }
    return Object.freeze({
      ...descriptor,
      chunks: Object.freeze(descriptor.chunks.map((chunk) => Object.freeze({ ...chunk }))),
      descriptorPath: reference.descriptorPath,
      descriptorCrc32: reference.descriptorCrc32,
    });
  }

  async #scanInternal(signal?: AbortSignal): Promise<InternalScan> {
    throwIfAborted(signal);
    const candidates: ManifestCandidate[] = [];
    const ignoredSlots: ManifestSlot[] = [];
    let foundHead = false;
    let unsupportedError: StudioOpfsRecoveryJournalError | null = null;
    for (const slot of ["a", "b"] as const) {
      const headExists = await this.#read(this.#headPath(slot), signal);
      if (headExists !== null) foundHead = true;
      try {
        const candidate = await this.#readCandidate(slot, signal);
        if (candidate) candidates.push(candidate);
      } catch (error) {
        if (
          error instanceof StudioOpfsRecoveryJournalError
          && error.code === "UNSUPPORTED_VERSION"
        ) {
          unsupportedError = error;
        }
        ignoredSlots.push(slot);
      }
    }
    if (unsupportedError) throw unsupportedError;
    if (candidates.length === 0) {
      if (foundHead) {
        journalError(
          "CORRUPT_MANIFEST",
          "두 manifest head 모두 torn/corrupt 상태라 결정적인 복구 지점을 찾지 못했습니다.",
        );
      }
      const manifest = emptyManifest(this.#identity);
      return {
        manifest,
        selected: null,
        candidates: Object.freeze([]),
        publicScan: Object.freeze({
          generation: 0,
          writerEpoch: 0,
          lastSequence: 0,
          totalPayloadBytes: 0,
          entries: Object.freeze([]),
          selectedSlot: null,
          ignoredSlots: Object.freeze(ignoredSlots),
        }),
      };
    }
    candidates.sort((left, right) => (
      right.manifest.generation - left.manifest.generation
      || left.slot.localeCompare(right.slot)
    ));
    if (
      candidates.length > 1
      && candidates[0]!.manifest.generation === candidates[1]!.manifest.generation
      && calculateStudioCrc32(candidates[0]!.manifestBytes)
        !== calculateStudioCrc32(candidates[1]!.manifestBytes)
    ) {
      journalError(
        "CORRUPT_MANIFEST",
        "같은 generation을 가리키는 두 committed manifest가 서로 다릅니다.",
      );
    }
    const selected = candidates[0]!;
    const entries: StudioOpfsRecoveryEntry[] = [];
    let totalPayloadBytes = 0;
    let checkpointCount = 0;
    const pageRevisions = new Map<string, number>();
    for (const reference of selected.manifest.entries) {
      const entry = await this.#validateEntry(reference, signal);
      const previousRevision = pageRevisions.get(entry.pageId);
      if (previousRevision !== undefined && entry.revision < previousRevision) {
        journalError(
          "CORRUPT_MANIFEST",
          "같은 page의 복구 revision이 뒤로 이동해 replay 순서를 결정할 수 없습니다.",
          { path: entry.descriptorPath },
        );
      }
      pageRevisions.set(entry.pageId, entry.revision);
      totalPayloadBytes += entry.byteLength;
      if (entry.kind === "checkpoint") checkpointCount += 1;
      entries.push(entry);
    }
    if (
      totalPayloadBytes !== selected.manifest.totalPayloadBytes
      || entries.length > this.#limits.maxEntries
      || checkpointCount > this.#limits.maxCheckpoints
      || selected.manifest.totalStoredBytes > this.#limits.maxJournalBytes
    ) {
      journalError(
        "CORRUPT_MANIFEST",
        "manifest 집계 또는 구성 개수가 현재 저널 한도와 일치하지 않습니다.",
        { path: selected.manifestPath },
      );
    }
    return {
      manifest: selected.manifest,
      selected,
      candidates: Object.freeze(candidates),
      publicScan: Object.freeze({
        generation: selected.manifest.generation,
        writerEpoch: selected.manifest.writerEpoch,
        lastSequence: selected.manifest.lastSequence,
        totalPayloadBytes,
        entries: Object.freeze(entries),
        selectedSlot: selected.slot,
        ignoredSlots: Object.freeze(ignoredSlots),
      }),
    };
  }

  async scan(options: StudioOpfsRecoveryMutationOptions = {}): Promise<StudioOpfsRecoveryScan> {
    return (await this.#scanInternal(options.signal)).publicScan;
  }

  async acquireWriter(input: {
    readonly ownerId: string;
    readonly signal?: AbortSignal;
  }): Promise<StudioOpfsRecoveryWriterLease> {
    assertEntryId(input.ownerId, "ownerId");
    throwIfAborted(input.signal);
    return this.#adapter.withExclusiveLock(this.#lockName, input.signal, async () => {
      throwIfAborted(input.signal);
      const now = this.#now();
      const existing = await this.#readLease(input.signal);
      if (existing && existing.expiresAt > now) {
        journalError(
          "LEASE_BUSY",
          "이 작품의 복구 저장소를 다른 탭이나 창이 사용하고 있어요.",
          {
            diagnostics:
              `lease ownerId=${existing.ownerId} epoch=${existing.epoch}`
              + ` expiresInMs=${existing.expiresAt - now}`,
          },
        );
      }
      const scan = await this.#scanInternal(input.signal);
      const previousEpoch = Math.max(existing?.epoch ?? 0, scan.publicScan.writerEpoch);
      if (previousEpoch >= Number.MAX_SAFE_INTEGER) {
        journalError("JOURNAL_LIMIT_EXCEEDED", "복구 저널 writer epoch 공간을 모두 사용했습니다.");
      }
      const epoch = previousEpoch + 1;
      const token = this.#randomToken();
      assertEntryId(token, "writer token");
      const stored: StoredLease = {
        format: STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT,
        version: STUDIO_OPFS_RECOVERY_JOURNAL_VERSION,
        documentId: this.#identity.documentId,
        ownerId: input.ownerId,
        token,
        epoch,
        acquiredAt: now,
        expiresAt: now + this.#limits.leaseTtlMs,
      };
      const path = this.#leasePath();
      const bytes = encodeFrame("lease", stored);
      await this.#write(path, bytes, input.signal);
      const verified = await this.#readLease(input.signal);
      if (
        !verified
        || verified.token !== token
        || verified.epoch !== epoch
        || verified.ownerId !== input.ownerId
      ) {
        journalError("LEASE_LOST", "writer lease 저장 직후 fencing 검증에 실패했습니다.", {
          path,
        });
      }
      return Object.freeze({
        documentId: stored.documentId,
        ownerId: stored.ownerId,
        token: stored.token,
        epoch: stored.epoch,
        acquiredAt: stored.acquiredAt,
        expiresAt: stored.expiresAt,
      });
    });
  }

  async renewWriter(
    writer: StudioOpfsRecoveryWriterLease,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryWriterLease> {
    return this.#adapter.withExclusiveLock(this.#lockName, options.signal, async () => {
      const stored = await this.#assertLease(writer, options.signal);
      const now = this.#now();
      const renewed: StoredLease = {
        ...stored,
        acquiredAt: now,
        expiresAt: now + this.#limits.leaseTtlMs,
      };
      await this.#write(this.#leasePath(), encodeFrame("lease", renewed), options.signal);
      return Object.freeze({
        documentId: renewed.documentId,
        ownerId: renewed.ownerId,
        token: renewed.token,
        epoch: renewed.epoch,
        acquiredAt: renewed.acquiredAt,
        expiresAt: renewed.expiresAt,
      });
    });
  }

  async releaseWriter(
    writer: StudioOpfsRecoveryWriterLease,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<void> {
    return this.#adapter.withExclusiveLock(this.#lockName, options.signal, async () => {
      const stored = await this.#readLease(options.signal);
      if (
        stored
        && stored.ownerId === writer.ownerId
        && stored.token === writer.token
        && stored.epoch === writer.epoch
        && stored.expiresAt === writer.expiresAt
      ) {
        try {
          await this.#adapter.remove(this.#leasePath());
        } catch (error) {
          mapStorageError(error, this.#leasePath());
        }
      }
    });
  }

  async #ensureQuota(
    additionalBytes: number,
    scan: InternalScan,
    signal?: AbortSignal,
  ): Promise<void> {
    let estimate: StudioOpfsRecoveryQuotaEstimate | null;
    try {
      estimate = await this.#adapter.estimateQuota();
    } catch (error) {
      mapStorageError(error);
    }
    throwIfAborted(signal);
    if (!validQuotaEstimate(estimate)) return;
    const required = additionalBytes + this.#limits.quotaReserveBytes;
    if (estimate.quota - estimate.usage >= required) return;
    await this.#evictObsoleteUnlocked(scan, signal);
    try {
      estimate = await this.#adapter.estimateQuota();
    } catch (error) {
      mapStorageError(error);
    }
    throwIfAborted(signal);
    if (
      validQuotaEstimate(estimate)
      && estimate.quota - estimate.usage < required
    ) {
      journalError(
        "QUOTA_EXCEEDED",
        "구세대/orphan 복구 파일을 제한 내에서 정리했지만 OPFS quota reserve가 부족합니다.",
      );
    }
  }

  async #stageEntry(
    kind: EntryKind,
    writer: StudioOpfsRecoveryWriterLease,
    input: StudioOpfsRecoveryAppendInput,
    sequence: number,
    stagingAttempt: number,
    compactThroughSequence: number | null,
    signal?: AbortSignal,
  ): Promise<StagedEntry> {
    assertEntryId(input.id, `${kind} id`);
    assertStorageId(input.pageId, "pageId");
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
      journalError("INVALID_ARGUMENT", "revision은 0 이상의 안전한 정수여야 합니다.");
    }
    const createdAt = input.createdAt ?? this.#now();
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      journalError("INVALID_ARGUMENT", "createdAt은 0 이상의 안전한 정수 timestamp여야 합니다.");
    }
    const byteLength = sourceByteLength(input.payload, input.byteLength);
    if (byteLength > this.#limits.maxEntryBytes) {
      journalError(
        "ENTRY_TOO_LARGE",
        `복구 entry는 최대 ${this.#limits.maxEntryBytes.toLocaleString("en-US")}바이트입니다.`,
      );
    }
    const chunks: StoredChunkReference[] = [];
    let streamedBytes = 0;
    let storedBytes = 0;
    let chunkIndex = 0;
    for await (const chunk of sourceChunks(input.payload, this.#limits.maxChunkBytes, signal)) {
      streamedBytes += chunk.byteLength;
      if (streamedBytes > byteLength || streamedBytes > this.#limits.maxEntryBytes) {
        journalError("INVALID_ARGUMENT", "payload stream이 선언한 byteLength를 초과했습니다.");
      }
      const path = this.#chunkPath(
        kind,
        sequence,
        writer.epoch,
        stagingAttempt,
        chunkIndex,
      );
      await this.#writeImmutable(path, chunk, signal);
      chunks.push({
        path,
        byteLength: chunk.byteLength,
        crc32: calculateStudioCrc32(chunk),
      });
      storedBytes += chunk.byteLength;
      chunkIndex += 1;
    }
    if (streamedBytes !== byteLength) {
      journalError(
        "INVALID_ARGUMENT",
        "payload stream이 선언한 byteLength보다 일찍 끝났습니다.",
      );
    }
    const descriptor: StoredDescriptor = {
      format: STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT,
      version: STUDIO_OPFS_RECOVERY_JOURNAL_VERSION,
      kind,
      id: input.id,
      sequence,
      pageId: input.pageId,
      revision: input.revision,
      documentId: this.#identity.documentId,
      documentVersion: this.#identity.documentVersion,
      engineVersion: this.#identity.engineVersion,
      writerEpoch: writer.epoch,
      createdAt,
      byteLength,
      chunks,
      compactThroughSequence,
    };
    const descriptorPath = this.#descriptorPath(
      kind,
      sequence,
      writer.epoch,
      stagingAttempt,
    );
    const descriptorBytes = encodeFrame("descriptor", descriptor);
    await this.#writeImmutable(descriptorPath, descriptorBytes, signal);
    storedBytes += descriptorBytes.byteLength;
    const descriptorCrc32 = calculateStudioCrc32(descriptorBytes);
    return {
      reference: {
        kind,
        sequence,
        descriptorPath,
        descriptorCrc32,
        storedBytes,
      },
      entry: Object.freeze({
        ...descriptor,
        chunks: Object.freeze(chunks.map((chunk) => Object.freeze({ ...chunk }))),
        descriptorPath,
        descriptorCrc32,
      }),
    };
  }

  async #commitManifest(
    writer: StudioOpfsRecoveryWriterLease,
    current: InternalScan,
    entries: readonly ManifestEntryReference[],
    lastSequence: number,
    createdAt: number,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#assertLease(writer, signal);
    if (current.manifest.generation >= Number.MAX_SAFE_INTEGER) {
      journalError("JOURNAL_LIMIT_EXCEEDED", "복구 manifest generation 공간을 모두 사용했습니다.");
    }
    const generation = current.manifest.generation + 1;
    const slot: ManifestSlot = generation % 2 === 1 ? "a" : "b";
    const manifestPath = this.#manifestPath(slot);
    const totalStoredBytes = entries.reduce((total, entry) => total + entry.storedBytes, 0);
    let totalPayloadBytes = 0;
    for (const reference of entries) {
      if (
        current.selected
        && current.manifest.entries.includes(reference)
      ) {
        const existing = current.publicScan.entries.find(
          (entry) => entry.sequence === reference.sequence,
        );
        totalPayloadBytes += existing?.byteLength ?? 0;
      } else {
        const entry = await this.#validateEntry(reference, signal);
        totalPayloadBytes += entry.byteLength;
      }
    }
    const manifest: StoredManifest = {
      format: STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT,
      version: STUDIO_OPFS_RECOVERY_JOURNAL_VERSION,
      phase: "prepared",
      generation,
      previousGeneration: current.manifest.generation,
      writerEpoch: writer.epoch,
      documentId: this.#identity.documentId,
      documentVersion: this.#identity.documentVersion,
      engineVersion: this.#identity.engineVersion,
      lastSequence,
      totalPayloadBytes,
      totalStoredBytes,
      createdAt,
      entries: entries.map((entry) => ({ ...entry })),
    };
    const manifestBytes = encodeFrame("manifest", manifest);
    // Phase 1: overwrite only the inactive manifest slot. The other head+manifest pair remains
    // valid even if this write is torn.
    await this.#write(manifestPath, manifestBytes, signal);
    await this.#assertLease(writer, signal);
    const head: StoredHead = {
      format: STUDIO_OPFS_RECOVERY_JOURNAL_FORMAT,
      version: STUDIO_OPFS_RECOVERY_JOURNAL_VERSION,
      phase: "committed",
      slot,
      generation,
      manifestPath,
      manifestCrc32: calculateStudioCrc32(manifestBytes),
    };
    // Phase 2 / commit point: publish the matching head in the same inactive slot. Do not perform
    // an abort check after this atomic write; once it returns, the generation is committed.
    try {
      await this.#adapter.writeAtomic(this.#headPath(slot), encodeFrame("head", head));
    } catch (error) {
      mapStorageError(error, this.#headPath(slot));
    }
  }

  async #append(
    kind: EntryKind,
    writer: StudioOpfsRecoveryWriterLease,
    input: StudioOpfsRecoveryAppendInput,
    compactThroughSequence: number | null,
    options: StudioOpfsRecoveryMutationOptions,
  ): Promise<StudioOpfsRecoveryEntry> {
    return this.#adapter.withExclusiveLock(this.#lockName, options.signal, async () => {
      await this.#assertLease(writer, options.signal);
      const current = await this.#scanInternal(options.signal);
      if (current.publicScan.writerEpoch > writer.epoch) {
        journalError("LEASE_LOST", "더 높은 writer epoch가 이미 manifest에 반영되었습니다.");
      }
      if (current.manifest.lastSequence >= Number.MAX_SAFE_INTEGER) {
        journalError("JOURNAL_LIMIT_EXCEEDED", "복구 저널 sequence 공간을 모두 사용했습니다.");
      }
      const previousPageEntry = [...current.publicScan.entries]
        .reverse()
        .find((entry) => entry.pageId === input.pageId);
      if (previousPageEntry && input.revision < previousPageEntry.revision) {
        journalError("INVALID_ARGUMENT", "같은 page의 revision은 감소할 수 없습니다.");
      }
      if (
        kind === "checkpoint"
        && previousPageEntry
        && (compactThroughSequence as number) < previousPageEntry.sequence
      ) {
        journalError(
          "INVALID_ARGUMENT",
          "checkpoint는 같은 page의 최신 active entry까지 포함해야 replay 순서가 보존됩니다.",
        );
      }
      const expectedBytes = sourceByteLength(input.payload, input.byteLength);
      if (
        kind === "operation"
        && (
          current.manifest.entries.length >= this.#limits.maxEntries
          || current.manifest.totalStoredBytes
            + expectedBytes
            + ENTRY_QUOTA_METADATA_ALLOWANCE_BYTES
            > this.#limits.maxJournalBytes
        )
      ) {
        journalError(
          "COMPACTION_REQUIRED",
          "복구 저널 한도에 도달했습니다. payload를 쓰기 전에 checkpoint compaction이 필요합니다.",
        );
      }
      await this.#ensureQuota(
        expectedBytes + ENTRY_QUOTA_METADATA_ALLOWANCE_BYTES,
        current,
        options.signal,
      );
      const sequence = current.manifest.lastSequence + 1;
      if (
        kind === "checkpoint"
        && (
          !isSafeInteger(compactThroughSequence)
          || compactThroughSequence > current.manifest.lastSequence
        )
      ) {
        journalError(
          "INVALID_ARGUMENT",
          "checkpoint compactThroughSequence는 현재 journal head를 넘을 수 없습니다.",
        );
      }
      const staged = await this.#stageEntry(
        kind,
        writer,
        input,
        sequence,
        this.#reserveStagingAttempt(kind, sequence, writer.epoch),
        compactThroughSequence,
        options.signal,
      );
      await this.#assertLease(writer, options.signal);
      const retained = kind === "checkpoint"
        ? current.manifest.entries.filter((reference) => {
          const entry = current.publicScan.entries.find(
            (candidate) => candidate.sequence === reference.sequence,
          );
          if (!entry || entry.pageId !== input.pageId) return true;
          if (entry.kind === "operation") {
            return entry.sequence > (compactThroughSequence as number);
          }
          return entry.sequence > (compactThroughSequence as number);
        })
        : [...current.manifest.entries];
      const nextEntries = [...retained, staged.reference];
      const checkpointCount = nextEntries.reduce(
        (count, reference) => count + (reference.kind === "checkpoint" ? 1 : 0),
        0,
      );
      if (nextEntries.length > this.#limits.maxEntries) {
        journalError(
          "COMPACTION_REQUIRED",
          "복구 operation 개수 한도에 도달했습니다. checkpoint compaction이 필요합니다.",
        );
      }
      if (checkpointCount > this.#limits.maxCheckpoints) {
        journalError(
          "COMPACTION_REQUIRED",
          "복구 checkpoint 개수 한도에 도달했습니다. 더 넓은 compaction 경계가 필요합니다.",
        );
      }
      const totalStoredBytes = nextEntries.reduce(
        (total, reference) => total + reference.storedBytes,
        0,
      );
      if (totalStoredBytes > this.#limits.maxJournalBytes) {
        journalError(
          "JOURNAL_LIMIT_EXCEEDED",
          "compaction 이후에도 복구 저널 byte 한도를 초과합니다.",
        );
      }
      await this.#commitManifest(
        writer,
        current,
        nextEntries,
        sequence,
        staged.entry.createdAt,
        options.signal,
      );
      this.#stagingAttempts.delete(
        this.#stagingAttemptKey(kind, sequence, writer.epoch),
      );
      return staged.entry;
    });
  }

  appendOperation(
    writer: StudioOpfsRecoveryWriterLease,
    input: StudioOpfsRecoveryAppendInput,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryEntry> {
    return this.#append("operation", writer, input, null, options);
  }

  appendCheckpoint(
    writer: StudioOpfsRecoveryWriterLease,
    input: StudioOpfsRecoveryCheckpointInput,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryEntry> {
    return this.#append(
      "checkpoint",
      writer,
      input,
      input.compactThroughSequence,
      options,
    );
  }

  async *readPayload(
    entry: StudioOpfsRecoveryEntry,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): AsyncGenerator<Uint8Array> {
    if (
      entry.documentId !== this.#identity.documentId
      || entry.documentVersion !== this.#identity.documentVersion
      || entry.engineVersion !== this.#identity.engineVersion
    ) {
      journalError("UNSUPPORTED_VERSION", "다른 문서/engine의 복구 entry는 읽을 수 없습니다.");
    }
    for (const chunk of entry.chunks) {
      const bytes = await this.#read(chunk.path, options.signal);
      if (
        bytes === null
        || bytes.byteLength !== chunk.byteLength
        || calculateStudioCrc32(bytes) !== chunk.crc32
      ) {
        journalError("CORRUPT_ENTRY", "복구 payload chunk 검증에 실패했습니다.", {
          path: chunk.path,
        });
      }
      yield bytes;
    }
  }

  async #evictObsoleteUnlocked(
    scan: InternalScan,
    signal?: AbortSignal,
  ): Promise<StudioOpfsRecoveryEvictionResult> {
    throwIfAborted(signal);
    const protectedPaths = new Set<string>([this.#leasePath()]);
    if (scan.selected) {
      protectedPaths.add(scan.selected.headPath);
      protectedPaths.add(scan.selected.manifestPath);
    }
    for (const entry of scan.publicScan.entries) {
      protectedPaths.add(entry.descriptorPath);
      for (const chunk of entry.chunks) protectedPaths.add(chunk.path);
    }
    let listed: readonly string[];
    try {
      listed = await this.#adapter.list(`${this.#basePath}/`);
    } catch (error) {
      return mapStorageError(error);
    }
    throwIfAborted(signal);
    const candidates = [...new Set(listed)]
      .filter((path) => path.startsWith(`${this.#basePath}/`) && !protectedPaths.has(path))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, this.#limits.maxEvictionsPerPass);
    const removedPaths: string[] = [];
    let freedBytes = 0;
    for (const path of candidates) {
      throwIfAborted(signal);
      let size: number | null;
      try {
        size = await this.#adapter.size(path);
        await this.#adapter.remove(path);
      } catch (error) {
        mapStorageError(error, path);
      }
      removedPaths.push(path);
      freedBytes += size ?? 0;
    }
    return Object.freeze({
      removedPaths: Object.freeze(removedPaths),
      freedBytes,
    });
  }

  evictObsolete(
    writer: StudioOpfsRecoveryWriterLease,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryEvictionResult> {
    return this.#adapter.withExclusiveLock(this.#lockName, options.signal, async () => {
      await this.#assertLease(writer, options.signal);
      return this.#evictObsoleteUnlocked(
        await this.#scanInternal(options.signal),
        options.signal,
      );
    });
  }
}

export function createStudioOpfsRecoveryJournal(
  options: StudioOpfsRecoveryJournalOptions,
): StudioOpfsRecoveryJournal {
  return new StudioOpfsRecoveryJournal(options);
}
