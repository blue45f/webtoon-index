import { fromUint8Array, toUint8Array } from "js-base64";

import { calculateStudioCrc32 } from "./studio-crc32";

import type { StudioLocalDatabase } from "./studio-local-database";
import type {
  StudioOpfsRecoveryAppendInput,
  StudioOpfsRecoveryByteSource,
  StudioOpfsRecoveryCheckpointInput,
  StudioOpfsRecoveryEntry,
  StudioOpfsRecoveryJournalIdentity,
  StudioOpfsRecoveryMutationOptions,
  StudioOpfsRecoveryScan,
  StudioOpfsRecoveryWriterLease,
} from "./studio-opfs-recovery-journal";
import type { StudioPagesHistoryRecoveryPort } from "./studio-pages-history-durable-runtime";

const SQLITE_HISTORY_RECOVERY_FORMAT = "toonspectrum:studio-pages-history-sqlite" as const;
const SQLITE_HISTORY_RECOVERY_VERSION = 1 as const;
const SQLITE_HISTORY_LEASE_TTL_MS = 30_000;
const SQLITE_HISTORY_LEASE_NAMESPACE = "studio-pages-history-writer-leases";
const TEXT_ENCODER = new TextEncoder();
const PROCESS_LOCK_TAILS = new Map<string, Promise<void>>();

interface StoredSqliteHistoryEntry {
  readonly format: typeof SQLITE_HISTORY_RECOVERY_FORMAT;
  readonly version: typeof SQLITE_HISTORY_RECOVERY_VERSION;
  readonly kind: "operation" | "checkpoint";
  readonly id: string;
  readonly sequence: number;
  readonly pageId: string;
  readonly revision: number;
  readonly documentId: string;
  readonly documentVersion: number;
  readonly engineVersion: string;
  readonly writerEpoch: number;
  readonly createdAt: number;
  readonly compactThroughSequence: number | null;
  readonly payloadBase64: string;
  readonly byteLength: number;
  readonly payloadCrc32: number;
}

interface ValidatedSqliteHistoryEntry {
  readonly stored: StoredSqliteHistoryEntry;
  readonly payload: Uint8Array;
  readonly descriptorCrc32: number;
  readonly snapshotSlot: "a" | "b" | null;
}

export interface StudioPagesHistorySqliteRecoveryOptions {
  readonly database: StudioLocalDatabase;
  readonly identity: StudioOpfsRecoveryJournalIdentity;
  readonly now?: () => number;
  /** The default factory owns its DB handle; injected/shared handles can opt out. */
  readonly closeDatabaseOnAbort?: boolean;
  readonly lockManager?: {
    request<T>(
      name: string,
      options: { readonly mode: "exclusive"; readonly signal?: AbortSignal },
      callback: () => Promise<T>,
    ): Promise<T>;
  } | null;
}

function assertNotAborted(options: StudioOpfsRecoveryMutationOptions = {}): void {
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new DOMException("aborted", "AbortError");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseStoredEntry(
  payload: string,
  rowCrc32: number,
  identity: StudioOpfsRecoveryJournalIdentity,
  snapshotSlot: "a" | "b" | null,
): ValidatedSqliteHistoryEntry | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(decoded)) return null;
  const kind = decoded.kind;
  if (
    decoded.format !== SQLITE_HISTORY_RECOVERY_FORMAT
    || decoded.version !== SQLITE_HISTORY_RECOVERY_VERSION
    || (kind !== "operation" && kind !== "checkpoint")
    || typeof decoded.id !== "string"
    || !isFiniteSafeInteger(decoded.sequence)
    || typeof decoded.pageId !== "string"
    || !isFiniteSafeInteger(decoded.revision)
    || decoded.documentId !== identity.documentId
    || decoded.documentVersion !== identity.documentVersion
    || decoded.engineVersion !== identity.engineVersion
    || !isFiniteSafeInteger(decoded.writerEpoch)
    || !isFiniteSafeInteger(decoded.createdAt)
    || (
      decoded.compactThroughSequence !== null
      && !isFiniteSafeInteger(decoded.compactThroughSequence)
    )
    || typeof decoded.payloadBase64 !== "string"
    || !isFiniteSafeInteger(decoded.byteLength)
    || !isFiniteSafeInteger(decoded.payloadCrc32)
  ) {
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = toUint8Array(decoded.payloadBase64);
  } catch {
    return null;
  }
  if (
    bytes.byteLength !== decoded.byteLength
    || calculateStudioCrc32(bytes) !== decoded.payloadCrc32
    || rowCrc32 !== decoded.payloadCrc32
  ) {
    return null;
  }
  return {
    stored: decoded as unknown as StoredSqliteHistoryEntry,
    payload: bytes,
    descriptorCrc32: calculateStudioCrc32(TEXT_ENCODER.encode(payload)),
    snapshotSlot,
  };
}

async function materializeBytes(source: StudioOpfsRecoveryByteSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source.slice();
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of source as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function toRecoveryEntry(
  projectId: string,
  entry: ValidatedSqliteHistoryEntry,
): StudioOpfsRecoveryEntry {
  const { stored } = entry;
  const path = `sqlite://${encodeURIComponent(projectId)}/${stored.sequence}`;
  return Object.freeze({
    kind: stored.kind,
    id: stored.id,
    sequence: stored.sequence,
    pageId: stored.pageId,
    revision: stored.revision,
    documentId: stored.documentId,
    documentVersion: stored.documentVersion,
    engineVersion: stored.engineVersion,
    writerEpoch: stored.writerEpoch,
    createdAt: stored.createdAt,
    byteLength: stored.byteLength,
    chunks: Object.freeze([Object.freeze({
      path,
      byteLength: stored.byteLength,
      crc32: stored.payloadCrc32,
    })]),
    compactThroughSequence: stored.compactThroughSequence,
    descriptorPath: path,
    descriptorCrc32: entry.descriptorCrc32,
  });
}

function freezeScan(
  entries: readonly ValidatedSqliteHistoryEntry[],
  ignoredSlots: readonly ("a" | "b")[],
): StudioOpfsRecoveryScan {
  const last = entries.at(-1)?.stored;
  const selectedCheckpoint = [...entries].reverse().find((entry) => entry.snapshotSlot !== null);
  return Object.freeze({
    generation: entries.length,
    writerEpoch: last?.writerEpoch ?? 0,
    lastSequence: last?.sequence ?? 0,
    totalPayloadBytes: entries.reduce((sum, entry) => sum + entry.stored.byteLength, 0),
    entries: Object.freeze(entries.map((entry) => toRecoveryEntry(
      `history:${entry.stored.documentId}`,
      entry,
    ))),
    selectedSlot: selectedCheckpoint?.snapshotSlot ?? null,
    ignoredSlots: Object.freeze([...ignoredSlots]),
  });
}

/**
 * SQLite implementation of the product history recovery contract.
 *
 * Journal rows retain every accepted frontier; checkpoints are additionally written into the
 * two-slot snapshot table. Recovery selects the newest valid checkpoint and only its contiguous,
 * CRC-valid tail. A torn/corrupt row therefore cannot make a later row visible.
 */
export class StudioPagesHistorySqliteRecovery implements StudioPagesHistoryRecoveryPort {
  readonly #database: StudioLocalDatabase;
  readonly #identity: StudioOpfsRecoveryJournalIdentity;
  readonly #projectId: string;
  readonly #now: () => number;
  readonly #closeDatabaseOnAbort: boolean;
  readonly #lockManager: StudioPagesHistorySqliteRecoveryOptions["lockManager"];
  #lease: StudioOpfsRecoveryWriterLease | null = null;
  #lastPayload: Uint8Array | null = null;
  #aborted = false;

  constructor(options: StudioPagesHistorySqliteRecoveryOptions) {
    this.#database = options.database;
    this.#identity = options.identity;
    this.#projectId = `history:${options.identity.documentId}`;
    this.#now = options.now ?? Date.now;
    this.#closeDatabaseOnAbort = options.closeDatabaseOnAbort ?? false;
    this.#lockManager = options.lockManager ?? null;
  }

  async #withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockName = `toonspectrum-studio-history-sqlite:${this.#identity.documentId}`;
    if (this.#lockManager) {
      return this.#lockManager.request(lockName, { mode: "exclusive" }, operation);
    }
    const previous = PROCESS_LOCK_TAILS.get(lockName) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    PROCESS_LOCK_TAILS.set(lockName, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (PROCESS_LOCK_TAILS.get(lockName) === tail) PROCESS_LOCK_TAILS.delete(lockName);
    }
  }

  async #persistedLease(): Promise<StudioOpfsRecoveryWriterLease | null> {
    const raw = await this.#database.kvGet(SQLITE_HISTORY_LEASE_NAMESPACE, this.#projectId);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as Partial<StudioOpfsRecoveryWriterLease>;
      if (
        value.documentId !== this.#identity.documentId
        || typeof value.ownerId !== "string"
        || typeof value.token !== "string"
        || !isFiniteSafeInteger(value.epoch)
        || !isFiniteSafeInteger(value.acquiredAt)
        || !isFiniteSafeInteger(value.expiresAt)
      ) {
        return null;
      }
      return value as StudioOpfsRecoveryWriterLease;
    } catch {
      return null;
    }
  }

  async #validatedFrontier(): Promise<{
    readonly entries: readonly ValidatedSqliteHistoryEntry[];
    readonly ignoredSlots: readonly ("a" | "b")[];
  }> {
    const snapshots = await this.#database.listJournalSnapshots(this.#projectId);
    const ignoredSlots: ("a" | "b")[] = [];
    const validSnapshots: ValidatedSqliteHistoryEntry[] = [];
    for (const row of snapshots) {
      const slot = row.slot === 0 ? "a" : "b";
      const parsed = parseStoredEntry(row.payload, row.crc32, this.#identity, slot);
      if (parsed?.stored.kind === "checkpoint" && parsed.stored.sequence === row.seq) {
        validSnapshots.push(parsed);
      } else {
        ignoredSlots.push(slot);
      }
    }
    validSnapshots.sort((left, right) => left.stored.sequence - right.stored.sequence);
    const checkpoint = validSnapshots.at(-1) ?? null;

    const rows = await this.#database.listJournalEntries(this.#projectId);
    const parsedRows = new Map<number, ValidatedSqliteHistoryEntry>();
    for (const row of rows) {
      const parsed = parseStoredEntry(row.payload, row.crc32, this.#identity, null);
      if (parsed && parsed.stored.sequence === row.seq) parsedRows.set(row.seq, parsed);
    }

    const entries: ValidatedSqliteHistoryEntry[] = checkpoint ? [checkpoint] : [];
    let expected = checkpoint ? checkpoint.stored.sequence + 1 : 1;
    while (parsedRows.has(expected)) {
      entries.push(parsedRows.get(expected)!);
      expected += 1;
    }
    return { entries, ignoredSlots };
  }

  async scanLatest(options: StudioOpfsRecoveryMutationOptions = {}): Promise<StudioOpfsRecoveryScan> {
    assertNotAborted(options);
    const { entries, ignoredSlots } = await this.#validatedFrontier();
    this.#lastPayload = entries.at(-1)?.payload.slice() ?? null;
    return freezeScan(entries, ignoredSlots);
  }

  async readLatestPayload(): Promise<Uint8Array | null> {
    if (this.#lastPayload === null) await this.scanLatest();
    return this.#lastPayload?.slice() ?? null;
  }

  async acquireWriter(input: {
    readonly ownerId: string;
    readonly signal?: AbortSignal;
  }): Promise<StudioOpfsRecoveryWriterLease> {
    assertNotAborted({ signal: input.signal });
    if (this.#aborted) throw new Error("studio history sqlite recovery is closed");
    return this.#withExclusiveLock(async () => {
      const acquiredAt = this.#now();
      const existing = await this.#persistedLease();
      if (
        existing
        && existing.expiresAt > acquiredAt
        && existing.ownerId !== input.ownerId
      ) {
        throw new Error("studio history sqlite recovery writer lease is busy");
      }
      const scan = await this.scanLatest();
      const epoch = Math.max(1, scan.writerEpoch + 1, (existing?.epoch ?? 0) + 1);
      const lease = Object.freeze({
        documentId: this.#identity.documentId,
        ownerId: input.ownerId,
        token: `${input.ownerId}:${epoch}:${acquiredAt}`,
        epoch,
        acquiredAt,
        expiresAt: acquiredAt + SQLITE_HISTORY_LEASE_TTL_MS,
      });
      await this.#database.kvSet(
        SQLITE_HISTORY_LEASE_NAMESPACE,
        this.#projectId,
        JSON.stringify(lease),
      );
      this.#lease = lease;
      return lease;
    });
  }

  async #append(
    kind: "operation" | "checkpoint",
    input: StudioOpfsRecoveryAppendInput | StudioOpfsRecoveryCheckpointInput,
    options: StudioOpfsRecoveryMutationOptions,
  ): Promise<StudioOpfsRecoveryEntry> {
    assertNotAborted(options);
    const bytes = await materializeBytes(input.payload);
    if (input.byteLength !== undefined && input.byteLength !== bytes.byteLength) {
      throw new Error("studio history sqlite recovery payload length mismatch");
    }
    return this.#withExclusiveLock(async () => {
      let lease = this.#lease;
      const persistedLease = await this.#persistedLease();
      if (
        !lease
        || this.#aborted
        || persistedLease?.token !== lease.token
      ) {
        throw new Error("studio history sqlite recovery writer lease was lost");
      }
      const now = this.#now();
      if (persistedLease.expiresAt - now <= SQLITE_HISTORY_LEASE_TTL_MS / 2) {
        lease = Object.freeze({
          ...lease,
          expiresAt: now + SQLITE_HISTORY_LEASE_TTL_MS,
        });
        await this.#database.kvSet(
          SQLITE_HISTORY_LEASE_NAMESPACE,
          this.#projectId,
          JSON.stringify(lease),
        );
        this.#lease = lease;
      }
      const frontier = await this.#validatedFrontier();
      const sequence = (frontier.entries.at(-1)?.stored.sequence ?? 0) + 1;
      const payloadCrc32 = calculateStudioCrc32(bytes);
      const stored: StoredSqliteHistoryEntry = Object.freeze({
        format: SQLITE_HISTORY_RECOVERY_FORMAT,
        version: SQLITE_HISTORY_RECOVERY_VERSION,
        kind,
        id: input.id,
        sequence,
        pageId: input.pageId,
        revision: input.revision,
        documentId: this.#identity.documentId,
        documentVersion: this.#identity.documentVersion,
        engineVersion: this.#identity.engineVersion,
        writerEpoch: lease.epoch,
        createdAt: input.createdAt ?? this.#now(),
        compactThroughSequence:
          kind === "checkpoint"
            ? (input as StudioOpfsRecoveryCheckpointInput).compactThroughSequence
            : null,
        payloadBase64: fromUint8Array(bytes),
        byteLength: bytes.byteLength,
        payloadCrc32,
      });
      const serialized = JSON.stringify(stored);
      if (kind === "checkpoint") {
        await this.#database.putJournalSnapshot(this.#projectId, {
          slot: sequence % 2 === 0 ? 0 : 1,
          seq: sequence,
          payload: serialized,
          crc32: payloadCrc32,
        });
      }
      await this.#database.appendJournalEntry(this.#projectId, {
        seq: sequence,
        payload: serialized,
        crc32: payloadCrc32,
      });
      if (kind === "checkpoint") {
        await this.#database.deleteJournalEntriesBefore(this.#projectId, sequence);
      }
      this.#lastPayload = bytes.slice();
      return toRecoveryEntry(this.#projectId, {
        stored,
        payload: bytes,
        descriptorCrc32: calculateStudioCrc32(TEXT_ENCODER.encode(serialized)),
        snapshotSlot: kind === "checkpoint" ? (sequence % 2 === 0 ? "a" : "b") : null,
      });
    });
  }

  appendCommand(
    input: StudioOpfsRecoveryAppendInput,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryEntry> {
    return this.#append("operation", input, options);
  }

  compact(
    input: StudioOpfsRecoveryCheckpointInput,
    options: StudioOpfsRecoveryMutationOptions = {},
  ): Promise<StudioOpfsRecoveryEntry> {
    return this.#append("checkpoint", input, options);
  }

  async flush(): Promise<void> {
    // sqlite-wasm statements and transactions complete before their async facade resolves.
  }

  async abort(): Promise<void> {
    if (this.#aborted) return;
    this.#aborted = true;
    const lease = this.#lease;
    this.#lease = null;
    if (lease) {
      await this.#withExclusiveLock(async () => {
        const persisted = await this.#persistedLease();
        if (persisted?.token === lease.token) {
          await this.#database.kvSet(
            SQLITE_HISTORY_LEASE_NAMESPACE,
            this.#projectId,
            JSON.stringify({ ...lease, expiresAt: Math.min(this.#now(), lease.expiresAt) }),
          );
        }
      });
    }
    if (this.#closeDatabaseOnAbort) await this.#database.close();
  }
}

export function createStudioPagesHistorySqliteRecovery(
  options: StudioPagesHistorySqliteRecoveryOptions,
): StudioPagesHistorySqliteRecovery {
  return new StudioPagesHistorySqliteRecovery(options);
}
