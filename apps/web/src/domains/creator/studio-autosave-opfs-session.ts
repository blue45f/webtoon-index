import {
  readStudioAutosave,
  serializeStudioAutosave,
  studioAutosaveHasContent,
  studioLifecycleAutosaveSidecarKey,
  type StudioAutosavePayload,
  type StudioAutosaveStorage,
} from "./studio-autosave";
import {
  requestStudioAutosaveDocumentLeadership,
  type StudioAutosaveDocumentLeadershipRegistry,
  type StudioAutosaveDocumentLease,
  type StudioAutosaveDocumentRole,
} from "./studio-autosave-document-leader";
import {
  selectStudioOpfsFileSystem,
  type StudioOpfsStorageManagerLike,
} from "./studio-opfs-filesystem";
import {
  createStudioOpfsRecoveryJournal,
  createStudioOpfsRecoveryJournalAdapter,
  type StudioOpfsRecoveryEntry,
  type StudioOpfsRecoveryJournalIdentity,
  type StudioOpfsRecoveryScan,
  type StudioOpfsRecoveryWriterLease,
} from "./studio-opfs-recovery-journal";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioAutosaveSqlitePort,
  StudioAutosaveSqliteReadResult,
} from "./studio-autosave-sqlite-store";

export const STUDIO_AUTOSAVE_OPFS_ENVELOPE_KIND =
  "toonspectrum:studio-autosave-opfs-checkpoint" as const;
export const STUDIO_AUTOSAVE_OPFS_ENVELOPE_VERSION = 1 as const;
export const STUDIO_AUTOSAVE_OPFS_ENGINE_VERSION = "studio-autosave-v2" as const;

const AUTOSAVE_PAGE_ID = "document";
const AUTOSAVE_ROOT_NAME = "toonspectrum-studio-autosave-v3";
const MAX_AUTOSAVE_BYTES = 256 * 1024 * 1024;
const MAX_AUTOSAVE_JOURNAL_BYTES = 1024 * 1024 * 1024;
const WRITER_RENEW_WINDOW_MS = 5_000;
const SHA_256_HEX = /^[a-f0-9]{64}$/u;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

type StudioAutosaveOpfsEnvelope = Readonly<{
  kind: typeof STUDIO_AUTOSAVE_OPFS_ENVELOPE_KIND;
  version: typeof STUDIO_AUTOSAVE_OPFS_ENVELOPE_VERSION;
  state: "snapshot" | "cleared";
  savedAt: string;
  autosaveKeyDigest: string;
  payloadDigest: string | null;
  payload: string | null;
}>;

export type StudioAutosaveOpfsReadResult =
  | Readonly<{
      state: "snapshot";
      savedAt: string;
      payload: StudioAutosavePayload;
      sequence: number;
      revision: number;
    }>
  | Readonly<{
      state: "cleared";
      savedAt: string;
      sequence: number;
      revision: number;
    }>
  | null;

export type StudioAutosaveDurableAuthority =
  | "opfs-journal"
  | "sqlite-fallback";

export type StudioAutosaveRecoveryAuthority =
  | StudioAutosaveDurableAuthority
  | "browser-storage-compatibility";

export type StudioAutosavePersistenceAuthority = StudioAutosaveDurableAuthority;

export type StudioAutosavePersistenceReceipt = Readonly<{
  authority: StudioAutosavePersistenceAuthority;
  savedAt: string;
  sequence: number | null;
  revision: number | null;
}>;

export type StudioAutosaveRecoveryCandidate = Readonly<{
  key: string;
  authority: StudioAutosaveRecoveryAuthority;
  savedAt: string;
  sequence: number | null;
  revision: number | null;
  payload: StudioAutosavePayload;
}>;

export type StudioAutosaveReconciliation = Readonly<{
  candidate: StudioAutosaveRecoveryCandidate | null;
  compatibilityCandidate: StudioAutosaveRecoveryCandidate | null;
  authority: StudioAutosaveRecoveryAuthority | null;
  durability: "durable" | "compatibility-only" | "none";
  migratedToOpfs: boolean;
}>;

export class StudioAutosaveDurabilityError extends Error {
  constructor(cause: unknown) {
    super(
      "OPFS와 SQLite 자동저장에 실패했습니다. 현재 작업은 메모리에 남아 있지만 내구 저장되지 않았습니다.",
      { cause },
    );
    this.name = "StudioAutosaveDurabilityError";
  }
}

/**
 * Another tab on this origin owns the document. This is deliberately NOT a
 * `StudioAutosaveDurabilityError`: the difference between "storage broke" and "someone else is the
 * author of record" decides whether falling back to the second authority is a repair or a fork.
 */
export class StudioAutosaveDocumentBusyError extends Error {
  constructor(cause?: unknown) {
    super(
      "이 원고는 다른 탭에서 편집 중입니다. 이 탭의 변경은 저장되지 않습니다.",
      { cause },
    );
    this.name = "StudioAutosaveDocumentBusyError";
  }
}

/**
 * True when a failure means "a different tab or window is the document's writer". Duck-typed on the
 * journal error code so the check survives module/chunk boundaries and a lane that owns the journal
 * re-exporting its error class.
 */
const DOCUMENT_BUSY_CODES = new Set(["LEASE_BUSY", "LEASE_LOST", "lock-unavailable"]);

function isFollowerAuthorityGap(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("SQLite autosave authority is unavailable")
    || error.message.includes("OPFS autosave authority is unavailable")
  );
}

export function studioAutosaveDocumentBusy(error: unknown): boolean {
  if (error instanceof StudioAutosaveDocumentBusyError) return true;
  if (typeof error !== "object" || error === null) return false;
  if (error instanceof AggregateError && error.errors.length > 0) {
    const anyBusy = error.errors.some((item) => studioAutosaveDocumentBusy(item));
    const allExpected = error.errors.every(
      (item) => studioAutosaveDocumentBusy(item) || isFollowerAuthorityGap(item),
    );
    return anyBusy && allExpected;
  }
  const code = (error as { readonly code?: unknown }).code;
  if (typeof code === "string" && DOCUMENT_BUSY_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("already owned by another page")
    || message.includes("DedicatedWorker ownership lock failed")
  ) {
    return true;
  }
  const cause = (error as { readonly cause?: unknown }).cause;
  return cause !== undefined && cause !== error && studioAutosaveDocumentBusy(cause);
}

export interface StudioAutosaveOpfsJournalPort {
  scan(options?: { readonly signal?: AbortSignal }): Promise<StudioOpfsRecoveryScan>;
  readPayload(
    entry: StudioOpfsRecoveryEntry,
    options?: { readonly signal?: AbortSignal },
  ): AsyncIterable<Uint8Array>;
  acquireWriter(input: {
    readonly ownerId: string;
    readonly signal?: AbortSignal;
  }): Promise<StudioOpfsRecoveryWriterLease>;
  renewWriter(
    writer: StudioOpfsRecoveryWriterLease,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StudioOpfsRecoveryWriterLease>;
  releaseWriter(
    writer: StudioOpfsRecoveryWriterLease,
    options?: { readonly signal?: AbortSignal },
  ): Promise<void>;
  appendCheckpoint(
    writer: StudioOpfsRecoveryWriterLease,
    input: {
      readonly id: string;
      readonly pageId: string;
      readonly revision: number;
      readonly payload: Uint8Array;
      readonly byteLength: number;
      readonly createdAt: number;
      readonly compactThroughSequence: number;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<StudioOpfsRecoveryEntry>;
  evictObsolete(
    writer: StudioOpfsRecoveryWriterLease,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

export interface StudioAutosaveOpfsSessionOptions {
  readonly autosaveKey: string;
  readonly journal: StudioAutosaveOpfsJournalPort;
  readonly ownerId: string;
  readonly now?: () => number;
}

interface StudioAutosaveBrowserScope {
  readonly navigator?: {
    readonly storage?: Partial<StudioOpfsStorageManagerLike>;
    readonly locks?: {
      request<T>(
        name: string,
        options: {
          readonly mode: "exclusive";
          /** Web Locks `ifAvailable`. Used by document-open leader arbitration. */
          readonly ifAvailable?: boolean;
          readonly signal?: AbortSignal;
        },
        callback: (lock?: unknown) => T | PromiseLike<T>,
      ): Promise<T>;
    };
  };
  readonly localStorage?: Storage;
  readonly crypto?: {
    readonly randomUUID?: () => string;
  };
}

function isPlainExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  return (
    ownKeys.length === keys.length
    && ownKeys.every((key) => typeof key === "string")
    && keys.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined
        && descriptor.enumerable
        && "value" in descriptor
        && descriptor.get === undefined
        && descriptor.set === undefined;
    })
  );
}

function validSavedAt(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length >= 20
    && value.length <= 64
    && Number.isFinite(Date.parse(value))
  );
}

function autosaveKeyDigest(autosaveKey: string): string {
  return sha256HexPortable(TEXT_ENCODER.encode(autosaveKey));
}

function encodeStudioAutosaveOpfsEnvelope(
  autosaveKey: string,
  state: "snapshot" | "cleared",
  savedAt: string,
  payload: StudioAutosavePayload | null,
): Uint8Array {
  if (!validSavedAt(savedAt)) {
    throw new Error("OPFS 자동저장 시각이 올바르지 않습니다.");
  }
  const serialized = payload === null ? null : serializeStudioAutosave(payload);
  const payloadDigest = serialized === null
    ? null
    : sha256HexPortable(TEXT_ENCODER.encode(serialized));
  return TEXT_ENCODER.encode(JSON.stringify({
    kind: STUDIO_AUTOSAVE_OPFS_ENVELOPE_KIND,
    version: STUDIO_AUTOSAVE_OPFS_ENVELOPE_VERSION,
    state,
    savedAt,
    autosaveKeyDigest: autosaveKeyDigest(autosaveKey),
    payloadDigest,
    payload: serialized,
  } satisfies StudioAutosaveOpfsEnvelope));
}

function decodeStudioAutosaveOpfsEnvelope(
  autosaveKey: string,
  bytes: Uint8Array,
): StudioAutosaveOpfsEnvelope {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUTOSAVE_BYTES) {
    throw new Error("OPFS 자동저장 checkpoint 크기가 허용 범위를 벗어났습니다.");
  }
  let value: unknown;
  try {
    value = JSON.parse(TEXT_DECODER.decode(bytes));
  } catch {
    throw new Error("OPFS 자동저장 checkpoint가 올바른 UTF-8 JSON이 아닙니다.");
  }
  if (!isPlainExactRecord(value, [
    "kind",
    "version",
    "state",
    "savedAt",
    "autosaveKeyDigest",
    "payloadDigest",
    "payload",
  ])) {
    throw new Error("OPFS 자동저장 checkpoint 스키마가 올바르지 않습니다.");
  }
  if (
    value.kind !== STUDIO_AUTOSAVE_OPFS_ENVELOPE_KIND
    || value.version !== STUDIO_AUTOSAVE_OPFS_ENVELOPE_VERSION
    || (value.state !== "snapshot" && value.state !== "cleared")
    || !validSavedAt(value.savedAt)
    || typeof value.autosaveKeyDigest !== "string"
    || !SHA_256_HEX.test(value.autosaveKeyDigest)
    || value.autosaveKeyDigest !== autosaveKeyDigest(autosaveKey)
  ) {
    throw new Error("OPFS 자동저장 checkpoint identity가 일치하지 않습니다.");
  }
  if (value.state === "cleared") {
    if (value.payload !== null || value.payloadDigest !== null) {
      throw new Error("삭제된 OPFS 자동저장 checkpoint에 payload가 남아 있습니다.");
    }
  } else {
    if (
      typeof value.payload !== "string"
      || typeof value.payloadDigest !== "string"
      || !SHA_256_HEX.test(value.payloadDigest)
      || sha256HexPortable(TEXT_ENCODER.encode(value.payload)) !== value.payloadDigest
    ) {
      throw new Error("OPFS 자동저장 payload 무결성 검증에 실패했습니다.");
    }
    const parsed = JSON.parse(value.payload) as unknown;
    if (
      typeof parsed !== "object"
      || parsed === null
      || !Array.isArray((parsed as { readonly pagesList?: unknown }).pagesList)
    ) {
      throw new Error("OPFS 자동저장 payload가 Studio 문서가 아닙니다.");
    }
  }
  return Object.freeze(value as unknown as StudioAutosaveOpfsEnvelope);
}

async function collectEntryBytes(
  journal: StudioAutosaveOpfsJournalPort,
  entry: StudioOpfsRecoveryEntry,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(entry.byteLength)
    || entry.byteLength <= 0
    || entry.byteLength > MAX_AUTOSAVE_BYTES
  ) {
    throw new Error("OPFS 자동저장 entry 크기가 허용 범위를 벗어났습니다.");
  }
  const output = new Uint8Array(entry.byteLength);
  let offset = 0;
  for await (const chunk of journal.readPayload(entry, { signal })) {
    if (!(chunk instanceof Uint8Array) || offset + chunk.byteLength > output.byteLength) {
      throw new Error("OPFS 자동저장 entry chunk 경계가 손상되었습니다.");
    }
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== output.byteLength) {
    throw new Error("OPFS 자동저장 entry가 부분적으로만 복원되었습니다.");
  }
  return output;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function journalIdentity(autosaveKey: string): StudioOpfsRecoveryJournalIdentity {
  return Object.freeze({
    documentId: `autosave-${autosaveKeyDigest(autosaveKey).slice(0, 48)}`,
    documentVersion: 2,
    engineVersion: STUDIO_AUTOSAVE_OPFS_ENGINE_VERSION,
  });
}

function latestDocumentEntry(scan: StudioOpfsRecoveryScan): StudioOpfsRecoveryEntry | null {
  let latest: StudioOpfsRecoveryEntry | null = null;
  for (const entry of scan.entries) {
    if (entry.pageId !== AUTOSAVE_PAGE_ID) continue;
    if (latest === null || entry.sequence > latest.sequence) latest = entry;
  }
  return latest;
}

export class StudioAutosaveOpfsSession {
  readonly #autosaveKey: string;
  readonly #journal: StudioAutosaveOpfsJournalPort;
  readonly #ownerId: string;
  readonly #now: () => number;
  #writer: StudioOpfsRecoveryWriterLease | null = null;
  #tail: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(options: StudioAutosaveOpfsSessionOptions) {
    if (options.autosaveKey.trim().length === 0 || options.ownerId.trim().length === 0) {
      throw new Error("OPFS 자동저장 세션 identity가 비어 있습니다.");
    }
    this.#autosaveKey = options.autosaveKey;
    this.#journal = options.journal;
    this.#ownerId = options.ownerId;
    this.#now = options.now ?? Date.now;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#disposed) {
      return Promise.reject(new Error("OPFS 자동저장 세션이 이미 종료되었습니다."));
    }
    const result = this.#tail.then(operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async #ensureWriter(signal?: AbortSignal): Promise<StudioOpfsRecoveryWriterLease> {
    const now = this.#now();
    if (this.#writer && this.#writer.expiresAt > now + WRITER_RENEW_WINDOW_MS) {
      return this.#writer;
    }
    if (this.#writer && this.#writer.expiresAt > now) {
      this.#writer = await this.#journal.renewWriter(this.#writer, { signal });
      return this.#writer;
    }
    this.#writer = await this.#journal.acquireWriter({
      ownerId: this.#ownerId,
      signal,
    });
    return this.#writer;
  }

  async #readLatestUnlocked(signal?: AbortSignal): Promise<StudioAutosaveOpfsReadResult> {
    const scan = await this.#journal.scan({ signal });
    const entry = latestDocumentEntry(scan);
    if (!entry) return null;
    const envelope = decodeStudioAutosaveOpfsEnvelope(
      this.#autosaveKey,
      await collectEntryBytes(this.#journal, entry, signal),
    );
    if (envelope.state === "cleared") {
      return Object.freeze({
        state: "cleared",
        savedAt: envelope.savedAt,
        sequence: entry.sequence,
        revision: entry.revision,
      });
    }
    const payload = JSON.parse(envelope.payload as string) as unknown;
    const serializedPayload = serializeStudioAutosave(payload as StudioAutosavePayload);
    const normalized = readStudioAutosave(
      {
        getItem: (candidate) =>
          candidate === this.#autosaveKey ? serializedPayload : null,
      },
      this.#autosaveKey,
    )?.payload ?? null;
    if (!normalized || !studioAutosaveHasContent(normalized)) {
      throw new Error("OPFS 자동저장 checkpoint에 복구할 Studio 내용이 없습니다.");
    }
    return Object.freeze({
      state: "snapshot",
      savedAt: envelope.savedAt,
      payload: normalized,
      sequence: entry.sequence,
      revision: entry.revision,
    });
  }

  readLatest(signal?: AbortSignal): Promise<StudioAutosaveOpfsReadResult> {
    return this.#enqueue(() => this.#readLatestUnlocked(signal));
  }

  #writeEnvelope(
    state: "snapshot" | "cleared",
    savedAt: string,
    payload: StudioAutosavePayload | null,
    signal?: AbortSignal,
  ): Promise<StudioAutosavePersistenceReceipt> {
    return this.#enqueue(async () => {
      const scan = await this.#journal.scan({ signal });
      const current = latestDocumentEntry(scan);
      const revision = (current?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error("OPFS 자동저장 revision 한도를 초과했습니다.");
      }
      const bytes = encodeStudioAutosaveOpfsEnvelope(
        this.#autosaveKey,
        state,
        savedAt,
        payload,
      );
      const digest = sha256HexPortable(bytes);
      const writer = await this.#ensureWriter(signal);
      const entry = await this.#journal.appendCheckpoint(writer, {
        id: `autosave-${revision}-${digest.slice(0, 12)}`,
        pageId: AUTOSAVE_PAGE_ID,
        revision,
        payload: bytes,
        byteLength: bytes.byteLength,
        createdAt: timestamp(savedAt),
        compactThroughSequence: scan.lastSequence,
      }, { signal });
      await this.#journal.evictObsolete(writer, { signal });
      return Object.freeze({
        authority: "opfs-journal",
        savedAt,
        sequence: entry.sequence,
        revision: entry.revision,
      });
    });
  }

  write(
    payload: StudioAutosavePayload,
    signal?: AbortSignal,
  ): Promise<StudioAutosavePersistenceReceipt> {
    if (!studioAutosaveHasContent(payload)) {
      return Promise.reject(new Error("내용이 없는 Studio 자동저장은 OPFS에 기록하지 않습니다."));
    }
    return this.#writeEnvelope("snapshot", payload.savedAt, payload, signal);
  }

  clear(
    savedAt = new Date(this.#now()).toISOString(),
    signal?: AbortSignal,
  ): Promise<StudioAutosavePersistenceReceipt> {
    return this.#writeEnvelope("cleared", savedAt, null, signal);
  }

  async flush(): Promise<void> {
    await this.#tail;
    await this.#journal.scan();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    // Close admission synchronously. Effect cleanup and page/route transitions can overlap a
    // pending checkpoint; leaving the flag open until its tail settles lets a stale closure append
    // behind the tail that disposal is waiting for and strand the renewed writer lease.
    this.#disposed = true;
    await this.#tail;
    const writer = this.#writer;
    this.#writer = null;
    if (!writer) return;
    try {
      await this.#journal.releaseWriter(writer);
    } catch {
      // An expired or replaced lease already prevents future writes; disposal is best-effort.
    }
  }
}

export async function createStudioAutosaveOpfsSession(
  autosaveKey: string,
  scope: StudioAutosaveBrowserScope =
    globalThis as unknown as StudioAutosaveBrowserScope,
  options: {
    /** Follower tabs get a session that reads the document but refuses every mutation. */
    readonly readOnly?: boolean;
  } = {},
): Promise<StudioAutosaveOpfsSession | null> {
  const lockManager = scope.navigator?.locks ?? null;
  if (!lockManager || typeof lockManager.request !== "function") return null;
  const selection = await selectStudioOpfsFileSystem(scope, {
    rootName: AUTOSAVE_ROOT_NAME,
  });
  if (selection.kind !== "opfs") return null;
  const identity = journalIdentity(autosaveKey);
  const journal = createStudioOpfsRecoveryJournal({
    identity,
    adapter: createStudioOpfsRecoveryJournalAdapter({
      fileSystem: selection.fs,
      lockManager,
      quotaEstimator: scope.navigator?.storage?.estimate
        ? {
            estimate: () => scope.navigator!.storage!.estimate!(),
          }
        : null,
    }),
    limits: {
      maxEntryBytes: MAX_AUTOSAVE_BYTES,
      maxJournalBytes: MAX_AUTOSAVE_JOURNAL_BYTES,
      maxEntries: 16,
      maxCheckpoints: 8,
    },
  });
  const randomId = scope.crypto?.randomUUID?.() ?? autosaveKeyDigest(
    `${autosaveKey}:${Date.now()}`,
  ).slice(0, 32);
  return new StudioAutosaveOpfsSession({
    autosaveKey,
    journal: options.readOnly ? createStudioAutosaveFollowerJournal(journal) : journal,
    ownerId: `autosave-${randomId}`,
  });
}

/**
 * Read-through, write-refusing view of a document journal.
 *
 * A follower tab still needs to *read* the manuscript (recovery discovery, reconciliation), so the
 * scan/read surface passes through untouched. Everything that could mutate the shared document is
 * refused before it reaches storage, which keeps the failure at the session boundary instead of
 * deep inside an append that has already advanced a revision.
 */
function createStudioAutosaveFollowerJournal(
  journal: StudioAutosaveOpfsJournalPort,
): StudioAutosaveOpfsJournalPort {
  const refuse = (): never => {
    throw new StudioAutosaveDocumentBusyError();
  };
  const follower: StudioAutosaveOpfsJournalPort = {
    scan: (options) => journal.scan(options),
    readPayload: (entry, options) => journal.readPayload(entry, options),
    acquireWriter: () => Promise.reject(new StudioAutosaveDocumentBusyError()),
    renewWriter: () => Promise.reject(new StudioAutosaveDocumentBusyError()),
    releaseWriter: () => Promise.resolve(),
    appendCheckpoint: refuse,
    evictObsolete: refuse,
  };
  return Object.freeze(follower);
}

export type StudioAutosaveDocumentSession = Readonly<{
  role: StudioAutosaveDocumentRole;
  /**
   * Always a usable *read* session when OPFS is available. For a follower every write path rejects
   * with `StudioAutosaveDocumentBusyError`, so the persistence helper fails closed instead of
   * forking into the SQLite authority.
   */
  session: StudioAutosaveOpfsSession | null;
  lease: StudioAutosaveDocumentLease;
}>;

/**
 * Document-open entry point: decides the leader before any stroke can be authored, then hands back
 * a session whose write capability matches that decision.
 *
 * Call `lease.release()` alongside `session.dispose()` when the document closes. The Web Lock is
 * released by the browser on tab destruction regardless, which is what lets a waiting follower take
 * over after a crash or a closed window.
 */
export async function openStudioAutosaveDocumentSession(
  autosaveKey: string,
  scope: StudioAutosaveBrowserScope =
    globalThis as unknown as StudioAutosaveBrowserScope,
  options: {
    readonly registry?: StudioAutosaveDocumentLeadershipRegistry;
  } = {},
): Promise<StudioAutosaveDocumentSession> {
  const lease = await requestStudioAutosaveDocumentLeadership({
    autosaveKey,
    locks: scope.navigator?.locks ?? null,
    registry: options.registry,
  });
  try {
    const session = await createStudioAutosaveOpfsSession(autosaveKey, scope, {
      readOnly: lease.role === "follower",
    });
    return Object.freeze({ role: lease.role, session, lease });
  } catch (cause: unknown) {
    await lease.release();
    throw cause;
  }
}

export async function reopenStudioAutosaveDocumentSessionForLeadership(input: {
  readonly session: StudioAutosaveOpfsSession | null;
  readonly autosaveKey: string;
  readonly scope?: StudioAutosaveBrowserScope;
}): Promise<StudioAutosaveOpfsSession | null> {
  if (input.session === null) return null;
  await input.session.dispose();
  return createStudioAutosaveOpfsSession(input.autosaveKey, input.scope);
}

/**
 * Withholds the second persistence authority from a follower tab.
 *
 * `persistStudioAutosaveWithOpfsPrimary` already fails closed on a busy document, but the emergency
 * pagehide path and the empty-document tombstone path write to SQLite *in parallel* with OPFS. A
 * follower reaching SQLite on its own writes a newer row than the leader's OPFS checkpoint, and the
 * next reconcile promotes it — the same fork, through a side door. Callers pass their acquired port
 * through this guard so a follower simply has no second authority to reach.
 */
export function withStudioAutosaveDocumentLeadership(
  sqlite: StudioAutosaveSqlitePort | null,
  lease: Pick<StudioAutosaveDocumentLease, "role"> | null,
): StudioAutosaveSqlitePort | null {
  return lease?.role === "follower" ? null : sqlite;
}

function browserRecoveryCandidate(
  candidate: Readonly<{ key: string; payload: StudioAutosavePayload }> | null,
): StudioAutosaveRecoveryCandidate | null {
  return candidate
    ? Object.freeze({
        key: candidate.key,
        authority: "browser-storage-compatibility" as const,
        savedAt: candidate.payload.savedAt,
        sequence: null,
        revision: null,
        payload: candidate.payload,
      })
    : null;
}

function discardAutosaveBrowserCompatibility(
  storage: StudioAutosaveStorage,
  key: string,
): void {
  try {
    storage.removeItem(key);
    storage.removeItem(studioLifecycleAutosaveSidecarKey(key));
  } catch {
    // Browser KV is compatibility/discard-only; cleanup denial never changes durable authority.
  }
}

export async function persistStudioAutosaveWithOpfsPrimary(input: {
  readonly session: StudioAutosaveOpfsSession | null;
  readonly sqlite?: StudioAutosaveSqlitePort | null;
  readonly storage: StudioAutosaveStorage;
  readonly key: string;
  readonly payload: StudioAutosavePayload;
  readonly signal?: AbortSignal;
  /**
   * OPFS 저널과 SQLite 권위가 모두 실패했을 때 호출된다. 현재 메모리 작업은 유지되지만
   * 브라우저 KV에 쓰거나 저장 성공으로 승격하지 않는다.
   */
  readonly onDurableAuthorityDegraded?: (cause: unknown) => void;
}): Promise<StudioAutosavePersistenceReceipt> {
  let durableFailure: unknown = !input.session && !input.sqlite
    ? new Error("OPFS journal and SQLite autosave authorities are unavailable")
    : null;
  if (input.session) {
    try {
      const receipt = await input.session.write(input.payload, input.signal);
      try {
        await input.sqlite?.write(input.key, input.payload);
      } catch {
        // OPFS가 권위이므로 SQLite 미러 실패는 저장 성공을 강등시키지 않는다.
      }
      discardAutosaveBrowserCompatibility(input.storage, input.key);
      return receipt;
    } catch (cause: unknown) {
      if (studioAutosaveDocumentBusy(cause)) {
        // 다른 탭이 이 원고의 leader다. SQLite 우회는 포크를 만든다. Jam 팔로워에게는
        // 예상된 상태이므로 저장 실패 배너를 올리지 않고 busy만 전파한다.
        throw cause instanceof StudioAutosaveDocumentBusyError
          ? cause
          : new StudioAutosaveDocumentBusyError(cause);
      }
      durableFailure = cause;
    }
  }
  if (input.sqlite) {
    try {
      await input.sqlite.write(input.key, input.payload);
      discardAutosaveBrowserCompatibility(input.storage, input.key);
      return Object.freeze({
        authority: "sqlite-fallback",
        savedAt: input.payload.savedAt,
        sequence: null,
        revision: null,
      });
    } catch (cause: unknown) {
      durableFailure = durableFailure === null
        ? cause
        : new AggregateError(
            [durableFailure, cause],
            "OPFS journal and SQLite autosave authorities both failed",
          );
    }
  }
  if (durableFailure !== null) {
    try {
      input.onDurableAuthorityDegraded?.(durableFailure);
    } catch {
      // 관측자 격리 — 고지 실패가 명시적인 durability error까지 막지 않는다.
    }
  }
  throw new StudioAutosaveDurabilityError(durableFailure);
}

export async function reconcileStudioAutosaveWithOpfsPrimary(input: {
  readonly session: StudioAutosaveOpfsSession | null;
  readonly sqlite?: StudioAutosaveSqlitePort | null;
  readonly storage: StudioAutosaveStorage;
  readonly key: string;
  readonly allowLegacy?: boolean;
  readonly signal?: AbortSignal;
}): Promise<StudioAutosaveReconciliation> {
  let compatibilityCandidate: StudioAutosaveRecoveryCandidate | null = null;
  try {
    compatibilityCandidate = browserRecoveryCandidate(readStudioAutosave(
      input.storage,
      input.key,
      input.allowLegacy ?? false,
    ));
  } catch {
    // Browser storage is a compatibility input only. Its denial must never hide OPFS/SQLite data.
  }
  type Candidate = Readonly<{
    key: string;
    source: StudioAutosaveDurableAuthority;
    state: "snapshot" | "cleared";
    savedAt: string;
    payload: StudioAutosavePayload | null;
    sequence: number | null;
    revision: number | null;
  }>;
  const candidates: Candidate[] = [];
  let sqliteReadable = false;
  if (input.sqlite) {
    try {
      const sqliteResult: StudioAutosaveSqliteReadResult = await input.sqlite.read(input.key);
      sqliteReadable = true;
      if (sqliteResult) {
        candidates.push(Object.freeze({
          key: input.key,
          source: "sqlite-fallback",
          state: sqliteResult.state,
          savedAt: sqliteResult.savedAt,
          payload: sqliteResult.state === "snapshot" ? sqliteResult.payload : null,
          sequence: null,
          revision: null,
        }));
      }
    } catch {
      // 손상/개방 실패 SQLite 행은 덮어쓰지 않고 다른 권위로 복구한다.
    }
  }
  let opfsReadable = false;
  if (input.session) {
    try {
      const durable = await input.session.readLatest(input.signal);
      opfsReadable = true;
      if (durable) {
        candidates.push(Object.freeze({
          key: input.key,
          source: "opfs-journal",
          state: durable.state,
          savedAt: durable.savedAt,
          payload: durable.state === "snapshot" ? durable.payload : null,
          sequence: durable.sequence,
          revision: durable.revision,
        }));
      }
    } catch {
      // SQLite와 브라우저 슬롯을 계속 평가한다.
    }
  }
  const sourceRank: Record<StudioAutosaveDurableAuthority, number> = {
    "opfs-journal": 3,
    "sqlite-fallback": 2,
  };
  candidates.sort((left, right) => (
    timestamp(right.savedAt) - timestamp(left.savedAt)
    || Number(right.state === "cleared") - Number(left.state === "cleared")
    || sourceRank[right.source] - sourceRank[left.source]
  ));
  let winner = candidates[0] ?? null;
  let migratedToOpfs = false;

  if (winner && input.session && opfsReadable && winner.source === "sqlite-fallback") {
    try {
      const receipt = winner.state === "snapshot"
        ? await input.session.write(winner.payload!, input.signal)
        : await input.session.clear(winner.savedAt, input.signal);
      winner = Object.freeze({
        ...winner,
        source: "opfs-journal",
        sequence: receipt.sequence,
        revision: receipt.revision,
      });
      migratedToOpfs = true;
    } catch {
      // 원래 SQLite 승자를 그대로 유지한다.
    }
  }

  if (!winner) {
    if (compatibilityCandidate) {
      return Object.freeze({
        candidate: compatibilityCandidate,
        compatibilityCandidate,
        authority: "browser-storage-compatibility",
        durability: "compatibility-only",
        migratedToOpfs: false,
      });
    }
    return Object.freeze({
      candidate: null,
      compatibilityCandidate: null,
      authority: opfsReadable
        ? "opfs-journal"
        : input.sqlite && sqliteReadable
          ? "sqlite-fallback"
          : null,
      durability: "none",
      migratedToOpfs: false,
    });
  }

  if (winner.state === "cleared") {
    const compatibilityIsNewer = compatibilityCandidate !== null
      && timestamp(compatibilityCandidate.savedAt) > timestamp(winner.savedAt);
    if (compatibilityIsNewer) {
      return Object.freeze({
        candidate: compatibilityCandidate,
        compatibilityCandidate,
        authority: "browser-storage-compatibility",
        durability: "compatibility-only",
        migratedToOpfs,
      });
    }
    discardAutosaveBrowserCompatibility(input.storage, input.key);
    if (winner.source === "opfs-journal" && input.sqlite) {
      try {
        await input.sqlite.clear(input.key, winner.savedAt);
      } catch {
        // OPFS tombstone remains authoritative.
      }
    }
    return Object.freeze({
      candidate: null,
      compatibilityCandidate: null,
      authority: winner.source,
      durability: "none",
      migratedToOpfs,
    });
  }

  if (
    compatibilityCandidate === null
    || timestamp(compatibilityCandidate.savedAt) <= timestamp(winner.savedAt)
  ) {
    discardAutosaveBrowserCompatibility(input.storage, input.key);
  }
  if (winner.source === "opfs-journal" && input.sqlite) {
    try {
      await input.sqlite.write(input.key, winner.payload!);
    } catch {
      // OPFS snapshot remains authoritative.
    }
  }
  return Object.freeze({
    candidate: Object.freeze({
      key: winner.key,
      authority: winner.source,
      savedAt: winner.savedAt,
      sequence: winner.sequence,
      revision: winner.revision,
      payload: winner.payload!,
    }),
    compatibilityCandidate:
      compatibilityCandidate
      && timestamp(compatibilityCandidate.savedAt) > timestamp(winner.savedAt)
        ? compatibilityCandidate
        : null,
    authority: winner.source,
    durability: "durable",
    migratedToOpfs,
  });
}
