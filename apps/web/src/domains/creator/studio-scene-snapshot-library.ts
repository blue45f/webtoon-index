import { normalizeAnimationTimelineDoc } from "./studio-anim-tracks";

import type { PageState } from "./studio-page-state";

export const STUDIO_SCENE_SNAPSHOT_DATABASE_NAME =
  "toonspectrum-studio-scene-snapshot-library";
export const STUDIO_SCENE_SNAPSHOT_DATABASE_VERSION = 1;
export const STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES = 64;
export const STUDIO_SCENE_SNAPSHOT_MAX_BYTES = 12 * 1024 * 1024;
export const STUDIO_SCENE_SNAPSHOT_TOTAL_MAX_BYTES = 96 * 1024 * 1024;
export const STUDIO_SCENE_SNAPSHOT_DATA_URL_MAX_BYTES = 8 * 1024 * 1024;
export const STUDIO_SCENE_SNAPSHOT_DATA_URL_TOTAL_MAX_BYTES = 10 * 1024 * 1024;
export const STUDIO_SCENE_SNAPSHOT_3D_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const STUDIO_SCENE_SNAPSHOT_3D_PAYLOAD_TOTAL_MAX_BYTES = 4 * 1024 * 1024;
export const STUDIO_SCENE_SNAPSHOT_MAX_NAME_LENGTH = 80;
export const STUDIO_SCENE_SNAPSHOT_MAX_TAGS = 12;
export const STUDIO_SCENE_SNAPSHOT_MAX_TAG_LENGTH = 32;

const STORE_NAME = "snapshots";
const RECORD_KIND = "toonspectrum-studio-scene-snapshot";
const RECORD_SCHEMA_VERSION = 1;
const MAX_STORED_ROW_SCAN = STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES * 4;
const MAX_PAGE_ELEMENTS = 10_000;
const MAX_PAGE_CANVAS_HEIGHT = 100_000;
const MAX_PAGE_NAME_LENGTH = 200;
const MAX_PAGE_NOTE_LENGTH = 10_000;
const MAX_SOURCE_WORK_ID_LENGTH = 160;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,95}$/u;
const FORBIDDEN_ID_SET = new Set(["constructor", "prototype", "__proto__"]);
const ELEMENT_TYPES = new Set([
  "image",
  "text",
  "bubble",
  "sticker",
  "draw",
  "frame",
  "focusLines",
  "speedLines",
]);
const THEMES = new Set<StudioSceneSnapshotTheme>(["classic", "soft", "vivid"]);
const THREE_D_PAYLOAD_KEYS = new Set([
  "bg3dScene",
  "vrmScene",
  "studio3dScene",
  "modelPayload",
  "glbPayload",
]);
const UTF8_ENCODER = new TextEncoder();
const RECORD_KEYS = [
  "kind",
  "schemaVersion",
  "id",
  "name",
  "tags",
  "version",
  "createdAt",
  "updatedAt",
  "sourceWorkId",
  "byteSize",
  "payloadJson",
] as const;

export type StudioSceneSnapshotTheme = "classic" | "soft" | "vivid";

export interface StudioSceneSnapshot {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sourceWorkId: string | null;
  /** UTF-8 metadata + canonical payload bytes used for admission and total quota. */
  readonly byteSize: number;
  readonly page: PageState;
  readonly theme: StudioSceneSnapshotTheme;
}

export interface CreateStudioSceneSnapshotInput {
  readonly name: string;
  readonly tags?: readonly string[];
  readonly page: PageState;
  readonly theme: StudioSceneSnapshotTheme;
  readonly sourceWorkId?: string | null;
}

export interface CreateStudioSceneSnapshotOptions {
  readonly id?: string;
  readonly now?: number;
}

export interface DuplicateStudioSceneSnapshotOptions {
  readonly id?: string;
  readonly now?: number;
}

export type StudioSceneSnapshotLibraryErrorCode =
  | "invalid-entry"
  | "invalid-id"
  | "item-too-large"
  | "data-url-too-large"
  | "3d-payload-too-large"
  | "max-entries"
  | "total-too-large"
  | "not-found"
  | "corrupt-data"
  | "clone-unavailable"
  | "storage-unavailable"
  | "storage-blocked"
  | "transaction-failed";

export class StudioSceneSnapshotLibraryError extends Error {
  readonly code: StudioSceneSnapshotLibraryErrorCode;

  constructor(
    code: StudioSceneSnapshotLibraryErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "StudioSceneSnapshotLibraryError";
    this.code = code;
  }
}

interface StoredStudioSceneSnapshotRecord {
  readonly kind: typeof RECORD_KIND;
  readonly schemaVersion: typeof RECORD_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sourceWorkId: string | null;
  readonly byteSize: number;
  readonly payloadJson: string;
}

interface SnapshotPayload {
  readonly page: PageState;
  readonly theme: StudioSceneSnapshotTheme;
}

interface PayloadBudget {
  dataUrlBytes: number;
  threeDPayloadBytes: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function libraryError(
  code: StudioSceneSnapshotLibraryErrorCode,
  message: string,
  cause?: unknown
): StudioSceneSnapshotLibraryError {
  return new StudioSceneSnapshotLibraryError(
    code,
    message,
    cause === undefined ? undefined : { cause }
  );
}

function exactDataProperties<const Keys extends readonly string[]>(
  raw: unknown,
  keys: Keys
): { readonly [Key in Keys[number]]: unknown } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  try {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(raw);
    if (
      ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    const values = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      values[key] = descriptor.value;
    }
    return values as { readonly [Key in Keys[number]]: unknown };
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeId(value: unknown): value is string {
  return (
    typeof value === "string"
    && SNAPSHOT_ID_PATTERN.test(value)
    && !FORBIDDEN_ID_SET.has(value.toLowerCase())
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    normalized.length < 1
    || normalized.length > STUDIO_SCENE_SNAPSHOT_MAX_NAME_LENGTH
    || hasControlCharacter(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function normalizeStudioSceneSnapshotTags(
  values: readonly string[] | undefined
): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const tag = raw.replace(/\s+/gu, " ").trim().slice(0, STUDIO_SCENE_SNAPSHOT_MAX_TAG_LENGTH);
    const key = tag.toLocaleLowerCase("ko-KR");
    if (!tag || hasControlCharacter(tag) || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= STUDIO_SCENE_SNAPSHOT_MAX_TAGS) break;
  }
  return tags;
}

function isCanonicalTags(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) return false;
  const normalized = normalizeStudioSceneSnapshotTags(value as string[]);
  return (
    normalized.length === value.length
    && normalized.every((tag, index) => tag === value[index])
  );
}

function isSafeVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isSafeTimestamp(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_TIMESTAMP
  );
}

function normalizeSourceWorkId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (
    normalized.length < 1
    || normalized.length > MAX_SOURCE_WORK_ID_LENGTH
    || hasControlCharacter(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function safeStructuredClone<T>(value: T): T {
  if (typeof globalThis.structuredClone !== "function") {
    throw libraryError(
      "clone-unavailable",
      "Structured clone is unavailable for scene snapshots."
    );
  }
  try {
    return globalThis.structuredClone(value);
  } catch (error) {
    throw libraryError(
      "invalid-entry",
      "The scene snapshot contains a value that cannot be cloned.",
      error
    );
  }
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function plainValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => plainValuesEqual(value, right[index]))
    );
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length
    && leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key)
        && plainValuesEqual(left[key], right[key])
    )
  );
}

function isCanonicalAnimationTimeline(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  try {
    const normalized = normalizeAnimationTimelineDoc(value);
    return plainValuesEqual(normalized, value);
  } catch {
    return false;
  }
}

function isCanonicalPage(value: unknown): value is PageState {
  if (!isPlainRecord(value)) return false;
  if (
    typeof value.id !== "string"
    || value.id.length < 1
    || value.id.length > 512
    || !Array.isArray(value.elements)
    || value.elements.length > MAX_PAGE_ELEMENTS
    || typeof value.bg !== "string"
    || value.bg.length > 512
    || typeof value.canvasH !== "number"
    || !Number.isFinite(value.canvasH)
    || value.canvasH <= 0
    || value.canvasH > MAX_PAGE_CANVAS_HEIGHT
  ) {
    return false;
  }
  if (
    value.bgGrad !== null
    && (
      !Array.isArray(value.bgGrad)
      || value.bgGrad.length > 16
      || value.bgGrad.some((color) => typeof color !== "string" || color.length > 512)
    )
  ) {
    return false;
  }
  if (
    value.name !== undefined
    && (typeof value.name !== "string" || value.name.length > MAX_PAGE_NAME_LENGTH)
  ) {
    return false;
  }
  if (
    value.note !== undefined
    && (typeof value.note !== "string" || value.note.length > MAX_PAGE_NOTE_LENGTH)
  ) {
    return false;
  }
  if (value.animTimeline !== undefined && !isCanonicalAnimationTimeline(value.animTimeline)) {
    return false;
  }
  return value.elements.every((element) => (
    isPlainRecord(element)
    && typeof element.id === "string"
    && element.id.length >= 1
    && element.id.length <= 512
    && typeof element.type === "string"
    && ELEMENT_TYPES.has(element.type)
  ));
}

function scanPayloadValue(
  value: unknown,
  budget: PayloadBudget,
  seen: Set<object>,
  key: string | null
): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    if (/^data:/iu.test(value)) {
      const bytes = utf8ByteLength(value);
      if (bytes > STUDIO_SCENE_SNAPSHOT_DATA_URL_MAX_BYTES) {
        throw libraryError(
          "data-url-too-large",
          "One embedded data URL exceeds the scene snapshot budget."
        );
      }
      budget.dataUrlBytes += bytes;
      if (budget.dataUrlBytes > STUDIO_SCENE_SNAPSHOT_DATA_URL_TOTAL_MAX_BYTES) {
        throw libraryError(
          "data-url-too-large",
          "Embedded data URLs exceed the scene snapshot budget."
        );
      }
    }
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (key && THREE_D_PAYLOAD_KEYS.has(key)) {
    let threeDJson: string;
    try {
      threeDJson = JSON.stringify(value);
    } catch {
      return false;
    }
    const bytes = utf8ByteLength(threeDJson);
    if (bytes > STUDIO_SCENE_SNAPSHOT_3D_PAYLOAD_MAX_BYTES) {
      throw libraryError(
        "3d-payload-too-large",
        "One embedded 3D scene exceeds the scene snapshot budget."
      );
    }
    budget.threeDPayloadBytes += bytes;
    if (budget.threeDPayloadBytes > STUDIO_SCENE_SNAPSHOT_3D_PAYLOAD_TOTAL_MAX_BYTES) {
      throw libraryError(
        "3d-payload-too-large",
        "Embedded 3D scenes exceed the scene snapshot budget."
      );
    }
  }

  if (Array.isArray(value)) {
    return value.every((item) => scanPayloadValue(item, budget, seen, null));
  }
  if (!isPlainRecord(value)) return false;
  for (const [childKey, child] of Object.entries(value)) {
    if (!scanPayloadValue(child, budget, seen, childKey)) return false;
  }
  return true;
}

function canonicalPayload(raw: unknown): {
  readonly payload: SnapshotPayload;
  readonly payloadJson: string;
} | null {
  let cloned: unknown;
  try {
    cloned = safeStructuredClone(raw);
  } catch (error) {
    if (error instanceof StudioSceneSnapshotLibraryError) throw error;
    return null;
  }
  const budget: PayloadBudget = { dataUrlBytes: 0, threeDPayloadBytes: 0 };
  if (!scanPayloadValue(cloned, budget, new Set(), null)) return null;

  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(cloned);
  } catch {
    return null;
  }
  if (
    payloadJson.length > STUDIO_SCENE_SNAPSHOT_MAX_BYTES
    || utf8ByteLength(payloadJson) > STUDIO_SCENE_SNAPSHOT_MAX_BYTES
  ) {
    throw libraryError(
      "item-too-large",
      "The scene snapshot exceeds the per-item byte budget."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson) as unknown;
  } catch {
    return null;
  }
  if (
    !isPlainRecord(parsed)
    || !isCanonicalPage(parsed.page)
    || typeof parsed.theme !== "string"
    || !THEMES.has(parsed.theme as StudioSceneSnapshotTheme)
  ) {
    return null;
  }
  return {
    payload: safeStructuredClone(parsed) as unknown as SnapshotPayload,
    payloadJson,
  };
}

function metadataByteSize(input: {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sourceWorkId: string | null;
}): number {
  return utf8ByteLength(JSON.stringify(input));
}

function recordFromSnapshot(raw: unknown): StoredStudioSceneSnapshotRecord | null {
  if (!isPlainRecord(raw)) return null;
  const id = raw.id;
  const name = normalizeName(raw.name);
  const tags = raw.tags;
  const version = raw.version;
  const createdAt = raw.createdAt;
  const updatedAt = raw.updatedAt;
  const sourceWorkId = normalizeSourceWorkId(raw.sourceWorkId);
  if (
    !isSafeId(id)
    || !name
    || name !== raw.name
    || !isCanonicalTags(tags)
    || !isSafeVersion(version)
    || !isSafeTimestamp(createdAt)
    || !isSafeTimestamp(updatedAt)
    || updatedAt < createdAt
    || sourceWorkId === undefined
    || sourceWorkId !== raw.sourceWorkId
  ) {
    return null;
  }
  const payload = canonicalPayload({ page: raw.page, theme: raw.theme });
  if (!payload) return null;
  const byteSize = metadataByteSize({
    id,
    name,
    tags,
    version,
    createdAt,
    updatedAt,
    sourceWorkId,
  }) + utf8ByteLength(payload.payloadJson);
  if (byteSize > STUDIO_SCENE_SNAPSHOT_MAX_BYTES) {
    throw libraryError(
      "item-too-large",
      "The scene snapshot exceeds the per-item byte budget."
    );
  }
  return {
    kind: RECORD_KIND,
    schemaVersion: RECORD_SCHEMA_VERSION,
    id,
    name,
    tags: [...tags],
    version,
    createdAt,
    updatedAt,
    sourceWorkId,
    byteSize,
    payloadJson: payload.payloadJson,
  };
}

function snapshotFromStoredRecord(raw: unknown): StudioSceneSnapshot | null {
  const record = exactDataProperties(raw, RECORD_KEYS);
  const name = normalizeName(record?.name);
  const sourceWorkId = normalizeSourceWorkId(record?.sourceWorkId);
  if (
    !record
    || record.kind !== RECORD_KIND
    || record.schemaVersion !== RECORD_SCHEMA_VERSION
    || !isSafeId(record.id)
    || !name
    || name !== record.name
    || !isCanonicalTags(record.tags)
    || !isSafeVersion(record.version)
    || !isSafeTimestamp(record.createdAt)
    || !isSafeTimestamp(record.updatedAt)
    || record.updatedAt < record.createdAt
    || sourceWorkId === undefined
    || sourceWorkId !== record.sourceWorkId
    || typeof record.byteSize !== "number"
    || !Number.isSafeInteger(record.byteSize)
    || record.byteSize < 1
    || record.byteSize > STUDIO_SCENE_SNAPSHOT_MAX_BYTES
    || typeof record.payloadJson !== "string"
    || record.payloadJson.length > STUDIO_SCENE_SNAPSHOT_MAX_BYTES
  ) {
    return null;
  }
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(record.payloadJson);
  } catch {
    return null;
  }
  const canonical = canonicalPayload(rawPayload);
  if (!canonical || canonical.payloadJson !== record.payloadJson) return null;
  const expectedByteSize = metadataByteSize({
    id: record.id,
    name: record.name,
    tags: record.tags,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sourceWorkId,
  }) + utf8ByteLength(record.payloadJson);
  if (expectedByteSize !== record.byteSize) return null;
  return safeStructuredClone({
    id: record.id,
    name,
    tags: [...record.tags],
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sourceWorkId,
    byteSize: record.byteSize,
    page: canonical.payload.page,
    theme: canonical.payload.theme,
  });
}

function snapshotsFromStoredRecords(
  rawRecords: readonly unknown[],
  strict: boolean
): StudioSceneSnapshot[] {
  const snapshots: StudioSceneSnapshot[] = [];
  for (const raw of rawRecords.slice(0, MAX_STORED_ROW_SCAN)) {
    let snapshot: StudioSceneSnapshot | null;
    try {
      snapshot = snapshotFromStoredRecord(raw);
    } catch {
      snapshot = null;
    }
    if (!snapshot) {
      if (strict) {
        throw libraryError(
          "corrupt-data",
          "The scene snapshot library contains a corrupt row."
        );
      }
      continue;
    }
    snapshots.push(snapshot);
    if (snapshots.length >= STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES) break;
  }
  snapshots.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return snapshots;
}

export function assertStudioSceneSnapshotLibraryBudget(
  entries: readonly Pick<StudioSceneSnapshot, "id" | "byteSize">[],
  incoming: Pick<StudioSceneSnapshot, "id" | "byteSize">
): number {
  const existing = entries.find((entry) => entry.id === incoming.id);
  if (!existing && entries.length >= STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES) {
    throw libraryError("max-entries", "The scene snapshot library is full.");
  }
  const nextBytes =
    entries.reduce((total, entry) => total + entry.byteSize, 0)
    - (existing?.byteSize ?? 0)
    + incoming.byteSize;
  if (!Number.isSafeInteger(nextBytes) || nextBytes > STUDIO_SCENE_SNAPSHOT_TOTAL_MAX_BYTES) {
    throw libraryError(
      "total-too-large",
      "The scene snapshot library exceeds its total byte budget."
    );
  }
  return nextBytes;
}

function createSnapshotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `scene-${crypto.randomUUID()}`;
  }
  return `scene-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createStudioSceneSnapshot(
  input: CreateStudioSceneSnapshotInput,
  options: CreateStudioSceneSnapshotOptions = {}
): StudioSceneSnapshot {
  const now = options.now ?? Date.now();
  const id = options.id ?? createSnapshotId();
  const name = normalizeName(input.name);
  const sourceWorkId = normalizeSourceWorkId(input.sourceWorkId);
  if (!name || !isSafeId(id) || !isSafeTimestamp(now) || sourceWorkId === undefined) {
    throw libraryError("invalid-entry", "Invalid scene snapshot metadata.");
  }
  const candidate = {
    id,
    name,
    tags: normalizeStudioSceneSnapshotTags(input.tags),
    version: 1,
    createdAt: now,
    updatedAt: now,
    sourceWorkId,
    byteSize: 0,
    page: input.page,
    theme: input.theme,
  };
  const record = recordFromSnapshot(candidate);
  if (!record) throw libraryError("invalid-entry", "Invalid scene snapshot payload.");
  const snapshot = snapshotFromStoredRecord(record);
  if (!snapshot) throw libraryError("invalid-entry", "Unable to canonicalize scene snapshot.");
  return snapshot;
}

export function cloneStudioSceneSnapshot(
  snapshot: StudioSceneSnapshot
): StudioSceneSnapshot {
  const record = recordFromSnapshot(snapshot);
  if (!record) throw libraryError("invalid-entry", "Invalid scene snapshot.");
  const cloned = snapshotFromStoredRecord(record);
  if (!cloned) throw libraryError("invalid-entry", "Unable to clone scene snapshot.");
  return cloned;
}

/**
 * V12 SQLite repositories store the exact IndexedDB record envelope rather than a renderer or
 * browser-engine object. Keeping this codec beside the existing validators gives both backends one
 * canonical, fail-closed data contract.
 */
export function serializeStudioSceneSnapshot(
  snapshot: StudioSceneSnapshot,
): string {
  const record = recordFromSnapshot(snapshot);
  if (!record) throw libraryError("invalid-entry", "Invalid scene snapshot.");
  const canonical = snapshotFromStoredRecord(record);
  if (!canonical) {
    throw libraryError("invalid-entry", "Unable to canonicalize scene snapshot.");
  }
  return JSON.stringify(record);
}

export function parseCanonicalStudioSceneSnapshot(raw: string): StudioSceneSnapshot {
  if (
    typeof raw !== "string"
    || raw.length === 0
    || raw.length > STUDIO_SCENE_SNAPSHOT_MAX_BYTES + 1_000_000
  ) {
    throw libraryError("corrupt-data", "Invalid scene snapshot record size.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw libraryError("corrupt-data", "Invalid scene snapshot record JSON.");
  }
  const snapshot = snapshotFromStoredRecord(parsed);
  if (!snapshot) {
    throw libraryError("corrupt-data", "Invalid scene snapshot record.");
  }
  const canonical = serializeStudioSceneSnapshot(snapshot);
  if (canonical !== raw) {
    throw libraryError("corrupt-data", "Non-canonical scene snapshot record.");
  }
  return snapshot;
}

export function filterStudioSceneSnapshots(
  snapshots: readonly StudioSceneSnapshot[],
  query: string
): StudioSceneSnapshot[] {
  const terms = query
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .split(/\s+/u)
    .filter(Boolean);
  if (terms.length === 0) return [...snapshots];
  return snapshots.filter((snapshot) => {
    const haystack = [
      snapshot.name,
      snapshot.tags.join(" "),
      snapshot.page.name ?? "",
      snapshot.page.note ?? "",
    ]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR");
    return terms.every((term) => haystack.includes(term));
  });
}

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      libraryError(
        "storage-unavailable",
        "IndexedDB is unavailable for scene snapshots."
      )
    );
  }
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const fail = (error: StudioSceneSnapshotLibraryError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(
        STUDIO_SCENE_SNAPSHOT_DATABASE_NAME,
        STUDIO_SCENE_SNAPSHOT_DATABASE_VERSION
      );
    } catch (error) {
      fail(
        libraryError(
          "storage-unavailable",
          "Unable to open the scene snapshot library.",
          error
        )
      );
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onblocked = () => {
      fail(
        libraryError(
          "storage-blocked",
          "The scene snapshot library upgrade is blocked."
        )
      );
    };
    request.onerror = () => {
      fail(
        libraryError(
          "storage-unavailable",
          "Unable to open the scene snapshot library.",
          request.error
        )
      );
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        if (dbPromise === opening) dbPromise = null;
      };
      resolve(database);
    };
  });
  dbPromise = opening;
  void opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

function transactionError(
  transaction: IDBTransaction,
  fallback: string
): StudioSceneSnapshotLibraryError {
  return libraryError("transaction-failed", fallback, transaction.error);
}

function readRows(
  store: IDBObjectStore,
  onRows: (rows: readonly unknown[]) => void,
  onError: (error: unknown) => void
): void {
  const request = store.getAll(undefined, MAX_STORED_ROW_SCAN);
  request.onsuccess = () => onRows(request.result as readonly unknown[]);
  request.onerror = () =>
    onError(
      libraryError(
        "transaction-failed",
        "Unable to read scene snapshot rows.",
        request.error
      )
    );
}

export async function listStudioSceneSnapshots(): Promise<StudioSceneSnapshot[]> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    let settled = false;
    let rows: readonly unknown[] | null = null;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      transaction.oncomplete = () => {
        if (settled) return;
        if (!rows) {
          fail(transactionError(transaction, "The scene snapshot read did not complete."));
          return;
        }
        settled = true;
        resolve(snapshotsFromStoredRecords(rows, false));
      };
      transaction.onerror = () =>
        fail(transactionError(transaction, "Unable to read scene snapshots."));
      transaction.onabort = () =>
        fail(transactionError(transaction, "The scene snapshot read was aborted."));
      readRows(transaction.objectStore(STORE_NAME), (nextRows) => {
        rows = nextRows;
      }, fail);
    } catch (error) {
      fail(
        libraryError(
          "transaction-failed",
          "Unable to start the scene snapshot read.",
          error
        )
      );
    }
  });
}

export async function saveStudioSceneSnapshot(
  snapshot: StudioSceneSnapshot
): Promise<StudioSceneSnapshot[]> {
  const record = recordFromSnapshot(snapshot);
  if (!record) throw libraryError("invalid-entry", "Invalid scene snapshot.");
  const canonical = snapshotFromStoredRecord(record);
  if (!canonical) throw libraryError("invalid-entry", "Invalid scene snapshot.");

  const database = await getDb();
  return new Promise((resolve, reject) => {
    let settled = false;
    let resultRows: readonly unknown[] | null = null;
    let domainError: unknown = null;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      transaction.oncomplete = () => {
        if (settled) return;
        if (!resultRows) {
          fail(transactionError(transaction, "The scene snapshot save did not complete."));
          return;
        }
        settled = true;
        resolve(snapshotsFromStoredRecords(resultRows, true));
      };
      transaction.onerror = () =>
        fail(domainError ?? transactionError(transaction, "Unable to save the scene snapshot."));
      transaction.onabort = () =>
        fail(domainError ?? transactionError(transaction, "The scene snapshot save was aborted."));

      readRows(store, (rows) => {
        try {
          if (rows.length > STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES) {
            throw libraryError("max-entries", "The scene snapshot library is full.");
          }
          const entries = snapshotsFromStoredRecords(rows, true);
          assertStudioSceneSnapshotLibraryBudget(entries, canonical);
          store.put(record);
          readRows(store, (nextRows) => {
            resultRows = nextRows;
          }, fail);
        } catch (error) {
          domainError = error;
          try {
            transaction.abort();
          } catch {
            fail(error);
          }
        }
      }, fail);
    } catch (error) {
      fail(
        libraryError(
          "transaction-failed",
          "Unable to start the scene snapshot save.",
          error
        )
      );
    }
  });
}

export async function duplicateStudioSceneSnapshot(
  sourceId: string,
  options: DuplicateStudioSceneSnapshotOptions = {}
): Promise<StudioSceneSnapshot[]> {
  if (!isSafeId(sourceId)) throw libraryError("invalid-id", "Invalid scene snapshot id.");
  const nextId = options.id ?? createSnapshotId();
  const now = options.now ?? Date.now();
  if (!isSafeId(nextId) || !isSafeTimestamp(now)) {
    throw libraryError("invalid-entry", "Invalid duplicated scene snapshot metadata.");
  }

  const database = await getDb();
  return new Promise((resolve, reject) => {
    let settled = false;
    let resultRows: readonly unknown[] | null = null;
    let domainError: unknown = null;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      transaction.oncomplete = () => {
        if (settled) return;
        if (!resultRows) {
          fail(transactionError(transaction, "The scene snapshot duplicate did not complete."));
          return;
        }
        settled = true;
        resolve(snapshotsFromStoredRecords(resultRows, true));
      };
      transaction.onerror = () =>
        fail(domainError ?? transactionError(transaction, "Unable to duplicate the scene snapshot."));
      transaction.onabort = () =>
        fail(domainError ?? transactionError(transaction, "The scene snapshot duplicate was aborted."));

      readRows(store, (rows) => {
        try {
          if (rows.length >= STUDIO_SCENE_SNAPSHOT_MAX_ENTRIES) {
            throw libraryError("max-entries", "The scene snapshot library is full.");
          }
          const entries = snapshotsFromStoredRecords(rows, true);
          const source = entries.find((entry) => entry.id === sourceId);
          if (!source) throw libraryError("not-found", "The scene snapshot was not found.");
          const nameBase = `${source.name} 복사본`;
          const name =
            normalizeName(nameBase.slice(0, STUDIO_SCENE_SNAPSHOT_MAX_NAME_LENGTH))
            ?? "장면 복사본";
          const duplicatedRecord = recordFromSnapshot({
            ...source,
            id: nextId,
            name,
            version: source.version + 1,
            createdAt: now,
            updatedAt: now,
          });
          if (!duplicatedRecord) {
            throw libraryError("invalid-entry", "Unable to duplicate the scene snapshot.");
          }
          const duplicated = snapshotFromStoredRecord(duplicatedRecord);
          if (!duplicated) {
            throw libraryError("invalid-entry", "Unable to duplicate the scene snapshot.");
          }
          assertStudioSceneSnapshotLibraryBudget(entries, duplicated);
          store.put(duplicatedRecord);
          readRows(store, (nextRows) => {
            resultRows = nextRows;
          }, fail);
        } catch (error) {
          domainError = error;
          try {
            transaction.abort();
          } catch {
            fail(error);
          }
        }
      }, fail);
    } catch (error) {
      fail(
        libraryError(
          "transaction-failed",
          "Unable to start the scene snapshot duplicate.",
          error
        )
      );
    }
  });
}

export async function deleteStudioSceneSnapshot(
  id: string
): Promise<StudioSceneSnapshot[]> {
  if (!isSafeId(id)) throw libraryError("invalid-id", "Invalid scene snapshot id.");
  const database = await getDb();
  return new Promise((resolve, reject) => {
    let settled = false;
    let resultRows: readonly unknown[] | null = null;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      transaction.oncomplete = () => {
        if (settled) return;
        if (!resultRows) {
          fail(transactionError(transaction, "The scene snapshot delete did not complete."));
          return;
        }
        settled = true;
        resolve(snapshotsFromStoredRecords(resultRows, false));
      };
      transaction.onerror = () =>
        fail(transactionError(transaction, "Unable to delete the scene snapshot."));
      transaction.onabort = () =>
        fail(transactionError(transaction, "The scene snapshot delete was aborted."));
      store.delete(id);
      readRows(store, (rows) => {
        resultRows = rows;
      }, fail);
    } catch (error) {
      fail(
        libraryError(
          "transaction-failed",
          "Unable to start the scene snapshot delete.",
          error
        )
      );
    }
  });
}
