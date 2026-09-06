import {
  canonicalJson,
  journalEntryIRSchema,
  projectDigest,
  recoverProject,
  snapshotIRSchema,
} from "@toonspectrum/studio-project-model";
import { z } from "zod";

import {
  browserStudioOpfsDigest,
  canonicalizeStudioOpfsContentHash,
  type StudioOpfsAssetStore,
  type StudioOpfsContentHash,
  type StudioOpfsDigest,
} from "./studio-opfs-asset-store";
import {
  buildStudioPackageArchiveBytes,
  type StudioPackageArchiveSource,
} from "./studio-package-archive";

import type { StudioCrc32ExecutionMode } from "./studio-crc32-worker-client";
import type {
  JournalEntryIR,
  JournalStore,
  ProjectStateIR,
  RecoveryReport,
  SnapshotIR,
} from "@toonspectrum/studio-project-model";

/**
 * Portable V12 disaster-recovery package.
 *
 * This is deliberately separate from normal OPFS/SQLite durability. Local durability protects a
 * running origin; these bytes can leave the origin through an explicit caller-owned file port.
 * There is no fetch/upload implementation in this module.
 *
 * The package reuses the deterministic ZIP32/store writer used by Studio project archives and the
 * existing `sha256:<hex>` OPFS content-address convention. The project archive importer is not
 * reusable because its reader is private and its manifest requires a StudioProjectFile, so this
 * module contains only the missing strict ZIP reader and recovery-manifest authentication layer.
 */

export const STUDIO_V12_RECOVERY_PACKAGE_SCHEMA =
  "toonspectrum.studio-v12-recovery-package" as const;
export const STUDIO_V12_RECOVERY_PACKAGE_VERSION = 1 as const;
export const STUDIO_V12_RECOVERY_PACKAGE_MIME =
  "application/vnd.toonspectrum.studio-recovery+zip" as const;

export const STUDIO_V12_RECOVERY_PACKAGE_LIMITS = Object.freeze({
  maxArchiveBytes: 256_000_000,
  maxManifestBytes: 1_000_000,
  maxSnapshotBytes: 64_000_000,
  maxJournalBytes: 64_000_000,
  maxJournalEntries: 100_000,
  maxAttachments: 1_024,
  maxAttachmentBytes: 128_000_000,
  maxTotalAttachmentBytes: 192_000_000,
  maxFiles: 1_027,
  maxPathBytes: 240,
});

export interface StudioV12RecoveryPackageLimits {
  maxArchiveBytes: number;
  maxManifestBytes: number;
  maxSnapshotBytes: number;
  maxJournalBytes: number;
  maxJournalEntries: number;
  maxAttachments: number;
  maxAttachmentBytes: number;
  maxTotalAttachmentBytes: number;
  maxFiles: number;
  maxPathBytes: number;
}

export type StudioV12RecoveryPackageErrorCode =
  | "INVALID_INPUT"
  | "HASH_UNAVAILABLE"
  | "LIMIT_EXCEEDED"
  | "ARCHIVE_INVALID"
  | "PATH_INVALID"
  | "DUPLICATE_ENTRY"
  | "ZIP_BOMB"
  | "COMPRESSION_UNSUPPORTED"
  | "CRC_MISMATCH"
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "UNKNOWN_VERSION"
  | "UNEXPECTED_ENTRY"
  | "MISSING_ENTRY"
  | "HASH_MISMATCH"
  | "HISTORY_INVALID"
  | "ENGINE_OBJECT_REJECTED"
  | "ATTACHMENT_CONFLICT"
  | "DESTINATION_NOT_EMPTY"
  | "ATTACHMENT_REJECTED"
  | "RESTORE_FAILED";

export class StudioV12RecoveryPackageError extends Error {
  readonly code: StudioV12RecoveryPackageErrorCode;
  readonly path?: string;
  override readonly cause?: unknown;

  constructor(
    code: StudioV12RecoveryPackageErrorCode,
    message: string,
    options: { path?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "StudioV12RecoveryPackageError";
    this.code = code;
    this.path = options.path;
    this.cause = options.cause;
  }
}

export interface StudioV12RecoveryProjectIdentityInput {
  projectId: string;
  workspaceId?: string | null;
  title?: string | null;
}

export interface StudioV12RecoveryRightsInput {
  owner?: string | null;
  licenseSpdx?: string | null;
  attribution?: readonly string[];
  notices?: readonly string[];
}

export interface StudioV12RecoveryMetadataInput {
  title?: string | null;
  description?: string | null;
  tags?: readonly string[];
}

export interface StudioV12RecoveryAttachmentMetadataInput {
  name?: string | null;
  kind?: string | null;
  sourceFormat?: string | null;
  tags?: readonly string[];
}

export interface StudioV12RecoveryAttachmentInput {
  data: StudioPackageArchiveSource;
  mimeType?: string;
  rights?: StudioV12RecoveryRightsInput;
  metadata?: StudioV12RecoveryAttachmentMetadataInput;
}

export interface BuildStudioV12RecoveryPackageInput {
  project: StudioV12RecoveryProjectIdentityInput;
  history: JournalStore;
  attachments?: readonly StudioV12RecoveryAttachmentInput[];
  rights?: StudioV12RecoveryRightsInput;
  metadata?: StudioV12RecoveryMetadataInput;
}

export interface StudioV12RecoveryPackageOptions {
  limits?: Partial<StudioV12RecoveryPackageLimits>;
  digest?: StudioOpfsDigest | null;
  signal?: AbortSignal;
  /** Fixed before ZIP construction. Browser product callers select `worker`. */
  crc32ExecutionMode?: StudioCrc32ExecutionMode;
  onProgress?: (progress: {
    phase: "history" | "attachments" | "archive";
    completed: number;
    total: number;
  }) => void;
}

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const SafeIdSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => !hasUnsafeTextCharacter(value, false));
const SafeTextSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => !hasUnsafeTextCharacter(value, true));
const MimeSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u);
const ProjectIdentitySchema = z
  .object({
    projectId: SafeIdSchema,
    workspaceId: SafeIdSchema.nullable(),
    title: SafeTextSchema.nullable(),
  })
  .strict();

const RightsSchema = z
  .object({
    owner: SafeTextSchema.nullable(),
    licenseSpdx: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9.+-]+$/u)
      .nullable(),
    attribution: z.array(SafeTextSchema).max(256),
    notices: z.array(SafeTextSchema).max(256),
  })
  .strict();

const PackageMetadataSchema = z
  .object({
    title: SafeTextSchema.nullable(),
    description: SafeTextSchema.nullable(),
    tags: z.array(SafeTextSchema.max(120)).max(256),
    sourceApplication: z.literal("ToonSpectrum Studio V12"),
  })
  .strict();

const AttachmentMetadataSchema = z
  .object({
    name: SafeTextSchema.max(512).nullable(),
    kind: SafeIdSchema.max(120).nullable(),
    sourceFormat: SafeIdSchema.max(120).nullable(),
    tags: z.array(SafeTextSchema.max(120)).max(256),
  })
  .strict();

const SnapshotReferenceSchema = z
  .object({
    path: z.literal("history/snapshot.json"),
    contentHash: Sha256Schema,
    byteSize: z.number().int().positive(),
    slot: z.enum(["A", "B"]),
    seq: z.number().int().nonnegative(),
    projectDigest: z.string().length(16),
  })
  .strict();

const JournalReferenceSchema = z
  .object({
    path: z.literal("history/journal-tail.json"),
    contentHash: Sha256Schema,
    byteSize: z.number().int().positive(),
    baseSeq: z.number().int().nonnegative(),
    firstSeq: z.number().int().positive().nullable(),
    lastSeq: z.number().int().positive().nullable(),
    count: z.number().int().nonnegative(),
  })
  .strict();

const AttachmentManifestSchema = z
  .object({
    contentHash: Sha256Schema,
    path: z.string().min(1).max(240),
    byteSize: z.number().int().positive(),
    mimeType: MimeSchema,
    rights: RightsSchema,
    metadata: AttachmentMetadataSchema,
  })
  .strict();

const RecoveryPackageManifestSchema = z
  .object({
    schema: z.literal(STUDIO_V12_RECOVERY_PACKAGE_SCHEMA),
    version: z.literal(STUDIO_V12_RECOVERY_PACKAGE_VERSION),
    hashAlgorithm: z.literal("sha256"),
    project: ProjectIdentitySchema,
    recovered: z
      .object({
        seq: z.number().int().positive(),
        projectDigest: z.string().length(16),
      })
      .strict(),
    snapshot: SnapshotReferenceSchema.nullable(),
    journalTail: JournalReferenceSchema,
    attachments: z.array(AttachmentManifestSchema),
    rights: RightsSchema,
    metadata: PackageMetadataSchema,
    totals: z
      .object({
        files: z.number().int().positive(),
        attachmentBytes: z.number().int().nonnegative(),
        payloadBytes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type StudioV12RecoveryPackageManifest = z.infer<
  typeof RecoveryPackageManifestSchema
>;

export interface BuildStudioV12RecoveryPackageResult {
  bytes: Uint8Array;
  manifest: StudioV12RecoveryPackageManifest;
  recoveredProject: ProjectStateIR;
  recovery: RecoveryReport;
}

export interface StudioV12RecoveryImportedAttachment {
  contentHash: StudioOpfsContentHash;
  bytes: Uint8Array;
  mimeType: string;
  rights: z.infer<typeof RightsSchema>;
  metadata: z.infer<typeof AttachmentMetadataSchema>;
}

export interface ImportStudioV12RecoveryPackageResult {
  manifest: StudioV12RecoveryPackageManifest;
  snapshot: SnapshotIR | null;
  journalTail: JournalEntryIR[];
  attachments: StudioV12RecoveryImportedAttachment[];
  recoveredProject: ProjectStateIR;
  recovery: RecoveryReport;
}

export interface StudioV12RecoveryAttachmentTarget {
  /** Returns the content hash computed by the destination. */
  put(
    attachment: StudioV12RecoveryImportedAttachment,
    options: { signal?: AbortSignal },
  ): Promise<string>;
}

export interface RestoreStudioV12RecoveryPackageOptions {
  history: JournalStore;
  attachments?: StudioV12RecoveryAttachmentTarget;
  signal?: AbortSignal;
}

export interface StudioV12RecoveryPackageExportFilePort {
  save(
    file: {
      suggestedName: string;
      mimeType: typeof STUDIO_V12_RECOVERY_PACKAGE_MIME;
      bytes: Uint8Array;
    },
    options: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface StudioV12RecoveryPackageImportFilePort {
  open(options: {
    accept: typeof STUDIO_V12_RECOVERY_PACKAGE_MIME;
    signal?: AbortSignal;
  }): Promise<StudioPackageArchiveSource>;
}

interface PreparedAttachment {
  manifest: z.infer<typeof AttachmentManifestSchema>;
  bytes: Uint8Array;
}

interface ZipReader {
  size: number;
  read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
}

interface ParsedZipEntry {
  path: string;
  crc32: number;
  compressedBytes: number;
  uncompressedBytes: number;
  localHeaderOffset: number;
  dataOffset: number;
}

const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });
const ZIP_LOCAL_SIGNATURE = 0x0403_4b50;
const ZIP_CENTRAL_SIGNATURE = 0x0201_4b50;
const ZIP_EOCD_SIGNATURE = 0x0605_4b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_LOCAL_HEADER_BYTES = 30;
const ZIP_CENTRAL_HEADER_BYTES = 46;
const ZIP_EOCD_BYTES = 22;
const SAFE_ARCHIVE_PATH = /^[a-z0-9][a-z0-9._/-]*$/u;
const FORBIDDEN_ENGINE_OBJECT_KEYS = new Set([
  "engineObject",
  "rendererObject",
  "gpuDevice",
  "gpuAdapter",
  "canvasKitObject",
  "skiaObject",
  "velloScene",
  "konvaNode",
  "threeObject",
]);

function hasUnsafeTextCharacter(value: string, allowWhitespace: boolean): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const forbiddenControl = allowWhitespace
      ? code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)
      : code <= 0x1f;
    if (
      forbiddenControl ||
      code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function failure(
  code: StudioV12RecoveryPackageErrorCode,
  message: string,
  options: { path?: string; cause?: unknown } = {},
): never {
  throw new StudioV12RecoveryPackageError(code, message, options);
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("복구 패키지 작업을 취소했습니다.", "AbortError");
  }
  const error = new Error("복구 패키지 작업을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function resolvePositiveLimit(
  value: number | undefined,
  fixed: number,
  label: keyof StudioV12RecoveryPackageLimits,
): number {
  if (value === undefined) return fixed;
  if (!Number.isSafeInteger(value) || value <= 0 || value > fixed) {
    failure("INVALID_INPUT", `${label} 한도는 1..${fixed} 범위여야 합니다.`);
  }
  return value;
}

function resolveLimits(
  input: Partial<StudioV12RecoveryPackageLimits> | undefined,
): StudioV12RecoveryPackageLimits {
  const fixed = STUDIO_V12_RECOVERY_PACKAGE_LIMITS;
  return {
    maxArchiveBytes: resolvePositiveLimit(
      input?.maxArchiveBytes,
      fixed.maxArchiveBytes,
      "maxArchiveBytes",
    ),
    maxManifestBytes: resolvePositiveLimit(
      input?.maxManifestBytes,
      fixed.maxManifestBytes,
      "maxManifestBytes",
    ),
    maxSnapshotBytes: resolvePositiveLimit(
      input?.maxSnapshotBytes,
      fixed.maxSnapshotBytes,
      "maxSnapshotBytes",
    ),
    maxJournalBytes: resolvePositiveLimit(
      input?.maxJournalBytes,
      fixed.maxJournalBytes,
      "maxJournalBytes",
    ),
    maxJournalEntries: resolvePositiveLimit(
      input?.maxJournalEntries,
      fixed.maxJournalEntries,
      "maxJournalEntries",
    ),
    maxAttachments: resolvePositiveLimit(
      input?.maxAttachments,
      fixed.maxAttachments,
      "maxAttachments",
    ),
    maxAttachmentBytes: resolvePositiveLimit(
      input?.maxAttachmentBytes,
      fixed.maxAttachmentBytes,
      "maxAttachmentBytes",
    ),
    maxTotalAttachmentBytes: resolvePositiveLimit(
      input?.maxTotalAttachmentBytes,
      fixed.maxTotalAttachmentBytes,
      "maxTotalAttachmentBytes",
    ),
    maxFiles: resolvePositiveLimit(input?.maxFiles, fixed.maxFiles, "maxFiles"),
    maxPathBytes: resolvePositiveLimit(
      input?.maxPathBytes,
      fixed.maxPathBytes,
      "maxPathBytes",
    ),
  };
}

function normalizedText(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") failure("INVALID_INPUT", `${label} 문자열이 올바르지 않습니다.`);
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0) return null;
  const parsed = SafeTextSchema.safeParse(normalized);
  if (!parsed.success) failure("INVALID_INPUT", `${label} 문자열이 안전 한도를 벗어났습니다.`);
  return parsed.data;
}

function normalizedId(value: string | null | undefined, label: string): string | null {
  const normalized = normalizedText(value, label);
  if (normalized === null) return null;
  const parsed = SafeIdSchema.safeParse(normalized);
  if (!parsed.success) failure("INVALID_INPUT", `${label} 식별자가 올바르지 않습니다.`);
  return parsed.data;
}

function normalizedList(
  value: readonly string[] | undefined,
  label: string,
  max = 256,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) {
    failure("INVALID_INPUT", `${label} 목록이 안전 한도를 벗어났습니다.`);
  }
  const unique = new Set<string>();
  for (const item of value) {
    const normalized = normalizedText(item, label);
    if (normalized !== null) unique.add(normalized);
  }
  return [...unique].sort((left, right) => left.localeCompare(right, "en"));
}

function normalizeRights(input: StudioV12RecoveryRightsInput | undefined): z.infer<
  typeof RightsSchema
> {
  const licenseSpdx = normalizedId(input?.licenseSpdx, "licenseSpdx");
  const value = {
    owner: normalizedText(input?.owner, "rights.owner"),
    licenseSpdx,
    attribution: normalizedList(input?.attribution, "rights.attribution"),
    notices: normalizedList(input?.notices, "rights.notices"),
  };
  const parsed = RightsSchema.safeParse(value);
  if (!parsed.success) failure("INVALID_INPUT", "권리 메타데이터가 올바르지 않습니다.");
  return parsed.data;
}

function normalizeProjectIdentity(
  input: StudioV12RecoveryProjectIdentityInput,
): z.infer<typeof ProjectIdentitySchema> {
  if (!input || typeof input !== "object") {
    failure("INVALID_INPUT", "프로젝트 신원 정보가 필요합니다.");
  }
  const projectId = normalizedId(input.projectId, "project.projectId");
  if (projectId === null) failure("INVALID_INPUT", "projectId가 필요합니다.");
  return ProjectIdentitySchema.parse({
    projectId,
    workspaceId: normalizedId(input.workspaceId, "project.workspaceId"),
    title: normalizedText(input.title, "project.title"),
  });
}

function normalizePackageMetadata(
  input: StudioV12RecoveryMetadataInput | undefined,
): z.infer<typeof PackageMetadataSchema> {
  return PackageMetadataSchema.parse({
    title: normalizedText(input?.title, "metadata.title"),
    description: normalizedText(input?.description, "metadata.description"),
    tags: normalizedList(input?.tags, "metadata.tags"),
    sourceApplication: "ToonSpectrum Studio V12",
  });
}

function normalizeAttachmentMetadata(
  input: StudioV12RecoveryAttachmentMetadataInput | undefined,
): z.infer<typeof AttachmentMetadataSchema> {
  return AttachmentMetadataSchema.parse({
    name: normalizedText(input?.name, "attachment.metadata.name"),
    kind: normalizedId(input?.kind, "attachment.metadata.kind"),
    sourceFormat: normalizedId(
      input?.sourceFormat,
      "attachment.metadata.sourceFormat",
    ),
    tags: normalizedList(input?.tags, "attachment.metadata.tags"),
  });
}

function normalizeMimeType(value: string | undefined): string {
  const normalized = value?.normalize("NFC").trim().toLowerCase() || "application/octet-stream";
  const parsed = MimeSchema.safeParse(normalized);
  if (!parsed.success) failure("INVALID_INPUT", "attachment MIME type이 올바르지 않습니다.");
  return parsed.data;
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function digestSource(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : Uint8Array.from(bytes);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(
  bytes: Uint8Array,
  digest: StudioOpfsDigest,
  signal?: AbortSignal,
): Promise<StudioOpfsContentHash> {
  throwIfAborted(signal);
  const result = await digest(digestSource(bytes));
  throwIfAborted(signal);
  if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) {
    failure("HASH_UNAVAILABLE", "SHA-256 digest provider가 32바이트를 반환하지 않았습니다.");
  }
  return `sha256:${hex(new Uint8Array(result))}` as StudioOpfsContentHash;
}

function requireDigest(value: StudioOpfsDigest | null | undefined): StudioOpfsDigest {
  const digest = value === undefined ? browserStudioOpfsDigest() : value;
  if (!digest) failure("HASH_UNAVAILABLE", "WebCrypto SHA-256을 사용할 수 없습니다.");
  return digest;
}

async function sourceBytes(
  source: StudioPackageArchiveSource,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfAborted(signal);
  let bytes: Uint8Array;
  if (source instanceof Blob) {
    if (source.size <= 0 || source.size > maxBytes) {
      failure("LIMIT_EXCEEDED", "attachment 크기가 안전 한도를 벗어났습니다.");
    }
    bytes = new Uint8Array(await source.arrayBuffer());
  } else if (source instanceof Uint8Array) {
    bytes = Uint8Array.from(source);
  } else if (source instanceof ArrayBuffer) {
    bytes = new Uint8Array(source.slice(0));
  } else {
    failure("INVALID_INPUT", "지원하지 않는 binary source입니다.");
  }
  throwIfAborted(signal);
  if (bytes.byteLength <= 0 || bytes.byteLength > maxBytes) {
    failure("LIMIT_EXCEEDED", "attachment 크기가 안전 한도를 벗어났습니다.");
  }
  return bytes;
}

function assertNoEngineObject(value: unknown, label: string): void {
  const queue: unknown[] = [value];
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.pop();
    visited += 1;
    if (visited > 1_000_000) failure("LIMIT_EXCEEDED", `${label} 구조가 너무 큽니다.`);
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (FORBIDDEN_ENGINE_OBJECT_KEYS.has(key) && child !== null && typeof child === "object") {
        failure(
          "ENGINE_OBJECT_REJECTED",
          `${label}에 엔진 런타임 객체 필드 ${key}가 포함되어 있습니다.`,
        );
      }
      queue.push(child);
    }
  }
}

function exactSchemaParse<T>(
  value: unknown,
  schema: z.ZodType<T>,
  code: StudioV12RecoveryPackageErrorCode,
  label: string,
): T {
  assertNoEngineObject(value, label);
  const parsed = schema.safeParse(value);
  if (!parsed.success || canonicalJson(parsed.data) !== canonicalJson(value)) {
    failure(code, `${label} schema 또는 canonical 구조가 올바르지 않습니다.`);
  }
  return parsed.data;
}

function canonicalBytes(value: unknown): Uint8Array {
  return textEncoder.encode(canonicalJson(value));
}

function attachmentPath(hash: StudioOpfsContentHash): string {
  return `attachments/sha256/${hash.slice("sha256:".length)}.bin`;
}

async function validatedHistory(
  store: JournalStore,
  limits: StudioV12RecoveryPackageLimits,
  signal?: AbortSignal,
): Promise<{
  snapshot: SnapshotIR | null;
  tail: JournalEntryIR[];
  recoveredProject: ProjectStateIR;
  recovery: RecoveryReport;
}> {
  throwIfAborted(signal);
  const [rawSnapshots, rawEntries] = await Promise.all([
    store.readSnapshots(),
    store.readEntries(),
  ]);
  throwIfAborted(signal);
  if (rawEntries.length > limits.maxJournalEntries) {
    failure("LIMIT_EXCEEDED", "journal entry 수가 안전 한도를 넘었습니다.");
  }
  const snapshots = rawSnapshots.map((snapshot) =>
    exactSchemaParse(snapshot, snapshotIRSchema, "HISTORY_INVALID", "snapshot"),
  );
  const entries = rawEntries.map((entry) =>
    exactSchemaParse(entry, journalEntryIRSchema, "HISTORY_INVALID", "journal entry"),
  );
  const frozenStore: JournalStore = {
    append: () => Promise.reject(new Error("read-only history snapshot")),
    readEntries: () => Promise.resolve(entries.map((entry) => structuredClone(entry))),
    writeSnapshot: () => Promise.reject(new Error("read-only history snapshot")),
    readSnapshots: () =>
      Promise.resolve(snapshots.map((snapshot) => structuredClone(snapshot))),
  };
  const recovered = await recoverProject(frozenStore);
  throwIfAborted(signal);
  if (
    recovered.project === null ||
    recovered.seq <= 0 ||
    recovered.report.issues.length > 0 ||
    recovered.report.truncatedFromSeq !== null
  ) {
    failure(
      "HISTORY_INVALID",
      `복구 가능한 완전한 history가 아닙니다: ${recovered.report.issues.join("; ") || "empty"}`,
    );
  }
  const snapshot = recovered.report.snapshotSlotUsed === null
    ? null
    : snapshots.find(
        (candidate) =>
          candidate.slot === recovered.report.snapshotSlotUsed &&
          candidate.seq === recovered.report.snapshotSeq,
      ) ?? null;
  if (recovered.report.snapshotSlotUsed !== null && snapshot === null) {
    failure("HISTORY_INVALID", "recovery가 선택한 snapshot을 찾지 못했습니다.");
  }
  const baseSeq = snapshot?.seq ?? 0;
  const tail = entries
    .filter((entry) => entry.seq > baseSeq && entry.seq <= recovered.seq)
    .sort((left, right) => left.seq - right.seq);
  if (tail.length > limits.maxJournalEntries) {
    failure("LIMIT_EXCEEDED", "journal tail 수가 안전 한도를 넘었습니다.");
  }
  return {
    snapshot,
    tail,
    recoveredProject: recovered.project,
    recovery: recovered.report,
  };
}

async function prepareAttachments(
  inputs: readonly StudioV12RecoveryAttachmentInput[],
  limits: StudioV12RecoveryPackageLimits,
  digest: StudioOpfsDigest,
  options: StudioV12RecoveryPackageOptions,
): Promise<PreparedAttachment[]> {
  if (inputs.length > limits.maxAttachments) {
    failure("LIMIT_EXCEEDED", "attachment 수가 안전 한도를 넘었습니다.");
  }
  const byHash = new Map<StudioOpfsContentHash, PreparedAttachment>();
  let totalBytes = 0;
  for (let index = 0; index < inputs.length; index += 1) {
    throwIfAborted(options.signal);
    const input = inputs[index];
    if (!input || typeof input !== "object") {
      failure("INVALID_INPUT", "attachment 입력이 올바르지 않습니다.");
    }
    const bytes = await sourceBytes(input.data, limits.maxAttachmentBytes, options.signal);
    totalBytes += bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalAttachmentBytes) {
      failure("LIMIT_EXCEEDED", "attachment 원본 합계가 안전 한도를 넘었습니다.");
    }
    const contentHash = await sha256(bytes, digest, options.signal);
    const manifest = AttachmentManifestSchema.parse({
      contentHash,
      path: attachmentPath(contentHash),
      byteSize: bytes.byteLength,
      mimeType: normalizeMimeType(input.mimeType),
      rights: normalizeRights(input.rights),
      metadata: normalizeAttachmentMetadata(input.metadata),
    });
    const existing = byHash.get(contentHash);
    if (existing) {
      if (canonicalJson(existing.manifest) !== canonicalJson(manifest)) {
        failure(
          "ATTACHMENT_CONFLICT",
          "같은 content hash에 서로 다른 권리 또는 메타데이터가 선언됐습니다.",
          { path: manifest.path },
        );
      }
    } else {
      byHash.set(contentHash, { manifest, bytes });
    }
    options.onProgress?.({
      phase: "attachments",
      completed: index + 1,
      total: inputs.length,
    });
  }
  return [...byHash.values()].sort((left, right) =>
    left.manifest.contentHash.localeCompare(right.manifest.contentHash, "en"),
  );
}

/** Builds deterministic bytes; no download or server transfer is performed. */
export async function buildStudioV12RecoveryPackage(
  input: BuildStudioV12RecoveryPackageInput,
  options: StudioV12RecoveryPackageOptions = {},
): Promise<BuildStudioV12RecoveryPackageResult> {
  throwIfAborted(options.signal);
  if (!input || typeof input !== "object" || !input.history) {
    failure("INVALID_INPUT", "복구 패키지 입력과 history가 필요합니다.");
  }
  const limits = resolveLimits(options.limits);
  const digest = requireDigest(options.digest);
  const history = await validatedHistory(input.history, limits, options.signal);
  options.onProgress?.({ phase: "history", completed: 1, total: 1 });

  const snapshotBytes = history.snapshot ? canonicalBytes(history.snapshot) : null;
  const journalBytes = canonicalBytes(history.tail);
  if (snapshotBytes && snapshotBytes.byteLength > limits.maxSnapshotBytes) {
    failure("LIMIT_EXCEEDED", "snapshot bytes가 안전 한도를 넘었습니다.");
  }
  if (journalBytes.byteLength > limits.maxJournalBytes) {
    failure("LIMIT_EXCEEDED", "journal bytes가 안전 한도를 넘었습니다.");
  }
  const [snapshotHash, journalHash, attachments] = await Promise.all([
    snapshotBytes ? sha256(snapshotBytes, digest, options.signal) : Promise.resolve(null),
    sha256(journalBytes, digest, options.signal),
    prepareAttachments(input.attachments ?? [], limits, digest, options),
  ]);
  throwIfAborted(options.signal);

  const finalProjectDigest = projectDigest(history.recoveredProject);
  const baseSeq = history.snapshot?.seq ?? 0;
  const firstEntry = history.tail[0] ?? null;
  const lastEntry = history.tail.at(-1) ?? null;
  const attachmentBytes = attachments.reduce(
    (sum, attachment) => sum + attachment.bytes.byteLength,
    0,
  );
  const payloadBytes =
    journalBytes.byteLength + (snapshotBytes?.byteLength ?? 0) + attachmentBytes;
  const fileCount = 2 + (snapshotBytes ? 1 : 0) + attachments.length;
  if (fileCount > limits.maxFiles) {
    failure("LIMIT_EXCEEDED", "복구 패키지 파일 수가 안전 한도를 넘었습니다.");
  }

  const manifest = RecoveryPackageManifestSchema.parse({
    schema: STUDIO_V12_RECOVERY_PACKAGE_SCHEMA,
    version: STUDIO_V12_RECOVERY_PACKAGE_VERSION,
    hashAlgorithm: "sha256",
    project: normalizeProjectIdentity(input.project),
    recovered: { seq: history.recovery.snapshotSeq + history.recovery.replayedEntries, projectDigest: finalProjectDigest },
    snapshot: history.snapshot && snapshotBytes && snapshotHash
      ? {
          path: "history/snapshot.json",
          contentHash: snapshotHash,
          byteSize: snapshotBytes.byteLength,
          slot: history.snapshot.slot,
          seq: history.snapshot.seq,
          projectDigest: history.snapshot.projectDigest ?? projectDigest({
            scene: history.snapshot.scene,
            comic: history.snapshot.comic ?? null,
            animation: history.snapshot.animation ?? null,
            effects: history.snapshot.effects ?? null,
          }),
        }
      : null,
    journalTail: {
      path: "history/journal-tail.json",
      contentHash: journalHash,
      byteSize: journalBytes.byteLength,
      baseSeq,
      firstSeq: firstEntry?.seq ?? null,
      lastSeq: lastEntry?.seq ?? null,
      count: history.tail.length,
    },
    attachments: attachments.map(({ manifest: attachment }) => attachment),
    rights: normalizeRights(input.rights),
    metadata: normalizePackageMetadata(input.metadata),
    totals: {
      files: fileCount,
      attachmentBytes,
      payloadBytes,
    },
  });
  if (manifest.recovered.seq !== history.recovery.snapshotSeq + history.recovery.replayedEntries) {
    failure("HISTORY_INVALID", "recovery seq 계산이 일치하지 않습니다.");
  }
  const manifestBytes = canonicalBytes(manifest);
  if (manifestBytes.byteLength > limits.maxManifestBytes) {
    failure("LIMIT_EXCEEDED", "manifest bytes가 안전 한도를 넘었습니다.");
  }

  const entries = [
    { path: "manifest.json", data: manifestBytes },
    ...(snapshotBytes ? [{ path: "history/snapshot.json", data: snapshotBytes }] : []),
    { path: "history/journal-tail.json", data: journalBytes },
    ...attachments.map((attachment) => ({
      path: attachment.manifest.path,
      data: attachment.bytes,
    })),
  ];
  const bytes = await buildStudioPackageArchiveBytes(entries, {
    crc32ExecutionMode: options.crc32ExecutionMode ?? "worker",
    signal: options.signal,
    limits: {
      maxFiles: limits.maxFiles,
      maxEntryBytes: Math.max(
        limits.maxManifestBytes,
        limits.maxSnapshotBytes,
        limits.maxJournalBytes,
        limits.maxAttachmentBytes,
      ),
      maxTotalBytes: limits.maxArchiveBytes,
      maxArchiveBytes: limits.maxArchiveBytes,
      maxPathBytes: limits.maxPathBytes,
    },
    onProgress: (progress) =>
      options.onProgress?.({
        phase: "archive",
        completed: progress.completedFiles,
        total: progress.totalFiles,
      }),
  });
  return {
    bytes,
    manifest,
    recoveredProject: history.recoveredProject,
    recovery: history.recovery,
  };
}

function createZipReader(
  source: StudioPackageArchiveSource,
  limits: StudioV12RecoveryPackageLimits,
): ZipReader {
  if (source instanceof Blob) {
    if (source.size <= 0 || source.size > limits.maxArchiveBytes) {
      failure("LIMIT_EXCEEDED", "복구 archive 크기가 안전 한도를 벗어났습니다.");
    }
    return {
      size: source.size,
      async read(offset, length, signal) {
        throwIfAborted(signal);
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          offset + length > source.size
        ) {
          failure("ARCHIVE_INVALID", "ZIP read 범위가 올바르지 않습니다.");
        }
        const bytes = new Uint8Array(await source.slice(offset, offset + length).arrayBuffer());
        throwIfAborted(signal);
        if (bytes.byteLength !== length) {
          failure("ARCHIVE_INVALID", "ZIP read 길이가 선언과 다릅니다.");
        }
        return bytes;
      },
    };
  }
  let bytes: Uint8Array;
  if (source instanceof Uint8Array) bytes = Uint8Array.from(source);
  else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source.slice(0));
  else failure("ARCHIVE_INVALID", "지원하지 않는 archive source입니다.");
  if (bytes.byteLength <= 0 || bytes.byteLength > limits.maxArchiveBytes) {
    failure("LIMIT_EXCEEDED", "복구 archive 크기가 안전 한도를 벗어났습니다.");
  }
  return {
    size: bytes.byteLength,
    read(offset, length, signal) {
      throwIfAborted(signal);
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > bytes.byteLength
      ) {
        failure("ARCHIVE_INVALID", "ZIP read 범위가 올바르지 않습니다.");
      }
      return Promise.resolve(bytes.slice(offset, offset + length));
    },
  };
}

function decodePath(bytes: Uint8Array, limits: StudioV12RecoveryPackageLimits): string {
  let path: string;
  try {
    path = fatalTextDecoder.decode(bytes);
  } catch (cause) {
    failure("PATH_INVALID", "ZIP 경로가 올바른 UTF-8이 아닙니다.", { cause });
  }
  if (
    bytes.byteLength <= 0 ||
    bytes.byteLength > limits.maxPathBytes ||
    path.normalize("NFC") !== path ||
    !SAFE_ARCHIVE_PATH.test(path) ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("//") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    failure("PATH_INVALID", "ZIP 경로가 안전한 canonical 상대 경로가 아닙니다.", { path });
  }
  return path;
}

async function parseZipEntries(
  reader: ZipReader,
  limits: StudioV12RecoveryPackageLimits,
  signal?: AbortSignal,
): Promise<ParsedZipEntry[]> {
  throwIfAborted(signal);
  if (reader.size < ZIP_EOCD_BYTES) failure("ARCHIVE_INVALID", "ZIP EOCD가 없습니다.");
  const eocdOffset = reader.size - ZIP_EOCD_BYTES;
  const eocd = await reader.read(eocdOffset, ZIP_EOCD_BYTES, signal);
  if (
    uint32(eocd, 0) !== ZIP_EOCD_SIGNATURE ||
    uint16(eocd, 4) !== 0 ||
    uint16(eocd, 6) !== 0 ||
    uint16(eocd, 20) !== 0
  ) {
    failure("ARCHIVE_INVALID", "단일 디스크·무주석 ZIP32 EOCD가 아닙니다.");
  }
  const entryCount = uint16(eocd, 10);
  if (entryCount !== uint16(eocd, 8) || entryCount < 2 || entryCount > limits.maxFiles) {
    failure("ZIP_BOMB", "ZIP 파일 수가 안전 한도를 벗어났습니다.");
  }
  const centralBytesLength = uint32(eocd, 12);
  const centralOffset = uint32(eocd, 16);
  if (
    centralOffset + centralBytesLength !== eocdOffset ||
    centralBytesLength > entryCount * (ZIP_CENTRAL_HEADER_BYTES + limits.maxPathBytes)
  ) {
    failure("ARCHIVE_INVALID", "ZIP central directory 범위가 올바르지 않습니다.");
  }
  const central = await reader.read(centralOffset, centralBytesLength, signal);
  const entries: ParsedZipEntry[] = [];
  const normalizedPaths = new Set<string>();
  let totalBytes = 0;
  let cursor = 0;
  for (let index = 0; index < entryCount; index += 1) {
    throwIfAborted(signal);
    if (cursor + ZIP_CENTRAL_HEADER_BYTES > central.byteLength) {
      failure("ARCHIVE_INVALID", "ZIP central header가 잘렸습니다.");
    }
    if (uint32(central, cursor) !== ZIP_CENTRAL_SIGNATURE) {
      failure("ARCHIVE_INVALID", "ZIP central header signature가 없습니다.");
    }
    const flags = uint16(central, cursor + 8);
    const method = uint16(central, cursor + 10);
    const crc = uint32(central, cursor + 16);
    const compressedBytes = uint32(central, cursor + 20);
    const uncompressedBytes = uint32(central, cursor + 24);
    const pathBytes = uint16(central, cursor + 28);
    const extraBytes = uint16(central, cursor + 30);
    const commentBytes = uint16(central, cursor + 32);
    const diskStart = uint16(central, cursor + 34);
    const localHeaderOffset = uint32(central, cursor + 42);
    const next = cursor + ZIP_CENTRAL_HEADER_BYTES + pathBytes + extraBytes + commentBytes;
    if (next > central.byteLength || diskStart !== 0 || extraBytes !== 0 || commentBytes !== 0) {
      failure("ARCHIVE_INVALID", "ZIP central entry 확장 또는 범위가 올바르지 않습니다.");
    }
    if (flags !== ZIP_UTF8_FLAG) {
      failure("ARCHIVE_INVALID", "ZIP entry는 UTF-8 store 플래그만 허용합니다.");
    }
    if (method !== ZIP_STORE_METHOD) {
      failure("COMPRESSION_UNSUPPORTED", "압축 ZIP entry는 복구 패키지에서 허용하지 않습니다.");
    }
    if (compressedBytes !== uncompressedBytes) {
      failure("ZIP_BOMB", "ZIP store entry의 압축/원본 길이가 다릅니다.");
    }
    if (uncompressedBytes > limits.maxAttachmentBytes) {
      failure("ZIP_BOMB", "ZIP entry 선언 크기가 안전 한도를 넘었습니다.");
    }
    totalBytes += uncompressedBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxArchiveBytes) {
      failure("ZIP_BOMB", "ZIP 원본 합계가 안전 한도를 넘었습니다.");
    }
    const path = decodePath(
      central.subarray(cursor + ZIP_CENTRAL_HEADER_BYTES, cursor + ZIP_CENTRAL_HEADER_BYTES + pathBytes),
      limits,
    );
    const normalizedPath = path.normalize("NFC").toLowerCase();
    if (normalizedPaths.has(normalizedPath)) {
      failure("DUPLICATE_ENTRY", "ZIP에 중복 extraction 경로가 있습니다.", { path });
    }
    normalizedPaths.add(normalizedPath);
    const local = await reader.read(
      localHeaderOffset,
      ZIP_LOCAL_HEADER_BYTES + pathBytes,
      signal,
    );
    if (
      uint32(local, 0) !== ZIP_LOCAL_SIGNATURE ||
      uint16(local, 6) !== flags ||
      uint16(local, 8) !== method ||
      uint32(local, 14) !== crc ||
      uint32(local, 18) !== compressedBytes ||
      uint32(local, 22) !== uncompressedBytes ||
      uint16(local, 26) !== pathBytes ||
      uint16(local, 28) !== 0
    ) {
      failure("ARCHIVE_INVALID", "ZIP local/central header가 일치하지 않습니다.", { path });
    }
    const localPath = decodePath(local.subarray(ZIP_LOCAL_HEADER_BYTES), limits);
    if (localPath !== path) {
      failure("ARCHIVE_INVALID", "ZIP local/central 경로가 일치하지 않습니다.", { path });
    }
    const dataOffset = localHeaderOffset + ZIP_LOCAL_HEADER_BYTES + pathBytes;
    if (dataOffset + compressedBytes > centralOffset) {
      failure("ZIP_BOMB", "ZIP entry 데이터 범위가 central directory를 침범합니다.", { path });
    }
    entries.push({
      path,
      crc32: crc,
      compressedBytes,
      uncompressedBytes,
      localHeaderOffset,
      dataOffset,
    });
    cursor = next;
  }
  if (cursor !== central.byteLength) {
    failure("ARCHIVE_INVALID", "ZIP central directory에 후행 바이트가 있습니다.");
  }
  const physical = [...entries].sort(
    (left, right) => left.localHeaderOffset - right.localHeaderOffset,
  );
  let expectedOffset = 0;
  for (const entry of physical) {
    if (entry.localHeaderOffset !== expectedOffset) {
      failure("ARCHIVE_INVALID", "ZIP local entry 사이에 숨은 또는 겹친 바이트가 있습니다.");
    }
    expectedOffset = entry.dataOffset + entry.compressedBytes;
  }
  if (expectedOffset !== centralOffset) {
    failure("ARCHIVE_INVALID", "ZIP local entry 범위가 central directory까지 연속적이지 않습니다.");
  }
  return entries;
}

async function readVerifiedZipEntry(
  reader: ZipReader,
  entry: ParsedZipEntry,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const bytes = await reader.read(entry.dataOffset, entry.uncompressedBytes, signal);
  if (crc32(bytes) !== entry.crc32) {
    failure("CRC_MISMATCH", "ZIP entry CRC32가 일치하지 않습니다.", { path: entry.path });
  }
  return bytes;
}

function parseCanonicalJson<T>(
  bytes: Uint8Array,
  schema: z.ZodType<T>,
  code: StudioV12RecoveryPackageErrorCode,
  label: string,
): T {
  let text: string;
  let value: unknown;
  try {
    text = fatalTextDecoder.decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    failure(code, `${label} JSON을 해석하지 못했습니다.`, { cause });
  }
  const parsed = exactSchemaParse(value, schema, code, label);
  if (canonicalJson(parsed) !== text) {
    failure(code, `${label} JSON이 canonical bytes가 아닙니다.`);
  }
  return parsed;
}

function assertSortedUniqueManifest(
  manifest: StudioV12RecoveryPackageManifest,
  limits: StudioV12RecoveryPackageLimits,
): void {
  if (manifest.attachments.length > limits.maxAttachments) {
    failure("LIMIT_EXCEEDED", "manifest attachment 수가 안전 한도를 넘었습니다.");
  }
  let previous = "";
  let total = 0;
  for (const attachment of manifest.attachments) {
    if (attachment.contentHash <= previous) {
      failure("MANIFEST_INVALID", "manifest attachment가 hash 순서 또는 unique 규약을 어겼습니다.");
    }
    previous = attachment.contentHash;
    const canonicalHash = canonicalizeStudioOpfsContentHash(attachment.contentHash);
    if (!canonicalHash || attachment.path !== attachmentPath(canonicalHash)) {
      failure("MANIFEST_INVALID", "attachment 경로가 content hash에서 유도되지 않았습니다.", {
        path: attachment.path,
      });
    }
    if (attachment.byteSize > limits.maxAttachmentBytes) {
      failure("LIMIT_EXCEEDED", "manifest attachment 크기가 안전 한도를 넘었습니다.");
    }
    total += attachment.byteSize;
  }
  if (total !== manifest.totals.attachmentBytes || total > limits.maxTotalAttachmentBytes) {
    failure("MANIFEST_INVALID", "manifest attachment 합계가 일치하지 않습니다.");
  }
  const expectedFiles = 2 + (manifest.snapshot ? 1 : 0) + manifest.attachments.length;
  if (manifest.totals.files !== expectedFiles || expectedFiles > limits.maxFiles) {
    failure("MANIFEST_INVALID", "manifest 파일 합계가 일치하지 않습니다.");
  }
}

/** Fully authenticates a bounded package before returning any restore payload. */
export async function importStudioV12RecoveryPackage(
  source: StudioPackageArchiveSource,
  options: StudioV12RecoveryPackageOptions = {},
): Promise<ImportStudioV12RecoveryPackageResult> {
  throwIfAborted(options.signal);
  const limits = resolveLimits(options.limits);
  const digest = requireDigest(options.digest);
  const reader = createZipReader(source, limits);
  const entries = await parseZipEntries(reader, limits, options.signal);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const manifestEntry = byPath.get("manifest.json");
  if (!manifestEntry) failure("MANIFEST_MISSING", "manifest.json이 없습니다.");
  if (manifestEntry.uncompressedBytes > limits.maxManifestBytes) {
    failure("LIMIT_EXCEEDED", "manifest 크기가 안전 한도를 넘었습니다.");
  }
  const manifestBytes = await readVerifiedZipEntry(reader, manifestEntry, options.signal);
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(fatalTextDecoder.decode(manifestBytes)) as unknown;
  } catch (cause) {
    failure("MANIFEST_INVALID", "manifest JSON을 해석하지 못했습니다.", { cause });
  }
  if (
    manifestRaw &&
    typeof manifestRaw === "object" &&
    "schema" in manifestRaw &&
    (manifestRaw as { schema?: unknown }).schema === STUDIO_V12_RECOVERY_PACKAGE_SCHEMA &&
    (manifestRaw as { version?: unknown }).version !== STUDIO_V12_RECOVERY_PACKAGE_VERSION
  ) {
    failure("UNKNOWN_VERSION", "지원하지 않는 복구 패키지 version입니다.");
  }
  const manifest = parseCanonicalJson(
    manifestBytes,
    RecoveryPackageManifestSchema,
    "MANIFEST_INVALID",
    "manifest",
  );
  assertSortedUniqueManifest(manifest, limits);
  const expectedPaths = new Set<string>([
    "manifest.json",
    manifest.journalTail.path,
    ...(manifest.snapshot ? [manifest.snapshot.path] : []),
    ...manifest.attachments.map((attachment) => attachment.path),
  ]);
  for (const path of expectedPaths) {
    if (!byPath.has(path)) failure("MISSING_ENTRY", "manifest가 선언한 파일이 없습니다.", { path });
  }
  for (const path of byPath.keys()) {
    if (!expectedPaths.has(path)) {
      failure("UNEXPECTED_ENTRY", "manifest에 없는 파일이 포함돼 있습니다.", { path });
    }
  }

  const snapshotBytes = manifest.snapshot
    ? await readVerifiedZipEntry(reader, byPath.get(manifest.snapshot.path)!, options.signal)
    : null;
  const journalBytes = await readVerifiedZipEntry(
    reader,
    byPath.get(manifest.journalTail.path)!,
    options.signal,
  );
  if (snapshotBytes && snapshotBytes.byteLength > limits.maxSnapshotBytes) {
    failure("LIMIT_EXCEEDED", "snapshot 크기가 안전 한도를 넘었습니다.");
  }
  if (journalBytes.byteLength > limits.maxJournalBytes) {
    failure("LIMIT_EXCEEDED", "journal 크기가 안전 한도를 넘었습니다.");
  }
  const [snapshotHash, journalHash] = await Promise.all([
    snapshotBytes ? sha256(snapshotBytes, digest, options.signal) : Promise.resolve(null),
    sha256(journalBytes, digest, options.signal),
  ]);
  if (snapshotBytes && snapshotHash !== manifest.snapshot?.contentHash) {
    failure("HASH_MISMATCH", "snapshot SHA-256이 manifest와 다릅니다.", {
      path: manifest.snapshot?.path,
    });
  }
  if (journalHash !== manifest.journalTail.contentHash) {
    failure("HASH_MISMATCH", "journal SHA-256이 manifest와 다릅니다.", {
      path: manifest.journalTail.path,
    });
  }
  if (
    (snapshotBytes && snapshotBytes.byteLength !== manifest.snapshot?.byteSize) ||
    journalBytes.byteLength !== manifest.journalTail.byteSize
  ) {
    failure("MANIFEST_INVALID", "history byteSize가 manifest와 다릅니다.");
  }

  const snapshot = snapshotBytes
    ? parseCanonicalJson(
        snapshotBytes,
        snapshotIRSchema,
        "HISTORY_INVALID",
        "snapshot",
      )
    : null;
  const journalTail = parseCanonicalJson(
    journalBytes,
    z.array(journalEntryIRSchema),
    "HISTORY_INVALID",
    "journal tail",
  );
  if (journalTail.length > limits.maxJournalEntries) {
    failure("LIMIT_EXCEEDED", "journal entry 수가 안전 한도를 넘었습니다.");
  }
  if (
    snapshot?.slot !== manifest.snapshot?.slot ||
    snapshot?.seq !== manifest.snapshot?.seq ||
    (snapshot && (snapshot.projectDigest ?? projectDigest({
      scene: snapshot.scene,
      comic: snapshot.comic ?? null,
      animation: snapshot.animation ?? null,
      effects: snapshot.effects ?? null,
    })) !== manifest.snapshot?.projectDigest)
  ) {
    failure("HISTORY_INVALID", "snapshot identity가 manifest와 다릅니다.");
  }
  const expectedBase = snapshot?.seq ?? 0;
  const first = journalTail[0] ?? null;
  const last = journalTail.at(-1) ?? null;
  if (
    manifest.journalTail.baseSeq !== expectedBase ||
    manifest.journalTail.count !== journalTail.length ||
    manifest.journalTail.firstSeq !== (first?.seq ?? null) ||
    manifest.journalTail.lastSeq !== (last?.seq ?? null)
  ) {
    failure("HISTORY_INVALID", "journal tail 범위가 manifest와 다릅니다.");
  }

  const memoryStore: JournalStore = {
    append: () => Promise.reject(new Error("read-only imported history")),
    readEntries: () => Promise.resolve(journalTail.map((entry) => structuredClone(entry))),
    writeSnapshot: () => Promise.reject(new Error("read-only imported history")),
    readSnapshots: () => Promise.resolve(snapshot ? [structuredClone(snapshot)] : []),
  };
  const recovered = await recoverProject(memoryStore);
  if (
    recovered.project === null ||
    recovered.report.issues.length > 0 ||
    recovered.report.truncatedFromSeq !== null ||
    recovered.seq !== manifest.recovered.seq ||
    projectDigest(recovered.project) !== manifest.recovered.projectDigest
  ) {
    failure(
      "HISTORY_INVALID",
      `history recovery integrity gate가 실패했습니다: ${recovered.report.issues.join("; ")}`,
    );
  }

  const attachments: StudioV12RecoveryImportedAttachment[] = [];
  let attachmentBytes = 0;
  for (let index = 0; index < manifest.attachments.length; index += 1) {
    throwIfAborted(options.signal);
    const metadata = manifest.attachments[index]!;
    const entry = byPath.get(metadata.path)!;
    if (entry.uncompressedBytes !== metadata.byteSize) {
      failure("MANIFEST_INVALID", "attachment byteSize가 manifest와 다릅니다.", {
        path: metadata.path,
      });
    }
    const bytes = await readVerifiedZipEntry(reader, entry, options.signal);
    const contentHash = await sha256(bytes, digest, options.signal);
    if (contentHash !== metadata.contentHash) {
      failure("HASH_MISMATCH", "attachment SHA-256이 manifest와 다릅니다.", {
        path: metadata.path,
      });
    }
    attachmentBytes += bytes.byteLength;
    attachments.push({
      contentHash,
      bytes,
      mimeType: metadata.mimeType,
      rights: metadata.rights,
      metadata: metadata.metadata,
    });
    options.onProgress?.({
      phase: "attachments",
      completed: index + 1,
      total: manifest.attachments.length,
    });
  }
  const payloadBytes =
    journalBytes.byteLength + (snapshotBytes?.byteLength ?? 0) + attachmentBytes;
  if (
    attachmentBytes !== manifest.totals.attachmentBytes ||
    payloadBytes !== manifest.totals.payloadBytes
  ) {
    failure("MANIFEST_INVALID", "manifest payload 합계가 실제 bytes와 다릅니다.");
  }

  return {
    manifest,
    snapshot,
    journalTail,
    attachments,
    recoveredProject: recovered.project,
    recovery: recovered.report,
  };
}

/**
 * Restores a fully authenticated import into an empty history target. Attachment CAS writes happen
 * first; partial CAS writes are harmless content-addressed blobs. JournalStore has no transaction
 * surface, so history writes remain prefix-recoverable rather than falsely claiming atomicity.
 */
export async function restoreStudioV12RecoveryPackage(
  imported: ImportStudioV12RecoveryPackageResult,
  options: RestoreStudioV12RecoveryPackageOptions,
): Promise<{ project: ProjectStateIR; seq: number; recovery: RecoveryReport }> {
  throwIfAborted(options.signal);
  const [entries, snapshots] = await Promise.all([
    options.history.readEntries(),
    options.history.readSnapshots(),
  ]);
  if (entries.length > 0 || snapshots.length > 0) {
    failure("DESTINATION_NOT_EMPTY", "복구 대상 history는 비어 있어야 합니다.");
  }
  if (options.attachments) {
    for (const attachment of imported.attachments) {
      throwIfAborted(options.signal);
      let restoredHash: string;
      try {
        restoredHash = await options.attachments.put(attachment, {
          signal: options.signal,
        });
      } catch (cause) {
        if ((cause as { name?: unknown })?.name === "AbortError") throw cause;
        failure("ATTACHMENT_REJECTED", "attachment CAS 복원이 실패했습니다.", { cause });
      }
      if (restoredHash !== attachment.contentHash) {
        failure("ATTACHMENT_REJECTED", "attachment target이 다른 content hash를 반환했습니다.");
      }
    }
  }
  try {
    throwIfAborted(options.signal);
    if (imported.snapshot) await options.history.writeSnapshot(imported.snapshot);
    for (const entry of imported.journalTail) {
      throwIfAborted(options.signal);
      await options.history.append(entry);
    }
  } catch (cause) {
    if ((cause as { name?: unknown })?.name === "AbortError") throw cause;
    failure(
      "RESTORE_FAILED",
      "history 복원이 중단됐습니다. 저장된 prefix는 기존 recovery 계약으로 검사해야 합니다.",
      { cause },
    );
  }
  const recovered = await recoverProject(options.history);
  if (
    recovered.project === null ||
    recovered.seq !== imported.manifest.recovered.seq ||
    projectDigest(recovered.project) !== imported.manifest.recovered.projectDigest ||
    recovered.report.issues.length > 0
  ) {
    failure("RESTORE_FAILED", "복원 후 recovery digest/seq가 manifest와 다릅니다.");
  }
  return { project: recovered.project, seq: recovered.seq, recovery: recovered.report };
}

/** Adapts the existing OPFS content-address store without inventing another asset store. */
export function createStudioV12RecoveryOpfsAttachmentTarget(
  store: Pick<StudioOpfsAssetStore, "put">,
): StudioV12RecoveryAttachmentTarget {
  return {
    async put(attachment, options) {
      throwIfAborted(options.signal);
      const result = await store.put(attachment.bytes, { mime: attachment.mimeType });
      throwIfAborted(options.signal);
      return result.ref.hash;
    },
  };
}

/** Explicit local-file outbox helper. The caller owns picker/download UX. */
export async function saveStudioV12RecoveryPackage(
  port: StudioV12RecoveryPackageExportFilePort,
  suggestedName: string,
  built: BuildStudioV12RecoveryPackageResult,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const safeName = suggestedName.normalize("NFC").trim();
  if (
    safeName.length > 180 ||
    safeName.includes("/") ||
    safeName.includes("\\") ||
    hasUnsafeTextCharacter(safeName, false) ||
    !safeName.endsWith(".toonrecovery.zip")
  ) {
    failure("INVALID_INPUT", "복구 파일 이름은 .toonrecovery.zip으로 끝나야 합니다.");
  }
  await port.save(
    {
      suggestedName: safeName,
      mimeType: STUDIO_V12_RECOVERY_PACKAGE_MIME,
      bytes: built.bytes,
    },
    { signal },
  );
  throwIfAborted(signal);
}

/** Explicit local-file inbox helper. This function never performs network I/O. */
export async function openStudioV12RecoveryPackage(
  port: StudioV12RecoveryPackageImportFilePort,
  options: StudioV12RecoveryPackageOptions = {},
): Promise<ImportStudioV12RecoveryPackageResult> {
  throwIfAborted(options.signal);
  const source = await port.open({
    accept: STUDIO_V12_RECOVERY_PACKAGE_MIME,
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  return importStudioV12RecoveryPackage(source, options);
}
