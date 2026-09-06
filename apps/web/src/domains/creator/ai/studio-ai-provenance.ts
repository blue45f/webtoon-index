import { z } from "zod";

/**
 * Local, document-scoped provenance for Studio AI operations.
 *
 * Privacy boundary:
 * - Prompt text is represented by a SHA-256 digest and a content-free summary by default.
 * - Raw prompt retention requires an explicit opt-in at append/update and again at serialization.
 * - Imported documents are redacted by default, even when they contain legacy raw prompt fields.
 * - The public projection omits prompt digests, raw prompts, internal target/reference identifiers,
 *   provider request IDs, seeds, and provider-supplied error details.
 *
 * This module is pure and browser-safe. It performs no network, storage, or telemetry work.
 */

export const STUDIO_AI_PROVENANCE_VERSION = 1 as const;
export const STUDIO_AI_PROVENANCE_PUBLISH_VERSION = 1 as const;

export const STUDIO_AI_PROVENANCE_LIMITS = {
  maxOperations: 500,
  maxImportCandidates: 2_000,
  maxSerializedBytes: 1_500_000,
  maxIdCodeUnits: 120,
  maxProviderCodeUnits: 120,
  maxModelCodeUnits: 180,
  maxRequestIdCodeUnits: 240,
  maxSeedCodeUnits: 120,
  maxErrorCodeCodeUnits: 100,
  maxPromptCodeUnits: 65_536,
  maxReferencesPerOperation: 24,
  maxDimension: 16_384,
  maxTokenCount: 1_000_000_000,
} as const;

export const STUDIO_AI_OPERATION_KINDS = ["text", "image"] as const;
export const STUDIO_AI_OPERATION_TRANSPORTS = ["server", "byok", "local", "other"] as const;
export const STUDIO_AI_OPERATION_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const STUDIO_AI_OPERATION_ERROR_CATEGORIES = [
  "configuration",
  "network",
  "provider",
  "policy",
  "cancelled",
  "unknown",
] as const;
export const STUDIO_AI_OPERATION_TASKS = [
  "composition",
  "scenario",
  "translation",
  "dialogue",
  "palette",
  "text-other",
  "background-image",
  "character-image",
  "image-edit",
  "colorize",
  "line-cleanup",
  "image-other",
] as const;

export type StudioAiOperationKind = (typeof STUDIO_AI_OPERATION_KINDS)[number];
export type StudioAiOperationTransport = (typeof STUDIO_AI_OPERATION_TRANSPORTS)[number];
export type StudioAiOperationStatus = (typeof STUDIO_AI_OPERATION_STATUSES)[number];
export type StudioAiOperationErrorCategory =
  (typeof STUDIO_AI_OPERATION_ERROR_CATEGORIES)[number];
export type StudioAiOperationTask = (typeof STUDIO_AI_OPERATION_TASKS)[number];

const TEXT_TASKS = new Set<StudioAiOperationTask>([
  "composition",
  "scenario",
  "translation",
  "dialogue",
  "palette",
  "text-other",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TEXT_ENCODER = new TextEncoder();

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Standards-compliant, synchronous SHA-256 over UTF-8 text. */
export function sha256StudioAiProvenanceText(value: string): string {
  const bytes = TEXT_ENCODER.encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = paddedView.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(schedule[index - 15], 7)
        ^ rotateRight(schedule[index - 15], 18)
        ^ (schedule[index - 15] >>> 3);
      const s1 = rotateRight(schedule[index - 2], 17)
        ^ rotateRight(schedule[index - 2], 19)
        ^ (schedule[index - 2] >>> 10);
      schedule[index] = (
        schedule[index - 16] + s0 + schedule[index - 7] + s1
      ) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_ROUND_CONSTANTS[index] + schedule[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripUnsafeControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      continue;
    }
    result += character;
  }
  return result;
}

function normalizeText(value: unknown, maxCodeUnits: number): string {
  if (typeof value !== "string") return "";
  return stripUnsafeControlCharacters(value).trim().slice(0, maxCodeUnits);
}

function normalizeId(value: unknown): string | null {
  const id = normalizeText(value, STUDIO_AI_PROVENANCE_LIMITS.maxIdCodeUnits);
  return id || null;
}

function normalizeCanonicalTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value !== "string" || value.length > 80 || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function firstValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function promptSummary(kind: StudioAiOperationKind, characterCount?: number): string {
  const label = kind === "image" ? "이미지 AI 프롬프트" : "텍스트 AI 프롬프트";
  return characterCount === undefined
    ? `${label} · 내용 비공개`
    : `${label} · 내용 비공개 · ${characterCount}자`;
}

const IdSchema = z.string().trim().min(1).max(STUDIO_AI_PROVENANCE_LIMITS.maxIdCodeUnits);
const TimestampSchema = z.string().refine(
  (value) => normalizeCanonicalTimestamp(value) === value,
  "UTC ISO timestamp required"
);
const Sha256Schema = z.string().regex(SHA256_PATTERN);
const BoundedPositiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(STUDIO_AI_PROVENANCE_LIMITS.maxDimension);
const TokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(STUDIO_AI_PROVENANCE_LIMITS.maxTokenCount);

export const StudioAiPromptProvenanceSchema = z
  .object({
    sha256: Sha256Schema,
    summary: z.string().min(1).max(100),
    characterCount: z.number().int().nonnegative().max(STUDIO_AI_PROVENANCE_LIMITS.maxPromptCodeUnits).optional(),
    retention: z.enum(["hash-only", "raw-opt-in"]),
    raw: z.string().max(STUDIO_AI_PROVENANCE_LIMITS.maxPromptCodeUnits).optional(),
  })
  .strict()
  .superRefine((prompt, context) => {
    if (prompt.retention === "raw-opt-in" && prompt.raw === undefined) {
      context.addIssue({ code: "custom", message: "raw-opt-in retention requires raw text", path: ["raw"] });
    }
    if (prompt.retention === "hash-only" && prompt.raw !== undefined) {
      context.addIssue({ code: "custom", message: "hash-only retention cannot contain raw text", path: ["raw"] });
    }
    if (prompt.raw !== undefined && sha256StudioAiProvenanceText(prompt.raw) !== prompt.sha256) {
      context.addIssue({ code: "custom", message: "raw text must match its SHA-256 digest", path: ["sha256"] });
    }
    if (prompt.raw !== undefined && prompt.characterCount !== prompt.raw.length) {
      context.addIssue({ code: "custom", message: "raw text length does not match characterCount", path: ["characterCount"] });
    }
  });

export type StudioAiPromptProvenance = z.infer<typeof StudioAiPromptProvenanceSchema>;

export const StudioAiOperationUsageSchema = z
  .object({
    promptTokens: TokenCountSchema.optional(),
    completionTokens: TokenCountSchema.optional(),
    totalTokens: TokenCountSchema.optional(),
  })
  .strict()
  .refine((usage) => Object.values(usage).some((value) => value !== undefined), {
    message: "usage requires at least one token count",
  });

export type StudioAiOperationUsage = z.infer<typeof StudioAiOperationUsageSchema>;

export const StudioAiOperationTargetSchema = z
  .object({
    pageId: IdSchema,
    frameId: IdSchema.optional(),
    elementId: IdSchema.optional(),
  })
  .strict();

export type StudioAiOperationTarget = z.infer<typeof StudioAiOperationTargetSchema>;

export const StudioAiRequestedSizeSchema = z
  .object({
    width: BoundedPositiveIntegerSchema,
    height: BoundedPositiveIntegerSchema,
  })
  .strict();

export type StudioAiRequestedSize = z.infer<typeof StudioAiRequestedSizeSchema>;

export const StudioAiReferenceAssetSchema = z
  .object({
    assetId: IdSchema.optional(),
    sha256: Sha256Schema.optional(),
  })
  .strict()
  .refine((reference) => Boolean(reference.assetId || reference.sha256), {
    message: "a reference requires an asset ID or SHA-256 digest",
  });

export type StudioAiReferenceAsset = z.infer<typeof StudioAiReferenceAssetSchema>;

const ERROR_MESSAGES: Record<StudioAiOperationErrorCategory, string> = {
  configuration: "AI 설정을 확인해야 합니다.",
  network: "AI 네트워크 요청이 완료되지 않았습니다.",
  provider: "AI 제공자 요청이 실패했습니다.",
  policy: "AI 안전 또는 정책 검토가 필요합니다.",
  cancelled: "AI 작업이 취소되었습니다.",
  unknown: "AI 작업이 완료되지 않았습니다.",
};

export const StudioAiOperationErrorSchema = z
  .object({
    category: z.enum(STUDIO_AI_OPERATION_ERROR_CATEGORIES),
    code: z.string().trim().min(1).max(STUDIO_AI_PROVENANCE_LIMITS.maxErrorCodeCodeUnits),
    message: z.string().min(1).max(100),
    retriable: z.boolean(),
  })
  .strict()
  .superRefine((error, context) => {
    if (error.message !== ERROR_MESSAGES[error.category]) {
      context.addIssue({ code: "custom", message: "error message must be privacy-safe", path: ["message"] });
    }
  });

export type StudioAiOperationError = z.infer<typeof StudioAiOperationErrorSchema>;

export const StudioAiOperationSchema = z
  .object({
    id: IdSchema,
    kind: z.enum(STUDIO_AI_OPERATION_KINDS),
    task: z.enum(STUDIO_AI_OPERATION_TASKS),
    provider: z.string().trim().min(1).max(STUDIO_AI_PROVENANCE_LIMITS.maxProviderCodeUnits),
    model: z.string().trim().min(1).max(STUDIO_AI_PROVENANCE_LIMITS.maxModelCodeUnits),
    transport: z.enum(STUDIO_AI_OPERATION_TRANSPORTS),
    promptVersion: z.number().int().positive().max(1_000_000),
    prompt: StudioAiPromptProvenanceSchema,
    revisedPrompt: StudioAiPromptProvenanceSchema.optional(),
    status: z.enum(STUDIO_AI_OPERATION_STATUSES),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    usage: StudioAiOperationUsageSchema.optional(),
    target: StudioAiOperationTargetSchema.optional(),
    requestedSize: StudioAiRequestedSizeSchema.optional(),
    references: z.array(StudioAiReferenceAssetSchema).max(STUDIO_AI_PROVENANCE_LIMITS.maxReferencesPerOperation),
    seed: z.string().trim().min(1).max(STUDIO_AI_PROVENANCE_LIMITS.maxSeedCodeUnits).optional(),
    requestId: z.string().trim().min(1).max(STUDIO_AI_PROVENANCE_LIMITS.maxRequestIdCodeUnits).optional(),
    error: StudioAiOperationErrorSchema.optional(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (TEXT_TASKS.has(operation.task) !== (operation.kind === "text")) {
      context.addIssue({ code: "custom", message: "task and operation kind do not match", path: ["task"] });
    }
    if (operation.prompt.summary !== promptSummary(operation.kind, operation.prompt.characterCount)) {
      context.addIssue({ code: "custom", message: "prompt summary must be content-free", path: ["prompt", "summary"] });
    }
    if (
      operation.revisedPrompt
      && operation.revisedPrompt.summary !== promptSummary(operation.kind, operation.revisedPrompt.characterCount)
    ) {
      context.addIssue({ code: "custom", message: "revised prompt summary must be content-free", path: ["revisedPrompt", "summary"] });
    }
    if (Date.parse(operation.updatedAt) < Date.parse(operation.createdAt)) {
      context.addIssue({ code: "custom", message: "updatedAt must not precede createdAt", path: ["updatedAt"] });
    }
    if (operation.status === "failed" && !operation.error) {
      context.addIssue({ code: "custom", message: "failed operations require an error", path: ["error"] });
    }
    if ((operation.status === "pending" || operation.status === "succeeded") && operation.error) {
      context.addIssue({ code: "custom", message: "pending or successful operations cannot have an error", path: ["error"] });
    }
    const referenceKeys = new Set<string>();
    for (let index = 0; index < operation.references.length; index += 1) {
      const reference = operation.references[index];
      const key = `${reference.assetId ?? ""}\u0000${reference.sha256 ?? ""}`;
      if (referenceKeys.has(key)) {
        context.addIssue({ code: "custom", message: "duplicate reference", path: ["references", index] });
      }
      referenceKeys.add(key);
    }
  });

export type StudioAiOperation = z.infer<typeof StudioAiOperationSchema>;

export const StudioAiProvenanceDocumentSchema = z
  .object({
    version: z.literal(STUDIO_AI_PROVENANCE_VERSION),
    operations: z.array(StudioAiOperationSchema).max(STUDIO_AI_PROVENANCE_LIMITS.maxOperations),
  })
  .strict()
  .superRefine((document, context) => {
    const ids = new Set<string>();
    for (let index = 0; index < document.operations.length; index += 1) {
      const operation = document.operations[index];
      if (ids.has(operation.id)) {
        context.addIssue({ code: "custom", message: "operation IDs must be unique", path: ["operations", index, "id"] });
      }
      ids.add(operation.id);
      if (index > 0 && compareOperations(operation, document.operations[index - 1]) < 0) {
        context.addIssue({ code: "custom", message: "operations must use canonical order", path: ["operations", index] });
      }
    }
    if (serializedByteLength(document.operations) > STUDIO_AI_PROVENANCE_LIMITS.maxSerializedBytes) {
      context.addIssue({
        code: "custom",
        message: "provenance document exceeds its serialized byte limit",
        path: ["operations"],
      });
    }
  });

export type StudioAiProvenanceDocument = z.infer<typeof StudioAiProvenanceDocumentSchema>;

export interface StudioAiOperationErrorInput {
  category?: StudioAiOperationErrorCategory;
  code: string;
  retriable?: boolean;
}

export interface StudioAiOperationInput {
  id: string;
  kind: StudioAiOperationKind;
  task: StudioAiOperationTask;
  provider: string;
  model: string;
  transport: StudioAiOperationTransport;
  promptVersion: number;
  prompt: string;
  revisedPrompt?: string;
  status?: StudioAiOperationStatus;
  createdAt?: string | Date;
  usage?: StudioAiOperationUsage;
  target?: StudioAiOperationTarget;
  requestedSize?: StudioAiRequestedSize;
  references?: readonly StudioAiReferenceAsset[];
  seed?: string | number;
  requestId?: string;
  error?: StudioAiOperationErrorInput;
}

export interface StudioAiProvenancePrivacyOptions {
  /** Preserve only raw fields that were explicitly retained by their source operation. */
  retainRawPrompts?: boolean;
}

export interface AppendStudioAiOperationOptions {
  now?: Date;
  retainRawPrompt?: boolean;
  retainRawRevisedPrompt?: boolean;
}

export interface UpdateStudioAiOperationPatch {
  status?: StudioAiOperationStatus;
  provider?: string;
  model?: string;
  transport?: StudioAiOperationTransport;
  usage?: StudioAiOperationUsage | null;
  revisedPrompt?: string | null;
  target?: StudioAiOperationTarget | null;
  requestedSize?: StudioAiRequestedSize | null;
  references?: readonly StudioAiReferenceAsset[];
  seed?: string | number | null;
  requestId?: string | null;
  error?: StudioAiOperationErrorInput | null;
}

export interface UpdateStudioAiOperationOptions {
  now?: Date;
  retainRawRevisedPrompt?: boolean;
}

function operationKindForTask(task: StudioAiOperationTask): StudioAiOperationKind {
  return TEXT_TASKS.has(task) ? "text" : "image";
}

function normalizeKind(value: unknown, taskValue?: unknown): StudioAiOperationKind {
  if (value === "image" || value === "text") return value;
  if (STUDIO_AI_OPERATION_TASKS.includes(taskValue as StudioAiOperationTask)) {
    return operationKindForTask(taskValue as StudioAiOperationTask);
  }
  if (
    typeof taskValue === "string"
    && ["background", "character", "edit", "cleanup"].includes(taskValue.trim().toLowerCase())
  ) {
    return "image";
  }
  return "text";
}

function normalizeTask(value: unknown, kind: StudioAiOperationKind): StudioAiOperationTask {
  if (STUDIO_AI_OPERATION_TASKS.includes(value as StudioAiOperationTask)) {
    const task = value as StudioAiOperationTask;
    return operationKindForTask(task) === kind ? task : kind === "text" ? "text-other" : "image-other";
  }
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  const aliases: Record<string, StudioAiOperationTask> = {
    compose: "composition",
    storyboard: "scenario",
    translate: "translation",
    background: "background-image",
    character: "character-image",
    edit: "image-edit",
    cleanup: "line-cleanup",
  };
  const alias = aliases[normalized];
  return alias && operationKindForTask(alias) === kind
    ? alias
    : kind === "text" ? "text-other" : "image-other";
}

function normalizeTransport(value: unknown): StudioAiOperationTransport {
  if (STUDIO_AI_OPERATION_TRANSPORTS.includes(value as StudioAiOperationTransport)) {
    return value as StudioAiOperationTransport;
  }
  if (value === "backend" || value === "hosted") return "server";
  if (value === "browser" || value === "direct") return "byok";
  return "other";
}

function normalizeStatus(value: unknown): StudioAiOperationStatus {
  if (STUDIO_AI_OPERATION_STATUSES.includes(value as StudioAiOperationStatus)) {
    return value as StudioAiOperationStatus;
  }
  if (value === "complete" || value === "completed" || value === "success") return "succeeded";
  if (value === "error") return "failed";
  if (value === "canceled" || value === "aborted") return "cancelled";
  return "pending";
}

function normalizeErrorCategory(value: unknown): StudioAiOperationErrorCategory {
  return STUDIO_AI_OPERATION_ERROR_CATEGORIES.includes(value as StudioAiOperationErrorCategory)
    ? value as StudioAiOperationErrorCategory
    : "unknown";
}

function normalizeError(value: unknown): StudioAiOperationError | undefined {
  if (value === undefined || value === null) return undefined;
  const source = isRecord(value) ? value : {};
  const category = normalizeErrorCategory(firstValue(source, ["category", "type"]));
  const code = normalizeText(
    firstValue(source, ["code", "errorCode"]) ?? (typeof value === "string" ? value : "UNKNOWN"),
    STUDIO_AI_PROVENANCE_LIMITS.maxErrorCodeCodeUnits
  ) || "UNKNOWN";
  return {
    category,
    code,
    message: ERROR_MESSAGES[category],
    retriable: source.retriable === true || source.retryable === true,
  };
}

function normalizeUsage(value: unknown): StudioAiOperationUsage | undefined {
  if (!isRecord(value)) return undefined;
  const readCount = (keys: readonly string[]): number | undefined => {
    const candidate = firstValue(value, keys);
    return typeof candidate === "number"
      && Number.isInteger(candidate)
      && candidate >= 0
      && candidate <= STUDIO_AI_PROVENANCE_LIMITS.maxTokenCount
      ? candidate
      : undefined;
  };
  const usage = {
    promptTokens: readCount(["promptTokens", "prompt_tokens", "inputTokens", "input_tokens"]),
    completionTokens: readCount(["completionTokens", "completion_tokens", "outputTokens", "output_tokens"]),
    totalTokens: readCount(["totalTokens", "total_tokens"]),
  };
  return Object.values(usage).some((item) => item !== undefined) ? usage : undefined;
}

function normalizeTarget(value: unknown, fallback?: Record<string, unknown>): StudioAiOperationTarget | undefined {
  const source = isRecord(value) ? value : fallback;
  if (!source) return undefined;
  const pageId = normalizeId(firstValue(source, ["pageId", "page_id", "page"]));
  if (!pageId) return undefined;
  const frameId = normalizeId(firstValue(source, ["frameId", "panelId", "frame_id", "frame"]));
  const elementId = normalizeId(firstValue(source, ["elementId", "layerId", "element_id", "element"]));
  return {
    pageId,
    ...(frameId ? { frameId } : {}),
    ...(elementId ? { elementId } : {}),
  };
}

function normalizeRequestedSize(value: unknown): StudioAiRequestedSize | undefined {
  let width: unknown;
  let height: unknown;
  if (typeof value === "string") {
    const match = /^(\d{1,5})x(\d{1,5})$/u.exec(value.trim().toLowerCase());
    if (match) {
      width = Number(match[1]);
      height = Number(match[2]);
    }
  } else if (isRecord(value)) {
    width = firstValue(value, ["width", "w"]);
    height = firstValue(value, ["height", "h"]);
  }
  const parsed = StudioAiRequestedSizeSchema.safeParse({ width, height });
  return parsed.success ? parsed.data : undefined;
}

function normalizeSha256(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const digest = value.trim().toLowerCase();
  return SHA256_PATTERN.test(digest) ? digest : undefined;
}

function normalizeReferences(value: unknown, fallback?: Record<string, unknown>): StudioAiReferenceAsset[] {
  const scanLimit = STUDIO_AI_PROVENANCE_LIMITS.maxReferencesPerOperation * 4;
  const candidates: unknown[] = Array.isArray(value) ? value.slice(0, scanLimit) : [];
  if (fallback) {
    const assetIds = firstValue(fallback, ["referenceAssetIds", "assetIds"]);
    const digests = firstValue(fallback, ["referenceSha256Digests", "referenceHashes"]);
    if (Array.isArray(assetIds)) {
      candidates.push(...assetIds.slice(0, scanLimit).map((assetId) => ({ assetId })));
    }
    if (Array.isArray(digests)) {
      candidates.push(...digests.slice(0, scanLimit).map((sha256) => ({ sha256 })));
    }
  }
  const references: StudioAiReferenceAsset[] = [];
  const keys = new Set<string>();
  for (const candidate of candidates) {
    const source = isRecord(candidate) ? candidate : { assetId: candidate };
    const assetId = normalizeId(firstValue(source, ["assetId", "id", "asset_id"]));
    const sha256 = normalizeSha256(firstValue(source, ["sha256", "digest", "hash"]));
    if (!assetId && !sha256) continue;
    const reference: StudioAiReferenceAsset = {
      ...(assetId ? { assetId } : {}),
      ...(sha256 ? { sha256 } : {}),
    };
    const key = `${assetId ?? ""}\u0000${sha256 ?? ""}`;
    if (keys.has(key)) continue;
    keys.add(key);
    references.push(reference);
    if (references.length >= STUDIO_AI_PROVENANCE_LIMITS.maxReferencesPerOperation) break;
  }
  return references;
}

function buildPromptProvenance(
  raw: string,
  kind: StudioAiOperationKind,
  retainRaw: boolean
): StudioAiPromptProvenance {
  if (raw.length > STUDIO_AI_PROVENANCE_LIMITS.maxPromptCodeUnits) {
    throw new Error(`AI 프롬프트는 최대 ${STUDIO_AI_PROVENANCE_LIMITS.maxPromptCodeUnits}자까지 기록할 수 있어요.`);
  }
  const characterCount = raw.length;
  return {
    sha256: sha256StudioAiProvenanceText(raw),
    summary: promptSummary(kind, characterCount),
    characterCount,
    retention: retainRaw ? "raw-opt-in" : "hash-only",
    ...(retainRaw ? { raw } : {}),
  };
}

function normalizePrompt(
  value: unknown,
  kind: StudioAiOperationKind,
  retainRaw: boolean,
  fallback?: Record<string, unknown>,
  revised = false
): StudioAiPromptProvenance | null {
  const source = isRecord(value) ? value : undefined;
  const rawCandidate = typeof value === "string"
    ? value
    : firstValue(source ?? {}, ["raw", "text", "value"])
      ?? (fallback
        ? firstValue(
            fallback,
            revised ? ["rawRevisedPrompt", "revisedPromptText"] : ["rawPrompt", "promptText"]
          )
        : undefined);
  if (typeof rawCandidate === "string") {
    if (rawCandidate.length > STUDIO_AI_PROVENANCE_LIMITS.maxPromptCodeUnits) return null;
    return buildPromptProvenance(rawCandidate, kind, retainRaw);
  }
  const digest = normalizeSha256(
    firstValue(source ?? {}, ["sha256", "digest", "hash"])
      ?? (fallback
        ? firstValue(
            fallback,
            revised ? ["revisedPromptSha256", "revisedPromptHash"] : ["promptSha256", "promptHash"]
          )
        : undefined)
  );
  if (!digest) return null;
  const rawCount = firstValue(source ?? {}, ["characterCount", "length"]);
  const characterCount = typeof rawCount === "number"
    && Number.isInteger(rawCount)
    && rawCount >= 0
    && rawCount <= STUDIO_AI_PROVENANCE_LIMITS.maxPromptCodeUnits
    ? rawCount
    : undefined;
  return {
    sha256: digest,
    summary: promptSummary(kind, characterCount),
    ...(characterCount === undefined ? {} : { characterCount }),
    retention: "hash-only",
  };
}

function normalizeOperation(
  value: unknown,
  options: StudioAiProvenancePrivacyOptions
): StudioAiOperation | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(firstValue(value, ["id", "operationId", "operation_id"]));
  const rawTask = firstValue(value, ["task", "taskName", "operation"]);
  const kind = normalizeKind(firstValue(value, ["kind", "media", "mediaKind", "type"]), rawTask);
  const task = normalizeTask(rawTask, kind);
  const provider = normalizeText(
    firstValue(value, ["provider", "providerName"]),
    STUDIO_AI_PROVENANCE_LIMITS.maxProviderCodeUnits
  ) || "unknown";
  const model = normalizeText(
    firstValue(value, ["model", "modelName"]),
    STUDIO_AI_PROVENANCE_LIMITS.maxModelCodeUnits
  ) || "unknown";
  const promptVersionCandidate = firstValue(value, ["promptVersion", "prompt_version"]);
  const promptVersion = typeof promptVersionCandidate === "number"
    && Number.isInteger(promptVersionCandidate)
    && promptVersionCandidate > 0
    && promptVersionCandidate <= 1_000_000
    ? promptVersionCandidate
    : 1;
  const createdAt = normalizeCanonicalTimestamp(
    firstValue(value, ["createdAt", "created_at", "timestamp"])
  );
  if (!id || !createdAt) return null;
  const rawUpdatedAt = normalizeCanonicalTimestamp(
    firstValue(value, ["updatedAt", "updated_at", "completedAt", "completed_at"])
  ) ?? createdAt;
  const updatedAt = Date.parse(rawUpdatedAt) < Date.parse(createdAt) ? createdAt : rawUpdatedAt;
  const retainRaw = options.retainRawPrompts === true;
  const prompt = normalizePrompt(value.prompt, kind, retainRaw, value);
  if (!prompt) return null;
  const revisedValue = firstValue(value, ["revisedPrompt", "revised_prompt"]);
  const revisedPrompt = revisedValue === undefined
    ? undefined
    : normalizePrompt(revisedValue, kind, retainRaw, value, true) ?? undefined;
  const status = normalizeStatus(value.status);
  let error = normalizeError(firstValue(value, ["error", "failure"]));
  if (status === "failed" && !error) error = normalizeError({ code: "UNKNOWN" });
  if (status === "pending" || status === "succeeded") error = undefined;
  const seed = normalizeText(value.seed, STUDIO_AI_PROVENANCE_LIMITS.maxSeedCodeUnits);
  const requestId = normalizeText(
    firstValue(value, ["requestId", "request_id", "providerRequestId"]),
    STUDIO_AI_PROVENANCE_LIMITS.maxRequestIdCodeUnits
  );
  const usage = normalizeUsage(value.usage);
  const target = normalizeTarget(value.target, value);
  const requestedSize = normalizeRequestedSize(
    firstValue(value, ["requestedSize", "size", "dimensions"])
  );
  const operation: StudioAiOperation = {
    id,
    kind,
    task,
    provider,
    model,
    transport: normalizeTransport(value.transport),
    promptVersion,
    prompt,
    ...(revisedPrompt ? { revisedPrompt } : {}),
    status,
    createdAt,
    updatedAt,
    ...(usage ? { usage } : {}),
    ...(target ? { target } : {}),
    ...(requestedSize ? { requestedSize } : {}),
    references: normalizeReferences(firstValue(value, ["references", "referenceAssets"]), value),
    ...(seed ? { seed } : {}),
    ...(requestId ? { requestId } : {}),
    ...(error ? { error } : {}),
  };
  const parsed = StudioAiOperationSchema.safeParse(operation);
  if (!parsed.success) return null;
  return parsed.data;
}

/** Newest first, then stable ID order. */
function compareOperations(left: StudioAiOperation, right: StudioAiOperation): number {
  const createdDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (createdDifference !== 0) return createdDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function chooseDuplicate(left: StudioAiOperation, right: StudioAiOperation): StudioAiOperation {
  const updatedDifference = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  if (updatedDifference !== 0) return updatedDifference > 0 ? left : right;
  const leftCanonical = JSON.stringify(left);
  const rightCanonical = JSON.stringify(right);
  return leftCanonical >= rightCanonical ? left : right;
}

function serializedByteLength(operations: readonly StudioAiOperation[]): number {
  return TEXT_ENCODER.encode(JSON.stringify({ version: STUDIO_AI_PROVENANCE_VERSION, operations })).byteLength;
}

function canonicalizeOperations(candidates: readonly StudioAiOperation[]): StudioAiOperation[] {
  const byId = new Map<string, StudioAiOperation>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    byId.set(candidate.id, existing ? chooseDuplicate(existing, candidate) : candidate);
  }
  const sorted = [...byId.values()].sort(compareOperations);
  const bounded: StudioAiOperation[] = [];
  for (const operation of sorted) {
    if (bounded.length >= STUDIO_AI_PROVENANCE_LIMITS.maxOperations) break;
    const next = [...bounded, operation];
    if (serializedByteLength(next) <= STUDIO_AI_PROVENANCE_LIMITS.maxSerializedBytes) {
      bounded.push(operation);
    }
  }
  return bounded;
}

function extractOperationCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  const operations = firstValue(value, ["operations", "entries", "items", "log"]);
  return Array.isArray(operations) ? operations : [];
}

export function createEmptyStudioAiProvenanceDocument(): StudioAiProvenanceDocument {
  return { version: STUDIO_AI_PROVENANCE_VERSION, operations: [] };
}

/**
 * Migrates v0 and conservative unversioned shapes. Explicit future/unknown versions are rejected.
 * Raw prompts are stripped unless `retainRawPrompts` is explicitly true.
 */
export function normalizeStudioAiProvenanceDocument(
  value: unknown,
  options: StudioAiProvenancePrivacyOptions = {}
): StudioAiProvenanceDocument {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return createEmptyStudioAiProvenanceDocument();
    }
  }
  if (isRecord(decoded) && Object.hasOwn(decoded, "version")) {
    if (decoded.version !== 0 && decoded.version !== STUDIO_AI_PROVENANCE_VERSION) {
      return createEmptyStudioAiProvenanceDocument();
    }
  }
  const candidates = extractOperationCandidates(decoded).slice(
    0,
    STUDIO_AI_PROVENANCE_LIMITS.maxImportCandidates
  );
  const operations = canonicalizeOperations(
    candidates.flatMap((candidate) => {
      const operation = normalizeOperation(candidate, options);
      return operation ? [operation] : [];
    })
  );
  return StudioAiProvenanceDocumentSchema.parse({
    version: STUDIO_AI_PROVENANCE_VERSION,
    operations,
  });
}

/** Default serialization is deliberately redacting. */
export function serializeStudioAiProvenanceDocument(
  value: unknown,
  options: StudioAiProvenancePrivacyOptions = {}
): string {
  return JSON.stringify(normalizeStudioAiProvenanceDocument(value, options));
}

function canonicalTimestamp(value: string | Date | undefined, fallback: Date): string {
  const timestamp = normalizeCanonicalTimestamp(value ?? fallback);
  if (!timestamp) throw new Error("AI 작업 시간이 올바르지 않아요.");
  return timestamp;
}

function assertCanonicalDocument(document: StudioAiProvenanceDocument): void {
  if (!StudioAiProvenanceDocumentSchema.safeParse(document).success) {
    throw new Error("AI 작업 이력 문서가 손상되었습니다. 먼저 데이터를 정규화해 주세요.");
  }
}

function canonicalRequiredText(value: unknown, maxCodeUnits: number, label: string): string {
  const text = normalizeText(value, maxCodeUnits);
  if (!text) throw new Error(`${label}을(를) 입력해 주세요.`);
  return text;
}

function canonicalSeed(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const seed = normalizeText(String(value), STUDIO_AI_PROVENANCE_LIMITS.maxSeedCodeUnits);
  if (!seed) throw new Error("AI 시드가 올바르지 않아요.");
  return seed;
}

function canonicalError(value: StudioAiOperationErrorInput | undefined): StudioAiOperationError | undefined {
  if (!value) return undefined;
  return normalizeError(value);
}

function canonicalizeInputOperation(
  input: StudioAiOperationInput,
  options: AppendStudioAiOperationOptions
): StudioAiOperation {
  const createdAt = canonicalTimestamp(input.createdAt, options.now ?? new Date());
  const kind = input.kind;
  if (operationKindForTask(input.task) !== kind) throw new Error("AI 작업 종류와 작업명이 일치하지 않아요.");
  const status = input.status ?? "succeeded";
  let error = canonicalError(input.error);
  if (status === "failed" && !error) throw new Error("실패한 AI 작업에는 오류 코드가 필요해요.");
  if (status === "pending" || status === "succeeded") error = undefined;
  const seed = canonicalSeed(input.seed);
  const operation: StudioAiOperation = {
    id: canonicalRequiredText(input.id, STUDIO_AI_PROVENANCE_LIMITS.maxIdCodeUnits, "AI 작업 ID"),
    kind,
    task: input.task,
    provider: canonicalRequiredText(input.provider, STUDIO_AI_PROVENANCE_LIMITS.maxProviderCodeUnits, "AI 제공자"),
    model: canonicalRequiredText(input.model, STUDIO_AI_PROVENANCE_LIMITS.maxModelCodeUnits, "AI 모델"),
    transport: input.transport,
    promptVersion: input.promptVersion,
    prompt: buildPromptProvenance(input.prompt, kind, options.retainRawPrompt === true),
    ...(input.revisedPrompt === undefined
      ? {}
      : { revisedPrompt: buildPromptProvenance(input.revisedPrompt, kind, options.retainRawRevisedPrompt === true) }),
    status,
    createdAt,
    updatedAt: createdAt,
    ...(input.usage ? { usage: input.usage } : {}),
    ...(input.target ? { target: input.target } : {}),
    ...(input.requestedSize ? { requestedSize: input.requestedSize } : {}),
    references: [...(input.references ?? [])],
    ...(seed ? { seed } : {}),
    ...(input.requestId
      ? { requestId: canonicalRequiredText(input.requestId, STUDIO_AI_PROVENANCE_LIMITS.maxRequestIdCodeUnits, "AI 요청 ID") }
      : {}),
    ...(error ? { error } : {}),
  };
  return StudioAiOperationSchema.parse(operation);
}

export function appendStudioAiOperation(
  document: StudioAiProvenanceDocument,
  input: StudioAiOperationInput,
  options: AppendStudioAiOperationOptions = {}
): StudioAiProvenanceDocument {
  assertCanonicalDocument(document);
  if (document.operations.some((operation) => operation.id === input.id.trim())) {
    throw new Error("이미 사용 중인 AI 작업 ID예요.");
  }
  const operation = canonicalizeInputOperation(input, options);
  const operations = canonicalizeOperations([...document.operations, operation]);
  if (!operations.some((candidate) => candidate.id === operation.id)) {
    throw new Error("AI 작업 이력 저장 한도를 초과했습니다.");
  }
  return { version: STUDIO_AI_PROVENANCE_VERSION, operations };
}

export function updateStudioAiOperation(
  document: StudioAiProvenanceDocument,
  operationId: string,
  patch: UpdateStudioAiOperationPatch,
  options: UpdateStudioAiOperationOptions = {}
): StudioAiProvenanceDocument {
  assertCanonicalDocument(document);
  const index = document.operations.findIndex((operation) => operation.id === operationId);
  if (index < 0) return document;
  const current = document.operations[index];
  const updatedAt = canonicalTimestamp(options.now, new Date());
  if (Date.parse(updatedAt) < Date.parse(current.createdAt) || Date.parse(updatedAt) < Date.parse(current.updatedAt)) {
    throw new Error("AI 작업 수정 시간은 이전 기록보다 빠를 수 없어요.");
  }
  const status = patch.status ?? current.status;
  let error = patch.error === undefined ? current.error : canonicalError(patch.error ?? undefined);
  if (status === "failed" && !error) throw new Error("실패한 AI 작업에는 오류 코드가 필요해요.");
  if (status === "pending" || status === "succeeded") error = undefined;
  const revisedPrompt = patch.revisedPrompt === undefined
    ? current.revisedPrompt
    : patch.revisedPrompt === null
      ? undefined
      : buildPromptProvenance(
          patch.revisedPrompt,
          current.kind,
          options.retainRawRevisedPrompt === true
        );
  const provider = patch.provider === undefined
    ? current.provider
    : canonicalRequiredText(patch.provider, STUDIO_AI_PROVENANCE_LIMITS.maxProviderCodeUnits, "AI 제공자");
  const model = patch.model === undefined
    ? current.model
    : canonicalRequiredText(patch.model, STUDIO_AI_PROVENANCE_LIMITS.maxModelCodeUnits, "AI 모델");
  const requestId = patch.requestId === undefined
    ? current.requestId
    : patch.requestId === null
      ? undefined
      : canonicalRequiredText(patch.requestId, STUDIO_AI_PROVENANCE_LIMITS.maxRequestIdCodeUnits, "AI 요청 ID");
  const seed = patch.seed === undefined ? current.seed : canonicalSeed(patch.seed);
  const next: StudioAiOperation = StudioAiOperationSchema.parse({
    ...current,
    provider,
    model,
    transport: patch.transport ?? current.transport,
    status,
    updatedAt,
    ...(patch.usage === undefined
      ? current.usage ? { usage: current.usage } : {}
      : patch.usage === null ? { usage: undefined } : { usage: patch.usage }),
    ...(revisedPrompt ? { revisedPrompt } : { revisedPrompt: undefined }),
    ...(patch.target === undefined
      ? current.target ? { target: current.target } : {}
      : patch.target === null ? { target: undefined } : { target: patch.target }),
    ...(patch.requestedSize === undefined
      ? current.requestedSize ? { requestedSize: current.requestedSize } : {}
      : patch.requestedSize === null ? { requestedSize: undefined } : { requestedSize: patch.requestedSize }),
    references: patch.references === undefined ? current.references : [...patch.references],
    ...(seed ? { seed } : { seed: undefined }),
    ...(requestId ? { requestId } : { requestId: undefined }),
    ...(error ? { error } : { error: undefined }),
  });
  const operations = [...document.operations];
  operations[index] = next;
  const bounded = canonicalizeOperations(operations);
  if (!bounded.some((operation) => operation.id === current.id)) {
    throw new Error("AI 작업 이력 저장 한도를 초과했습니다.");
  }
  return { version: STUDIO_AI_PROVENANCE_VERSION, operations: bounded };
}

export interface StudioAiPublishOperationProjection {
  sequence: number;
  kind: StudioAiOperationKind;
  task: StudioAiOperationTask;
  provider: string;
  model: string;
  transport: StudioAiOperationTransport;
  promptVersion: number;
  status: StudioAiOperationStatus;
  createdAt: string;
  usage?: StudioAiOperationUsage;
  requestedSize?: StudioAiRequestedSize;
  referenceCount: number;
  targetScopes: Array<"page" | "frame" | "element">;
  promptSummary: string;
  revisedPromptSummary?: string;
  error?: {
    category: StudioAiOperationErrorCategory;
    retriable: boolean;
  };
}

export interface StudioAiPublishProvenanceProjection {
  version: typeof STUDIO_AI_PROVENANCE_PUBLISH_VERSION;
  sourceDocumentVersion: typeof STUDIO_AI_PROVENANCE_VERSION;
  aiUsed: boolean;
  operationCount: number;
  byKind: Record<StudioAiOperationKind, number>;
  byStatus: Record<StudioAiOperationStatus, number>;
  providers: string[];
  models: string[];
  operations: StudioAiPublishOperationProjection[];
}

/**
 * Produces a deterministic public disclosure projection. It intentionally cannot reconstruct or
 * correlate private prompts, assets, document node IDs, or provider requests.
 */
export function projectStudioAiProvenanceForPublish(
  value: unknown
): StudioAiPublishProvenanceProjection {
  const document = normalizeStudioAiProvenanceDocument(value);
  const byKind: Record<StudioAiOperationKind, number> = { text: 0, image: 0 };
  const byStatus: Record<StudioAiOperationStatus, number> = {
    pending: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  const providers = new Set<string>();
  const models = new Set<string>();
  const operations = document.operations.map((operation, index): StudioAiPublishOperationProjection => {
    byKind[operation.kind] += 1;
    byStatus[operation.status] += 1;
    providers.add(operation.provider);
    models.add(operation.model);
    const targetScopes: Array<"page" | "frame" | "element"> = [];
    if (operation.target) targetScopes.push("page");
    if (operation.target?.frameId) targetScopes.push("frame");
    if (operation.target?.elementId) targetScopes.push("element");
    return {
      sequence: index + 1,
      kind: operation.kind,
      task: operation.task,
      provider: operation.provider,
      model: operation.model,
      transport: operation.transport,
      promptVersion: operation.promptVersion,
      status: operation.status,
      createdAt: operation.createdAt,
      ...(operation.usage ? { usage: operation.usage } : {}),
      ...(operation.requestedSize ? { requestedSize: operation.requestedSize } : {}),
      referenceCount: operation.references.length,
      targetScopes,
      promptSummary: operation.prompt.summary,
      ...(operation.revisedPrompt ? { revisedPromptSummary: operation.revisedPrompt.summary } : {}),
      ...(operation.error
        ? { error: { category: operation.error.category, retriable: operation.error.retriable } }
        : {}),
    };
  });
  return {
    version: STUDIO_AI_PROVENANCE_PUBLISH_VERSION,
    sourceDocumentVersion: STUDIO_AI_PROVENANCE_VERSION,
    aiUsed: operations.length > 0,
    operationCount: operations.length,
    byKind,
    byStatus,
    providers: [...providers].sort(),
    models: [...models].sort(),
    operations,
  };
}
