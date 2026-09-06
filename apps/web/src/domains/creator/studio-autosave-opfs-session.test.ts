import { describe, expect, it, vi } from "vitest";

import {
  serializeStudioAutosave,
  studioLifecycleAutosaveSidecarKey,
  type StudioAutosavePayload,
  type StudioAutosaveStorage,
} from "./studio-autosave";
import {
  StudioAutosaveDurabilityError,
  StudioAutosaveOpfsSession,
  reopenStudioAutosaveDocumentSessionForLeadership,
  persistStudioAutosaveWithOpfsPrimary,
  reconcileStudioAutosaveWithOpfsPrimary,
  type StudioAutosaveOpfsJournalPort,
} from "./studio-autosave-opfs-session";

import type {
  StudioAutosaveSqlitePort,
  StudioAutosaveSqliteReadResult,
} from "./studio-autosave-sqlite-store";
import type {
  StudioOpfsRecoveryEntry,
  StudioOpfsRecoveryScan,
  StudioOpfsRecoveryWriterLease,
} from "./studio-opfs-recovery-journal";


const DOCUMENT_ID = "autosave-test-document";
const ENGINE_VERSION = "studio-autosave-v2";

function payload(savedAt: string, elementId = "stroke-1"): StudioAutosavePayload {
  return {
    version: 2,
    savedAt,
    pagesList: [{
      id: "page-1",
      elements: [{ id: elementId, type: "draw" }],
      canvasH: 2_000,
    }],
    currentPageId: "page-1",
  };
}

function memoryStorage(
  initial: Readonly<Record<string, string>> = {},
): StudioAutosaveStorage & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function memorySqliteStore(): StudioAutosaveSqlitePort & {
  readonly values: Map<string, StudioAutosaveSqliteReadResult>;
  failWrites: boolean;
} {
  const values = new Map<string, StudioAutosaveSqliteReadResult>();
  return {
    values,
    failWrites: false,
    async read(key) {
      return values.get(key) ?? null;
    },
    async write(key, next) {
      if (this.failWrites) throw new Error("sqlite write failed");
      values.set(key, Object.freeze({
        state: "snapshot",
        savedAt: next.savedAt,
        payload: next,
      }));
    },
    async clear(key, savedAt = new Date().toISOString()) {
      if (this.failWrites) throw new Error("sqlite clear failed");
      values.set(key, Object.freeze({ state: "cleared", savedAt }));
    },
  };
}

class FakeAutosaveJournal implements StudioAutosaveOpfsJournalPort {
  readonly payloads = new Map<string, Uint8Array>();
  entries: StudioOpfsRecoveryEntry[] = [];
  epoch = 0;
  acquireCount = 0;
  renewCount = 0;
  releaseCount = 0;
  now = 1_000;
  appendGate: Promise<void> | null = null;

  async scan(): Promise<StudioOpfsRecoveryScan> {
    return Object.freeze({
      generation: this.entries.length,
      writerEpoch: this.epoch,
      lastSequence: this.entries.at(-1)?.sequence ?? 0,
      totalPayloadBytes: this.entries.reduce((total, entry) => total + entry.byteLength, 0),
      entries: Object.freeze([...this.entries]),
      selectedSlot: this.entries.length > 0 ? "a" : null,
      ignoredSlots: Object.freeze([]),
    });
  }

  async *readPayload(entry: StudioOpfsRecoveryEntry): AsyncIterable<Uint8Array> {
    const bytes = this.payloads.get(entry.descriptorPath);
    if (!bytes) throw new Error("missing payload");
    const split = Math.floor(bytes.byteLength / 2);
    if (split > 0) yield bytes.slice(0, split);
    yield bytes.slice(split);
  }

  async acquireWriter(
    input: { readonly ownerId: string },
  ): Promise<StudioOpfsRecoveryWriterLease> {
    this.acquireCount += 1;
    this.epoch += 1;
    return Object.freeze({
      documentId: DOCUMENT_ID,
      ownerId: input.ownerId,
      token: `token-${this.epoch}`,
      epoch: this.epoch,
      acquiredAt: this.now,
      expiresAt: this.now + 30_000,
    });
  }

  async renewWriter(
    writer: StudioOpfsRecoveryWriterLease,
  ): Promise<StudioOpfsRecoveryWriterLease> {
    this.renewCount += 1;
    return Object.freeze({
      ...writer,
      expiresAt: this.now + 30_000,
    });
  }

  async releaseWriter(): Promise<void> {
    this.releaseCount += 1;
  }

  async appendCheckpoint(
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
  ): Promise<StudioOpfsRecoveryEntry> {
    await this.appendGate;
    const sequence = (this.entries.at(-1)?.sequence ?? 0) + 1;
    this.entries = this.entries.filter(
      (entry) =>
        entry.pageId !== input.pageId
        || entry.sequence > input.compactThroughSequence,
    );
    const descriptorPath = `entry-${sequence}`;
    const entry: StudioOpfsRecoveryEntry = Object.freeze({
      kind: "checkpoint",
      id: input.id,
      sequence,
      pageId: input.pageId,
      revision: input.revision,
      documentId: writer.documentId,
      documentVersion: 2,
      engineVersion: ENGINE_VERSION,
      writerEpoch: writer.epoch,
      createdAt: input.createdAt,
      byteLength: input.byteLength,
      chunks: Object.freeze([{
        path: `chunk-${sequence}`,
        byteLength: input.byteLength,
        crc32: 0,
      }]),
      compactThroughSequence: input.compactThroughSequence,
      descriptorPath,
      descriptorCrc32: 0,
    });
    this.payloads.set(descriptorPath, Uint8Array.from(input.payload));
    this.entries.push(entry);
    return entry;
  }

  async evictObsolete(): Promise<unknown> {
    return Object.freeze({ removedPaths: Object.freeze([]), freedBytes: 0 });
  }
}

function session(
  journal: FakeAutosaveJournal,
  key = "toonspectrum-studio-autosave:v12:guest:new",
): StudioAutosaveOpfsSession {
  return new StudioAutosaveOpfsSession({
    autosaveKey: key,
    journal,
    ownerId: "autosave-test-owner",
    now: () => journal.now,
  });
}

describe("StudioAutosaveOpfsSession", () => {
  it("releases a previously read-only session before reopening for leadership", async () => {
    const original = {
      dispose: vi.fn(async () => undefined),
    } as unknown as StudioAutosaveOpfsSession;

    const reopened = await reopenStudioAutosaveDocumentSessionForLeadership({
      session: original,
      autosaveKey: "toonspectrum-studio-autosave:v12:guest:new",
    });
    if (reopened !== null) {
      expect(reopened).toHaveProperty("dispose");
      expect(reopened).toHaveProperty("write");
      await reopened.dispose();
    }
    expect(original.dispose).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no existing OPFS session", async () => {
    await expect(
      reopenStudioAutosaveDocumentSessionForLeadership({
        session: null,
        autosaveKey: "toonspectrum-studio-autosave:v12:guest:new",
      }),
    ).resolves.toBeNull();
  });

  it("writes one compacted checkpoint and restores the newest complete Studio payload", async () => {
    const journal = new FakeAutosaveJournal();
    const target = session(journal);

    const first = await target.write(payload("2026-07-30T01:00:00.000Z", "first"));
    const second = await target.write(payload("2026-07-30T01:01:00.000Z", "second"));
    const restored = await target.readLatest();

    expect(first).toMatchObject({ authority: "opfs-journal", sequence: 1, revision: 1 });
    expect(second).toMatchObject({ authority: "opfs-journal", sequence: 2, revision: 2 });
    expect(journal.entries).toHaveLength(1);
    expect(restored).toMatchObject({
      state: "snapshot",
      sequence: 2,
      revision: 2,
      payload: {
        pagesList: [{ elements: [{ id: "second" }] }],
      },
    });
    await target.dispose();
    expect(journal.releaseCount).toBe(1);
  });

  it("uses a durable tombstone so a cleared recovery cannot reappear on reload", async () => {
    const journal = new FakeAutosaveJournal();
    const target = session(journal);
    await target.write(payload("2026-07-30T01:00:00.000Z"));
    await target.clear("2026-07-30T02:00:00.000Z");

    expect(await target.readLatest()).toEqual({
      state: "cleared",
      savedAt: "2026-07-30T02:00:00.000Z",
      sequence: 2,
      revision: 2,
    });
    expect(journal.entries).toHaveLength(1);
  });

  it("fails closed when checkpoint bytes are modified after commit", async () => {
    const journal = new FakeAutosaveJournal();
    const target = session(journal);
    await target.write(payload("2026-07-30T01:00:00.000Z"));
    const entry = journal.entries[0]!;
    const bytes = journal.payloads.get(entry.descriptorPath)!;
    bytes[Math.floor(bytes.byteLength / 2)] ^= 0x01;

    await expect(target.readLatest()).rejects.toThrow(/무결성|JSON/u);
  });

  it("renews a near-expiry writer and reacquires an expired writer", async () => {
    const journal = new FakeAutosaveJournal();
    const target = session(journal);
    await target.write(payload("2026-07-30T01:00:00.000Z", "first"));
    journal.now = 26_500;
    await target.write(payload("2026-07-30T01:01:00.000Z", "second"));
    expect(journal.renewCount).toBe(1);

    journal.now = 100_000;
    await target.write(payload("2026-07-30T01:02:00.000Z", "third"));
    expect(journal.acquireCount).toBe(2);
  });

  it("closes admission before waiting for an in-flight checkpoint during disposal", async () => {
    const journal = new FakeAutosaveJournal();
    let releaseAppend!: () => void;
    journal.appendGate = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    const target = session(journal);
    const inFlight = target.write(payload("2026-07-30T01:00:00.000Z", "first"));
    await vi.waitFor(() => expect(journal.acquireCount).toBe(1));

    const disposal = target.dispose();
    await expect(
      target.write(payload("2026-07-30T01:01:00.000Z", "stale")),
    ).rejects.toThrow("OPFS 자동저장 세션이 이미 종료되었습니다.");
    releaseAppend();
    await inFlight;
    await disposal;

    expect(journal.entries).toHaveLength(1);
    expect(journal.releaseCount).toBe(1);
  });
});

describe("Studio autosave OPFS authority reconciliation", () => {
  it("commits OPFS without writing browser storage and discards stale compatibility data", async () => {
    const key = "autosave-primary";
    const storage = memoryStorage({
      [studioLifecycleAutosaveSidecarKey(key)]: serializeStudioAutosave(
        payload("2026-07-30T00:00:00.000Z", "old"),
      ),
    });
    const journal = new FakeAutosaveJournal();
    const target = session(journal, key);
    const next = payload("2026-07-30T03:00:00.000Z", "durable");
    const setItem = vi.spyOn(storage, "setItem");

    const receipt = await persistStudioAutosaveWithOpfsPrimary({
      session: target,
      storage,
      key,
      payload: next,
    });

    expect(receipt.authority).toBe("opfs-journal");
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem(studioLifecycleAutosaveSidecarKey(key))).toBeNull();
  });

  it("does not touch writable browser KV after a durable snapshot commits", async () => {
    const key = "autosave-browser-quota";
    const target = session(new FakeAutosaveJournal(), key);
    const setItem = vi.fn(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const blockedStorage: StudioAutosaveStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem,
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };

    await expect(persistStudioAutosaveWithOpfsPrimary({
      session: target,
      storage: blockedStorage,
      key,
      payload: payload("2026-07-30T03:10:00.000Z", "durable-despite-quota"),
    })).resolves.toMatchObject({ authority: "opfs-journal" });
    await expect(reconcileStudioAutosaveWithOpfsPrimary({
      session: target,
      storage: blockedStorage,
      key,
    })).resolves.toMatchObject({
      authority: "opfs-journal",
      durability: "durable",
      candidate: {
        authority: "opfs-journal",
        sequence: 1,
        revision: 1,
        payload: { pagesList: [{ elements: [{ id: "durable-despite-quota" }] }] },
      },
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("never returns browser storage as durable success when all durable authorities are unavailable", async () => {
    const key = "autosave-fallback";
    const storage = memoryStorage();
    const next = payload("2026-07-30T03:00:00.000Z");
    const setItem = vi.spyOn(storage, "setItem");
    const causes: unknown[] = [];
    const failure = await persistStudioAutosaveWithOpfsPrimary({
      session: null,
      storage,
      key,
      payload: next,
      onDurableAuthorityDegraded: (cause) => causes.push(cause),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(StudioAutosaveDurabilityError);
    expect(failure).toHaveProperty("message", expect.stringContaining("메모리에 남아"));
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBeNull();
    expect(causes).toHaveLength(1);
  });

  it("uses SQLite without reporting or writing a synchronous browser slot", async () => {
    const key = "autosave-sqlite-fallback";
    const storage = memoryStorage();
    const sqlite = memorySqliteStore();
    const next = payload("2026-07-30T03:30:00.000Z", "sqlite");
    const setItem = vi.spyOn(storage, "setItem");

    const receipt = await persistStudioAutosaveWithOpfsPrimary({
      session: null,
      sqlite,
      storage,
      key,
      payload: next,
    });

    expect(receipt.authority).toBe("sqlite-fallback");
    expect(sqlite.values.get(key)).toMatchObject({
      state: "snapshot",
      payload: { pagesList: [{ elements: [{ id: "sqlite" }] }] },
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBeNull();
  });

  it("only reports durable degradation after OPFS and SQLite both fail", async () => {
    const key = "autosave-all-durable-fail";
    const storage = memoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const sqlite = memorySqliteStore();
    sqlite.failWrites = true;
    const causes: unknown[] = [];
    const journal = new FakeAutosaveJournal();
    journal.appendCheckpoint = async () => {
      throw new Error("opfs write failed");
    };

    const failure = await persistStudioAutosaveWithOpfsPrimary({
      session: session(journal, key),
      sqlite,
      storage,
      key,
      payload: payload("2026-07-30T03:40:00.000Z"),
      onDurableAuthorityDegraded: (cause) => causes.push(cause),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(StudioAutosaveDurabilityError);
    expect(setItem).not.toHaveBeenCalled();
    expect(storage.getItem(key)).toBeNull();
    expect(causes).toHaveLength(1);
    expect(causes[0]).toBeInstanceOf(AggregateError);
  });

  it("selects the exact OPFS snapshot without promoting a newer browser compatibility input", async () => {
    const key = "autosave-reconcile";
    const journal = new FakeAutosaveJournal();
    const target = session(journal, key);
    await target.write(payload("2026-07-30T03:00:00.000Z", "opfs"));
    const storage = memoryStorage({
      [key]: serializeStudioAutosave(payload("2026-07-30T02:00:00.000Z", "local-old")),
    });
    const setItem = vi.spyOn(storage, "setItem");

    const durableWins = await reconcileStudioAutosaveWithOpfsPrimary({
      session: target,
      storage,
      key,
    });
    expect(durableWins).toMatchObject({
      authority: "opfs-journal",
      durability: "durable",
      migratedToOpfs: false,
      candidate: {
        authority: "opfs-journal",
        sequence: 1,
        revision: 1,
        payload: { pagesList: [{ elements: [{ id: "opfs" }] }] },
      },
    });
    expect(setItem).not.toHaveBeenCalled();

    storage.setItem(
      studioLifecycleAutosaveSidecarKey(key),
      serializeStudioAutosave(payload("2026-07-30T04:00:00.000Z", "lifecycle-new")),
    );
    setItem.mockClear();
    const durableStillWins = await reconcileStudioAutosaveWithOpfsPrimary({
      session: target,
      storage,
      key,
    });
    expect(durableStillWins).toMatchObject({
      authority: "opfs-journal",
      durability: "durable",
      migratedToOpfs: false,
      candidate: {
        authority: "opfs-journal",
        sequence: 1,
        revision: 1,
        payload: { pagesList: [{ elements: [{ id: "opfs" }] }] },
      },
      compatibilityCandidate: {
        authority: "browser-storage-compatibility",
        key: studioLifecycleAutosaveSidecarKey(key),
        payload: { pagesList: [{ elements: [{ id: "lifecycle-new" }] }] },
      },
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(await target.readLatest()).toMatchObject({
      state: "snapshot",
      sequence: 1,
      revision: 1,
      payload: { pagesList: [{ elements: [{ id: "opfs" }] }] },
    });
  });

  it("honors a newer durable clear checkpoint over stale browser recovery", async () => {
    const key = "autosave-cleared";
    const journal = new FakeAutosaveJournal();
    const target = session(journal, key);
    await target.write(payload("2026-07-30T01:00:00.000Z"));
    await target.clear("2026-07-30T05:00:00.000Z");
    const storage = memoryStorage({
      [key]: serializeStudioAutosave(payload("2026-07-30T02:00:00.000Z")),
      [studioLifecycleAutosaveSidecarKey(key)]: serializeStudioAutosave(
        payload("2026-07-30T03:00:00.000Z"),
      ),
    });

    const result = await reconcileStudioAutosaveWithOpfsPrimary({
      session: target,
      storage,
      key,
    });

    expect(result).toEqual({
      candidate: null,
      compatibilityCandidate: null,
      authority: "opfs-journal",
      durability: "none",
      migratedToOpfs: false,
    });
    expect(storage.values.size).toBe(0);
  });

  it("selects the SQLite snapshot without promoting a newer browser compatibility input", async () => {
    const key = "autosave-sqlite-reconcile";
    const sqlite = memorySqliteStore();
    await sqlite.write(key, payload("2026-07-30T04:00:00.000Z", "sqlite"));
    const storage = memoryStorage({
      [key]: serializeStudioAutosave(payload("2026-07-30T03:00:00.000Z", "old")),
    });
    const setItem = vi.spyOn(storage, "setItem");

    const sqliteWins = await reconcileStudioAutosaveWithOpfsPrimary({
      session: null,
      sqlite,
      storage,
      key,
    });
    expect(sqliteWins).toMatchObject({
      authority: "sqlite-fallback",
      durability: "durable",
      candidate: {
        authority: "sqlite-fallback",
        sequence: null,
        revision: null,
        payload: { pagesList: [{ elements: [{ id: "sqlite" }] }] },
      },
    });
    expect(setItem).not.toHaveBeenCalled();

    storage.setItem(
      studioLifecycleAutosaveSidecarKey(key),
      serializeStudioAutosave(payload("2026-07-30T05:00:00.000Z", "sidecar")),
    );
    setItem.mockClear();
    const sqliteStillWins = await reconcileStudioAutosaveWithOpfsPrimary({
      session: null,
      sqlite,
      storage,
      key,
    });
    expect(sqliteStillWins).toMatchObject({
      authority: "sqlite-fallback",
      durability: "durable",
      candidate: {
        authority: "sqlite-fallback",
        payload: { pagesList: [{ elements: [{ id: "sqlite" }] }] },
      },
      compatibilityCandidate: {
        authority: "browser-storage-compatibility",
        key: studioLifecycleAutosaveSidecarKey(key),
        payload: { pagesList: [{ elements: [{ id: "sidecar" }] }] },
      },
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(sqlite.values.get(key)).toMatchObject({
      state: "snapshot",
      payload: { pagesList: [{ elements: [{ id: "sqlite" }] }] },
    });
  });

  it("honors a newer SQLite tombstone over stale browser recovery", async () => {
    const key = "autosave-sqlite-clear";
    const sqlite = memorySqliteStore();
    await sqlite.clear(key, "2026-07-30T06:00:00.000Z");
    const storage = memoryStorage({
      [key]: serializeStudioAutosave(payload("2026-07-30T05:00:00.000Z")),
    });

    const result = await reconcileStudioAutosaveWithOpfsPrimary({
      session: null,
      sqlite,
      storage,
      key,
    });

    expect(result).toEqual({
      candidate: null,
      compatibilityCandidate: null,
      authority: "sqlite-fallback",
      durability: "none",
      migratedToOpfs: false,
    });
    expect(storage.values.size).toBe(0);
  });

  it("exposes a browser-only recovery as backup-only compatibility, never durable state", async () => {
    const key = "autosave-compatibility-only";
    const storage = memoryStorage({
      [key]: serializeStudioAutosave(
        payload("2026-07-30T07:00:00.000Z", "compatibility-only"),
      ),
    });
    const setItem = vi.spyOn(storage, "setItem");

    const result = await reconcileStudioAutosaveWithOpfsPrimary({
      session: null,
      sqlite: null,
      storage,
      key,
      allowLegacy: false,
    });

    expect(result).toMatchObject({
      authority: "browser-storage-compatibility",
      durability: "compatibility-only",
      migratedToOpfs: false,
      candidate: {
        authority: "browser-storage-compatibility",
        sequence: null,
        revision: null,
        payload: { pagesList: [{ elements: [{ id: "compatibility-only" }] }] },
      },
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("never attempts a compatibility write when no durable authority exists", async () => {
    const setItem = vi.fn(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const blockedStorage: StudioAutosaveStorage = {
      getItem: () => null,
      setItem,
      removeItem: () => undefined,
    };

    const failure = await persistStudioAutosaveWithOpfsPrimary({
      session: null,
      sqlite: null,
      storage: blockedStorage,
      key: "autosave-no-authority",
      payload: payload("2026-07-30T08:00:00.000Z", "unsaved"),
    }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(StudioAutosaveDurabilityError);
    expect(setItem).not.toHaveBeenCalled();
  });
});
