/**
 * Durable user-template boundary for Studio BG3D.
 *
 * A template stores only canonical scene JSON. In particular, private IndexedDB model keys are
 * never part of this format: model nodes refer to logical attachment ids and attachments carry the
 * verified SHA-256 identity used to resolve the local model library at apply time.
 */

import { getStudioBg3dLibrariesAuthority } from "./studio-bg3d-libraries-sqlite-opfs-authority";
import {
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dSceneDocument,
  type StudioBg3dSceneNode,
} from "./studio-bg3d-scene-document";

import type { StudioBg3dLibrariesAuthority } from "./studio-bg3d-libraries-sqlite-opfs-authority";

export const BG3D_TEMPLATE_LIBRARY_DATABASE_NAME =
  "toonspectrum-studio-bg3d-template-library";
export const BG3D_TEMPLATE_LIBRARY_DATABASE_VERSION = 2;
export const BG3D_TEMPLATE_LIBRARY_MAX_ENTRIES = 128;
export const BG3D_TEMPLATE_LIBRARY_MAX_NAME_LENGTH = 80;

const STORE_NAME = "templates";
const TEMPLATE_RECORD_KIND = "toonspectrum-studio-bg3d-template";
const TEMPLATE_RECORD_VERSION = 1;
const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_ID_SET = new Set(["constructor", "prototype", "__proto__"]);
const UTF8_ENCODER = new TextEncoder();
const MAX_CREATED_AT = 8_640_000_000_000_000;
const MAX_NODE_ID_ATTEMPTS = 64;
const MAX_STORED_ROW_SCAN = BG3D_TEMPLATE_LIBRARY_MAX_ENTRIES * 4;

const DRAFT_KEYS = ["id", "name", "createdAt", "document"] as const;
const RECORD_KEYS = ["kind", "version", "id", "name", "createdAt", "sceneJson"] as const;

export interface Bg3dTemplateLibraryDraft {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly document: StudioBg3dSceneDocument;
}

export interface Bg3dTemplateLibraryEntry extends Bg3dTemplateLibraryDraft {
  /** Derived from every canonical attachment; it is never trusted from IndexedDB. */
  readonly commercialUse: boolean;
}

export interface Bg3dInstantiatedTemplate {
  /** Canonical document containing fresh nodes and no template-local storyboard state. */
  readonly document: StudioBg3dSceneDocument;
  readonly nodeIdByTemplateNodeId: ReadonlyMap<string, string>;
}

export type Bg3dTemplateLibraryErrorCode =
  | "invalid-entry"
  | "invalid-id"
  | "max-entries"
  | "storage-unavailable"
  | "storage-blocked"
  | "transaction-failed";

export class Bg3dTemplateLibraryError extends Error {
  readonly code: Bg3dTemplateLibraryErrorCode;

  constructor(code: Bg3dTemplateLibraryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Bg3dTemplateLibraryError";
    this.code = code;
  }
}

interface StoredBg3dTemplateRecord {
  readonly kind: typeof TEMPLATE_RECORD_KIND;
  readonly version: typeof TEMPLATE_RECORD_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly sceneJson: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function libraryError(
  code: Bg3dTemplateLibraryErrorCode,
  message: string,
  cause?: unknown,
): Bg3dTemplateLibraryError {
  return new Bg3dTemplateLibraryError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function exactDataProperties<const Keys extends readonly string[]>(
  raw: unknown,
  keys: Keys,
): { readonly [Key in Keys[number]]: unknown } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  try {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(raw);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
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

function isSafeId(value: unknown): value is string {
  return typeof value === "string" &&
    TEMPLATE_ID_PATTERN.test(value) &&
    !FORBIDDEN_ID_SET.has(value.toLowerCase());
}

function isSafeName(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= BG3D_TEMPLATE_LIBRARY_MAX_NAME_LENGTH &&
    value.trim() === value &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    }) &&
    UTF8_ENCODER.encode(value).byteLength <= BG3D_TEMPLATE_LIBRARY_MAX_NAME_LENGTH * 4;
}

function isSafeCreatedAt(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_CREATED_AT;
}

function canonicalDocument(raw: unknown): {
  readonly document: StudioBg3dSceneDocument;
  readonly sceneJson: string;
} | null {
  const sceneJson = serializeStudioBg3dSceneDocument(raw);
  if (!sceneJson || UTF8_ENCODER.encode(sceneJson).byteLength > STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES) {
    return null;
  }
  const document = parseStudioBg3dSceneDocument(sceneJson);
  if (!document || serializeStudioBg3dSceneDocument(document) !== sceneJson) return null;
  return { document, sceneJson };
}

function recordFromDraft(raw: unknown): StoredBg3dTemplateRecord | null {
  const draft = exactDataProperties(raw, DRAFT_KEYS);
  if (!draft || !isSafeId(draft.id) || !isSafeName(draft.name) ||
    !isSafeCreatedAt(draft.createdAt)) {
    return null;
  }
  const canonical = canonicalDocument(draft.document);
  if (!canonical) return null;
  return {
    kind: TEMPLATE_RECORD_KIND,
    version: TEMPLATE_RECORD_VERSION,
    id: draft.id,
    name: draft.name,
    createdAt: draft.createdAt,
    sceneJson: canonical.sceneJson,
  };
}

function entryFromStoredRecord(raw: unknown): Bg3dTemplateLibraryEntry | null {
  const record = exactDataProperties(raw, RECORD_KEYS);
  if (
    !record ||
    record.kind !== TEMPLATE_RECORD_KIND ||
    record.version !== TEMPLATE_RECORD_VERSION ||
    !isSafeId(record.id) ||
    !isSafeName(record.name) ||
    !isSafeCreatedAt(record.createdAt) ||
    typeof record.sceneJson !== "string" ||
    record.sceneJson.length > STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES
  ) {
    return null;
  }
  const document = parseStudioBg3dSceneDocument(record.sceneJson);
  if (!document || serializeStudioBg3dSceneDocument(document) !== record.sceneJson) return null;
  return Object.freeze({
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    document,
    commercialUse: document.attachments.every(
      (attachment) => attachment.rights.commercialUse,
    ),
  });
}

function entriesFromStoredRecords(rawRecords: readonly unknown[]): Bg3dTemplateLibraryEntry[] {
  const entries: Bg3dTemplateLibraryEntry[] = [];
  for (const raw of rawRecords.slice(0, MAX_STORED_ROW_SCAN)) {
    const entry = entryFromStoredRecord(raw);
    if (entry) entries.push(entry);
    if (entries.length >= BG3D_TEMPLATE_LIBRARY_MAX_ENTRIES) break;
  }
  entries.sort((left, right) => {
    if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return entries;
}

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(libraryError(
      "storage-unavailable",
      "IndexedDB is unavailable for the BG3D template library.",
    ));
  }

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const fail = (error: Bg3dTemplateLibraryError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(
        BG3D_TEMPLATE_LIBRARY_DATABASE_NAME,
        BG3D_TEMPLATE_LIBRARY_DATABASE_VERSION,
      );
    } catch (error) {
      fail(libraryError("storage-unavailable", "Unable to open the BG3D template library.", error));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onblocked = () => {
      fail(libraryError("storage-blocked", "The BG3D template library upgrade is blocked."));
    };
    request.onerror = () => {
      fail(libraryError(
        "storage-unavailable",
        "Unable to open the BG3D template library.",
        request.error,
      ));
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

function transactionFailure(transaction: IDBTransaction, fallback: string): Bg3dTemplateLibraryError {
  return libraryError("transaction-failed", fallback, transaction.error);
}

/** Reads only validated current-format rows and waits for the readonly transaction to complete. */
export async function legacyListBg3dTemplates(): Promise<Bg3dTemplateLibraryEntry[]> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    let settled = false;
    let records: readonly unknown[] | null = null;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      transaction.oncomplete = () => {
        if (settled) return;
        if (!records) {
          fail(transactionFailure(transaction, "The BG3D template read did not complete."));
          return;
        }
        settled = true;
        resolve(entriesFromStoredRecords(records));
      };
      transaction.onerror = () => fail(transactionFailure(
        transaction,
        "Unable to read the BG3D template library.",
      ));
      transaction.onabort = () => fail(transactionFailure(
        transaction,
        "The BG3D template read was aborted.",
      ));
      const request = transaction.objectStore(STORE_NAME).getAll(
        undefined,
        MAX_STORED_ROW_SCAN,
      );
      request.onsuccess = () => {
        records = request.result as readonly unknown[];
      };
      request.onerror = () => fail(libraryError(
        "transaction-failed",
        "Unable to read BG3D template rows.",
        request.error,
      ));
    } catch (error) {
      fail(libraryError("transaction-failed", "Unable to start the BG3D template read.", error));
    }
  });
}

/**
 * Atomically stores one canonical row and returns the list from that same readwrite transaction.
 * The promise never resolves on `put.onsuccess`; transaction completion is the durability point.
 */
export async function legacySaveBg3dTemplate(
  draft: Bg3dTemplateLibraryDraft,
): Promise<Bg3dTemplateLibraryEntry[]> {
  const record = recordFromDraft(draft);
  if (!record) {
    throw libraryError("invalid-entry", "The BG3D template is not canonical or bounded.");
  }
  const database = await getDb();
  return new Promise((resolve, reject) => {
    let settled = false;
    let records: readonly unknown[] | null = null;
    let existingDone = false;
    let countDone = false;
    let existing: unknown;
    let count = 0;
    let mutationQueued = false;
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
        if (!records) {
          fail(transactionFailure(transaction, "The BG3D template save did not complete."));
          return;
        }
        settled = true;
        resolve(entriesFromStoredRecords(records));
      };
      transaction.onerror = () => fail(transactionFailure(
        transaction,
        "Unable to save the BG3D template.",
      ));
      transaction.onabort = () => fail(transactionFailure(
        transaction,
        "The BG3D template save was aborted.",
      ));

      const queueMutation = () => {
        if (!existingDone || !countDone || mutationQueued || settled) return;
        mutationQueued = true;
        if (existing === undefined && count >= BG3D_TEMPLATE_LIBRARY_MAX_ENTRIES) {
          fail(libraryError("max-entries", "The BG3D template library is full."));
          try {
            transaction.abort();
          } catch {
            // The explicit domain error above remains authoritative.
          }
          return;
        }
        try {
          store.put(record);
          const listRequest = store.getAll(undefined, MAX_STORED_ROW_SCAN);
          listRequest.onsuccess = () => {
            records = listRequest.result as readonly unknown[];
          };
          listRequest.onerror = () => fail(libraryError(
            "transaction-failed",
            "Unable to read the saved BG3D template list.",
            listRequest.error,
          ));
        } catch (error) {
          fail(libraryError(
            "transaction-failed",
            "Unable to queue the BG3D template save.",
            error,
          ));
          try {
            transaction.abort();
          } catch {
            // The synchronous queue failure above remains authoritative.
          }
        }
      };

      const existingRequest = store.get(record.id);
      existingRequest.onsuccess = () => {
        existing = existingRequest.result;
        existingDone = true;
        queueMutation();
      };
      existingRequest.onerror = () => fail(libraryError(
        "transaction-failed",
        "Unable to inspect the BG3D template identity.",
        existingRequest.error,
      ));
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        count = countRequest.result;
        countDone = true;
        queueMutation();
      };
      countRequest.onerror = () => fail(libraryError(
        "transaction-failed",
        "Unable to count BG3D templates.",
        countRequest.error,
      ));
    } catch (error) {
      fail(libraryError("transaction-failed", "Unable to start the BG3D template save.", error));
    }
  });
}

/** Deletes one id and returns the post-delete list only after the transaction commits. */
export async function legacyDeleteBg3dTemplate(
  id: string,
): Promise<Bg3dTemplateLibraryEntry[]> {
  if (!isSafeId(id)) throw libraryError("invalid-id", "Invalid BG3D template id.");
  const database = await getDb();
  return new Promise((resolve, reject) => {
    let settled = false;
    let records: readonly unknown[] | null = null;
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
        if (!records) {
          fail(transactionFailure(transaction, "The BG3D template delete did not complete."));
          return;
        }
        settled = true;
        resolve(entriesFromStoredRecords(records));
      };
      transaction.onerror = () => fail(transactionFailure(
        transaction,
        "Unable to delete the BG3D template.",
      ));
      transaction.onabort = () => fail(transactionFailure(
        transaction,
        "The BG3D template delete was aborted.",
      ));
      store.delete(id);
      const listRequest = store.getAll(undefined, MAX_STORED_ROW_SCAN);
      listRequest.onsuccess = () => {
        records = listRequest.result as readonly unknown[];
      };
      listRequest.onerror = () => fail(libraryError(
        "transaction-failed",
        "Unable to read the remaining BG3D templates.",
        listRequest.error,
      ));
    } catch (error) {
      fail(libraryError("transaction-failed", "Unable to start the BG3D template delete.", error));
    }
  });
}

// ── V12 shared SQLite product authority ──────────────────────────────────

export const BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_KIND =
  "toonspectrum-studio-bg3d-template-library-v12";
export const BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_VERSION = 1 as const;
export const BG3D_TEMPLATE_LIBRARY_V12_MAX_TOTAL_BYTES = 48 * 1024 * 1024;
export const BG3D_TEMPLATE_LIBRARY_V12_MAX_MANIFEST_BYTES = 50 * 1024 * 1024;

const TEMPLATE_V12_MANIFEST_KEYS = [
  "kind",
  "version",
  "revision",
  "updatedAt",
  "records",
] as const;

interface Bg3dTemplateLibraryV12Manifest {
  readonly kind: typeof BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_KIND;
  readonly version: typeof BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_VERSION;
  readonly revision: number;
  readonly updatedAt: number;
  readonly records: readonly StoredBg3dTemplateRecord[];
}

export interface Bg3dTemplateLibraryV12Options {
  readonly authority?: StudioBg3dLibrariesAuthority;
}

function exactV12TemplateManifest(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Object.keys(raw);
  if (
    keys.length !== TEMPLATE_V12_MANIFEST_KEYS.length ||
    keys.some((key) => !TEMPLATE_V12_MANIFEST_KEYS.includes(
      key as (typeof TEMPLATE_V12_MANIFEST_KEYS)[number],
    ))
  ) return null;
  return raw as Record<string, unknown>;
}

function canonicalV12TemplateManifest(
  manifest: Bg3dTemplateLibraryV12Manifest,
): Bg3dTemplateLibraryV12Manifest {
  return {
    kind: BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_KIND,
    version: BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_VERSION,
    revision: manifest.revision,
    updatedAt: manifest.updatedAt,
    records: [...manifest.records].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function emptyV12TemplateManifest(): Bg3dTemplateLibraryV12Manifest {
  return canonicalV12TemplateManifest({
    kind: BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_KIND,
    version: BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_VERSION,
    revision: 0,
    updatedAt: 0,
    records: [],
  });
}

function parseV12TemplateManifest(raw: string | null): Bg3dTemplateLibraryV12Manifest {
  if (raw === null) return emptyV12TemplateManifest();
  if (UTF8_ENCODER.encode(raw).byteLength > BG3D_TEMPLATE_LIBRARY_V12_MAX_MANIFEST_BYTES) {
    throw libraryError("transaction-failed", "The BG3D SQLite template manifest is oversized.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw libraryError("transaction-failed", "The BG3D SQLite template manifest is torn.", cause);
  }
  const value = exactV12TemplateManifest(parsed);
  if (
    !value ||
    value.kind !== BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_KIND ||
    value.version !== BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !isSafeCreatedAt(value.updatedAt) ||
    !Array.isArray(value.records) ||
    value.records.length > BG3D_TEMPLATE_LIBRARY_MAX_ENTRIES
  ) throw libraryError("transaction-failed", "The BG3D SQLite template manifest is invalid.");

  const records: StoredBg3dTemplateRecord[] = [];
  let totalBytes = 0;
  for (const candidate of value.records) {
    const entry = entryFromStoredRecord(candidate);
    if (!entry) {
      throw libraryError("transaction-failed", "The BG3D SQLite template row is invalid.");
    }
    const record = recordFromDraft({
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      document: entry.document,
    });
    if (!record || JSON.stringify(record) !== JSON.stringify(candidate)) {
      throw libraryError("transaction-failed", "The BG3D SQLite template row is noncanonical.");
    }
    totalBytes += UTF8_ENCODER.encode(record.sceneJson).byteLength;
    records.push(record);
  }
  if (
    totalBytes > BG3D_TEMPLATE_LIBRARY_V12_MAX_TOTAL_BYTES ||
    new Set(records.map(({ id }) => id)).size !== records.length
  ) throw libraryError("transaction-failed", "The BG3D SQLite template ledger is invalid.");
  const manifest = canonicalV12TemplateManifest({
    kind: BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_KIND,
    version: BG3D_TEMPLATE_LIBRARY_V12_MANIFEST_VERSION,
    revision: value.revision as number,
    updatedAt: value.updatedAt as number,
    records,
  });
  if (JSON.stringify(manifest) !== raw) {
    throw libraryError("transaction-failed", "The BG3D SQLite template manifest is noncanonical.");
  }
  return manifest;
}

function serializeV12TemplateManifest(manifest: Bg3dTemplateLibraryV12Manifest): string {
  const raw = JSON.stringify(canonicalV12TemplateManifest(manifest));
  if (UTF8_ENCODER.encode(raw).byteLength > BG3D_TEMPLATE_LIBRARY_V12_MAX_MANIFEST_BYTES) {
    throw libraryError("max-entries", "The BG3D template manifest byte limit was reached.");
  }
  return raw;
}

function entriesFromV12TemplateManifest(
  manifest: Bg3dTemplateLibraryV12Manifest,
): Bg3dTemplateLibraryEntry[] {
  return entriesFromStoredRecords(manifest.records);
}

function v12TemplateAuthority(
  options: Bg3dTemplateLibraryV12Options,
): StudioBg3dLibrariesAuthority {
  return options.authority ?? getStudioBg3dLibrariesAuthority();
}

export async function listBg3dTemplatesV12(
  options: Bg3dTemplateLibraryV12Options = {},
): Promise<Bg3dTemplateLibraryEntry[]> {
  const manifest = parseV12TemplateManifest(
    await v12TemplateAuthority(options).readManifest("templates"),
  );
  return entriesFromV12TemplateManifest(manifest);
}

export async function saveBg3dTemplateV12(
  draft: Bg3dTemplateLibraryDraft,
  options: Bg3dTemplateLibraryV12Options = {},
): Promise<Bg3dTemplateLibraryEntry[]> {
  const record = recordFromDraft(draft);
  if (!record) {
    throw libraryError("invalid-entry", "The BG3D template is not canonical or bounded.");
  }
  return v12TemplateAuthority(options).mutate("templates", () => [], async (context) => {
    const current = parseV12TemplateManifest(context.currentRaw);
    const byId = new Map(current.records.map((candidate) => [candidate.id, candidate]));
    if (!byId.has(record.id) && byId.size >= BG3D_TEMPLATE_LIBRARY_MAX_ENTRIES) {
      throw libraryError("max-entries", "The BG3D template library is full.");
    }
    byId.set(record.id, record);
    const records = [...byId.values()];
    const totalBytes = records.reduce(
      (sum, candidate) => sum + UTF8_ENCODER.encode(candidate.sceneJson).byteLength,
      0,
    );
    if (totalBytes > BG3D_TEMPLATE_LIBRARY_V12_MAX_TOTAL_BYTES) {
      throw libraryError("max-entries", "The BG3D template library byte limit was reached.");
    }
    const next = canonicalV12TemplateManifest({
      ...current,
      revision: current.revision + 1,
      updatedAt: context.now,
      records,
    });
    return {
      nextRaw: serializeV12TemplateManifest(next),
      nextRefs: [],
      result: entriesFromV12TemplateManifest(next),
    };
  });
}

export async function deleteBg3dTemplateV12(
  id: string,
  options: Bg3dTemplateLibraryV12Options = {},
): Promise<Bg3dTemplateLibraryEntry[]> {
  if (!isSafeId(id)) throw libraryError("invalid-id", "Invalid BG3D template id.");
  return v12TemplateAuthority(options).mutate("templates", () => [], async (context) => {
    const current = parseV12TemplateManifest(context.currentRaw);
    const next = canonicalV12TemplateManifest({
      ...current,
      revision: current.revision + 1,
      updatedAt: context.now,
      records: current.records.filter((candidate) => candidate.id !== id),
    });
    return {
      nextRaw: serializeV12TemplateManifest(next),
      nextRefs: [],
      result: entriesFromV12TemplateManifest(next),
    };
  });
}

/** Product defaults are the V12 SQLite authority; IndexedDB remains explicit legacy test/import. */
export const listBg3dTemplates = listBg3dTemplatesV12;
export const saveBg3dTemplate = saveBg3dTemplateV12;
export const deleteBg3dTemplate = deleteBg3dTemplateV12;

/**
 * Reissues every template node id before insertion and remaps hierarchy parents exactly. Template
 * shots are intentionally omitted: applying a reusable object group must not replace or append the
 * destination scene's storyboard state.
 */
export function instantiateBg3dTemplateDocument(
  rawDocument: StudioBg3dSceneDocument,
  occupiedNodeIds: ReadonlySet<string>,
  createNodeId: () => string,
): Bg3dInstantiatedTemplate | null {
  const canonical = canonicalDocument(rawDocument);
  if (!canonical || typeof createNodeId !== "function") return null;
  const blockedIds = new Set(canonical.document.nodes.map((node) => node.id));
  const nodeIdByTemplateNodeId = new Map<string, string>();
  try {
    for (const node of canonical.document.nodes) {
      let nextId: string | null = null;
      for (let attempt = 0; attempt < MAX_NODE_ID_ATTEMPTS; attempt += 1) {
        const candidate = createNodeId();
        if (
          isSafeId(candidate) &&
          !blockedIds.has(candidate) &&
          !occupiedNodeIds.has(candidate)
        ) {
          nextId = candidate;
          break;
        }
      }
      if (!nextId) return null;
      blockedIds.add(nextId);
      nodeIdByTemplateNodeId.set(node.id, nextId);
    }
  } catch {
    return null;
  }

  const nodes: StudioBg3dSceneNode[] = [];
  for (const node of canonical.document.nodes) {
    const id = nodeIdByTemplateNodeId.get(node.id);
    if (!id) return null;
    const parentId = node.parentId === null || node.parentId === undefined
      ? null
      : nodeIdByTemplateNodeId.get(node.parentId);
    if (parentId === undefined) return null;
    nodes.push({ ...node, id, parentId });
  }

  const {
    shots: _templateShots,
    activeShotId: _templateActiveShotId,
    ...documentWithoutShots
  } = canonical.document;
  const instantiated = canonicalDocument({ ...documentWithoutShots, nodes });
  if (!instantiated) return null;
  return Object.freeze({
    document: instantiated.document,
    nodeIdByTemplateNodeId: new Map(nodeIdByTemplateNodeId),
  });
}
