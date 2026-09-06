import { z } from "zod";

import { STUDIO_CHARACTER_BIBLE_MAX_ID_LENGTH } from "./studio-character-bible";
import { SFX_LIBRARY } from "./studio-sfx-presets";

/**
 * A local, deterministic writer-room document.
 *
 * This module stores planning structure and review suggestions only. It does not call AI, apply a
 * suggestion implicitly, or duplicate Character Bible records: characters are referenced by ID.
 */
export const STUDIO_WRITER_ROOM_VERSION = 1 as const;

export const STUDIO_WRITER_ROOM_STAGES = [
  "premise",
  "synopsis",
  "episode-outline",
  "beats",
  "scenes",
  "panel-plan",
  "dialogue-sfx",
] as const;

export type StudioWriterRoomStage = (typeof STUDIO_WRITER_ROOM_STAGES)[number];

export const STUDIO_WRITER_ROOM_LIMITS = {
  maxSerializedBytes: 2_000_000,
  maxIdLength: 120,
  /** @deprecated Reference totals are governed by canonical UTF-8 bytes. */
  maxCharacterRefs: Number.POSITIVE_INFINITY,
  /** @deprecated Reference totals are governed by canonical UTF-8 bytes. */
  maxReferenceIds: Number.POSITIVE_INFINITY,
  maxShortTextLength: 500,
  maxTextLength: 12_000,
  maxDialogueLength: 4_000,
  maxSfxTextLength: 160,
  maxRationaleLength: 4_000,
  maxProvenanceRefLength: 240,
  /** @deprecated Stage totals are governed by canonical UTF-8 bytes. */
  maxStageItems: Number.POSITIVE_INFINITY,
  /** @deprecated Dialogue totals are governed by canonical UTF-8 bytes. */
  maxDialogues: Number.POSITIVE_INFINITY,
  /** @deprecated SFX totals are governed by canonical UTF-8 bytes. */
  maxSfx: Number.POSITIVE_INFINITY,
  /** @deprecated Suggestion totals are governed by canonical UTF-8 bytes. */
  maxSuggestions: Number.POSITIVE_INFINITY,
  /** One explicit decision request is bounded independently from document authority. */
  maxDecisionBatch: 100,
  maxOrder: 1_000_000,
} as const;

const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const PROVENANCE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const BLOCKED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const SFX_PRESET_IDS = new Set(SFX_LIBRARY.map(({ id }) => id));
const TEXT_ENCODER = new TextEncoder();
const LEGACY_TIMESTAMP = "1970-01-01T00:00:00.000Z";

const SafeIdSchema = z
  .string()
  .min(1)
  .max(STUDIO_WRITER_ROOM_LIMITS.maxIdLength)
  .regex(SAFE_SEGMENT_PATTERN);
const CharacterIdSchema = z.string().min(1).max(STUDIO_CHARACTER_BIBLE_MAX_ID_LENGTH);
const CharacterIdsSchema = z.array(CharacterIdSchema);
const ReferenceIdsSchema = z.array(SafeIdSchema);
const ShortTextSchema = z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength);
const LongTextSchema = z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxTextLength);
const OrderSchema = z
  .number()
  .int()
  .min(0)
  .max(STUDIO_WRITER_ROOM_LIMITS.maxOrder);

export const StudioWriterRoomPremiseSchema = z
  .object({ text: LongTextSchema, characterIds: CharacterIdsSchema })
  .strict();
export const StudioWriterRoomSynopsisSchema = z
  .object({ text: LongTextSchema, characterIds: CharacterIdsSchema })
  .strict();
export const StudioWriterRoomEpisodeOutlineSchema = z
  .object({ title: ShortTextSchema, summary: LongTextSchema, characterIds: CharacterIdsSchema })
  .strict();

export const StudioWriterRoomBeatSchema = z
  .object({
    id: SafeIdSchema,
    order: OrderSchema,
    title: ShortTextSchema,
    summary: LongTextSchema,
    characterIds: CharacterIdsSchema,
  })
  .strict();

export const StudioWriterRoomSceneSchema = z
  .object({
    id: SafeIdSchema,
    order: OrderSchema,
    beatIds: ReferenceIdsSchema,
    heading: ShortTextSchema,
    summary: LongTextSchema,
    location: ShortTextSchema,
    time: ShortTextSchema,
    characterIds: CharacterIdsSchema,
  })
  .strict();

export const StudioWriterRoomPanelSchema = z
  .object({
    id: SafeIdSchema,
    order: OrderSchema,
    sceneId: z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxIdLength),
    shot: ShortTextSchema,
    action: LongTextSchema,
    characterIds: CharacterIdsSchema,
  })
  .strict();

export const StudioWriterRoomDialogueSchema = z
  .object({
    id: SafeIdSchema,
    order: OrderSchema,
    panelId: z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxIdLength),
    characterId: CharacterIdSchema.nullable(),
    text: z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxDialogueLength),
  })
  .strict();

export const STUDIO_WRITER_ROOM_SFX_EMPHASIS = ["quiet", "normal", "strong"] as const;
export const STUDIO_WRITER_ROOM_SFX_SCALES = ["small", "medium", "large"] as const;

export const StudioWriterRoomSfxStyleSchema = z
  .object({
    emphasis: z.enum(STUDIO_WRITER_ROOM_SFX_EMPHASIS),
    scale: z.enum(STUDIO_WRITER_ROOM_SFX_SCALES),
  })
  .strict();

export const StudioWriterRoomSfxSchema = z
  .object({
    id: SafeIdSchema,
    order: OrderSchema,
    panelId: z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxIdLength),
    presetId: z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxIdLength).nullable(),
    customText: z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxSfxTextLength),
    style: StudioWriterRoomSfxStyleSchema,
  })
  .strict();

export const StudioWriterRoomStagesSchema = z
  .object({
    premise: StudioWriterRoomPremiseSchema,
    synopsis: StudioWriterRoomSynopsisSchema,
    "episode-outline": StudioWriterRoomEpisodeOutlineSchema,
    beats: z
      .object({
        items: z.array(StudioWriterRoomBeatSchema),
      })
      .strict(),
    scenes: z
      .object({
        items: z.array(StudioWriterRoomSceneSchema),
      })
      .strict(),
    "panel-plan": z
      .object({
        items: z.array(StudioWriterRoomPanelSchema),
      })
      .strict(),
    "dialogue-sfx": z
      .object({
        dialogue: z.array(StudioWriterRoomDialogueSchema),
        sfx: z.array(StudioWriterRoomSfxSchema),
      })
      .strict(),
  })
  .strict();

export const StudioWriterRoomCompletionSchema = z
  .object({
    premise: z.boolean(),
    synopsis: z.boolean(),
    "episode-outline": z.boolean(),
    beats: z.boolean(),
    scenes: z.boolean(),
    "panel-plan": z.boolean(),
    "dialogue-sfx": z.boolean(),
  })
  .strict();

export const STUDIO_WRITER_ROOM_SUGGESTION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
] as const;
export type StudioWriterRoomSuggestionStatus =
  (typeof STUDIO_WRITER_ROOM_SUGGESTION_STATUSES)[number];

export const StudioWriterRoomSuggestionValueSchema = z.union([
  z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxTextLength),
  OrderSchema,
  z.boolean(),
  z.null(),
  z.array(CharacterIdSchema),
]);

export const StudioWriterRoomSuggestionSchema = z
  .object({
    id: SafeIdSchema,
    targetPath: z.string().min(1).max(500),
    currentValue: StudioWriterRoomSuggestionValueSchema,
    proposedValue: StudioWriterRoomSuggestionValueSchema,
    rationale: z.string().max(STUDIO_WRITER_ROOM_LIMITS.maxRationaleLength),
    status: z.enum(STUDIO_WRITER_ROOM_SUGGESTION_STATUSES),
    provenanceRef: z
      .string()
      .max(STUDIO_WRITER_ROOM_LIMITS.maxProvenanceRefLength)
      .optional(),
    createdAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().optional(),
  })
  .strict();

const StudioWriterRoomPreviousSuggestionStateSchema = z
  .object({
    id: SafeIdSchema,
    status: z.enum(STUDIO_WRITER_ROOM_SUGGESTION_STATUSES),
    resolvedAt: z.iso.datetime().optional(),
  })
  .strict();

const StudioWriterRoomPreviousTargetValueSchema = z
  .object({
    targetPath: z.string().min(1).max(500),
    value: StudioWriterRoomSuggestionValueSchema,
  })
  .strict();

export const StudioWriterRoomDecisionSchema = z
  .object({
    kind: z.enum(["accept", "reject"]),
    suggestionStates: z
      .array(StudioWriterRoomPreviousSuggestionStateSchema)
      .max(STUDIO_WRITER_ROOM_LIMITS.maxDecisionBatch),
    targetValues: z
      .array(StudioWriterRoomPreviousTargetValueSchema)
      .max(STUDIO_WRITER_ROOM_LIMITS.maxDecisionBatch),
    decidedAt: z.iso.datetime(),
  })
  .strict();

export const StudioWriterRoomDocumentSchema = z
  .object({
    version: z.literal(STUDIO_WRITER_ROOM_VERSION),
    stages: StudioWriterRoomStagesSchema,
    completion: StudioWriterRoomCompletionSchema,
    suggestions: z.array(StudioWriterRoomSuggestionSchema),
    lastDecision: StudioWriterRoomDecisionSchema.optional(),
  })
  .strict();

export type StudioWriterRoomPremise = z.infer<typeof StudioWriterRoomPremiseSchema>;
export type StudioWriterRoomSynopsis = z.infer<typeof StudioWriterRoomSynopsisSchema>;
export type StudioWriterRoomEpisodeOutline = z.infer<
  typeof StudioWriterRoomEpisodeOutlineSchema
>;
export type StudioWriterRoomBeat = z.infer<typeof StudioWriterRoomBeatSchema>;
export type StudioWriterRoomScene = z.infer<typeof StudioWriterRoomSceneSchema>;
export type StudioWriterRoomPanel = z.infer<typeof StudioWriterRoomPanelSchema>;
export type StudioWriterRoomDialogue = z.infer<typeof StudioWriterRoomDialogueSchema>;
export type StudioWriterRoomSfx = z.infer<typeof StudioWriterRoomSfxSchema>;
export type StudioWriterRoomStages = z.infer<typeof StudioWriterRoomStagesSchema>;
export type StudioWriterRoomCompletion = z.infer<typeof StudioWriterRoomCompletionSchema>;
export type StudioWriterRoomSuggestionValue = z.infer<
  typeof StudioWriterRoomSuggestionValueSchema
>;
export type StudioWriterRoomSuggestion = z.infer<typeof StudioWriterRoomSuggestionSchema>;
export type StudioWriterRoomDecision = z.infer<typeof StudioWriterRoomDecisionSchema>;
export type StudioWriterRoomDocument = z.infer<typeof StudioWriterRoomDocumentSchema>;

export type StudioWriterRoomAdmissionFailureReason =
  | "unsafe-or-unbounded-input"
  | "byte-budget-exceeded"
  | "invalid-document";

/**
 * Atomic admission result for a canonical Writer Room document. A rejected receipt always returns
 * the caller-supplied committed document by identity; no normalized prefix becomes authority.
 */
export type StudioWriterRoomDocumentAdmissionReceipt =
  | Readonly<{
      kind: "accepted";
      document: StudioWriterRoomDocument;
      serialized: string;
      serializedBytes: number;
      maximumSerializedBytes: typeof STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes;
    }>
  | Readonly<{
      kind: "rejected";
      reason: StudioWriterRoomAdmissionFailureReason;
      document: StudioWriterRoomDocument;
      serializedBytes: number | null;
      maximumSerializedBytes: typeof STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes;
    }>;

export class StudioWriterRoomCapacityError extends Error {
  readonly name = "StudioWriterRoomCapacityError";
  readonly code = "STUDIO_WRITER_ROOM_BYTE_BUDGET_EXCEEDED" as const;

  constructor() {
    super("Writer Room 문서가 canonical UTF-8 2,000,000바이트 저장 예산을 초과했어요.");
  }
}

export class StudioWriterRoomAdmissionError extends Error {
  readonly name = "StudioWriterRoomAdmissionError";
  readonly code = "STUDIO_WRITER_ROOM_UNSAFE_INPUT" as const;

  constructor() {
    super("Writer Room 입력에 접근자, sparse 배열, 순환 참조 또는 지원하지 않는 객체가 있어 안전하게 읽지 않았어요.");
  }
}

export interface StudioWriterRoomSuggestionInput {
  id: string;
  targetPath: string;
  proposedValue: unknown;
  rationale: string;
  provenanceRef?: string;
  createdAt: string;
}

export interface StudioWriterRoomProgress {
  completedStages: StudioWriterRoomStage[];
  incompleteStages: StudioWriterRoomStage[];
  completedCount: number;
  totalStages: typeof STUDIO_WRITER_ROOM_STAGES.length;
  percent: number;
  nextStage: StudioWriterRoomStage | null;
}

interface ParsedTargetPath {
  stage: StudioWriterRoomStage;
  collection?: "items" | "dialogue" | "sfx";
  itemId?: string;
  field: string;
}

const TARGET_FIELDS = {
  premise: new Set(["text", "characterIds"]),
  synopsis: new Set(["text", "characterIds"]),
  "episode-outline": new Set(["title", "summary", "characterIds"]),
  beats: new Set(["order", "title", "summary", "characterIds"]),
  scenes: new Set([
    "order",
    "beatIds",
    "heading",
    "summary",
    "location",
    "time",
    "characterIds",
  ]),
  "panel-plan": new Set(["order", "sceneId", "shot", "action", "characterIds"]),
  dialogue: new Set(["order", "panelId", "characterId", "text"]),
  sfx: new Set([
    "order",
    "panelId",
    "presetId",
    "customText",
    "style.emphasis",
    "style.scale",
  ]),
} as const;

const EMPTY_STAGES: StudioWriterRoomStages = {
  premise: { text: "", characterIds: [] },
  synopsis: { text: "", characterIds: [] },
  "episode-outline": { title: "", summary: "", characterIds: [] },
  beats: { items: [] },
  scenes: { items: [] },
  "panel-plan": { items: [] },
  "dialogue-sfx": { dialogue: [], sfx: [] },
};

const EMPTY_COMPLETION: StudioWriterRoomCompletion = {
  premise: false,
  synopsis: false,
  "episode-outline": false,
  beats: false,
  scenes: false,
  "panel-plan": false,
  "dialogue-sfx": false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ARRAY_INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

/**
 * Produces a getter-free JSON-data clone before tolerant migration reads a single caller-owned
 * property. Dense arrays, plain/null-prototype records and data properties are the only admitted
 * containers. The traversal budget is derived from the serialized byte authority rather than a
 * product item count.
 */
function cloneInspectableSource(root: unknown): unknown {
  const clones = new Map<object, unknown>();
  const ancestors = new Set<object>();
  let visitedContainers = 0;
  let visitedProperties = 0;

  const visit = (value: unknown): unknown => {
    if (
      value === null
      || value === undefined
      || typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
    ) {
      return value;
    }
    if (
      typeof value === "bigint"
      || typeof value === "function"
      || typeof value === "symbol"
    ) {
      throw new StudioWriterRoomAdmissionError();
    }

    const object = value as object;
    if (ancestors.has(object)) throw new StudioWriterRoomAdmissionError();
    const existing = clones.get(object);
    if (existing !== undefined) return existing;

    let array: boolean;
    let prototype: object | null;
    let ownKeys: readonly PropertyKey[];
    try {
      array = Array.isArray(object);
      prototype = Object.getPrototypeOf(object) as object | null;
      ownKeys = Reflect.ownKeys(object);
    } catch {
      throw new StudioWriterRoomAdmissionError();
    }

    visitedContainers += 1;
    visitedProperties += ownKeys.length;
    if (
      visitedContainers > STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes
      || visitedProperties > STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes
    ) {
      throw new StudioWriterRoomCapacityError();
    }

    if (array) {
      if (prototype !== Array.prototype) throw new StudioWriterRoomAdmissionError();
      let lengthDescriptor: PropertyDescriptor | undefined;
      try {
        lengthDescriptor = Object.getOwnPropertyDescriptor(object, "length");
      } catch {
        throw new StudioWriterRoomAdmissionError();
      }
      if (
        !lengthDescriptor
        || !("value" in lengthDescriptor)
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0
      ) {
        throw new StudioWriterRoomAdmissionError();
      }
      const length = lengthDescriptor.value as number;
      const minimumJsonBytes = length === 0 ? 2 : length * 2 + 1;
      if (minimumJsonBytes > STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes) {
        throw new StudioWriterRoomCapacityError();
      }
      if (
        ownKeys.length !== length + 1
        || ownKeys.some((key) => {
          if (key === "length") return false;
          if (typeof key !== "string" || !ARRAY_INDEX_PATTERN.test(key)) return true;
          const index = Number(key);
          return !Number.isSafeInteger(index) || index < 0 || index >= length;
        })
      ) {
        throw new StudioWriterRoomAdmissionError();
      }

      const result: unknown[] = [];
      clones.set(object, result);
      ancestors.add(object);
      try {
        for (let index = 0; index < length; index += 1) {
          let descriptor: PropertyDescriptor | undefined;
          try {
            descriptor = Object.getOwnPropertyDescriptor(object, String(index));
          } catch {
            throw new StudioWriterRoomAdmissionError();
          }
          if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
            throw new StudioWriterRoomAdmissionError();
          }
          result.push(visit(descriptor.value as unknown));
        }
      } finally {
        ancestors.delete(object);
      }
      return result;
    }

    if (prototype !== Object.prototype && prototype !== null) {
      throw new StudioWriterRoomAdmissionError();
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    clones.set(object, result);
    ancestors.add(object);
    try {
      for (const key of ownKeys) {
        if (typeof key !== "string" || BLOCKED_PATH_SEGMENTS.has(key)) {
          throw new StudioWriterRoomAdmissionError();
        }
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(object, key);
        } catch {
          throw new StudioWriterRoomAdmissionError();
        }
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
          throw new StudioWriterRoomAdmissionError();
        }
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: visit(descriptor.value as unknown),
        });
      }
    } finally {
      ancestors.delete(object);
    }
    return result;
  };

  try {
    return visit(root);
  } catch (cause) {
    if (
      cause instanceof StudioWriterRoomAdmissionError
      || cause instanceof StudioWriterRoomCapacityError
    ) {
      throw cause;
    }
    throw new StudioWriterRoomAdmissionError();
  }
}

function utf8Serialized(value: unknown): { serialized: string; bytes: number } {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new StudioWriterRoomAdmissionError();
  }
  const canonical = serialized ?? "null";
  return { serialized: canonical, bytes: TEXT_ENCODER.encode(canonical).byteLength };
}

function inspectSourceWithinByteBudget(value: unknown): unknown {
  const inspected = cloneInspectableSource(value);
  const { bytes } = utf8Serialized(inspected);
  if (bytes > STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes) {
    throw new StudioWriterRoomCapacityError();
  }
  return inspected;
}

function stripUnsafeControls(value: string): string {
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

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? stripUnsafeControls(value).trim().slice(0, maxLength)
    : "";
}

function normalizeSafeId(value: unknown): string | null {
  const id = normalizeText(value, STUDIO_WRITER_ROOM_LIMITS.maxIdLength);
  return SafeIdSchema.safeParse(id).success ? id : null;
}

function normalizeCharacterId(value: unknown): string | null {
  const id = normalizeText(value, STUDIO_CHARACTER_BIBLE_MAX_ID_LENGTH);
  return id ? id : null;
}

function normalizeReferenceId(value: unknown): string {
  return normalizeSafeId(value) ?? "";
}

function normalizeOrder(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(STUDIO_WRITER_ROOM_LIMITS.maxOrder, Math.trunc(numeric)));
}

function normalizeUniqueStrings(
  value: unknown,
  normalizeItem: (candidate: unknown) => string | null
): string[] {
  const candidates = Array.isArray(value) ? value : [];
  const result = new Set<string>();
  for (const candidate of candidates) {
    const item = normalizeItem(candidate);
    if (item) result.add(item);
  }
  return [...result].sort();
}

function normalizeCharacterIds(value: unknown): string[] {
  return normalizeUniqueStrings(value, normalizeCharacterId);
}

function normalizeReferenceIds(value: unknown): string[] {
  return normalizeUniqueStrings(value, normalizeSafeId);
}

function normalizeTimestamp(value: unknown, fallback = LEGACY_TIMESTAMP): string {
  if (typeof value !== "string") return fallback;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function operationTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("결정 시각은 유효한 ISO 날짜여야 해요.");
  return new Date(timestamp).toISOString();
}

function normalizeProvenanceRef(value: unknown): string | undefined {
  const normalized = normalizeText(value, STUDIO_WRITER_ROOM_LIMITS.maxProvenanceRefLength);
  if (!normalized || !PROVENANCE_REF_PATTERN.test(normalized)) return undefined;
  if (normalized.split(/[.:/]/u).some((segment) => BLOCKED_PATH_SEGMENTS.has(segment))) {
    return undefined;
  }
  return normalized;
}

function decodeSource(value: unknown): unknown | null {
  if (typeof value !== "string") return inspectSourceWithinByteBudget(value);
  if (TEXT_ENCODER.encode(value).byteLength > STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes) {
    throw new StudioWriterRoomCapacityError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  return inspectSourceWithinByteBudget(parsed);
}

function sortByOrderAndId<T extends { id: string; order: number }>(items: T[]): T[] {
  return items.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function normalizeItemArray<T>(
  value: unknown,
  normalizeItem: (candidate: unknown) => T | null,
  idOf: (item: T) => string,
  sort: (items: T[]) => T[]
): T[] {
  const candidates = Array.isArray(value) ? value : [];
  const ids = new Set<string>();
  const result: T[] = [];
  for (const candidate of candidates) {
    const item = normalizeItem(candidate);
    if (!item || ids.has(idOf(item))) continue;
    ids.add(idOf(item));
    result.push(item);
  }
  return sort(result);
}

function normalizeBeat(value: unknown): StudioWriterRoomBeat | null {
  if (!isRecord(value)) return null;
  const id = normalizeSafeId(value.id ?? value.beatId);
  if (!id) return null;
  return {
    id,
    order: normalizeOrder(value.order ?? value.index),
    title: normalizeText(value.title ?? value.name, STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength),
    summary: normalizeText(
      value.summary ?? value.description ?? value.text,
      STUDIO_WRITER_ROOM_LIMITS.maxTextLength
    ),
    characterIds: normalizeCharacterIds(value.characterIds ?? value.characters),
  };
}

function normalizeScene(value: unknown): StudioWriterRoomScene | null {
  if (!isRecord(value)) return null;
  const id = normalizeSafeId(value.id ?? value.sceneId);
  if (!id) return null;
  return {
    id,
    order: normalizeOrder(value.order ?? value.index),
    beatIds: normalizeReferenceIds(value.beatIds ?? value.beats),
    heading: normalizeText(value.heading ?? value.title, STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength),
    summary: normalizeText(
      value.summary ?? value.description ?? value.action,
      STUDIO_WRITER_ROOM_LIMITS.maxTextLength
    ),
    location: normalizeText(value.location, STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength),
    time: normalizeText(value.time ?? value.timeOfDay, STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength),
    characterIds: normalizeCharacterIds(value.characterIds ?? value.characters),
  };
}

function normalizePanel(value: unknown): StudioWriterRoomPanel | null {
  if (!isRecord(value)) return null;
  const id = normalizeSafeId(value.id ?? value.panelId);
  if (!id) return null;
  return {
    id,
    order: normalizeOrder(value.order ?? value.index),
    sceneId: normalizeReferenceId(value.sceneId),
    shot: normalizeText(value.shot ?? value.framing, STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength),
    action: normalizeText(
      value.action ?? value.description,
      STUDIO_WRITER_ROOM_LIMITS.maxTextLength
    ),
    characterIds: normalizeCharacterIds(value.characterIds ?? value.characters),
  };
}

function normalizeDialogue(value: unknown): StudioWriterRoomDialogue | null {
  if (!isRecord(value)) return null;
  const id = normalizeSafeId(value.id ?? value.dialogueId);
  if (!id) return null;
  return {
    id,
    order: normalizeOrder(value.order ?? value.index),
    panelId: normalizeReferenceId(value.panelId),
    characterId: normalizeCharacterId(value.characterId) ?? null,
    text: normalizeText(value.text ?? value.dialogue, STUDIO_WRITER_ROOM_LIMITS.maxDialogueLength),
  };
}

function normalizeSfx(value: unknown): StudioWriterRoomSfx | null {
  if (!isRecord(value)) return null;
  const id = normalizeSafeId(value.id ?? value.sfxId);
  if (!id) return null;
  const rawPresetId = normalizeText(value.presetId, STUDIO_WRITER_ROOM_LIMITS.maxIdLength);
  const presetId = SFX_PRESET_IDS.has(rawPresetId) ? rawPresetId : null;
  const customText = normalizeText(
    value.customText ?? value.text,
    STUDIO_WRITER_ROOM_LIMITS.maxSfxTextLength
  );
  if (!presetId && !customText) return null;
  const style = isRecord(value.style) ? value.style : value;
  const emphasis = STUDIO_WRITER_ROOM_SFX_EMPHASIS.includes(
    style.emphasis as (typeof STUDIO_WRITER_ROOM_SFX_EMPHASIS)[number]
  )
    ? (style.emphasis as (typeof STUDIO_WRITER_ROOM_SFX_EMPHASIS)[number])
    : "normal";
  const scale = STUDIO_WRITER_ROOM_SFX_SCALES.includes(
    style.scale as (typeof STUDIO_WRITER_ROOM_SFX_SCALES)[number]
  )
    ? (style.scale as (typeof STUDIO_WRITER_ROOM_SFX_SCALES)[number])
    : "medium";
  return {
    id,
    order: normalizeOrder(value.order ?? value.index),
    panelId: normalizeReferenceId(value.panelId),
    presetId,
    customText,
    style: { emphasis, scale },
  };
}

function stageRecord(source: Record<string, unknown>, key: string, legacyKey?: string): unknown {
  if (Object.hasOwn(source, key)) return source[key];
  return legacyKey && Object.hasOwn(source, legacyKey) ? source[legacyKey] : undefined;
}

function textStage(value: unknown): StudioWriterRoomPremise {
  if (typeof value === "string") return { text: normalizeText(value, STUDIO_WRITER_ROOM_LIMITS.maxTextLength), characterIds: [] };
  if (!isRecord(value)) return { text: "", characterIds: [] };
  return {
    text: normalizeText(value.text ?? value.content, STUDIO_WRITER_ROOM_LIMITS.maxTextLength),
    characterIds: normalizeCharacterIds(value.characterIds ?? value.characters),
  };
}

function normalizeStages(value: unknown): StudioWriterRoomStages {
  const root = isRecord(value) ? value : {};
  const stages = isRecord(root.stages) ? root.stages : root;
  const outlineValue = stageRecord(stages, "episode-outline", "episodeOutline");
  const outline = isRecord(outlineValue) ? outlineValue : {};
  const beatsValue = stageRecord(stages, "beats");
  const scenesValue = stageRecord(stages, "scenes");
  const panelValue = stageRecord(stages, "panel-plan", "panelPlan") ?? root.panels;
  const dialogueSfxValue = stageRecord(stages, "dialogue-sfx", "dialogueSfx");
  const beats = isRecord(beatsValue) ? beatsValue.items ?? beatsValue.beats : beatsValue;
  const scenes = isRecord(scenesValue) ? scenesValue.items ?? scenesValue.scenes : scenesValue;
  const panels = isRecord(panelValue) ? panelValue.items ?? panelValue.panels : panelValue;
  const dialogueSfx = isRecord(dialogueSfxValue) ? dialogueSfxValue : {};
  const dialogue = dialogueSfx.dialogue ?? dialogueSfx.dialogues ?? root.dialogue ?? root.dialogues;
  const sfx = dialogueSfx.sfx ?? root.sfx;

  return {
    premise: textStage(stageRecord(stages, "premise")),
    synopsis: textStage(stageRecord(stages, "synopsis")),
    "episode-outline": {
      title: normalizeText(outline.title ?? outline.episodeTitle, STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength),
      summary: normalizeText(
        outline.summary ?? outline.text ?? outline.content,
        STUDIO_WRITER_ROOM_LIMITS.maxTextLength
      ),
      characterIds: normalizeCharacterIds(outline.characterIds ?? outline.characters),
    },
    beats: {
      items: normalizeItemArray(
        beats,
        normalizeBeat,
        ({ id }) => id,
        sortByOrderAndId
      ),
    },
    scenes: {
      items: normalizeItemArray(
        scenes,
        normalizeScene,
        ({ id }) => id,
        sortByOrderAndId
      ),
    },
    "panel-plan": {
      items: normalizeItemArray(
        panels,
        normalizePanel,
        ({ id }) => id,
        sortByOrderAndId
      ),
    },
    "dialogue-sfx": {
      dialogue: normalizeItemArray(
        dialogue,
        normalizeDialogue,
        ({ id }) => id,
        sortByOrderAndId
      ),
      sfx: normalizeItemArray(
        sfx,
        normalizeSfx,
        ({ id }) => id,
        sortByOrderAndId
      ),
    },
  };
}

function normalizeCompletion(value: unknown): StudioWriterRoomCompletion {
  const root = isRecord(value) ? value : {};
  const completion = isRecord(root.completion) ? root.completion : {};
  const completedStages = new Set(
    Array.isArray(root.completedStages)
      ? root.completedStages.filter((stage): stage is StudioWriterRoomStage =>
          STUDIO_WRITER_ROOM_STAGES.includes(stage as StudioWriterRoomStage)
        )
      : []
  );
  const result = { ...EMPTY_COMPLETION };
  for (const stage of STUDIO_WRITER_ROOM_STAGES) {
    const camelStage = stage === "episode-outline"
      ? "episodeOutline"
      : stage === "panel-plan"
        ? "panelPlan"
        : stage === "dialogue-sfx"
          ? "dialogueSfx"
          : stage;
    result[stage] = completion[stage] === true || completion[camelStage] === true || completedStages.has(stage);
  }
  return result;
}

function parseTargetPath(value: unknown): ParsedTargetPath | null {
  if (typeof value !== "string" || value.length > 500) return null;
  const parts = value.split(".");
  if (parts.some((part) => !part || BLOCKED_PATH_SEGMENTS.has(part))) return null;
  if (parts[0] !== "stages") return null;
  const stage = parts[1] as StudioWriterRoomStage;
  if (!STUDIO_WRITER_ROOM_STAGES.includes(stage)) return null;

  if (stage === "premise" || stage === "synopsis" || stage === "episode-outline") {
    if (parts.length !== 3 || !TARGET_FIELDS[stage].has(parts[2])) return null;
    return { stage, field: parts[2] };
  }
  if (stage === "beats" || stage === "scenes" || stage === "panel-plan") {
    if (
      parts.length !== 5 ||
      parts[2] !== "items" ||
      !normalizeSafeId(parts[3]) ||
      !TARGET_FIELDS[stage].has(parts[4])
    ) {
      return null;
    }
    return { stage, collection: "items", itemId: parts[3], field: parts[4] };
  }
  if (stage !== "dialogue-sfx") return null;
  const collection = parts[2];
  if (collection !== "dialogue" && collection !== "sfx") return null;
  const isStyleField = collection === "sfx" && parts.length === 6 && parts[4] === "style";
  const field = isStyleField ? `style.${parts[5]}` : parts[4];
  if (
    (!isStyleField && parts.length !== 5) ||
    !normalizeSafeId(parts[3]) ||
    !TARGET_FIELDS[collection].has(field)
  ) {
    return null;
  }
  return { stage, collection, itemId: parts[3], field };
}

export function isStudioWriterRoomTargetPath(value: unknown): value is string {
  return parseTargetPath(value) !== null;
}

function cloneSuggestionValue(value: StudioWriterRoomSuggestionValue): StudioWriterRoomSuggestionValue {
  return Array.isArray(value) ? value.slice() : value;
}

function findTargetValue(
  document: StudioWriterRoomDocument,
  target: ParsedTargetPath
): StudioWriterRoomSuggestionValue | undefined {
  if (target.stage === "premise" || target.stage === "synopsis") {
    const content = document.stages[target.stage];
    return target.field === "characterIds" ? content.characterIds.slice() : content.text;
  }
  if (target.stage === "episode-outline") {
    const content = document.stages[target.stage];
    if (target.field === "characterIds") return content.characterIds.slice();
    return target.field === "title" ? content.title : content.summary;
  }
  const itemId = target.itemId;
  if (!itemId) return undefined;
  if (target.stage === "beats") {
    const item = document.stages.beats.items.find(({ id }) => id === itemId);
    if (!item) return undefined;
    if (target.field === "characterIds") return item.characterIds.slice();
    if (target.field === "order") return item.order;
    return target.field === "title" ? item.title : item.summary;
  }
  if (target.stage === "scenes") {
    const item = document.stages.scenes.items.find(({ id }) => id === itemId);
    if (!item) return undefined;
    if (target.field === "characterIds") return item.characterIds.slice();
    if (target.field === "beatIds") return item.beatIds.slice();
    if (target.field === "order") return item.order;
    if (target.field === "heading") return item.heading;
    if (target.field === "summary") return item.summary;
    if (target.field === "location") return item.location;
    return item.time;
  }
  if (target.stage === "panel-plan") {
    const item = document.stages["panel-plan"].items.find(({ id }) => id === itemId);
    if (!item) return undefined;
    if (target.field === "characterIds") return item.characterIds.slice();
    if (target.field === "order") return item.order;
    if (target.field === "sceneId") return item.sceneId;
    if (target.field === "shot") return item.shot;
    return item.action;
  }
  if (target.collection === "dialogue") {
    const item = document.stages["dialogue-sfx"].dialogue.find(({ id }) => id === itemId);
    if (!item) return undefined;
    if (target.field === "order") return item.order;
    if (target.field === "panelId") return item.panelId;
    if (target.field === "characterId") return item.characterId;
    return item.text;
  }
  const item = document.stages["dialogue-sfx"].sfx.find(({ id }) => id === itemId);
  if (!item) return undefined;
  if (target.field === "order") return item.order;
  if (target.field === "panelId") return item.panelId;
  if (target.field === "presetId") return item.presetId;
  if (target.field === "customText") return item.customText;
  if (target.field === "style.emphasis") return item.style.emphasis;
  return item.style.scale;
}

function coerceTargetValue(
  target: ParsedTargetPath,
  value: unknown
): StudioWriterRoomSuggestionValue | undefined {
  if (target.field === "order") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > STUDIO_WRITER_ROOM_LIMITS.maxOrder) return undefined;
    return value;
  }
  if (target.field === "characterIds") {
    if (!Array.isArray(value)) return undefined;
    return normalizeCharacterIds(value);
  }
  if (target.field === "beatIds") {
    if (!Array.isArray(value)) return undefined;
    return normalizeReferenceIds(value);
  }
  if (target.field === "characterId") {
    if (value === null) return null;
    return normalizeCharacterId(value) ?? undefined;
  }
  if (target.field === "presetId") {
    if (value === null) return null;
    const presetId = normalizeText(value, STUDIO_WRITER_ROOM_LIMITS.maxIdLength);
    return SFX_PRESET_IDS.has(presetId) ? presetId : undefined;
  }
  if (target.field === "style.emphasis") {
    return STUDIO_WRITER_ROOM_SFX_EMPHASIS.includes(
      value as (typeof STUDIO_WRITER_ROOM_SFX_EMPHASIS)[number]
    )
      ? (value as (typeof STUDIO_WRITER_ROOM_SFX_EMPHASIS)[number])
      : undefined;
  }
  if (target.field === "style.scale") {
    return STUDIO_WRITER_ROOM_SFX_SCALES.includes(
      value as (typeof STUDIO_WRITER_ROOM_SFX_SCALES)[number]
    )
      ? (value as (typeof STUDIO_WRITER_ROOM_SFX_SCALES)[number])
      : undefined;
  }
  if (typeof value !== "string") return undefined;
  const maximum = target.field === "customText"
    ? STUDIO_WRITER_ROOM_LIMITS.maxSfxTextLength
    : target.field === "text" && target.collection === "dialogue"
      ? STUDIO_WRITER_ROOM_LIMITS.maxDialogueLength
      : ["title", "heading", "location", "time", "shot"].includes(target.field)
        ? STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength
        : target.field.endsWith("Id")
          ? STUDIO_WRITER_ROOM_LIMITS.maxIdLength
          : STUDIO_WRITER_ROOM_LIMITS.maxTextLength;
  const normalized = normalizeText(value, maximum);
  if (target.field.endsWith("Id") && normalized && !normalizeSafeId(normalized)) return undefined;
  return normalized;
}

function replaceAllowlistedItemField<T extends object>(
  item: T,
  target: ParsedTargetPath,
  value: StudioWriterRoomSuggestionValue
): T {
  if (target.field === "style.emphasis" || target.field === "style.scale") {
    const sfx = item as T & StudioWriterRoomSfx;
    const styleField = target.field === "style.emphasis" ? "emphasis" : "scale";
    return { ...sfx, style: { ...sfx.style, [styleField]: value } };
  }
  // target.field has already passed the fixed grammar above; no caller-controlled key reaches here.
  return { ...item, [target.field]: cloneSuggestionValue(value) };
}

function applyTargetValue(
  document: StudioWriterRoomDocument,
  target: ParsedTargetPath,
  value: StudioWriterRoomSuggestionValue
): StudioWriterRoomDocument {
  if (target.stage === "premise" || target.stage === "synopsis" || target.stage === "episode-outline") {
    return StudioWriterRoomDocumentSchema.parse({
      ...document,
      stages: {
        ...document.stages,
        [target.stage]: {
          ...document.stages[target.stage],
          [target.field]: cloneSuggestionValue(value),
        },
      },
    });
  }
  const itemId = target.itemId;
  if (!itemId) return document;
  if (target.stage === "beats") {
    return StudioWriterRoomDocumentSchema.parse({
      ...document,
      stages: {
        ...document.stages,
        beats: {
          items: document.stages.beats.items.map((item) =>
            item.id === itemId ? replaceAllowlistedItemField(item, target, value) : item
          ),
        },
      },
    });
  }
  if (target.stage === "scenes") {
    return StudioWriterRoomDocumentSchema.parse({
      ...document,
      stages: {
        ...document.stages,
        scenes: {
          items: document.stages.scenes.items.map((item) =>
            item.id === itemId ? replaceAllowlistedItemField(item, target, value) : item
          ),
        },
      },
    });
  }
  if (target.stage === "panel-plan") {
    return StudioWriterRoomDocumentSchema.parse({
      ...document,
      stages: {
        ...document.stages,
        "panel-plan": {
          items: document.stages["panel-plan"].items.map((item) =>
            item.id === itemId ? replaceAllowlistedItemField(item, target, value) : item
          ),
        },
      },
    });
  }
  if (target.collection === "dialogue") {
    return StudioWriterRoomDocumentSchema.parse({
      ...document,
      stages: {
        ...document.stages,
        "dialogue-sfx": {
          ...document.stages["dialogue-sfx"],
          dialogue: document.stages["dialogue-sfx"].dialogue.map((item) =>
            item.id === itemId ? replaceAllowlistedItemField(item, target, value) : item
          ),
        },
      },
    });
  }
  return StudioWriterRoomDocumentSchema.parse({
    ...document,
    stages: {
      ...document.stages,
      "dialogue-sfx": {
        ...document.stages["dialogue-sfx"],
        sfx: document.stages["dialogue-sfx"].sfx.map((item) =>
          item.id === itemId ? replaceAllowlistedItemField(item, target, value) : item
        ),
      },
    },
  });
}

function valuesEqual(
  left: StudioWriterRoomSuggestionValue,
  right: StudioWriterRoomSuggestionValue
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeSuggestion(
  value: unknown,
  document: StudioWriterRoomDocument
): StudioWriterRoomSuggestion | null {
  if (!isRecord(value)) return null;
  const id = normalizeSafeId(value.id ?? value.suggestionId);
  const targetPath = normalizeText(value.targetPath ?? value.path, 500);
  const target = parseTargetPath(targetPath);
  if (!id || !target) return null;
  const actualValue = findTargetValue(document, target);
  if (actualValue === undefined) return null;
  const currentValue = coerceTargetValue(
    target,
    Object.hasOwn(value, "currentValue") ? value.currentValue : actualValue
  );
  const proposedValue = coerceTargetValue(
    target,
    value.proposedValue ?? value.proposal ?? value.value
  );
  if (currentValue === undefined || proposedValue === undefined) return null;
  const status = STUDIO_WRITER_ROOM_SUGGESTION_STATUSES.includes(
    value.status as StudioWriterRoomSuggestionStatus
  )
    ? (value.status as StudioWriterRoomSuggestionStatus)
    : "pending";
  const createdAt = normalizeTimestamp(value.createdAt);
  const resolvedAt = status === "pending"
    ? undefined
    : normalizeTimestamp(value.resolvedAt, createdAt);
  const provenanceRef = normalizeProvenanceRef(value.provenanceRef);
  return StudioWriterRoomSuggestionSchema.parse({
    id,
    targetPath,
    currentValue,
    proposedValue,
    rationale: normalizeText(
      value.rationale ?? value.reason,
      STUDIO_WRITER_ROOM_LIMITS.maxRationaleLength
    ),
    status,
    ...(provenanceRef ? { provenanceRef } : {}),
    createdAt,
    ...(resolvedAt ? { resolvedAt } : {}),
  });
}

function suggestionCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  return Array.isArray(value.suggestions)
    ? value.suggestions
    : Array.isArray(value.reviews)
      ? value.reviews
      : [];
}

function normalizeSuggestions(
  value: unknown,
  document: StudioWriterRoomDocument
): StudioWriterRoomSuggestion[] {
  const ids = new Set<string>();
  const result: StudioWriterRoomSuggestion[] = [];
  for (const candidate of suggestionCandidates(value)) {
    const suggestion = normalizeSuggestion(candidate, document);
    if (!suggestion || ids.has(suggestion.id)) continue;
    ids.add(suggestion.id);
    result.push(suggestion);
  }
  return result.sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );
}

function normalizeDecision(
  value: unknown,
  document: StudioWriterRoomDocument
): StudioWriterRoomDecision | undefined {
  if (!isRecord(value) || (value.kind !== "accept" && value.kind !== "reject")) return undefined;
  const decidedAt = normalizeTimestamp(value.decidedAt);
  const knownSuggestions = new Map(document.suggestions.map((suggestion) => [suggestion.id, suggestion]));
  const stateCandidates = Array.isArray(value.suggestionStates) ? value.suggestionStates : [];
  if (stateCandidates.length > STUDIO_WRITER_ROOM_LIMITS.maxDecisionBatch) {
    throw new StudioWriterRoomAdmissionError();
  }
  const stateIds = new Set<string>();
  const suggestionStates: StudioWriterRoomDecision["suggestionStates"] = [];
  for (const candidate of stateCandidates) {
    if (!isRecord(candidate)) continue;
    const id = normalizeSafeId(candidate.id);
    if (!id || !knownSuggestions.has(id) || stateIds.has(id)) continue;
    stateIds.add(id);
    const status = STUDIO_WRITER_ROOM_SUGGESTION_STATUSES.includes(
      candidate.status as StudioWriterRoomSuggestionStatus
    )
      ? (candidate.status as StudioWriterRoomSuggestionStatus)
      : "pending";
    const resolvedAt = typeof candidate.resolvedAt === "string"
      ? normalizeTimestamp(candidate.resolvedAt)
      : undefined;
    suggestionStates.push({ id, status, ...(resolvedAt ? { resolvedAt } : {}) });
  }
  if (suggestionStates.length === 0) return undefined;
  const targetCandidates = Array.isArray(value.targetValues) ? value.targetValues : [];
  if (targetCandidates.length > STUDIO_WRITER_ROOM_LIMITS.maxDecisionBatch) {
    throw new StudioWriterRoomAdmissionError();
  }
  const targetPaths = new Set<string>();
  const targetValues: StudioWriterRoomDecision["targetValues"] = [];
  for (const candidate of targetCandidates) {
    if (!isRecord(candidate)) continue;
    const targetPath = normalizeText(candidate.targetPath, 500);
    const target = parseTargetPath(targetPath);
    if (!target || targetPaths.has(targetPath) || findTargetValue(document, target) === undefined) continue;
    const normalizedValue = coerceTargetValue(target, candidate.value);
    if (normalizedValue === undefined) continue;
    targetPaths.add(targetPath);
    targetValues.push({ targetPath, value: normalizedValue });
  }
  if (value.kind === "accept" && targetValues.length === 0) return undefined;
  return StudioWriterRoomDecisionSchema.parse({
    kind: value.kind,
    suggestionStates,
    targetValues,
    decidedAt,
  });
}

function finalized(document: StudioWriterRoomDocument): StudioWriterRoomDocument {
  const parsed = StudioWriterRoomDocumentSchema.parse(document);
  const { bytes } = utf8Serialized(parsed);
  if (bytes > STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes) {
    throw new StudioWriterRoomCapacityError();
  }
  return parsed;
}

function retainedDocumentSerializedBytes(document: StudioWriterRoomDocument): number | null {
  try {
    const inspected = inspectSourceWithinByteBudget(document);
    const parsed = StudioWriterRoomDocumentSchema.safeParse(inspected);
    return parsed.success ? utf8Serialized(parsed.data).bytes : null;
  } catch {
    return null;
  }
}

function rejectedDocumentReceipt(
  document: StudioWriterRoomDocument,
  cause: unknown
): StudioWriterRoomDocumentAdmissionReceipt {
  const reason: StudioWriterRoomAdmissionFailureReason = cause instanceof StudioWriterRoomCapacityError
    ? "byte-budget-exceeded"
    : cause instanceof StudioWriterRoomAdmissionError
      ? "unsafe-or-unbounded-input"
      : "invalid-document";
  return Object.freeze({
    kind: "rejected",
    reason,
    document,
    serializedBytes: retainedDocumentSerializedBytes(document),
    maximumSerializedBytes: STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes,
  });
}

export function createEmptyStudioWriterRoomDocument(): StudioWriterRoomDocument {
  return {
    version: STUDIO_WRITER_ROOM_VERSION,
    stages: {
      ...EMPTY_STAGES,
      premise: { ...EMPTY_STAGES.premise, characterIds: [] },
      synopsis: { ...EMPTY_STAGES.synopsis, characterIds: [] },
      "episode-outline": { ...EMPTY_STAGES["episode-outline"], characterIds: [] },
      beats: { items: [] },
      scenes: { items: [] },
      "panel-plan": { items: [] },
      "dialogue-sfx": { dialogue: [], sfx: [] },
    },
    completion: { ...EMPTY_COMPLETION },
    suggestions: [],
  };
}

/**
 * Migrates current v1 and conservative unversioned aliases. Ordinary malformed JSON and explicit
 * future versions retain the legacy empty-document fallback. Unscannable, cyclic, sparse or
 * over-budget inputs throw typed errors so callers cannot mistake an empty/truncated value for
 * committed document authority.
 */
export function normalizeStudioWriterRoomDocument(value: unknown): StudioWriterRoomDocument {
  const decoded = decodeSource(value);
  if (!isRecord(decoded)) return createEmptyStudioWriterRoomDocument();
  if (typeof decoded.version === "number" && decoded.version > STUDIO_WRITER_ROOM_VERSION) {
    return createEmptyStudioWriterRoomDocument();
  }
  const stages = normalizeStages(decoded);
  const base: StudioWriterRoomDocument = {
    version: STUDIO_WRITER_ROOM_VERSION,
    stages,
    completion: normalizeCompletion(decoded),
    suggestions: [],
  };
  const suggestions = normalizeSuggestions(decoded, base);
  const withSuggestions: StudioWriterRoomDocument = { ...base, suggestions };
  const lastDecision = normalizeDecision(decoded.lastDecision, withSuggestions);
  const result = lastDecision ? { ...withSuggestions, lastDecision } : withSuggestions;
  return finalized(result);
}

/**
 * Atomically admits one complete Writer Room authority document by canonical UTF-8 bytes.
 * Rejection returns `retainedDocument` unchanged by identity and never exposes a normalized prefix.
 */
export function admitStudioWriterRoomDocument(
  value: unknown,
  retainedDocument: StudioWriterRoomDocument = createEmptyStudioWriterRoomDocument()
): StudioWriterRoomDocumentAdmissionReceipt {
  try {
    const document = normalizeStudioWriterRoomDocument(value);
    const { serialized, bytes: serializedBytes } = utf8Serialized(document);
    return Object.freeze({
      kind: "accepted",
      document,
      serialized,
      serializedBytes,
      maximumSerializedBytes: STUDIO_WRITER_ROOM_LIMITS.maxSerializedBytes,
    });
  } catch (cause) {
    return rejectedDocumentReceipt(retainedDocument, cause);
  }
}

export function serializeStudioWriterRoomDocument(value: unknown): string {
  return utf8Serialized(normalizeStudioWriterRoomDocument(value)).serialized;
}

/**
 * Atomically admits one stage edit. Byte/structure rejection retains the exact committed document
 * object so UI callers can report pressure without accidentally publishing a truncated draft.
 */
export function admitStudioWriterRoomStage(
  document: StudioWriterRoomDocument,
  stage: StudioWriterRoomStage,
  stageContent: unknown
): StudioWriterRoomDocumentAdmissionReceipt {
  if (!STUDIO_WRITER_ROOM_STAGES.includes(stage)) {
    return rejectedDocumentReceipt(document, new StudioWriterRoomAdmissionError());
  }
  const currentReceipt = admitStudioWriterRoomDocument(document, document);
  if (currentReceipt.kind === "rejected") return currentReceipt;
  try {
    const inspectedStageContent = inspectSourceWithinByteBudget(stageContent);
    const stages = normalizeStages({
      stages: { ...currentReceipt.document.stages, [stage]: inspectedStageContent },
    });
    return admitStudioWriterRoomDocument({
      ...currentReceipt.document,
      stages,
      lastDecision: undefined,
    }, document);
  } catch (cause) {
    return rejectedDocumentReceipt(document, cause);
  }
}

/**
 * @deprecated Compatibility-only document return. Product callers must consume
 * `admitStudioWriterRoomStage` so a rejected receipt and retained identity remain observable.
 */
export function replaceStudioWriterRoomStage(
  value: unknown,
  stage: StudioWriterRoomStage,
  stageContent: unknown
): StudioWriterRoomDocument {
  const document = normalizeStudioWriterRoomDocument(value);
  return admitStudioWriterRoomStage(document, stage, stageContent).document;
}

export function setStudioWriterRoomStageCompleted(
  value: unknown,
  stage: StudioWriterRoomStage,
  completed: boolean
): StudioWriterRoomDocument {
  if (!STUDIO_WRITER_ROOM_STAGES.includes(stage)) throw new Error("알 수 없는 Writer Room 단계예요.");
  const document = normalizeStudioWriterRoomDocument(value);
  return finalized({
    ...document,
    completion: { ...document.completion, [stage]: completed === true },
  });
}

export function computeStudioWriterRoomProgress(value: unknown): StudioWriterRoomProgress {
  const document = normalizeStudioWriterRoomDocument(value);
  const completedStages = STUDIO_WRITER_ROOM_STAGES.filter((stage) => document.completion[stage]);
  const incompleteStages = STUDIO_WRITER_ROOM_STAGES.filter((stage) => !document.completion[stage]);
  return {
    completedStages,
    incompleteStages,
    completedCount: completedStages.length,
    totalStages: STUDIO_WRITER_ROOM_STAGES.length,
    percent: Math.round((completedStages.length / STUDIO_WRITER_ROOM_STAGES.length) * 100),
    nextStage: incompleteStages[0] ?? null,
  };
}

export function studioWriterRoomHasContent(value: unknown): boolean {
  const document = normalizeStudioWriterRoomDocument(value);
  return (
    document.suggestions.length > 0 ||
    Object.values(document.completion).some(Boolean) ||
    document.stages.premise.text.length > 0 ||
    document.stages.premise.characterIds.length > 0 ||
    document.stages.synopsis.text.length > 0 ||
    document.stages.synopsis.characterIds.length > 0 ||
    document.stages["episode-outline"].title.length > 0 ||
    document.stages["episode-outline"].summary.length > 0 ||
    document.stages["episode-outline"].characterIds.length > 0 ||
    document.stages.beats.items.length > 0 ||
    document.stages.scenes.items.length > 0 ||
    document.stages["panel-plan"].items.length > 0 ||
    document.stages["dialogue-sfx"].dialogue.length > 0 ||
    document.stages["dialogue-sfx"].sfx.length > 0
  );
}

export function addStudioWriterRoomSuggestion(
  value: unknown,
  input: StudioWriterRoomSuggestionInput
): StudioWriterRoomDocument {
  const document = normalizeStudioWriterRoomDocument(value);
  const inspectedInput = inspectSourceWithinByteBudget(input);
  if (!isRecord(inspectedInput)) throw new StudioWriterRoomAdmissionError();
  const id = normalizeSafeId(inspectedInput.id);
  if (!id) throw new Error("제안 ID 형식이 올바르지 않아요.");
  if (document.suggestions.some((suggestion) => suggestion.id === id)) return document;
  const targetPath = normalizeText(inspectedInput.targetPath, 500);
  const target = parseTargetPath(targetPath);
  if (!target) throw new Error("제안 대상 경로가 허용 목록에 없어요.");
  const currentValue = findTargetValue(document, target);
  if (currentValue === undefined) throw new Error("제안 대상이 현재 Writer Room 문서에 없어요.");
  const proposedValue = coerceTargetValue(target, inspectedInput.proposedValue);
  if (proposedValue === undefined) throw new Error("제안 값이 대상 필드 형식과 맞지 않아요.");
  if (valuesEqual(currentValue, proposedValue)) throw new Error("현재 값과 다른 제안 값이 필요해요.");
  const rationale = normalizeText(
    inspectedInput.rationale,
    STUDIO_WRITER_ROOM_LIMITS.maxRationaleLength
  );
  const provenanceRef = inspectedInput.provenanceRef === undefined
    ? undefined
    : normalizeProvenanceRef(inspectedInput.provenanceRef);
  if (inspectedInput.provenanceRef !== undefined && !provenanceRef) {
    throw new Error("출처 참조 형식이 올바르지 않아요.");
  }
  const suggestion: StudioWriterRoomSuggestion = {
    id,
    targetPath,
    currentValue: cloneSuggestionValue(currentValue),
    proposedValue,
    rationale,
    status: "pending",
    ...(provenanceRef ? { provenanceRef } : {}),
    createdAt: operationTimestamp(
      typeof inspectedInput.createdAt === "string" ? inspectedInput.createdAt : ""
    ),
  };
  return finalized({
    ...document,
    suggestions: [...document.suggestions, suggestion].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    ),
  });
}

/** Existing IDs always win, so an explicitly rejected suggestion cannot be revived by an import. */
export function mergeStudioWriterRoomSuggestions(
  value: unknown,
  incoming: unknown
): StudioWriterRoomDocument {
  const document = normalizeStudioWriterRoomDocument(value);
  const decoded = decodeSource(incoming);
  if (decoded === null) return document;
  const ids = new Set(document.suggestions.map(({ id }) => id));
  const suggestions = document.suggestions.slice();
  for (const candidate of suggestionCandidates(decoded)) {
    const normalized = normalizeSuggestion(candidate, document);
    if (!normalized || ids.has(normalized.id)) continue;
    ids.add(normalized.id);
    suggestions.push(normalized);
  }
  suggestions.sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );
  return finalized({ ...document, suggestions });
}

function decideSuggestions(
  value: unknown,
  suggestionIds: readonly string[],
  kind: "accept" | "reject",
  decidedAtInput: string
): StudioWriterRoomDocument {
  const inspectedSuggestionIds = inspectSourceWithinByteBudget(suggestionIds);
  if (!Array.isArray(inspectedSuggestionIds)) throw new StudioWriterRoomAdmissionError();
  if (inspectedSuggestionIds.length > STUDIO_WRITER_ROOM_LIMITS.maxDecisionBatch) {
    throw new Error(`한 번에 최대 ${STUDIO_WRITER_ROOM_LIMITS.maxDecisionBatch}개 제안만 결정할 수 있어요.`);
  }
  const document = normalizeStudioWriterRoomDocument(value);
  const decidedAt = operationTimestamp(decidedAtInput);
  const requestedIds = new Set<string>();
  for (const candidate of inspectedSuggestionIds) {
    const id = normalizeSafeId(candidate);
    if (id) requestedIds.add(id);
  }
  const selected = document.suggestions.filter(
    (suggestion) => requestedIds.has(suggestion.id) && suggestion.status === "pending"
  );
  if (selected.length === 0) return document;

  let working = document;
  const targetValues: StudioWriterRoomDecision["targetValues"] = [];
  if (kind === "accept") {
    const targetPaths = new Set<string>();
    for (const suggestion of selected) {
      if (targetPaths.has(suggestion.targetPath)) {
        throw new Error("한 번의 승인 묶음에서 같은 필드를 두 번 변경할 수 없어요.");
      }
      const target = parseTargetPath(suggestion.targetPath);
      if (!target) throw new Error("승인할 제안의 대상 경로가 올바르지 않아요.");
      const currentValue = findTargetValue(document, target);
      if (currentValue === undefined || !valuesEqual(currentValue, suggestion.currentValue)) {
        throw new Error("제안 이후 대상 값이 바뀌었어요. 새 제안으로 다시 검토해 주세요.");
      }
      const proposedValue = coerceTargetValue(target, suggestion.proposedValue);
      if (proposedValue === undefined) throw new Error("승인할 제안 값이 대상 필드와 맞지 않아요.");
      targetPaths.add(suggestion.targetPath);
      targetValues.push({ targetPath: suggestion.targetPath, value: cloneSuggestionValue(currentValue) });
    }
    for (const suggestion of selected) {
      const target = parseTargetPath(suggestion.targetPath);
      if (target) working = applyTargetValue(working, target, suggestion.proposedValue);
    }
  }

  const selectedIds = new Set(selected.map(({ id }) => id));
  const suggestionStates: StudioWriterRoomDecision["suggestionStates"] = selected.map(
    ({ id, status, resolvedAt }) => ({ id, status, ...(resolvedAt ? { resolvedAt } : {}) })
  );
  const suggestions = working.suggestions.map((suggestion) =>
    selectedIds.has(suggestion.id)
      ? { ...suggestion, status: kind === "accept" ? "accepted" as const : "rejected" as const, resolvedAt: decidedAt }
      : suggestion
  );
  return finalized({
    ...working,
    suggestions,
    lastDecision: { kind, suggestionStates, targetValues, decidedAt },
  });
}

export function acceptStudioWriterRoomSuggestion(
  value: unknown,
  suggestionId: string,
  decidedAt: string
): StudioWriterRoomDocument {
  return decideSuggestions(value, [suggestionId], "accept", decidedAt);
}

export function rejectStudioWriterRoomSuggestion(
  value: unknown,
  suggestionId: string,
  decidedAt: string
): StudioWriterRoomDocument {
  return decideSuggestions(value, [suggestionId], "reject", decidedAt);
}

export function acceptStudioWriterRoomSuggestions(
  value: unknown,
  suggestionIds: readonly string[],
  decidedAt: string
): StudioWriterRoomDocument {
  return decideSuggestions(value, suggestionIds, "accept", decidedAt);
}

export function rejectStudioWriterRoomSuggestions(
  value: unknown,
  suggestionIds: readonly string[],
  decidedAt: string
): StudioWriterRoomDocument {
  return decideSuggestions(value, suggestionIds, "reject", decidedAt);
}

/** Reverts only the most recent explicit accept/reject decision and deliberately provides no redo. */
export function undoLastStudioWriterRoomDecision(value: unknown): StudioWriterRoomDocument {
  const document = normalizeStudioWriterRoomDocument(value);
  const decision = document.lastDecision;
  if (!decision) return document;
  let working = document;
  for (const previous of decision.targetValues) {
    const target = parseTargetPath(previous.targetPath);
    if (target && findTargetValue(working, target) !== undefined) {
      working = applyTargetValue(working, target, previous.value);
    }
  }
  const previousStates = new Map(decision.suggestionStates.map((state) => [state.id, state]));
  const suggestions = working.suggestions.map((suggestion) => {
    const previous = previousStates.get(suggestion.id);
    if (!previous) return suggestion;
    const { resolvedAt: _resolvedAt, ...withoutResolvedAt } = suggestion;
    return {
      ...withoutResolvedAt,
      status: previous.status,
      ...(previous.resolvedAt ? { resolvedAt: previous.resolvedAt } : {}),
    };
  });
  const { lastDecision: _lastDecision, ...withoutDecision } = working;
  return finalized({ ...withoutDecision, suggestions });
}
