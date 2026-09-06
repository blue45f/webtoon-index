import {
  createStudioShared3dSceneSession,
  createStudioShared3dSceneSessionFromElements,
  parseStudioShared3dCharacterStageTransform,
  studioShared3dCharacterStageTransformHash,
  type StudioShared3dCharacterStageTransform,
  type StudioShared3dCharacterSource,
  type StudioShared3dCharacterTransformCommitResult,
  type StudioShared3dCharacterTransformReceipt,
  type StudioShared3dCharacterTransformUpdateRequest,
  type StudioShared3dSceneSession,
} from "./studio-shared-3d-scene-bridge";
import {
  STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
  STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
  parseStudioShared3dStageDocument,
  refreshStudioShared3dStageDocument,
  remapStudioShared3dStageDocumentElementIds,
  resolveStudioShared3dStageDocument,
  type StudioShared3dStageCapturePolicy,
  type StudioShared3dStageCharacterLink,
  type StudioShared3dStageDccSource,
  type StudioShared3dStageDocument,
  type StudioShared3dStageElementSource,
  type StudioShared3dStageResolution,
} from "./studio-shared-3d-stage-document";

export const STUDIO_SHARED_3D_STAGE_COLLECTION_KIND =
  "toonspectrum.studio-shared-3d-stage-collection" as const;
export const STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION = 3 as const;
export const STUDIO_SHARED_3D_STAGE_COLLECTION_PAGED_VERSION = 4 as const;
const STUDIO_SHARED_3D_STAGE_COLLECTION_LEGACY_VERSION = 2 as const;
/** v4 page size, retained under the historical export name for source compatibility. */
export const STUDIO_SHARED_3D_STAGE_COLLECTION_PAGE_SIZE = 64;
export const STUDIO_SHARED_3D_STAGE_COLLECTION_MAX_STAGES =
  STUDIO_SHARED_3D_STAGE_COLLECTION_PAGE_SIZE;
export const STUDIO_SHARED_3D_STAGE_COLLECTION_MAX_BYTES = 1024 * 1024;

const STUDIO_SHARED_3D_STAGE_ENTRY_MAX_BYTES = 12 * 1024;
const STUDIO_SHARED_3D_STAGE_RECEIPT_PAGE_SIZE = 256;
const STUDIO_SHARED_3D_STAGE_MAX_PAGE_COUNT = 1_024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const MODEL_RUNTIME_KEY_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}:sha256:[a-f0-9]{64}$/u;
const FORBIDDEN_IDS = new Set(["__proto__", "constructor", "prototype"]);
const TEXT_ENCODER = new TextEncoder();

export interface StudioShared3dStageCharacterInstanceLink extends
Omit<StudioShared3dStageCharacterLink, "hiddenByStage"> {
  /** Absolute root placement for this background only; pose/wardrobe/model stay source-owned. */
  readonly placement?: StudioShared3dCharacterStageTransform;
}

export interface StudioShared3dStageEntry {
  /** Stable page-local identity. v1 migration deterministically uses the LT bundle id. */
  readonly id: string;
  readonly capturePolicy: StudioShared3dStageCapturePolicy;
  readonly background: StudioShared3dStageDocument["background"];
  readonly characters: readonly StudioShared3dStageCharacterInstanceLink[];
  readonly dccSource?: StudioShared3dStageDccSource;
}

export interface StudioShared3dStageVisibilityReceipt {
  readonly elementId: string;
  /** Exact model authority hidden by Studio; a replacement model is never unhidden on its behalf. */
  readonly modelRuntimeKey: string;
}

export interface StudioShared3dStageCollectionDocumentV3 {
  readonly kind: typeof STUDIO_SHARED_3D_STAGE_COLLECTION_KIND;
  readonly version: typeof STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION;
  readonly authority: "page-shared-3d-stage-collection";
  readonly stages: readonly StudioShared3dStageEntry[];
  readonly visibilityReceipts: readonly StudioShared3dStageVisibilityReceipt[];
}

export interface StudioShared3dStagePage {
  readonly id: string;
  readonly items: readonly StudioShared3dStageEntry[];
}

export interface StudioShared3dStageVisibilityReceiptPage {
  readonly id: string;
  readonly items: readonly StudioShared3dStageVisibilityReceipt[];
}

export interface StudioShared3dStageCollectionDocumentV4 {
  readonly kind: typeof STUDIO_SHARED_3D_STAGE_COLLECTION_KIND;
  readonly version: typeof STUDIO_SHARED_3D_STAGE_COLLECTION_PAGED_VERSION;
  readonly authority: "page-shared-3d-stage-collection";
  readonly stagePages: readonly StudioShared3dStagePage[];
  readonly visibilityReceiptPages: readonly StudioShared3dStageVisibilityReceiptPage[];
  /** Frozen non-enumerable runtime view; persisted authority remains `stagePages`. */
  readonly stages: readonly StudioShared3dStageEntry[];
  /** Frozen non-enumerable runtime view; persisted authority remains `visibilityReceiptPages`. */
  readonly visibilityReceipts: readonly StudioShared3dStageVisibilityReceipt[];
}

export type StudioShared3dStageCollectionDocument =
  | StudioShared3dStageCollectionDocumentV3
  | StudioShared3dStageCollectionDocumentV4;

/** Historical singular v1 and plural v2 remain readable; mutations write v3 or paged v4 by size. */
export type StudioShared3dStagePersistedState =
  | StudioShared3dStageDocument
  | StudioShared3dStageCollectionDocument;

export interface StudioShared3dStageCollectionMutation<
  T extends StudioShared3dStageElementSource,
> {
  readonly nextState: StudioShared3dStageCollectionDocument | undefined;
  readonly nextElements: readonly T[];
  readonly restoredElementIds: readonly string[];
}

export interface StudioShared3dStageCharacterPlacementCapture {
  readonly elementId: string;
  readonly expectedRuntimeKey: string;
  readonly transform: StudioShared3dCharacterStageTransform;
}

export type StudioShared3dStageCharacterPlacementMutation =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly nextState: StudioShared3dStageCollectionDocument;
      readonly receipt: StudioShared3dCharacterTransformReceipt;
    }
  | Exclude<StudioShared3dCharacterTransformCommitResult, { readonly ok: true }>;

export interface StudioShared3dStageVisibilityReceiptReconciliation {
  readonly nextState: StudioShared3dStageCollectionDocument;
  readonly consumedElementIds: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (
      point <= 0x1f
      || (point >= 0x7f && point <= 0x9f)
      || (point >= 0x202a && point <= 0x202e)
      || (point >= 0x2066 && point <= 0x2069)
    ) return true;
  }
  return false;
}

function safeId(value: unknown): string | null {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 128
    || hasControlCharacter(value)
  ) return null;
  if (!SAFE_ID_PATTERN.test(value) || FORBIDDEN_IDS.has(value.toLowerCase())) return null;
  return value;
}

function safeRuntimeKey(value: unknown, elementId: string): string | null {
  return typeof value === "string"
    && value.length <= 200
    && MODEL_RUNTIME_KEY_PATTERN.test(value)
    && value.startsWith(`${elementId}:`)
    ? value
    : null;
}

function snapshotArray(value: unknown, maxLength: number): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  try {
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > maxLength) return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) snapshot.push(value[index]);
    return value.length === length ? Object.freeze(snapshot) : null;
  } catch {
    return null;
  }
}

function stageEntryAsV1Document(
  entry: StudioShared3dStageEntry,
  receiptAuthorities: ReadonlySet<string> = new Set(),
): StudioShared3dStageDocument | null {
  return parseStudioShared3dStageDocument({
    kind: STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
    version: STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
    authority: "page-background-with-linked-character-sources",
    capturePolicy: entry.capturePolicy,
    background: entry.background,
    characters: entry.characters.map(({ placement: _placement, ...character }) => ({
      ...character,
      ...(receiptAuthorities.has(
        `${character.elementId}\u0000${character.modelRuntimeKey}`,
      ) ? { hiddenByStage: true as const } : {}),
    })),
    ...(entry.dccSource ? { dccSource: entry.dccSource } : {}),
  });
}

function parseStageEntry(value: unknown): StudioShared3dStageEntry | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id",
    "capturePolicy",
    "background",
    "characters",
    "dccSource",
  ])) return null;
  try {
    const id = safeId(value.id);
    const capturePolicy = value.capturePolicy;
    const background = value.background;
    const characters = snapshotArray(value.characters, 12);
    const dccSource = value.dccSource;
    if (!id || !characters) return null;
    const legacyCharacters: Array<{
      readonly elementId: unknown;
      readonly modelRuntimeKey: unknown;
      readonly sourceHash: unknown;
    }> = [];
    const placements: Array<StudioShared3dCharacterStageTransform | undefined> = [];
    for (const candidate of characters) {
      if (!isRecord(candidate) || !hasOnlyKeys(candidate, [
        "elementId",
        "modelRuntimeKey",
        "sourceHash",
        "placement",
      ])) return null;
      const placementValue = candidate.placement;
      const placement = placementValue === undefined
        ? undefined
        : parseStudioShared3dCharacterStageTransform(placementValue) ?? null;
      if (placement === null) return null;
      legacyCharacters.push({
        elementId: candidate.elementId,
        modelRuntimeKey: candidate.modelRuntimeKey,
        sourceHash: candidate.sourceHash,
      });
      placements.push(placement);
    }
    const legacy = parseStudioShared3dStageDocument({
      kind: STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
      version: STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
      authority: "page-background-with-linked-character-sources",
      capturePolicy,
      background,
      characters: legacyCharacters,
      ...(dccSource === undefined ? {} : { dccSource }),
    });
    if (!legacy || legacy.characters.some(({ hiddenByStage }) => hiddenByStage === true)) {
      return null;
    }
    const entry: StudioShared3dStageEntry = Object.freeze({
      id,
      capturePolicy: legacy.capturePolicy,
      background: legacy.background,
      characters: Object.freeze(legacy.characters.map((character, index) => Object.freeze({
        elementId: character.elementId,
        modelRuntimeKey: character.modelRuntimeKey,
        sourceHash: character.sourceHash,
        ...(placements[index] ? { placement: placements[index] } : {}),
      }))),
      ...(legacy.dccSource ? { dccSource: legacy.dccSource } : {}),
    });
    return TEXT_ENCODER.encode(JSON.stringify(entry)).byteLength
      <= STUDIO_SHARED_3D_STAGE_ENTRY_MAX_BYTES
      ? entry
      : null;
  } catch {
    return null;
  }
}

function parseVisibilityReceipt(value: unknown): StudioShared3dStageVisibilityReceipt | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["elementId", "modelRuntimeKey"])) return null;
  try {
    const elementId = safeId(value.elementId);
    const modelRuntimeKey = elementId
      ? safeRuntimeKey(value.modelRuntimeKey, elementId)
      : null;
    return elementId && modelRuntimeKey
      ? Object.freeze({ elementId, modelRuntimeKey })
      : null;
  } catch {
    return null;
  }
}

function entryFromV1Document(
  document: StudioShared3dStageDocument,
  id = document.background.bundleId,
): StudioShared3dStageEntry | null {
  return parseStageEntry({
    id,
    capturePolicy: document.capturePolicy,
    background: document.background,
    characters: document.characters.map(({ hiddenByStage: _hiddenByStage, ...character }) =>
      character),
    ...(document.dccSource ? { dccSource: document.dccSource } : {}),
  });
}

interface ParsedStudioShared3dStageCollectionEntries {
  readonly stages: readonly StudioShared3dStageEntry[];
  readonly visibilityReceipts: readonly StudioShared3dStageVisibilityReceipt[];
}

function parseCollectionEntries(
  stageCandidates: readonly unknown[],
  receiptCandidates: readonly unknown[],
): ParsedStudioShared3dStageCollectionEntries | null {
  if (stageCandidates.length === 0) return null;
  const stages: StudioShared3dStageEntry[] = [];
  const stageIds = new Set<string>();
  const bundleIds = new Set<string>();
  const characterRuntimeKeys = new Map<string, Set<string>>();
  for (const candidate of stageCandidates) {
    const stage = parseStageEntry(candidate);
    if (
      !stage
      || stageIds.has(stage.id)
      || bundleIds.has(stage.background.bundleId)
    ) return null;
    stageIds.add(stage.id);
    bundleIds.add(stage.background.bundleId);
    for (const character of stage.characters) {
      const runtimeKeys = characterRuntimeKeys.get(character.elementId) ?? new Set<string>();
      runtimeKeys.add(character.modelRuntimeKey);
      characterRuntimeKeys.set(character.elementId, runtimeKeys);
    }
    stages.push(stage);
  }

  const visibilityReceipts: StudioShared3dStageVisibilityReceipt[] = [];
  const receiptIds = new Set<string>();
  for (const candidate of receiptCandidates) {
    const receipt = parseVisibilityReceipt(candidate);
    if (
      !receipt
      || receiptIds.has(receipt.elementId)
      || !characterRuntimeKeys.get(receipt.elementId)?.has(receipt.modelRuntimeKey)
    ) return null;
    receiptIds.add(receipt.elementId);
    visibilityReceipts.push(receipt);
  }
  return Object.freeze({
    stages: Object.freeze(stages),
    visibilityReceipts: Object.freeze(visibilityReceipts),
  });
}

function serializedFingerprint(serialized: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function pageFingerprint(value: unknown): string {
  return serializedFingerprint(JSON.stringify(value));
}

function collectionCursorGeneration(
  collection: StudioShared3dStageCollectionDocument,
): string {
  const serialized = JSON.stringify(collection);
  return `${serialized.length.toString(36)}-${serializedFingerprint(serialized)}`;
}

function pageId(prefix: "stage" | "receipt", index: number, items: unknown): string {
  return `${prefix}-page-${index.toString(36).padStart(4, "0")}-${pageFingerprint(items)}`;
}

function chunkPages<T>(
  values: readonly T[],
  pageSize: number,
  prefix: "stage" | "receipt",
): readonly Readonly<{ readonly id: string; readonly items: readonly T[] }>[] {
  const pages: Array<Readonly<{ readonly id: string; readonly items: readonly T[] }>> = [];
  for (let offset = 0; offset < values.length; offset += pageSize) {
    const items = Object.freeze(values.slice(offset, offset + pageSize));
    pages.push(Object.freeze({
      id: pageId(prefix, pages.length, items),
      items,
    }));
  }
  return Object.freeze(pages);
}

function buildPagedCollectionDocument(
  entries: ParsedStudioShared3dStageCollectionEntries,
): StudioShared3dStageCollectionDocumentV4 | null {
  const stagePages = chunkPages(
    entries.stages,
    STUDIO_SHARED_3D_STAGE_COLLECTION_PAGE_SIZE,
    "stage",
  ) as readonly StudioShared3dStagePage[];
  const visibilityReceiptPages = chunkPages(
    entries.visibilityReceipts,
    STUDIO_SHARED_3D_STAGE_RECEIPT_PAGE_SIZE,
    "receipt",
  ) as readonly StudioShared3dStageVisibilityReceiptPage[];
  if (
    stagePages.length === 0
    || stagePages.length > STUDIO_SHARED_3D_STAGE_MAX_PAGE_COUNT
    || visibilityReceiptPages.length > STUDIO_SHARED_3D_STAGE_MAX_PAGE_COUNT
  ) return null;
  const document = {
    kind: STUDIO_SHARED_3D_STAGE_COLLECTION_KIND,
    version: STUDIO_SHARED_3D_STAGE_COLLECTION_PAGED_VERSION,
    authority: "page-shared-3d-stage-collection" as const,
    stagePages,
    visibilityReceiptPages,
  } as StudioShared3dStageCollectionDocumentV4;
  Object.defineProperties(document, {
    stages: { enumerable: false, value: entries.stages },
    visibilityReceipts: { enumerable: false, value: entries.visibilityReceipts },
  });
  Object.freeze(document);
  return TEXT_ENCODER.encode(JSON.stringify(document)).byteLength
    <= STUDIO_SHARED_3D_STAGE_COLLECTION_MAX_BYTES
    ? document
    : null;
}

function parseFlatCollectionV3(
  value: Record<string, unknown>,
): StudioShared3dStageCollectionDocumentV3 | null {
  if (!hasOnlyKeys(value, [
    "kind",
    "version",
    "authority",
    "stages",
    "visibilityReceipts",
  ])) return null;
  if (
    value.kind !== STUDIO_SHARED_3D_STAGE_COLLECTION_KIND
    || value.version !== STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION
    || value.authority !== "page-shared-3d-stage-collection"
  ) return null;
  const stageCandidates = snapshotArray(
    value.stages,
    STUDIO_SHARED_3D_STAGE_COLLECTION_PAGE_SIZE,
  );
  const receiptCandidates = snapshotArray(
    value.visibilityReceipts,
    STUDIO_SHARED_3D_STAGE_COLLECTION_PAGE_SIZE * 12,
  );
  if (!stageCandidates || !receiptCandidates) return null;
  const entries = parseCollectionEntries(stageCandidates, receiptCandidates);
  if (!entries) return null;
  const document: StudioShared3dStageCollectionDocumentV3 = Object.freeze({
    kind: STUDIO_SHARED_3D_STAGE_COLLECTION_KIND,
    version: STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION,
    authority: "page-shared-3d-stage-collection",
    stages: entries.stages,
    visibilityReceipts: entries.visibilityReceipts,
  });
  return TEXT_ENCODER.encode(JSON.stringify(document)).byteLength
    <= STUDIO_SHARED_3D_STAGE_COLLECTION_MAX_BYTES
    ? document
    : null;
}

function parsePageItems(
  value: unknown,
  maximum: number,
  prefix: "stage" | "receipt",
): readonly unknown[] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "items"])) return null;
  if (typeof value.id !== "string" || !value.id.startsWith(`${prefix}-page-`)) return null;
  const items = snapshotArray(value.items, maximum);
  return items && items.length > 0 ? items : null;
}

function parsePagedCollectionV4(
  value: Record<string, unknown>,
): StudioShared3dStageCollectionDocumentV4 | null {
  if (!hasOnlyKeys(value, [
    "kind",
    "version",
    "authority",
    "stagePages",
    "visibilityReceiptPages",
  ])) return null;
  if (
    value.kind !== STUDIO_SHARED_3D_STAGE_COLLECTION_KIND
    || value.version !== STUDIO_SHARED_3D_STAGE_COLLECTION_PAGED_VERSION
    || value.authority !== "page-shared-3d-stage-collection"
  ) return null;
  const serialized = JSON.stringify(value);
  if (TEXT_ENCODER.encode(serialized).byteLength > STUDIO_SHARED_3D_STAGE_COLLECTION_MAX_BYTES) {
    return null;
  }
  const rawStagePages = snapshotArray(value.stagePages, STUDIO_SHARED_3D_STAGE_MAX_PAGE_COUNT);
  const rawReceiptPages = snapshotArray(
    value.visibilityReceiptPages,
    STUDIO_SHARED_3D_STAGE_MAX_PAGE_COUNT,
  );
  if (!rawStagePages || rawStagePages.length === 0 || !rawReceiptPages) return null;
  const stageCandidates: unknown[] = [];
  for (const rawPage of rawStagePages) {
    const items = parsePageItems(
      rawPage,
      STUDIO_SHARED_3D_STAGE_COLLECTION_PAGE_SIZE,
      "stage",
    );
    if (!items) return null;
    stageCandidates.push(...items);
  }
  const receiptCandidates: unknown[] = [];
  for (const rawPage of rawReceiptPages) {
    const items = parsePageItems(
      rawPage,
      STUDIO_SHARED_3D_STAGE_RECEIPT_PAGE_SIZE,
      "receipt",
    );
    if (!items) return null;
    receiptCandidates.push(...items);
  }
  const entries = parseCollectionEntries(stageCandidates, receiptCandidates);
  const canonical = entries ? buildPagedCollectionDocument(entries) : null;
  return canonical && JSON.stringify(canonical) === serialized ? canonical : null;
}

export function parseStudioShared3dStageCollectionDocument(
  value: unknown,
): StudioShared3dStageCollectionDocument | null {
  try {
    if (!isRecord(value)) return null;
    return value.version === STUDIO_SHARED_3D_STAGE_COLLECTION_PAGED_VERSION
      ? parsePagedCollectionV4(value)
      : parseFlatCollectionV3(value);
  } catch {
    return null;
  }
}

/** Strictly migrates historical singular v1 or plural v2 into canonical placement-aware v3. */
export function migrateStudioShared3dStageCollectionDocument(
  value: unknown,
): StudioShared3dStageCollectionDocument | null {
  const current = parseStudioShared3dStageCollectionDocument(value);
  if (current) return current;
  if (
    isRecord(value)
    && value.kind === STUDIO_SHARED_3D_STAGE_COLLECTION_KIND
    && value.version === STUDIO_SHARED_3D_STAGE_COLLECTION_LEGACY_VERSION
  ) {
    const migratedPlural = parseStudioShared3dStageCollectionDocument({
      ...value,
      version: STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION,
    });
    if (migratedPlural) return migratedPlural;
  }
  const legacy = parseStudioShared3dStageDocument(value);
  if (!legacy) return null;
  const entry = entryFromV1Document(legacy);
  if (!entry) return null;
  return parseStudioShared3dStageCollectionDocument({
    kind: STUDIO_SHARED_3D_STAGE_COLLECTION_KIND,
    version: STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION,
    authority: "page-shared-3d-stage-collection",
    stages: [entry],
    visibilityReceipts: legacy.characters.flatMap((character) =>
      character.hiddenByStage === true
        ? [{
            elementId: character.elementId,
            modelRuntimeKey: character.modelRuntimeKey,
          }]
        : []),
  });
}

export function serializeStudioShared3dStageCollectionDocument(value: unknown): string | null {
  const document = migrateStudioShared3dStageCollectionDocument(value);
  return document ? JSON.stringify(document) : null;
}

export function studioShared3dStageCollectionEntries(
  value: unknown,
): readonly StudioShared3dStageEntry[] | null {
  if (value === undefined || value === null) return Object.freeze([]);
  return migrateStudioShared3dStageCollectionDocument(value)?.stages ?? null;
}

export type StudioShared3dStagePageCursor = string & {
  readonly __studioShared3dStagePageCursor: unique symbol;
};

export interface StudioShared3dStageCollectionPageResult {
  readonly items: readonly StudioShared3dStageEntry[];
  readonly cursor: StudioShared3dStagePageCursor;
  readonly nextCursor: StudioShared3dStagePageCursor | null;
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly totalCount: number;
}

/** Reads one canonical metadata page. A cursor from an older collection fails closed. */
export function queryStudioShared3dStageCollectionPage(
  value: unknown,
  options: { readonly cursor?: string | null } = {},
): StudioShared3dStageCollectionPageResult | null {
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  if (!collection) return null;
  const pages = collection.version === STUDIO_SHARED_3D_STAGE_COLLECTION_PAGED_VERSION
    ? collection.stagePages
    : chunkPages(
        collection.stages,
        STUDIO_SHARED_3D_STAGE_COLLECTION_PAGE_SIZE,
        "stage",
      ) as readonly StudioShared3dStagePage[];
  const generation = collectionCursorGeneration(collection);
  const cursorForPage = (page: StudioShared3dStagePage) =>
    `stage-cursor-${generation}-${page.id}` as StudioShared3dStagePageCursor;
  const pageIndex = options.cursor === undefined || options.cursor === null
    ? 0
    : pages.findIndex((page) => cursorForPage(page) === options.cursor);
  const page = pages[pageIndex];
  if (pageIndex < 0 || !page) return null;
  return Object.freeze({
    items: page.items,
    cursor: cursorForPage(page),
    nextCursor: pages[pageIndex + 1] ? cursorForPage(pages[pageIndex + 1]) : null,
    pageIndex,
    pageCount: pages.length,
    totalCount: collection.stages.length,
  });
}

export function findStudioShared3dStageEntryByBundleId(
  value: unknown,
  bundleId: string | null | undefined,
): StudioShared3dStageEntry | null {
  if (!bundleId) return null;
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  return collection?.stages.find((stage) => stage.background.bundleId === bundleId) ?? null;
}

export function studioShared3dStageEntryAsDocument(
  value: unknown,
  bundleId: string | null | undefined,
): StudioShared3dStageDocument | null {
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  const stage = collection?.stages.find((candidate) =>
    candidate.background.bundleId === bundleId);
  if (!collection || !stage) return null;
  const receiptAuthorities = new Set(collection.visibilityReceipts.map((receipt) =>
    `${receipt.elementId}\u0000${receipt.modelRuntimeKey}`));
  return stageEntryAsV1Document(stage, receiptAuthorities);
}

export function resolveStudioShared3dStageCollectionForBundle(
  value: unknown,
  elements: readonly StudioShared3dStageElementSource[],
  bundleId: string | null | undefined,
): StudioShared3dStageResolution {
  if (value === undefined || value === null || !bundleId) {
    return resolveStudioShared3dStageDocument(undefined, elements);
  }
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  if (!collection) return resolveStudioShared3dStageDocument({}, elements);
  const document = studioShared3dStageEntryAsDocument(collection, bundleId);
  return resolveStudioShared3dStageDocument(document ?? undefined, elements);
}

export function studioShared3dStageOwnedCharacterElementIds(
  value: unknown,
  exceptBundleId?: string | null,
): ReadonlySet<string> {
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  return new Set(collection?.stages.flatMap((stage) =>
    stage.background.bundleId === exceptBundleId
      ? []
      : stage.characters.map(({ elementId }) => elementId)) ?? []);
}

export function studioShared3dStageLinkedCharacterElementIds(
  value: unknown,
): readonly string[] | null {
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  return collection
    ? Object.freeze(collection.stages.flatMap((stage) =>
        stage.characters.map(({ elementId }) => elementId)))
    : null;
}

function exactCharacterSource<T extends StudioShared3dStageElementSource>(
  elements: readonly T[],
  elementId: string,
): StudioShared3dCharacterSource | null {
  const matches = elements.filter((element) => element.id === elementId);
  if (matches.length !== 1) return null;
  const session = createStudioShared3dSceneSessionFromElements(matches);
  return session.characters.length === 1 && session.characters[0]?.elementId === elementId
    ? session.characters[0]
    : null;
}

function entryWithCharacterPlacements<T extends StudioShared3dStageElementSource>(input: {
  readonly entry: StudioShared3dStageEntry;
  readonly elements: readonly T[];
  readonly priorTarget?: StudioShared3dStageEntry;
  readonly placementCaptures?: readonly StudioShared3dStageCharacterPlacementCapture[];
}): StudioShared3dStageEntry | null {
  const captures = input.placementCaptures ?? [];
  if (
    captures.length > 12
    || new Set(captures.map(({ elementId }) => elementId)).size !== captures.length
    || (
      input.placementCaptures !== undefined
      && captures.length !== input.entry.characters.length
    )
  ) return null;
  const entryIds = new Set(input.entry.characters.map(({ elementId }) => elementId));
  const captureById = new Map<string, {
    readonly expectedRuntimeKey: string;
    readonly transform: StudioShared3dCharacterStageTransform;
  }>();
  for (const capture of captures) {
    const elementId = safeId(capture?.elementId);
    const transform = parseStudioShared3dCharacterStageTransform(capture?.transform);
    if (
      !elementId
      || !entryIds.has(elementId)
      || typeof capture?.expectedRuntimeKey !== "string"
      || capture.expectedRuntimeKey.length < 1
      || capture.expectedRuntimeKey.length > 256
      || !transform
    ) return null;
    captureById.set(elementId, {
      expectedRuntimeKey: capture.expectedRuntimeKey,
      transform,
    });
  }

  const priorById = new Map(input.priorTarget?.characters.map((character) =>
    [character.elementId, character] as const) ?? []);
  const characters: StudioShared3dStageCharacterInstanceLink[] = [];
  for (const character of input.entry.characters) {
    const source = exactCharacterSource(input.elements, character.elementId);
    if (!source || source.modelRuntimeKey !== character.modelRuntimeKey) return null;
    const captured = captureById.get(character.elementId);
    if (captured && captured.expectedRuntimeKey !== source.runtimeKey) return null;
    const prior = priorById.get(character.elementId);
    const placement = captured?.transform
      ?? (
        prior?.modelRuntimeKey === character.modelRuntimeKey
          ? prior.placement
          : undefined
      )
      ?? source.stageTransform;
    characters.push(Object.freeze({
      elementId: character.elementId,
      modelRuntimeKey: character.modelRuntimeKey,
      sourceHash: character.sourceHash,
      placement,
    }));
  }
  return parseStageEntry({
    id: input.entry.id,
    capturePolicy: input.entry.capturePolicy,
    background: input.entry.background,
    characters,
    ...(input.entry.dccSource ? { dccSource: input.entry.dccSource } : {}),
  });
}

export function createStudioShared3dSceneSessionForStage(
  value: unknown,
  elements: readonly StudioShared3dStageElementSource[],
  bundleId: string | null | undefined,
): StudioShared3dSceneSession {
  const stage = findStudioShared3dStageEntryByBundleId(value, bundleId);
  if (!stage) return createStudioShared3dSceneSession([]);
  return createStudioShared3dSceneSession(stage.characters.flatMap((character) => {
    const source = exactCharacterSource(elements, character.elementId);
    // The resolver separately exposes live-update and replacement status. Preview the unique
    // current authority so the artist can inspect and explicitly refresh/relink it, while the
    // Stage placement remains stable and no document mutation occurs merely by opening the tool.
    return source ? [{
          elementId: character.elementId,
          label: source.label,
          scene: source.scene,
          ...(character.placement ? { stageTransform: character.placement } : {}),
          stageId: stage.id,
        }] : [];
  }));
}

function exactRuntimeKey<T extends StudioShared3dStageElementSource>(
  elements: readonly T[],
  elementId: string,
): string | null {
  return exactCharacterSource(elements, elementId)?.modelRuntimeKey ?? null;
}

function hasExactHiddenRuntimeAuthority<T extends StudioShared3dStageElementSource>(
  elements: readonly T[],
  receipt: StudioShared3dStageVisibilityReceipt,
): boolean {
  const matches = elements.filter((element) => element.id === receipt.elementId);
  const element = matches[0];
  return matches.length === 1
    && element?.type === "image"
    && element.vrmScene !== undefined
    && element.hidden === true
    && exactRuntimeKey(elements, receipt.elementId) === receipt.modelRuntimeKey;
}

/**
 * Resolves the exact sources whose visibility is currently owned by an active Stage receipt.
 * Unlike `studioShared3dStageReusableHiddenCharacterElementIds`, this intentionally ignores the
 * element's scalar `hidden` value: realtime collaboration stores the artist-authored visibility as
 * the scalar and derives Stage-owned hiding from this receipt authority.
 */
export function studioShared3dStageVisibilityOverlayElementIds<
  T extends StudioShared3dStageElementSource,
>(
  value: unknown,
  elements: readonly T[],
): ReadonlySet<string> {
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  if (!collection) return new Set();
  const counts = new Map<string, number>();
  for (const element of elements) {
    counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
  }
  const result = new Set<string>();
  for (const receipt of collection.visibilityReceipts) {
    const element = elements.find((candidate) => candidate.id === receipt.elementId);
    if (
      counts.get(receipt.elementId) === 1
      && element?.type === "image"
      && element.vrmScene !== undefined
      && exactRuntimeKey(elements, receipt.elementId) === receipt.modelRuntimeKey
    ) {
      result.add(receipt.elementId);
    }
  }
  return result;
}

export function studioShared3dStageReusableHiddenCharacterElementIds<
  T extends StudioShared3dStageElementSource,
>(
  value: unknown,
  elements: readonly T[],
): ReadonlySet<string> {
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  return new Set(collection?.visibilityReceipts.flatMap((receipt) =>
    hasExactHiddenRuntimeAuthority(elements, receipt) ? [receipt.elementId] : []) ?? []);
}

function releaseOrphanedVisibilityReceipts<T extends StudioShared3dStageElementSource>(
  elements: readonly T[],
  receipts: readonly StudioShared3dStageVisibilityReceipt[],
): { readonly nextElements: readonly T[]; readonly restoredElementIds: readonly string[] } {
  if (receipts.length === 0) {
    return Object.freeze({ nextElements: elements, restoredElementIds: Object.freeze([]) });
  }
  const receiptById = new Map(receipts.map((receipt) => [receipt.elementId, receipt] as const));
  const counts = new Map<string, number>();
  for (const element of elements) {
    if (receiptById.has(element.id)) counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
  }
  const restoredElementIds: string[] = [];
  const nextElements = elements.map((element) => {
    const receipt = receiptById.get(element.id);
    if (
      !receipt
      || counts.get(element.id) !== 1
      || element.type !== "image"
      || !element.vrmScene
      || element.hidden !== true
      || exactRuntimeKey(elements, element.id) !== receipt.modelRuntimeKey
    ) return element;
    restoredElementIds.push(element.id);
    return { ...element, hidden: false };
  });
  return Object.freeze({
    nextElements: restoredElementIds.length > 0 ? Object.freeze(nextElements) : elements,
    restoredElementIds: Object.freeze(restoredElementIds),
  });
}

function buildCollection(
  stages: readonly StudioShared3dStageEntry[],
  receipts: readonly StudioShared3dStageVisibilityReceipt[],
): StudioShared3dStageCollectionDocument | null {
  const flatCandidate = {
    kind: STUDIO_SHARED_3D_STAGE_COLLECTION_KIND,
    version: STUDIO_SHARED_3D_STAGE_COLLECTION_VERSION,
    authority: "page-shared-3d-stage-collection",
    stages,
    visibilityReceipts: receipts,
  } as const;
  if (stages.length <= STUDIO_SHARED_3D_STAGE_COLLECTION_PAGE_SIZE) {
    return parseStudioShared3dStageCollectionDocument(flatCandidate);
  }
  const entries = parseCollectionEntries(stages, receipts);
  return entries ? buildPagedCollectionDocument(entries) : null;
}

/**
 * Validates page-owned Stage metadata and selects flat v3 or paged v4 without changing authority.
 */
export function createStudioShared3dStageCollectionDocument(input: {
  readonly stages: readonly StudioShared3dStageEntry[];
  readonly visibilityReceipts: readonly StudioShared3dStageVisibilityReceipt[];
}): StudioShared3dStageCollectionDocument | null {
  return buildCollection(input.stages, input.visibilityReceipts);
}

function uniqueElementsById<T extends StudioShared3dStageElementSource>(
  elements: readonly T[],
): ReadonlyMap<string, T | null> {
  const byId = new Map<string, T | null>();
  for (const element of elements) {
    byId.set(element.id, byId.has(element.id) ? null : element);
  }
  return byId;
}

/**
 * Consumes Studio's visibility ownership when a generic element mutation explicitly reveals the
 * exact source that a Stage had hidden. Once consumed, a later user-authored hide is never undone
 * by Stage removal. Missing, duplicate and replacement authorities remain untouched tombstones.
 */
export function reconcileStudioShared3dStageVisibilityReceiptsAfterElementMutation<
  T extends StudioShared3dStageElementSource,
>(input: {
  readonly value: unknown;
  readonly beforeElements: readonly T[];
  readonly nextElements: readonly T[];
}): StudioShared3dStageVisibilityReceiptReconciliation | null {
  const collection = migrateStudioShared3dStageCollectionDocument(input.value);
  if (!collection) return null;
  const beforeById = uniqueElementsById(input.beforeElements);
  const nextById = uniqueElementsById(input.nextElements);
  const consumedElementIds: string[] = [];
  const retainedReceipts = collection.visibilityReceipts.filter((receipt) => {
    const before = beforeById.get(receipt.elementId);
    const next = nextById.get(receipt.elementId);
    if (
      !before
      || !next
      || before.type !== "image"
      || next.type !== "image"
      || !before.vrmScene
      || !next.vrmScene
      || before.hidden !== true
      || next.hidden === true
    ) return true;
    if (
      exactRuntimeKey([before], receipt.elementId) !== receipt.modelRuntimeKey
      || exactRuntimeKey([next], receipt.elementId) !== receipt.modelRuntimeKey
    ) return true;
    consumedElementIds.push(receipt.elementId);
    return false;
  });
  if (consumedElementIds.length === 0) {
    return Object.freeze({
      nextState: collection,
      consumedElementIds: Object.freeze([]),
    });
  }
  const nextState = buildCollection(collection.stages, retainedReceipts);
  return nextState
    ? Object.freeze({
        nextState,
        consumedElementIds: Object.freeze(consumedElementIds),
      })
    : null;
}

/**
 * Adds or replaces one exact background Stage and updates Studio-owned source visibility as one
 * immutable plan. The caller commits both arrays in the same undo transaction.
 */
export function planStudioShared3dStageCollectionUpsert<
  T extends StudioShared3dStageElementSource,
>(input: {
  readonly value: unknown;
  readonly stage: StudioShared3dStageDocument;
  readonly elements: readonly T[];
  readonly placementCaptures?: readonly StudioShared3dStageCharacterPlacementCapture[];
}): StudioShared3dStageCollectionMutation<T> | null {
  const collection = input.value === undefined || input.value === null
    ? null
    : migrateStudioShared3dStageCollectionDocument(input.value);
  if (input.value !== undefined && input.value !== null && !collection) return null;
  const document = parseStudioShared3dStageDocument(input.stage);
  if (!document) return null;
  const priorStages = collection?.stages ?? [];
  const priorTargetIndex = priorStages.findIndex((stage) =>
    stage.background.bundleId === document.background.bundleId);
  const priorTarget = priorStages[priorTargetIndex];
  const provisionalEntry = entryFromV1Document(document, priorTarget?.id);
  const entry = provisionalEntry
    ? entryWithCharacterPlacements({
        entry: provisionalEntry,
        elements: input.elements,
        ...(priorTarget ? { priorTarget } : {}),
        ...(input.placementCaptures
          ? { placementCaptures: input.placementCaptures }
          : {}),
      })
    : null;
  if (!entry) return null;
  if (
    priorTargetIndex < 0
    && priorStages.some((stage) => stage.id === entry.id)
  ) return null;
  const nextStages = priorTargetIndex >= 0
    ? priorStages.map((stage, index) => index === priorTargetIndex ? entry : stage)
    : [...priorStages, entry];
  const referencedRuntimeKeys = new Set(nextStages.flatMap((stage) =>
    stage.characters.map((character) =>
      `${character.elementId}\u0000${character.modelRuntimeKey}`)));
  const receiptCandidates = new Map<string, StudioShared3dStageVisibilityReceipt>();
  for (const receipt of collection?.visibilityReceipts ?? []) {
    if (referencedRuntimeKeys.has(`${receipt.elementId}\u0000${receipt.modelRuntimeKey}`)) {
      receiptCandidates.set(receipt.elementId, receipt);
    }
  }
  for (const character of document.characters) {
    if (character.hiddenByStage === true) {
      const receipt = Object.freeze({
        elementId: character.elementId,
        modelRuntimeKey: character.modelRuntimeKey,
      });
      if (
        !receiptCandidates.has(character.elementId)
        && !hasExactHiddenRuntimeAuthority(input.elements, receipt)
      ) return null;
      receiptCandidates.set(character.elementId, receipt);
    }
  }
  const nextCollection = buildCollection(nextStages, [...receiptCandidates.values()]);
  if (!nextCollection) return null;
  const retainedReceiptIds = new Set(nextCollection.visibilityReceipts.map(({ elementId }) =>
    elementId));
  const orphaned = (collection?.visibilityReceipts ?? []).filter(({ elementId }) =>
    !retainedReceiptIds.has(elementId));
  const release = releaseOrphanedVisibilityReceipts(input.elements, orphaned);
  return Object.freeze({
    nextState: nextCollection,
    nextElements: release.nextElements,
    restoredElementIds: release.restoredElementIds,
  });
}

export function refreshStudioShared3dStageCollectionEntry<
  T extends StudioShared3dStageElementSource,
>(input: {
  readonly value: unknown;
  readonly bundleId: string;
  readonly elements: readonly T[];
}): StudioShared3dStageCollectionMutation<T> | null {
  const document = studioShared3dStageEntryAsDocument(input.value, input.bundleId);
  const refreshed = document
    ? refreshStudioShared3dStageDocument(document, input.elements)
    : null;
  return refreshed
    ? planStudioShared3dStageCollectionUpsert({
        value: input.value,
        stage: refreshed,
        elements: input.elements,
      })
    : null;
}

/**
 * Writes one character root placement into one exact background Stage only. The canonical VRM
 * source remains untouched, so the same model can appear in several shots with independent
 * position and yaw while sharing pose, wardrobe, expression, props and model provenance.
 */
export function planStudioShared3dStageCharacterPlacementUpdate<
  T extends StudioShared3dStageElementSource,
>(input: {
  readonly value: unknown;
  readonly bundleId: string;
  readonly elements: readonly T[];
  readonly request: StudioShared3dCharacterTransformUpdateRequest;
  /** Stage/background authority lock; a source-layer lock does not own Stage-local placement. */
  readonly stageLocked?: boolean;
}): StudioShared3dStageCharacterPlacementMutation {
  const collection = migrateStudioShared3dStageCollectionDocument(input.value);
  const bundleId = safeId(input.bundleId);
  const elementId = safeId(input.request?.elementId);
  const transform = parseStudioShared3dCharacterStageTransform(input.request?.transform);
  if (
    !collection
    || !bundleId
    || !elementId
    || typeof input.request?.expectedRuntimeKey !== "string"
    || input.request.expectedRuntimeKey.length < 1
    || input.request.expectedRuntimeKey.length > 256
    || (
      input.request.expectedPlacementHash !== undefined
      && !/^sha256:[a-f0-9]{64}$/u.test(input.request.expectedPlacementHash)
    )
    || !transform
  ) {
    return Object.freeze({
      ok: false as const,
      code: "invalid-request" as const,
      message: "이 배경의 캐릭터 위치·높이·방향 값이 올바르지 않아 바꾸지 않았어요.",
    });
  }

  const stageIndex = collection.stages.findIndex((stage) =>
    stage.background.bundleId === bundleId);
  const stage = collection.stages[stageIndex];
  if (!stage) {
    return Object.freeze({
      ok: false as const,
      code: "missing-source" as const,
      message: "연결된 3D 배경을 정확히 찾지 못해 캐릭터 배치를 바꾸지 않았어요.",
    });
  }
  const characterIndex = stage.characters.findIndex((character) =>
    character.elementId === elementId);
  const character = stage.characters[characterIndex];
  const matchingElements = input.elements.filter((element) => element.id === elementId);
  const sourceElement = matchingElements[0];
  const source = exactCharacterSource(input.elements, elementId);
  if (
    !character
    || matchingElements.length !== 1
    || !sourceElement
    || !source
    || source.modelRuntimeKey !== character.modelRuntimeKey
    || source.sourceHash !== character.sourceHash
  ) {
    return Object.freeze({
      ok: false as const,
      code: character ? "stale-source" as const : "missing-source" as const,
      message: character
        ? "캐릭터 원본이 이 배경을 연 뒤 바뀌어 오래된 배치를 적용하지 않았어요. 현재 원본으로 다시 연결해 주세요."
        : "이 배경에 연결된 캐릭터 원본을 정확히 찾지 못해 배치를 바꾸지 않았어요.",
    });
  }
  if (input.stageLocked) {
    return Object.freeze({
      ok: false as const,
      code: "locked-source" as const,
      message: "이 3D 배경이 잠겨 있어 캐릭터 배치를 바꾸지 않았어요. 배경 잠금을 먼저 해제해 주세요.",
    });
  }
  if (source.runtimeKey !== input.request.expectedRuntimeKey) {
    return Object.freeze({
      ok: false as const,
      code: "stale-source" as const,
      message: "캐릭터 원본이 미리보기 이후 바뀌어 오래된 배치를 적용하지 않았어요. 현재 값을 다시 확인해 주세요.",
    });
  }

  const beforeTransform = character.placement ?? source.stageTransform;
  const beforePlacementHash = studioShared3dCharacterStageTransformHash(beforeTransform);
  if (
    input.request.expectedPlacementHash !== undefined
    && input.request.expectedPlacementHash !== beforePlacementHash
  ) {
    return Object.freeze({
      ok: false as const,
      code: "stale-source" as const,
      message: "이 배경의 캐릭터 배치가 미리보기 이후 바뀌어 오래된 값을 적용하지 않았어요. 현재 값을 다시 확인해 주세요.",
    });
  }

  const afterPlacementHash = studioShared3dCharacterStageTransformHash(transform);
  const receipt: StudioShared3dCharacterTransformReceipt = Object.freeze({
    kind: "toonspectrum.shared-3d-character-transform-receipt" as const,
    version: 1 as const,
    elementId,
    beforeSourceHash: source.sourceHash,
    afterSourceHash: source.sourceHash,
    beforeRuntimeKey: source.runtimeKey,
    afterRuntimeKey: source.runtimeKey,
    authority: "stage-override" as const,
    stageId: stage.id,
    beforePlacementHash,
    afterPlacementHash,
    transform,
  });
  const changed = character.placement === undefined
    || beforePlacementHash !== afterPlacementHash;
  if (!changed) {
    return Object.freeze({
      ok: true as const,
      changed: false,
      nextState: collection,
      receipt,
    });
  }

  const nextCharacters = stage.characters.map((candidate, index) =>
    index === characterIndex
      ? Object.freeze({ ...candidate, placement: transform })
      : candidate);
  const nextStage = parseStageEntry({
    ...stage,
    characters: nextCharacters,
  });
  if (!nextStage) {
    return Object.freeze({
      ok: false as const,
      code: "commit-rejected" as const,
      message: "이 배경의 캐릭터 배치를 안전한 Stage 문서로 만들지 못해 변경하지 않았어요.",
    });
  }
  const nextState = buildCollection(
    collection.stages.map((candidate, index) => index === stageIndex ? nextStage : candidate),
    collection.visibilityReceipts,
  );
  return nextState
    ? Object.freeze({
        ok: true as const,
        changed: true,
        nextState,
        receipt,
      })
    : Object.freeze({
        ok: false as const,
        code: "commit-rejected" as const,
        message: "이 배경의 캐릭터 배치를 저장하지 못해 원본과 다른 배경은 그대로 유지했어요.",
      });
}

export function planStudioShared3dStageCollectionRemoval<
  T extends StudioShared3dStageElementSource,
>(input: {
  readonly value: unknown;
  readonly bundleIds: readonly string[];
  readonly elements: readonly T[];
}): StudioShared3dStageCollectionMutation<T> | null {
  const collection = migrateStudioShared3dStageCollectionDocument(input.value);
  if (!collection) return null;
  const remove = new Set(input.bundleIds);
  if (remove.size !== input.bundleIds.length) return null;
  const nextStages = collection.stages.filter((stage) =>
    !remove.has(stage.background.bundleId));
  const referencedAuthorities = new Set(nextStages.flatMap((stage) =>
    stage.characters.map(({ elementId, modelRuntimeKey }) =>
      `${elementId}\u0000${modelRuntimeKey}`)));
  const retainedReceipts = collection.visibilityReceipts.filter((receipt) =>
    referencedAuthorities.has(`${receipt.elementId}\u0000${receipt.modelRuntimeKey}`));
  const orphanedReceipts = collection.visibilityReceipts.filter((receipt) =>
    !referencedAuthorities.has(`${receipt.elementId}\u0000${receipt.modelRuntimeKey}`));
  let nextState: StudioShared3dStageCollectionDocument | undefined;
  if (nextStages.length > 0) {
    const built = buildCollection(nextStages, retainedReceipts);
    if (!built) return null;
    nextState = built;
  }
  const release = releaseOrphanedVisibilityReceipts(input.elements, orphanedReceipts);
  return Object.freeze({
    nextState,
    nextElements: release.nextElements,
    restoredElementIds: release.restoredElementIds,
  });
}

export function remapStudioShared3dStageCollectionElementIds(
  value: unknown,
  elementIdMap: ReadonlyMap<string, string>,
): StudioShared3dStageCollectionDocument | null {
  const collection = migrateStudioShared3dStageCollectionDocument(value);
  if (!collection) return null;
  const receiptAuthorities = new Set(collection.visibilityReceipts.map((receipt) =>
    `${receipt.elementId}\u0000${receipt.modelRuntimeKey}`));
  const stages: StudioShared3dStageEntry[] = [];
  for (const entry of collection.stages) {
    const legacy = stageEntryAsV1Document(entry, receiptAuthorities);
    const remapped = legacy
      ? remapStudioShared3dStageDocumentElementIds(legacy, elementIdMap)
      : null;
    const baseEntry = remapped ? entryFromV1Document(remapped, entry.id) : null;
    const placementByRemappedId = new Map(entry.characters.flatMap((character) => {
      const remappedElementId = elementIdMap.get(character.elementId);
      return remappedElementId && character.placement
        ? [[remappedElementId, character.placement] as const]
        : [];
    }));
    const nextEntry = baseEntry
      ? parseStageEntry({
          ...baseEntry,
          characters: baseEntry.characters.map((character) => ({
            ...character,
            ...(placementByRemappedId.has(character.elementId)
              ? { placement: placementByRemappedId.get(character.elementId) }
              : {}),
          })),
        })
      : null;
    if (!nextEntry) return null;
    stages.push(nextEntry);
  }
  const receipts: StudioShared3dStageVisibilityReceipt[] = [];
  for (const receipt of collection.visibilityReceipts) {
    const elementId = safeId(elementIdMap.get(receipt.elementId));
    if (!elementId) return null;
    const modelHash = receipt.modelRuntimeKey.slice(receipt.modelRuntimeKey.indexOf(":"));
    const remapped = parseVisibilityReceipt({
      elementId,
      modelRuntimeKey: `${elementId}${modelHash}`,
    });
    if (!remapped) return null;
    receipts.push(remapped);
  }
  return buildCollection(stages, receipts);
}
