import { z } from "zod";

import {
  createEmptyStudioPromisePayoffLedger,
  mergeStudioPromisePayoffLedgers,
  normalizeStudioPromisePayoffLedger,
  StudioPromisePayoffLedgerSchema,
  type StudioPromisePayoffLedger,
} from "./studio-promise-payoff-ledger";

export const STUDIO_PRODUCTION_BIBLE_VERSION = 1 as const;
export const STUDIO_PRODUCTION_BIBLE_MAX_ENTRIES = 256;
export const STUDIO_PRODUCTION_BIBLE_MAX_ID_LENGTH = 120;
export const STUDIO_PRODUCTION_BIBLE_MAX_NAME_LENGTH = 120;
export const STUDIO_PRODUCTION_BIBLE_MAX_DESCRIPTION_LENGTH = 4_000;
export const STUDIO_PRODUCTION_BIBLE_MAX_TIME_LENGTH = 80;
export const STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEMS = 48;
export const STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEM_LENGTH = 160;
export const STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const STUDIO_PRODUCTION_BIBLE_ENTRY_KINDS = [
  "scene",
  "location",
  "prop",
] as const;

export type StudioProductionBibleEntryKind =
  (typeof STUDIO_PRODUCTION_BIBLE_ENTRY_KINDS)[number];

const ENTRY_KIND_SET = new Set<string>(STUDIO_PRODUCTION_BIBLE_ENTRY_KINDS);
const ENTRY_KIND_ORDER = new Map<StudioProductionBibleEntryKind, number>(
  STUDIO_PRODUCTION_BIBLE_ENTRY_KINDS.map((kind, index) => [kind, index])
);
const IdSchema = z.string().trim().min(1).max(STUDIO_PRODUCTION_BIBLE_MAX_ID_LENGTH);
const DisplayListItemSchema = z.string().max(
  STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEM_LENGTH
);
const DisplayListSchema = z
  .array(DisplayListItemSchema)
  .max(STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEMS);
const IdListSchema = z
  .array(IdSchema)
  .max(STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEMS);

export const StudioProductionBibleEntrySchema = z
  .object({
    id: IdSchema,
    kind: z.enum(STUDIO_PRODUCTION_BIBLE_ENTRY_KINDS),
    name: z.string().max(STUDIO_PRODUCTION_BIBLE_MAX_NAME_LENGTH),
    aliases: DisplayListSchema,
    description: z.string().max(STUDIO_PRODUCTION_BIBLE_MAX_DESCRIPTION_LENGTH),
    visualKeywords: DisplayListSchema,
    colors: DisplayListSchema,
    timeOfDay: z.string().max(STUDIO_PRODUCTION_BIBLE_MAX_TIME_LENGTH),
    linkedCharacterIds: IdListSchema,
    linkedLocationIds: IdListSchema,
    linkedPropIds: IdListSchema,
    referenceAssetIds: IdListSchema,
  })
  .strict();

export const StudioProductionBibleSchema = z
  .object({
    version: z.literal(STUDIO_PRODUCTION_BIBLE_VERSION),
    entries: z
      .array(StudioProductionBibleEntrySchema)
      .max(STUDIO_PRODUCTION_BIBLE_MAX_ENTRIES),
    /** Optional at the schema edge so existing v1 local documents remain readable. */
    promisePayoffLedger: StudioPromisePayoffLedgerSchema.optional(),
  })
  .strict();

export type StudioProductionBibleEntry = z.infer<
  typeof StudioProductionBibleEntrySchema
>;
export type StudioProductionBible = z.infer<typeof StudioProductionBibleSchema>;
export type StudioProductionBibleEntryInput = {
  kind: StudioProductionBibleEntryKind;
  id?: string;
} & Partial<
  Omit<StudioProductionBibleEntry, "id" | "kind">
>;
export type StudioProductionBibleEntryPatch = Partial<
  Omit<StudioProductionBibleEntry, "id" | "kind">
>;

export interface StudioProductionBibleSearchFilter {
  readonly query?: string;
  readonly kinds?: readonly StudioProductionBibleEntryKind[];
  readonly linkedCharacterId?: string;
  readonly linkedLocationId?: string;
  readonly linkedPropId?: string;
  readonly referenceAssetId?: string;
  readonly danglingOnly?: boolean;
  readonly knownCharacterIds?: readonly string[];
  readonly knownAssetIds?: readonly string[];
}

export type StudioProductionBibleMergeConflictPolicy =
  | "merge"
  | "keep-existing"
  | "replace-existing";

export interface StudioProductionBibleMergeResult {
  readonly bible: StudioProductionBible;
  readonly addedIds: readonly string[];
  readonly updatedIds: readonly string[];
  readonly keptIds: readonly string[];
  /** Same stable ID was used for two different entry kinds. The existing kind always wins. */
  readonly kindConflictIds: readonly string[];
  readonly promiseAddedIds: readonly string[];
  readonly promiseUpdatedIds: readonly string[];
  readonly promiseKeptIds: readonly string[];
}

export type StudioProductionBibleReferenceIssueCode =
  | "DANGLING_CHARACTER"
  | "DANGLING_LOCATION"
  | "DANGLING_PROP"
  | "DANGLING_ASSET"
  | "REFERENCE_KIND_MISMATCH";

export interface StudioProductionBibleReferenceIssue {
  readonly code: StudioProductionBibleReferenceIssueCode;
  readonly entryId: string;
  readonly entryKind: StudioProductionBibleEntryKind;
  readonly field:
    | "linkedCharacterIds"
    | "linkedLocationIds"
    | "linkedPropIds"
    | "referenceAssetIds";
  readonly referenceId: string;
  readonly message: string;
}

export interface StudioProductionBibleDiagnosticOptions {
  /**
   * Omit when the character bible is not available. Passing an empty array means it is available
   * and therefore every character reference is currently dangling.
   */
  readonly knownCharacterIds?: readonly string[];
  /** Same semantics as knownCharacterIds for the local asset catalogue. */
  readonly knownAssetIds?: readonly string[];
}

export interface StudioProductionBibleProjectionReference {
  readonly id: string;
  readonly name: string | null;
}

export interface StudioProductionBibleContinuityScene {
  readonly sceneId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly timeOfDay: string;
  readonly characterIds: readonly string[];
  readonly locations: readonly StudioProductionBibleProjectionReference[];
  readonly props: readonly StudioProductionBibleProjectionReference[];
  readonly colors: readonly string[];
  readonly visualKeywords: readonly string[];
  readonly referenceAssetIds: readonly string[];
}

export interface StudioProductionBibleContinuityCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly colors: readonly string[];
  readonly visualKeywords: readonly string[];
  readonly referenceAssetIds: readonly string[];
}

export interface StudioProductionBibleContinuityProjection {
  readonly scenes: readonly StudioProductionBibleContinuityScene[];
  readonly locations: readonly StudioProductionBibleContinuityCatalogEntry[];
  readonly props: readonly StudioProductionBibleContinuityCatalogEntry[];
}

export interface StudioProductionBibleLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type StudioProductionBiblePersistenceBackend =
  | "sqlite"
  | "memory"
  | "unavailable"
  | "legacy-indexeddb"
  | "legacy-local-storage";

export interface StudioProductionBiblePersistenceResult {
  readonly bible: StudioProductionBible;
  readonly backend: StudioProductionBiblePersistenceBackend;
  readonly persisted: boolean;
  /** There is intentionally no server-sync claim until a project integration explicitly adds one. */
  readonly localOnly: true;
  readonly warning?: string;
}

export interface StudioProductionBibleRepositoryOptions {
  /**
   * V12 never reads legacy stores by default. Tests/dev import tools must opt in and inject the
   * exact adapters they intend to inspect; browser globals are deliberately never discovered.
   */
  readonly legacyDataPolicy?: "discard" | "import-explicit";
  readonly indexedDB?: IDBFactory | null;
  readonly localStorage?: StudioProductionBibleLocalStorage | null;
}

export interface StudioProductionBibleRepository {
  load(key: string): Promise<StudioProductionBiblePersistenceResult>;
  save(
    key: string,
    value: StudioProductionBible
  ): Promise<StudioProductionBiblePersistenceResult>;
}

const PATCH_FIELDS = new Set<string>([
  "name",
  "aliases",
  "description",
  "visualKeywords",
  "colors",
  "timeOfDay",
  "linkedCharacterIds",
  "linkedLocationIds",
  "linkedPropIds",
  "referenceAssetIds",
]);
const PRODUCTION_BIBLE_STORAGE_PREFIX = "toonspectrum-studio-production-bible:v12";
const PRODUCTION_BIBLE_LEGACY_STORAGE_PREFIX =
  "toonspectrum-studio-production-bible:v1";
const PRODUCTION_BIBLE_DB_NAME = "toonspectrum-studio-production-bible";
const PRODUCTION_BIBLE_DB_VERSION = 1;
const PRODUCTION_BIBLE_STORE_NAME = "documents";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedLookupText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizeShortText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, maxLength);
}

function normalizeLongText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .trim()
    .slice(0, STUDIO_PRODUCTION_BIBLE_MAX_DESCRIPTION_LENGTH);
}

function listCandidates(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[\n,;]+/u);
  return [];
}

function normalizeDisplayList(value: unknown): string[] {
  const byKey = new Map<string, string>();
  for (const candidate of listCandidates(value)) {
    const display = normalizeShortText(
      candidate,
      STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEM_LENGTH
    );
    if (!display) continue;
    const key = normalizedLookupText(display);
    if (!byKey.has(key)) byKey.set(key, display);
    if (byKey.size >= STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEMS) break;
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, display]) => display);
}

function normalizeId(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, STUDIO_PRODUCTION_BIBLE_MAX_ID_LENGTH)
    : "";
}

export function normalizeStudioProductionBibleStorageKey(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 512) : "";
}

function normalizeIdList(value: unknown): string[] {
  const result = new Set<string>();
  for (const candidate of listCandidates(value)) {
    const id = normalizeId(candidate);
    if (!id) continue;
    result.add(id);
    if (result.size >= STUDIO_PRODUCTION_BIBLE_MAX_LIST_ITEMS) break;
  }
  return [...result].sort(compareText);
}

function normalizeEntryKind(
  value: unknown,
  fallback?: StudioProductionBibleEntryKind
): StudioProductionBibleEntryKind | null {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ENTRY_KIND_SET.has(candidate)) {
    return candidate as StudioProductionBibleEntryKind;
  }
  return fallback ?? null;
}

function normalizeEntry(
  value: unknown,
  fallbackKind?: StudioProductionBibleEntryKind
): StudioProductionBibleEntry | null {
  if (!isRecord(value)) return null;
  const id = normalizeId(value.id ?? value.entryId);
  const kind = normalizeEntryKind(value.kind ?? value.type, fallbackKind);
  if (!id || !kind) return null;

  return StudioProductionBibleEntrySchema.parse({
    id,
    kind,
    name: normalizeShortText(
      value.name ?? value.title,
      STUDIO_PRODUCTION_BIBLE_MAX_NAME_LENGTH
    ),
    aliases: normalizeDisplayList(value.aliases ?? value.alias),
    description: normalizeLongText(value.description ?? value.notes),
    visualKeywords: normalizeDisplayList(
      value.visualKeywords ?? value.keywords ?? value.visuals
    ),
    colors: normalizeDisplayList(value.colors ?? value.palette),
    timeOfDay: normalizeShortText(
      value.timeOfDay ?? value.time,
      STUDIO_PRODUCTION_BIBLE_MAX_TIME_LENGTH
    ),
    linkedCharacterIds: normalizeIdList(
      value.linkedCharacterIds ?? value.characterIds
    ),
    linkedLocationIds: normalizeIdList(
      value.linkedLocationIds ?? value.locationIds
    ),
    linkedPropIds: normalizeIdList(value.linkedPropIds ?? value.propIds),
    referenceAssetIds: normalizeIdList(
      value.referenceAssetIds ?? value.assetIds
    ),
  });
}

function canonicalEntryOrder(
  left: StudioProductionBibleEntry,
  right: StudioProductionBibleEntry
): number {
  return (
    (ENTRY_KIND_ORDER.get(left.kind) ?? Number.MAX_SAFE_INTEGER)
      - (ENTRY_KIND_ORDER.get(right.kind) ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.id, right.id)
  );
}

function canonicalBible(
  entries: readonly StudioProductionBibleEntry[],
  promisePayoffLedger: unknown = createEmptyStudioPromisePayoffLedger()
): StudioProductionBible {
  const unique = new Map<string, StudioProductionBibleEntry>();
  for (const entry of entries) {
    if (!unique.has(entry.id)) unique.set(entry.id, entry);
    if (unique.size >= STUDIO_PRODUCTION_BIBLE_MAX_ENTRIES) break;
  }
  return StudioProductionBibleSchema.parse({
    version: STUDIO_PRODUCTION_BIBLE_VERSION,
    entries: [...unique.values()].sort(canonicalEntryOrder),
    promisePayoffLedger: normalizeStudioPromisePayoffLedger(promisePayoffLedger),
  });
}

function extractedEntries(
  value: unknown
): Array<{ value: unknown; fallbackKind?: StudioProductionBibleEntryKind }> {
  if (Array.isArray(value)) return value.map((entry) => ({ value: entry }));
  if (!isRecord(value)) return [];
  const result: Array<{
    value: unknown;
    fallbackKind?: StudioProductionBibleEntryKind;
  }> = [];
  if (Array.isArray(value.entries)) {
    result.push(...value.entries.map((entry) => ({ value: entry })));
  }
  for (const [field, kind] of [
    ["scenes", "scene"],
    ["locations", "location"],
    ["props", "prop"],
  ] as const) {
    const entries = value[field];
    if (!Array.isArray(entries)) continue;
    result.push(...entries.map((entry) => ({ value: entry, fallbackKind: kind })));
  }
  return result;
}

export function createEmptyStudioProductionBible(): StudioProductionBible {
  return {
    version: STUDIO_PRODUCTION_BIBLE_VERSION,
    entries: [],
    promisePayoffLedger: createEmptyStudioPromisePayoffLedger(),
  };
}

/**
 * Normalizes current and early scene/location/prop containers. Records without a client-owned ID
 * are dropped rather than receiving an unstable ID derived from a mutable name.
 */
export function normalizeStudioProductionBible(value: unknown): StudioProductionBible {
  let decoded = value;
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).byteLength > STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES) {
      return createEmptyStudioProductionBible();
    }
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return createEmptyStudioProductionBible();
    }
  }

  const entries: StudioProductionBibleEntry[] = [];
  const ids = new Set<string>();
  for (const candidate of extractedEntries(decoded)) {
    const entry = normalizeEntry(candidate.value, candidate.fallbackKind);
    if (!entry || ids.has(entry.id)) continue;
    ids.add(entry.id);
    entries.push(entry);
    if (entries.length >= STUDIO_PRODUCTION_BIBLE_MAX_ENTRIES) break;
  }
  return canonicalBible(
    entries,
    isRecord(decoded)
      ? decoded.promisePayoffLedger ?? decoded.promisePayoff
      : undefined
  );
}

/** Canonical field and entry order makes exports byte-stable for the same normalized content. */
export function serializeStudioProductionBible(
  bible: StudioProductionBible,
  pretty = false
): string {
  const normalized = normalizeStudioProductionBible(bible);
  return JSON.stringify(normalized, null, pretty ? 2 : undefined);
}

export function parseStudioProductionBibleImport(
  text: string
): { ok: true; bible: StudioProductionBible } | { ok: false; error: string } {
  if (new TextEncoder().encode(text).byteLength > STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: `바이블 파일은 ${Math.floor(STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES / 1024 / 1024)}MB 이하여야 해요.`,
    };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "장면·장소·소품 바이블 JSON을 해석하지 못했어요." };
  }
  if (
    !Array.isArray(decoded)
    && (!isRecord(decoded) || extractedEntries(decoded).length === 0)
    && !(isRecord(decoded) && Array.isArray(decoded.entries))
    && !(isRecord(decoded) && isRecord(decoded.promisePayoffLedger))
  ) {
    return { ok: false, error: "지원하는 바이블 항목 목록을 찾지 못했어요." };
  }
  return { ok: true, bible: normalizeStudioProductionBible(decoded) };
}

export function createStudioProductionBibleEntryId(
  kind: StudioProductionBibleEntryKind,
  entropy?: () => string
): string {
  const raw = entropy?.()
    ?? (typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  const token = raw
    .normalize("NFKC")
    .trim()
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, Math.max(1, STUDIO_PRODUCTION_BIBLE_MAX_ID_LENGTH - kind.length - 1));
  return `${kind}_${token || "entry"}`;
}

export function addStudioProductionBibleEntry(
  bible: StudioProductionBible,
  input: StudioProductionBibleEntryInput,
  createId: (kind: StudioProductionBibleEntryKind) => string =
    createStudioProductionBibleEntryId
): StudioProductionBible {
  if (bible.entries.length >= STUDIO_PRODUCTION_BIBLE_MAX_ENTRIES) {
    throw new Error(
      `장면·장소·소품은 합쳐서 최대 ${STUDIO_PRODUCTION_BIBLE_MAX_ENTRIES}개까지 저장할 수 있어요.`
    );
  }
  const id = normalizeId(input.id) || normalizeId(createId(input.kind));
  const entry = normalizeEntry({ ...input, id, kind: input.kind });
  if (!entry) throw new Error("유효한 종류와 안정적인 항목 ID가 필요해요.");
  if (bible.entries.some((candidate) => candidate.id === entry.id)) {
    throw new Error("이미 사용 중인 바이블 항목 ID예요.");
  }
  return canonicalBible([...bible.entries, entry], bible.promisePayoffLedger);
}

export function patchStudioProductionBibleEntry(
  bible: StudioProductionBible,
  entryId: string,
  patch: StudioProductionBibleEntryPatch
): StudioProductionBible {
  if (!isRecord(patch)) throw new Error("올바르지 않은 바이블 수정 내용이에요.");
  for (const key of Object.keys(patch)) {
    if (!PATCH_FIELDS.has(key)) {
      throw new Error(`수정할 수 없는 바이블 필드예요: ${key}`);
    }
  }
  const index = bible.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return bible;
  const next = normalizeEntry({ ...bible.entries[index], ...patch });
  if (!next) throw new Error("바이블 항목을 정규화하지 못했어요.");
  const entries = bible.entries.slice();
  entries[index] = next;
  return canonicalBible(entries, bible.promisePayoffLedger);
}

export function duplicateStudioProductionBibleEntry(
  bible: StudioProductionBible,
  entryId: string,
  options: {
    readonly id?: string;
    readonly name?: string;
    readonly createId?: (kind: StudioProductionBibleEntryKind) => string;
  } = {}
): StudioProductionBible {
  const source = bible.entries.find((entry) => entry.id === entryId);
  if (!source) return bible;
  const id =
    normalizeId(options.id)
    || normalizeId((options.createId ?? createStudioProductionBibleEntryId)(source.kind));
  const name = normalizeShortText(
    options.name ?? `${source.name || kindLabel(source.kind)} 복사본`,
    STUDIO_PRODUCTION_BIBLE_MAX_NAME_LENGTH
  );
  return addStudioProductionBibleEntry(bible, { ...source, id, name, kind: source.kind });
}

export function removeStudioProductionBibleEntry(
  bible: StudioProductionBible,
  entryId: string
): StudioProductionBible {
  const removed = bible.entries.find((entry) => entry.id === entryId);
  if (!removed) return bible;
  const entries = bible.entries
    .filter((entry) => entry.id !== entryId)
    .map((entry) => {
      if (removed.kind === "location" && entry.linkedLocationIds.includes(entryId)) {
        return { ...entry, linkedLocationIds: entry.linkedLocationIds.filter((id) => id !== entryId) };
      }
      if (removed.kind === "prop" && entry.linkedPropIds.includes(entryId)) {
        return { ...entry, linkedPropIds: entry.linkedPropIds.filter((id) => id !== entryId) };
      }
      return entry;
    });
  return canonicalBible(entries, bible.promisePayoffLedger);
}

export function replaceStudioProductionBiblePromisePayoffLedger(
  bible: StudioProductionBible,
  promisePayoffLedger: StudioPromisePayoffLedger
): StudioProductionBible {
  const normalizedLedger = normalizeStudioPromisePayoffLedger(promisePayoffLedger);
  if (
    JSON.stringify(normalizedLedger)
    === JSON.stringify(
      bible.promisePayoffLedger ?? createEmptyStudioPromisePayoffLedger()
    )
  ) {
    return bible;
  }
  return canonicalBible(bible.entries, normalizedLedger);
}

function mergeLists(left: readonly string[], right: readonly string[], ids = false): string[] {
  return ids ? normalizeIdList([...left, ...right]) : normalizeDisplayList([...left, ...right]);
}

function mergedEntry(
  existing: StudioProductionBibleEntry,
  incoming: StudioProductionBibleEntry
): StudioProductionBibleEntry {
  const preferExisting = (left: string, right: string) => left || right;
  return StudioProductionBibleEntrySchema.parse({
    ...existing,
    name: preferExisting(existing.name, incoming.name),
    description: preferExisting(existing.description, incoming.description),
    timeOfDay: preferExisting(existing.timeOfDay, incoming.timeOfDay),
    aliases: mergeLists(existing.aliases, incoming.aliases),
    visualKeywords: mergeLists(existing.visualKeywords, incoming.visualKeywords),
    colors: mergeLists(existing.colors, incoming.colors),
    linkedCharacterIds: mergeLists(
      existing.linkedCharacterIds,
      incoming.linkedCharacterIds,
      true
    ),
    linkedLocationIds: mergeLists(
      existing.linkedLocationIds,
      incoming.linkedLocationIds,
      true
    ),
    linkedPropIds: mergeLists(existing.linkedPropIds, incoming.linkedPropIds, true),
    referenceAssetIds: mergeLists(
      existing.referenceAssetIds,
      incoming.referenceAssetIds,
      true
    ),
  });
}

export function mergeStudioProductionBibles(
  currentValue: unknown,
  incomingValue: unknown,
  policy: StudioProductionBibleMergeConflictPolicy = "merge"
): StudioProductionBibleMergeResult {
  const current = normalizeStudioProductionBible(currentValue);
  const incoming = normalizeStudioProductionBible(incomingValue);
  const entries = new Map(current.entries.map((entry) => [entry.id, entry] as const));
  const addedIds: string[] = [];
  const updatedIds: string[] = [];
  const keptIds: string[] = [];
  const kindConflictIds: string[] = [];
  const promiseMerge = mergeStudioPromisePayoffLedgers(
    current.promisePayoffLedger,
    incoming.promisePayoffLedger,
    policy
  );

  for (const candidate of incoming.entries) {
    const existing = entries.get(candidate.id);
    if (!existing) {
      if (entries.size < STUDIO_PRODUCTION_BIBLE_MAX_ENTRIES) {
        entries.set(candidate.id, candidate);
        addedIds.push(candidate.id);
      }
      continue;
    }
    if (existing.kind !== candidate.kind) {
      kindConflictIds.push(candidate.id);
      keptIds.push(candidate.id);
      continue;
    }
    if (policy === "keep-existing") {
      keptIds.push(candidate.id);
      continue;
    }
    const replacement =
      policy === "replace-existing" ? candidate : mergedEntry(existing, candidate);
    entries.set(candidate.id, replacement);
    if (JSON.stringify(existing) === JSON.stringify(replacement)) keptIds.push(candidate.id);
    else updatedIds.push(candidate.id);
  }

  return {
    bible: canonicalBible([...entries.values()], promiseMerge.ledger),
    addedIds: addedIds.sort(compareText),
    updatedIds: updatedIds.sort(compareText),
    keptIds: [...new Set(keptIds)].sort(compareText),
    kindConflictIds: kindConflictIds.sort(compareText),
    promiseAddedIds: promiseMerge.addedIds,
    promiseUpdatedIds: promiseMerge.updatedIds,
    promiseKeptIds: promiseMerge.keptIds,
  };
}

function kindLabel(kind: StudioProductionBibleEntryKind): string {
  if (kind === "scene") return "장면";
  if (kind === "location") return "장소";
  return "소품";
}

export function diagnoseStudioProductionBibleReferences(
  value: unknown,
  options: StudioProductionBibleDiagnosticOptions = {}
): StudioProductionBibleReferenceIssue[] {
  const bible = normalizeStudioProductionBible(value);
  const entriesById = new Map(bible.entries.map((entry) => [entry.id, entry] as const));
  const knownCharacters =
    options.knownCharacterIds === undefined
      ? null
      : new Set(normalizeIdList(options.knownCharacterIds));
  const knownAssets =
    options.knownAssetIds === undefined
      ? null
      : new Set(normalizeIdList(options.knownAssetIds));
  const issues: StudioProductionBibleReferenceIssue[] = [];

  const addInternal = (
    entry: StudioProductionBibleEntry,
    field: "linkedLocationIds" | "linkedPropIds",
    expectedKind: "location" | "prop"
  ) => {
    for (const referenceId of entry[field]) {
      const target = entriesById.get(referenceId);
      if (!target) {
        issues.push({
          code: expectedKind === "location" ? "DANGLING_LOCATION" : "DANGLING_PROP",
          entryId: entry.id,
          entryKind: entry.kind,
          field,
          referenceId,
          message: `${kindLabel(entry.kind)} "${entry.name || entry.id}"이(가) 없는 ${kindLabel(expectedKind)} ID "${referenceId}"을(를) 참조합니다.`,
        });
      } else if (target.kind !== expectedKind) {
        issues.push({
          code: "REFERENCE_KIND_MISMATCH",
          entryId: entry.id,
          entryKind: entry.kind,
          field,
          referenceId,
          message: `참조 "${referenceId}"은(는) ${kindLabel(target.kind)}이지만 ${kindLabel(expectedKind)} 연결에 들어 있습니다.`,
        });
      }
    }
  };

  for (const entry of bible.entries) {
    if (knownCharacters) {
      for (const referenceId of entry.linkedCharacterIds) {
        if (knownCharacters.has(referenceId)) continue;
        issues.push({
          code: "DANGLING_CHARACTER",
          entryId: entry.id,
          entryKind: entry.kind,
          field: "linkedCharacterIds",
          referenceId,
          message: `${kindLabel(entry.kind)} "${entry.name || entry.id}"이(가) 캐릭터 바이블에 없는 ID "${referenceId}"을(를) 참조합니다.`,
        });
      }
    }
    addInternal(entry, "linkedLocationIds", "location");
    addInternal(entry, "linkedPropIds", "prop");
    if (knownAssets) {
      for (const referenceId of entry.referenceAssetIds) {
        if (knownAssets.has(referenceId)) continue;
        issues.push({
          code: "DANGLING_ASSET",
          entryId: entry.id,
          entryKind: entry.kind,
          field: "referenceAssetIds",
          referenceId,
          message: `${kindLabel(entry.kind)} "${entry.name || entry.id}"이(가) 로컬 에셋에 없는 ID "${referenceId}"을(를) 참조합니다.`,
        });
      }
    }
  }
  return issues;
}

export function searchStudioProductionBible(
  value: unknown,
  filter: StudioProductionBibleSearchFilter = {}
): StudioProductionBibleEntry[] {
  const bible = normalizeStudioProductionBible(value);
  const kinds =
    filter.kinds && filter.kinds.length > 0 ? new Set(filter.kinds) : null;
  const queryTokens = normalizedLookupText(filter.query ?? "")
    .split(" ")
    .filter(Boolean);
  const danglingIds = filter.danglingOnly
    ? new Set(
        diagnoseStudioProductionBibleReferences(bible, {
          knownCharacterIds: filter.knownCharacterIds,
          knownAssetIds: filter.knownAssetIds,
        }).map((issue) => issue.entryId)
      )
    : null;
  const linkedCharacterId = normalizeId(filter.linkedCharacterId);
  const linkedLocationId = normalizeId(filter.linkedLocationId);
  const linkedPropId = normalizeId(filter.linkedPropId);
  const referenceAssetId = normalizeId(filter.referenceAssetId);

  return bible.entries.filter((entry) => {
    if (kinds && !kinds.has(entry.kind)) return false;
    if (danglingIds && !danglingIds.has(entry.id)) return false;
    if (
      linkedCharacterId
      && !entry.linkedCharacterIds.includes(linkedCharacterId)
    ) {
      return false;
    }
    if (linkedLocationId && !entry.linkedLocationIds.includes(linkedLocationId)) {
      return false;
    }
    if (linkedPropId && !entry.linkedPropIds.includes(linkedPropId)) return false;
    if (referenceAssetId && !entry.referenceAssetIds.includes(referenceAssetId)) {
      return false;
    }
    if (queryTokens.length === 0) return true;
    const haystack = normalizedLookupText(
      [
        entry.name,
        ...entry.aliases,
        entry.description,
        ...entry.visualKeywords,
        ...entry.colors,
        entry.timeOfDay,
        ...entry.linkedCharacterIds,
        ...entry.linkedLocationIds,
        ...entry.linkedPropIds,
        ...entry.referenceAssetIds,
      ].join(" ")
    );
    return queryTokens.every((token) => haystack.includes(token));
  });
}

function frozenReference(
  id: string,
  expectedKind: "location" | "prop",
  entriesById: ReadonlyMap<string, StudioProductionBibleEntry>
): StudioProductionBibleProjectionReference {
  const target = entriesById.get(id);
  return Object.freeze({
    id,
    name: target?.kind === expectedKind ? target.name || null : null,
  });
}

function frozenCatalogEntry(
  entry: StudioProductionBibleEntry
): StudioProductionBibleContinuityCatalogEntry {
  return Object.freeze({
    id: entry.id,
    name: entry.name,
    aliases: Object.freeze([...entry.aliases]),
    description: entry.description,
    colors: Object.freeze([...entry.colors]),
    visualKeywords: Object.freeze([...entry.visualKeywords]),
    referenceAssetIds: Object.freeze([...entry.referenceAssetIds]),
  });
}

/**
 * Read-only facts for a future continuity adapter. It deliberately exposes IDs and resolved labels
 * instead of inventing prop state/ownership that the production bible does not know.
 */
export function projectStudioProductionBibleForContinuity(
  value: unknown
): StudioProductionBibleContinuityProjection {
  const bible = normalizeStudioProductionBible(value);
  const entriesById = new Map(bible.entries.map((entry) => [entry.id, entry] as const));
  const scenes = bible.entries
    .filter((entry) => entry.kind === "scene")
    .map((entry): StudioProductionBibleContinuityScene =>
      Object.freeze({
        sceneId: entry.id,
        name: entry.name,
        aliases: Object.freeze([...entry.aliases]),
        timeOfDay: entry.timeOfDay,
        characterIds: Object.freeze([...entry.linkedCharacterIds]),
        locations: Object.freeze(
          entry.linkedLocationIds.map((id) =>
            frozenReference(id, "location", entriesById)
          )
        ),
        props: Object.freeze(
          entry.linkedPropIds.map((id) => frozenReference(id, "prop", entriesById))
        ),
        colors: Object.freeze([...entry.colors]),
        visualKeywords: Object.freeze([...entry.visualKeywords]),
        referenceAssetIds: Object.freeze([...entry.referenceAssetIds]),
      })
    );
  const locations = bible.entries
    .filter((entry) => entry.kind === "location")
    .map(frozenCatalogEntry);
  const props = bible.entries
    .filter((entry) => entry.kind === "prop")
    .map(frozenCatalogEntry);
  return Object.freeze({
    scenes: Object.freeze(scenes),
    locations: Object.freeze(locations),
    props: Object.freeze(props),
  });
}

export function studioProductionBibleStorageKey(input: {
  readonly userId?: string | null;
  readonly workId?: string | null;
  readonly remixId?: string | null;
}): string {
  return scopedProductionBibleStorageKey(PRODUCTION_BIBLE_STORAGE_PREFIX, input);
}

/** Explicit test/dev import seam for the discarded pre-V12 browser-store namespace. */
export function studioProductionBibleLegacyStorageKey(input: {
  readonly userId?: string | null;
  readonly workId?: string | null;
  readonly remixId?: string | null;
}): string {
  return scopedProductionBibleStorageKey(PRODUCTION_BIBLE_LEGACY_STORAGE_PREFIX, input);
}

function scopedProductionBibleStorageKey(
  prefix: string,
  input: {
    readonly userId?: string | null;
    readonly workId?: string | null;
    readonly remixId?: string | null;
  }
): string {
  const owner = encodeURIComponent(input.userId?.trim() || "guest");
  const documentId = input.workId
    ? `work:${encodeURIComponent(input.workId)}`
    : input.remixId
      ? `remix:${encodeURIComponent(input.remixId)}`
      : "new";
  return `${prefix}:${owner}:${documentId}`;
}

function resolveIndexedDb(
  options: StudioProductionBibleRepositoryOptions
): IDBFactory | null {
  if (options.legacyDataPolicy !== "import-explicit") return null;
  return options.indexedDB ?? null;
}

function resolveLocalStorage(
  options: StudioProductionBibleRepositoryOptions
): StudioProductionBibleLocalStorage | null {
  if (options.legacyDataPolicy !== "import-explicit") return null;
  return options.localStorage ?? null;
}

function openProductionBibleDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(PRODUCTION_BIBLE_DB_NAME, PRODUCTION_BIBLE_DB_VERSION);
    } catch (cause) {
      reject(cause);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PRODUCTION_BIBLE_STORE_NAME)) {
        database.createObjectStore(PRODUCTION_BIBLE_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 열기 실패"));
    request.onblocked = () => reject(new Error("IndexedDB 업그레이드가 차단됨"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readProductionBibleFromIndexedDb(
  factory: IDBFactory,
  key: string
): Promise<string | null> {
  const database = await openProductionBibleDatabase(factory);
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const transaction = database.transaction(PRODUCTION_BIBLE_STORE_NAME, "readonly");
      const request = transaction.objectStore(PRODUCTION_BIBLE_STORE_NAME).get(key);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB 읽기 실패"));
      request.onsuccess = () => {
        const result = request.result as { value?: unknown } | undefined;
        resolve(typeof result?.value === "string" ? result.value : null);
      };
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB 읽기 중단"));
    });
  } finally {
    database.close();
  }
}

async function writeProductionBibleToIndexedDb(
  factory: IDBFactory,
  key: string,
  value: string
): Promise<void> {
  const database = await openProductionBibleDatabase(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PRODUCTION_BIBLE_STORE_NAME, "readwrite");
      transaction.objectStore(PRODUCTION_BIBLE_STORE_NAME).put({ key, value });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("IndexedDB 쓰기 실패"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB 쓰기 중단"));
    });
  } finally {
    database.close();
  }
}

function warningText(messages: readonly string[]): string | undefined {
  const unique = [...new Set(messages.filter(Boolean))];
  return unique.length > 0 ? unique.join(" ") : undefined;
}

/**
 * Explicit legacy import/test repository. The default policy is discard and therefore touches no
 * IndexedDB or localStorage global. Supplying `legacyDataPolicy: "import-explicit"` plus concrete
 * adapters is the only way to inspect the pre-V12 stores. Product code uses the SQLite repository.
 * Memory always receives the last accepted edit so an injected-adapter failure is surfaced without
 * losing the in-session value.
 */
export class StudioProductionBibleLocalRepository {
  private readonly memory = new Map<string, StudioProductionBible>();

  constructor(
    private readonly options: StudioProductionBibleRepositoryOptions = {}
  ) {}

  async load(key: string): Promise<StudioProductionBiblePersistenceResult> {
    const normalizedKey = normalizeStudioProductionBibleStorageKey(key);
    if (!normalizedKey) {
      return {
        bible: createEmptyStudioProductionBible(),
        backend: "memory",
        persisted: false,
        localOnly: true,
        warning: "저장 키가 없어 이 세션의 메모리에서만 바이블을 유지합니다.",
      };
    }
    const warnings: string[] = [];
    const indexedDb = resolveIndexedDb(this.options);
    if (indexedDb) {
      try {
        const serialized = await readProductionBibleFromIndexedDb(indexedDb, normalizedKey);
        if (serialized !== null) {
          const imported = parseStudioProductionBibleImport(serialized);
          if (imported.ok) {
            this.memory.set(normalizedKey, imported.bible);
            return {
              bible: imported.bible,
              backend: "legacy-indexeddb",
              persisted: true,
              localOnly: true,
            };
          }
          warnings.push(`IndexedDB 레거시 바이블을 가져오지 않았습니다: ${imported.error}`);
        }
      } catch {
        warnings.push("IndexedDB를 읽지 못해 로컬 저장소로 전환했습니다.");
      }
    }

    const localStorage = resolveLocalStorage(this.options);
    if (localStorage) {
      try {
        const serialized = localStorage.getItem(normalizedKey);
        if (serialized !== null) {
          const imported = parseStudioProductionBibleImport(serialized);
          if (imported.ok) {
            this.memory.set(normalizedKey, imported.bible);
            return {
              bible: imported.bible,
              backend: "legacy-local-storage",
              persisted: true,
              localOnly: true,
              ...(warningText(warnings) ? { warning: warningText(warnings) } : {}),
            };
          }
          warnings.push(`localStorage 레거시 바이블을 가져오지 않았습니다: ${imported.error}`);
        }
      } catch {
        warnings.push("localStorage를 읽지 못해 메모리 복구본을 사용합니다.");
      }
    }

    const bible = this.memory.get(normalizedKey) ?? createEmptyStudioProductionBible();
    return {
      bible,
      backend: "memory",
      persisted: false,
      localOnly: true,
      ...(warningText(warnings) ? { warning: warningText(warnings) } : {}),
    };
  }

  async save(
    key: string,
    value: StudioProductionBible
  ): Promise<StudioProductionBiblePersistenceResult> {
    const normalizedKey = normalizeStudioProductionBibleStorageKey(key);
    const bible = normalizeStudioProductionBible(value);
    const serialized = serializeStudioProductionBible(bible);
    const warnings: string[] = [];
    if (!normalizedKey) {
      return {
        bible,
        backend: "memory",
        persisted: false,
        localOnly: true,
        warning: "저장 키가 없어 이 세션의 메모리에서만 바이블을 유지합니다.",
      };
    }
    this.memory.set(normalizedKey, bible);

    const indexedDb = resolveIndexedDb(this.options);
    if (indexedDb) {
      try {
        await writeProductionBibleToIndexedDb(indexedDb, normalizedKey, serialized);
        const localStorage = resolveLocalStorage(this.options);
        if (localStorage) {
          try {
            localStorage.setItem(normalizedKey, serialized);
          } catch {
            warnings.push("IndexedDB 저장은 완료됐지만 localStorage 복구 사본은 만들지 못했습니다.");
          }
        }
        return {
          bible,
          backend: "legacy-indexeddb",
          persisted: true,
          localOnly: true,
          ...(warningText(warnings) ? { warning: warningText(warnings) } : {}),
        };
      } catch {
        warnings.push("IndexedDB 저장에 실패해 localStorage로 전환했습니다.");
      }
    }

    const localStorage = resolveLocalStorage(this.options);
    if (localStorage) {
      try {
        localStorage.setItem(normalizedKey, serialized);
        return {
          bible,
          backend: "legacy-local-storage",
          persisted: true,
          localOnly: true,
          ...(warningText(warnings) ? { warning: warningText(warnings) } : {}),
        };
      } catch {
        warnings.push("localStorage 저장도 실패했습니다.");
      }
    }

    warnings.push("새로고침 전까지만 메모리에서 변경을 유지합니다.");
    return {
      bible,
      backend: "memory",
      persisted: false,
      localOnly: true,
      warning: warningText(warnings),
    };
  }
}
