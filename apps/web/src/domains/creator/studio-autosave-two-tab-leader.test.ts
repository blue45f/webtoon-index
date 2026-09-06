import { describe, expect, it } from "vitest";

import {
  createStudioAutosaveDocumentLeadershipRegistry,
  presentStudioAutosaveDocumentLeadership,
  requestStudioAutosaveDocumentLeadership,
  studioAutosaveDocumentLockName,
  studioAutosaveLeadershipAllowsLocalEdit,
  type StudioAutosaveDocumentLockManagerLike,
} from "./studio-autosave-document-leader";
import {
  StudioAutosaveDocumentBusyError,
  StudioAutosaveDurabilityError,
  StudioAutosaveOpfsSession,
  openStudioAutosaveDocumentSession,
  persistStudioAutosaveWithOpfsPrimary,
  reconcileStudioAutosaveWithOpfsPrimary,
  studioAutosaveDocumentBusy,
  withStudioAutosaveDocumentLeadership,
  type StudioAutosaveOpfsJournalPort,
} from "./studio-autosave-opfs-session";
import {
  StudioOpfsRecoveryJournalError,
  type StudioOpfsRecoveryEntry,
  type StudioOpfsRecoveryScan,
  type StudioOpfsRecoveryWriterLease,
} from "./studio-opfs-recovery-journal";

import type {
  StudioAutosavePayload,
  StudioAutosaveStorage,
} from "./studio-autosave";
import type {
  StudioAutosaveSqlitePort,
  StudioAutosaveSqliteReadResult,
} from "./studio-autosave-sqlite-store";

const AUTOSAVE_KEY = "toonspectrum-studio-autosave:v12:guest:new";
const DOCUMENT_ID = "autosave-two-tab-document";
const ENGINE_VERSION = "studio-autosave-v2";

function payload(savedAt: string, strokeIds: readonly string[]): StudioAutosavePayload {
  return {
    version: 2,
    savedAt,
    pagesList: [{
      id: "page-1",
      elements: strokeIds.map((id) => ({ id, type: "draw" })),
      canvasH: 2_000,
    }],
    currentPageId: "page-1",
  };
}

function memoryStorage(): StudioAutosaveStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
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
} {
  const values = new Map<string, StudioAutosaveSqliteReadResult>();
  return {
    values,
    async read(key) {
      return values.get(key) ?? null;
    },
    async write(key, next) {
      values.set(key, Object.freeze({ state: "snapshot", savedAt: next.savedAt, payload: next }));
    },
    async clear(key, savedAt = new Date().toISOString()) {
      values.set(key, Object.freeze({ state: "cleared", savedAt }));
    },
  };
}

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (cause: unknown) => void;
}

/** Minimal Web Locks stand-in with real exclusive, `ifAvailable`, queue and abort semantics. */
class FakeLockManager implements StudioAutosaveDocumentLockManagerLike {
  readonly held = new Set<string>();
  readonly queues = new Map<string, Waiter[]>();

  async request<T>(
    name: string,
    options: {
      readonly mode: "exclusive";
      readonly ifAvailable?: boolean;
      readonly signal?: AbortSignal;
    },
    callback: (lock: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    if (this.held.has(name)) {
      if (options.ifAvailable) return await callback(null);
      await this.#enqueue(name, options.signal);
    } else {
      this.held.add(name);
    }
    try {
      return await callback({ name, mode: options.mode });
    } finally {
      this.#handoff(name);
    }
  }

  #enqueue(name: string, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const queue = this.queues.get(name) ?? [];
      const waiter: Waiter = { resolve, reject };
      queue.push(waiter);
      this.queues.set(name, queue);
      signal?.addEventListener("abort", () => {
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        reject(new Error("AbortError"));
      }, { once: true });
    });
  }

  #handoff(name: string): void {
    const next = this.queues.get(name)?.shift();
    // Ownership transfers directly to the waiter, so `held` intentionally stays set.
    if (next) next.resolve();
    else this.held.delete(name);
  }
}

/** One OPFS document shared by every simulated tab, including its cross-tab writer lease. */
class SharedJournalStore {
  entries: StudioOpfsRecoveryEntry[] = [];
  readonly payloads = new Map<string, Uint8Array>();
  lease: { ownerId: string; epoch: number } | null = null;
  epoch = 0;
  now = 1_000;
}

class TabJournal implements StudioAutosaveOpfsJournalPort {
  constructor(private readonly store: SharedJournalStore) {}

  async scan(): Promise<StudioOpfsRecoveryScan> {
    return Object.freeze({
      generation: this.store.entries.length,
      writerEpoch: this.store.epoch,
      lastSequence: this.store.entries.at(-1)?.sequence ?? 0,
      totalPayloadBytes: this.store.entries.reduce((sum, entry) => sum + entry.byteLength, 0),
      entries: Object.freeze([...this.store.entries]),
      selectedSlot: this.store.entries.length > 0 ? "a" : null,
      ignoredSlots: Object.freeze([]),
    });
  }

  async *readPayload(entry: StudioOpfsRecoveryEntry): AsyncIterable<Uint8Array> {
    const bytes = this.store.payloads.get(entry.descriptorPath);
    if (!bytes) throw new Error("missing payload");
    yield bytes;
  }

  async acquireWriter(
    input: { readonly ownerId: string },
  ): Promise<StudioOpfsRecoveryWriterLease> {
    if (this.store.lease && this.store.lease.ownerId !== input.ownerId) {
      throw new StudioOpfsRecoveryJournalError(
        "LEASE_BUSY",
        "이 작품의 복구 저장소를 다른 탭이나 창이 사용하고 있어요.",
      );
    }
    this.store.epoch += 1;
    this.store.lease = { ownerId: input.ownerId, epoch: this.store.epoch };
    return Object.freeze({
      documentId: DOCUMENT_ID,
      ownerId: input.ownerId,
      token: `token-${this.store.epoch}`,
      epoch: this.store.epoch,
      acquiredAt: this.store.now,
      expiresAt: this.store.now + 30_000,
    });
  }

  async renewWriter(
    writer: StudioOpfsRecoveryWriterLease,
  ): Promise<StudioOpfsRecoveryWriterLease> {
    return Object.freeze({ ...writer, expiresAt: this.store.now + 30_000 });
  }

  async releaseWriter(writer: StudioOpfsRecoveryWriterLease): Promise<void> {
    if (this.store.lease?.ownerId === writer.ownerId) this.store.lease = null;
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
    const sequence = (this.store.entries.at(-1)?.sequence ?? 0) + 1;
    const descriptorPath = `entry-${sequence}`;
    this.store.entries = this.store.entries.filter(
      (entry) =>
        entry.pageId !== input.pageId || entry.sequence > input.compactThroughSequence,
    );
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
    this.store.payloads.set(descriptorPath, Uint8Array.from(input.payload));
    this.store.entries.push(entry);
    return entry;
  }

  async evictObsolete(): Promise<unknown> {
    return Object.freeze({ removedPaths: Object.freeze([]), freedBytes: 0 });
  }
}

function tabSession(store: SharedJournalStore, ownerId: string): StudioAutosaveOpfsSession {
  return new StudioAutosaveOpfsSession({
    autosaveKey: AUTOSAVE_KEY,
    journal: new TabJournal(store),
    ownerId,
    now: () => store.now,
  });
}

function strokeIdsOf(payloadValue: StudioAutosavePayload | null | undefined): readonly string[] {
  const elements = payloadValue?.pagesList[0]?.elements;
  return Array.isArray(elements)
    ? elements.map((element) => (element as { id?: string }).id ?? "")
    : [];
}

describe("studioAutosaveDocumentLockName", () => {
  it("derives a stable, digest-scoped name that never leaks the manuscript identity", () => {
    const name = studioAutosaveDocumentLockName(AUTOSAVE_KEY);
    expect(name).toBe(studioAutosaveDocumentLockName(AUTOSAVE_KEY));
    expect(name.startsWith("toonspectrum-studio-autosave-document:")).toBe(true);
    expect(name).not.toContain("guest");
    expect(name).not.toBe(
      studioAutosaveDocumentLockName("toonspectrum-studio-autosave:v12:guest:work:1"),
    );
  });
});

describe("requestStudioAutosaveDocumentLeadership", () => {
  it("gives the first tab leadership and demotes the second tab to follower", async () => {
    const locks = new FakeLockManager();
    const first = await requestStudioAutosaveDocumentLeadership({
      autosaveKey: AUTOSAVE_KEY,
      locks,
      registry: createStudioAutosaveDocumentLeadershipRegistry(),
    });
    const second = await requestStudioAutosaveDocumentLeadership({
      autosaveKey: AUTOSAVE_KEY,
      locks,
      registry: createStudioAutosaveDocumentLeadershipRegistry(),
    });

    expect(first.role).toBe("leader");
    expect(first.basis).toBe("web-lock");
    expect(second.role).toBe("follower");
    // The late tab must not preempt a live leader that may hold unsaved strokes.
    expect(await second.waitForLeadership({ timeoutMs: 0 })).toBe(false);
  });

  it("does not demote a tab that opens the same document twice before the first lock settles", async () => {
    const locks = new FakeLockManager();
    const registry = createStudioAutosaveDocumentLeadershipRegistry();
    const [first, second] = await Promise.all([
      requestStudioAutosaveDocumentLeadership({
        autosaveKey: AUTOSAVE_KEY,
        locks,
        registry,
      }),
      requestStudioAutosaveDocumentLeadership({
        autosaveKey: AUTOSAVE_KEY,
        locks,
        registry,
      }),
    ]);

    expect(first.role).toBe("leader");
    expect(second.role).toBe("leader");
    await first.release();
    expect(second.role).toBe("leader");
    expect(locks.held.has(studioAutosaveDocumentLockName(AUTOSAVE_KEY))).toBe(true);
    await second.release();
  });

  it("keeps one tab leading itself when the same document is opened twice in that tab", async () => {
    const locks = new FakeLockManager();
    const registry = createStudioAutosaveDocumentLeadershipRegistry();
    const first = await requestStudioAutosaveDocumentLeadership({
      autosaveKey: AUTOSAVE_KEY,
      locks,
      registry,
    });
    const reentrant = await requestStudioAutosaveDocumentLeadership({
      autosaveKey: AUTOSAVE_KEY,
      locks,
      registry,
    });

    expect(first.role).toBe("leader");
    expect(reentrant.role).toBe("leader");

    // Releasing one of the two overlapping opens must not drop the tab's leadership.
    await first.release();
    expect(reentrant.role).toBe("leader");
    expect(locks.held.has(studioAutosaveDocumentLockName(AUTOSAVE_KEY))).toBe(true);
  });

  it("hands leadership to the waiting tab once the leading tab goes away", async () => {
    const locks = new FakeLockManager();
    const leader = await requestStudioAutosaveDocumentLeadership({
      autosaveKey: AUTOSAVE_KEY,
      locks,
      registry: createStudioAutosaveDocumentLeadershipRegistry(),
    });
    const follower = await requestStudioAutosaveDocumentLeadership({
      autosaveKey: AUTOSAVE_KEY,
      locks,
      registry: createStudioAutosaveDocumentLeadershipRegistry(),
    });
    expect(follower.role).toBe("follower");

    await leader.release();

    expect(await follower.waitForLeadership({ timeoutMs: 1_000 })).toBe(true);
    expect(follower.role).toBe("leader");
    expect(follower.basis).toBe("promoted-after-handover");
  });

  it("reports leadership when the Web Locks API is unavailable instead of blocking the tab", async () => {
    const lease = await requestStudioAutosaveDocumentLeadership({
      autosaveKey: AUTOSAVE_KEY,
      locks: null,
      registry: createStudioAutosaveDocumentLeadershipRegistry(),
    });
    expect(lease.role).toBe("leader");
    expect(lease.basis).toBe("locks-unavailable");
  });
});

describe("openStudioAutosaveDocumentSession", () => {
  it("assigns leader then follower roles across two opens of the same document key", async () => {
    const locks = new FakeLockManager();
    const registryOne = createStudioAutosaveDocumentLeadershipRegistry();
    const registryTwo = createStudioAutosaveDocumentLeadershipRegistry();
    const scope = { navigator: { locks } } as never;

    const tabOne = await openStudioAutosaveDocumentSession(AUTOSAVE_KEY, scope, {
      registry: registryOne,
    });
    const tabTwo = await openStudioAutosaveDocumentSession(AUTOSAVE_KEY, scope, {
      registry: registryTwo,
    });

    expect(tabOne.role).toBe("leader");
    expect(tabTwo.role).toBe("follower");

    await tabOne.lease.release();
    expect(await tabTwo.lease.waitForLeadership({ timeoutMs: 1_000 })).toBe(true);
    await tabTwo.lease.release();
  });

  it("promotes a follower tab to writable OPFS and can write after leadership hand-off", async () => {
    const locks = new FakeLockManager();
    const registryOne = createStudioAutosaveDocumentLeadershipRegistry();
    const registryTwo = createStudioAutosaveDocumentLeadershipRegistry();
    const store = new SharedJournalStore();
    const storage = memoryStorage();

    const leaderLease = await requestStudioAutosaveDocumentLeadership({
      autosaveKey: AUTOSAVE_KEY,
      locks,
      registry: registryOne,
    });
    const followerLease = await requestStudioAutosaveDocumentLeadership({
      autosaveKey: AUTOSAVE_KEY,
      locks,
      registry: registryTwo,
    });
    expect(leaderLease.role).toBe("leader");
    expect(followerLease.role).toBe("follower");

    const leaderSession = tabSession(store, "autosave-tab-1");
    const followerSession = tabSession(store, "autosave-tab-2");

    await persistStudioAutosaveWithOpfsPrimary({
      session: leaderSession,
      sqlite: null,
      storage,
      key: AUTOSAVE_KEY,
      payload: payload("2026-08-13T00:00:00.000Z", ["leader-stroke"]),
    });

    await expect(persistStudioAutosaveWithOpfsPrimary({
      session: followerSession,
      sqlite: null,
      storage,
      key: AUTOSAVE_KEY,
      payload: payload("2026-08-13T00:01:00.000Z", ["follower-stroke"]),
    })).rejects.toBeInstanceOf(StudioAutosaveDocumentBusyError);

    await leaderLease.release();
    await leaderSession.dispose();
    expect(await followerLease.waitForLeadership({ timeoutMs: 1_000 })).toBe(true);

    const promotedSession = tabSession(store, "autosave-tab-2");
    const receipt = await persistStudioAutosaveWithOpfsPrimary({
      session: promotedSession,
      sqlite: null,
      storage,
      key: AUTOSAVE_KEY,
      payload: payload("2026-08-13T00:02:00.000Z", ["promoted-stroke"]),
    });
    expect(receipt.authority).toBe("opfs-journal");
    const reconciled = await reconcileStudioAutosaveWithOpfsPrimary({
      session: promotedSession,
      sqlite: null,
      storage,
      key: AUTOSAVE_KEY,
      allowLegacy: true,
    });
    expect(strokeIdsOf(reconciled.candidate?.payload)).toEqual(["promoted-stroke"]);

    await followerLease.release();
    await followerSession.dispose();
    await promotedSession.dispose();
  });
});

describe("presentStudioAutosaveDocumentLeadership", () => {
  it("tells the follower explicitly instead of demoting it silently", () => {
    const notice = presentStudioAutosaveDocumentLeadership({
      role: "follower",
      basis: "web-lock",
    });
    expect(notice.canPersist).toBe(false);
    expect(notice.canDraw).toBe(true);
    expect(notice.tone).toBe("warn");
    expect(notice.title).toContain("다른 탭에서 편집 중");
    expect(notice.actionLabel).toContain("새로고침");
    expect(studioAutosaveLeadershipAllowsLocalEdit({
      role: "follower",
      basis: "web-lock",
    })).toBe(true);
  });

  it("tells a Magma jam follower they can keep drawing", () => {
    const notice = presentStudioAutosaveDocumentLeadership(
      { role: "follower", basis: "web-lock" },
      { liveJam: true },
    );
    expect(notice.canPersist).toBe(false);
    expect(notice.canDraw).toBe(true);
    expect(notice.tone).toBe("good");
    expect(notice.title).toContain("같이 그리는 중");
    expect(notice.detail).toContain("이 탭에서도 바로 그릴 수 있습니다");
    expect(notice.actionLabel).toBeNull();
  });

  it("only lets a leading tab claim it is the one saving", () => {
    const notice = presentStudioAutosaveDocumentLeadership({ role: "leader", basis: "web-lock" });
    expect(notice.canPersist).toBe(true);
    expect(notice.actionLabel).toBeNull();
  });
});

describe("two-tab autosave persistence", () => {
  it("refuses to fork the document into the second authority when another tab owns it", async () => {
    const store = new SharedJournalStore();
    const storage = memoryStorage();
    const sqlite = memorySqliteStore();
    const leader = tabSession(store, "autosave-tab-1");
    const follower = tabSession(store, "autosave-tab-2");

    await persistStudioAutosaveWithOpfsPrimary({
      session: leader,
      sqlite,
      storage,
      key: AUTOSAVE_KEY,
      payload: payload("2026-08-13T00:00:00.000Z", ["stroke-a", "stroke-b", "stroke-c"]),
    });
    const leaderMirror = sqlite.values.get(AUTOSAVE_KEY);

    const degraded: unknown[] = [];
    await expect(persistStudioAutosaveWithOpfsPrimary({
      session: follower,
      sqlite,
      storage,
      key: AUTOSAVE_KEY,
      payload: payload("2026-08-13T00:00:04.000Z", ["stroke-z"]),
      onDurableAuthorityDegraded: (cause) => degraded.push(cause),
    })).rejects.toBeInstanceOf(StudioAutosaveDocumentBusyError);

    // The follower must not have reached any authority: no SQLite row change, no browser slot.
    expect(sqlite.values.get(AUTOSAVE_KEY)).toBe(leaderMirror);
    expect(storage.values.size).toBe(0);
    expect(degraded).toHaveLength(0);
  });

  it("keeps the leading tab's strokes as the durable document after a follower write attempt",
    async () => {
      const store = new SharedJournalStore();
      const storage = memoryStorage();
      const sqlite = memorySqliteStore();
      const leader = tabSession(store, "autosave-tab-1");
      const follower = tabSession(store, "autosave-tab-2");

      await persistStudioAutosaveWithOpfsPrimary({
        session: leader,
        sqlite,
        storage,
        key: AUTOSAVE_KEY,
        payload: payload("2026-08-13T00:00:00.000Z", ["stroke-a", "stroke-b", "stroke-c"]),
      });
      await persistStudioAutosaveWithOpfsPrimary({
        session: follower,
        sqlite,
        storage,
        key: AUTOSAVE_KEY,
        payload: payload("2026-08-13T00:00:04.000Z", ["stroke-z"]),
      }).catch(() => undefined);

      for (const view of [leader, follower]) {
        const reconciliation = await reconcileStudioAutosaveWithOpfsPrimary({
          session: view,
          sqlite,
          storage,
          key: AUTOSAVE_KEY,
        });
        expect(reconciliation.authority).toBe("opfs-journal");
        expect(strokeIdsOf(reconciliation.candidate?.payload)).toEqual([
          "stroke-a",
          "stroke-b",
          "stroke-c",
        ]);
      }
    });

  it("lets the follower read the shared document so recovery never shows an empty manuscript",
    async () => {
      const store = new SharedJournalStore();
      const leader = tabSession(store, "autosave-tab-1");
      const follower = tabSession(store, "autosave-tab-2");

      await leader.write(payload("2026-08-13T00:00:00.000Z", ["stroke-a", "stroke-b", "stroke-c"]));
      const seen = await follower.readLatest();

      expect(seen?.state).toBe("snapshot");
      expect(strokeIdsOf(seen?.state === "snapshot" ? seen.payload : null)).toEqual([
        "stroke-a",
        "stroke-b",
        "stroke-c",
      ]);
    });

  it("lets the next tab take over once the leading tab releases its writer", async () => {
    const store = new SharedJournalStore();
    const storage = memoryStorage();
    const sqlite = memorySqliteStore();
    const leader = tabSession(store, "autosave-tab-1");
    const successor = tabSession(store, "autosave-tab-2");

    await persistStudioAutosaveWithOpfsPrimary({
      session: leader,
      sqlite,
      storage,
      key: AUTOSAVE_KEY,
      payload: payload("2026-08-13T00:00:00.000Z", ["stroke-a", "stroke-b", "stroke-c"]),
    });
    await leader.dispose();

    const receipt = await persistStudioAutosaveWithOpfsPrimary({
      session: successor,
      sqlite,
      storage,
      key: AUTOSAVE_KEY,
      payload: payload("2026-08-13T00:00:08.000Z", ["stroke-a", "stroke-b", "stroke-c", "stroke-z"]),
    });
    expect(receipt.authority).toBe("opfs-journal");

    const reconciliation = await reconcileStudioAutosaveWithOpfsPrimary({
      session: successor,
      sqlite,
      storage,
      key: AUTOSAVE_KEY,
    });
    expect(strokeIdsOf(reconciliation.candidate?.payload)).toHaveLength(4);
  });

  it("still degrades to the SQLite authority when OPFS fails for a non-ownership reason",
    async () => {
      const store = new SharedJournalStore();
      const storage = memoryStorage();
      const sqlite = memorySqliteStore();
      const journal = new TabJournal(store);
      journal.acquireWriter = async () => {
        throw new StudioOpfsRecoveryJournalError("QUOTA_EXCEEDED", "저장 공간이 부족합니다.");
      };
      const brokenSession = new StudioAutosaveOpfsSession({
        autosaveKey: AUTOSAVE_KEY,
        journal,
        ownerId: "autosave-tab-1",
        now: () => store.now,
      });

      const receipt = await persistStudioAutosaveWithOpfsPrimary({
        session: brokenSession,
        sqlite,
        storage,
        key: AUTOSAVE_KEY,
        payload: payload("2026-08-13T00:00:00.000Z", ["stroke-a"]),
      });
      expect(receipt.authority).toBe("sqlite-fallback");
    });

  it("still raises the generic durability error when both authorities fail", async () => {
    const store = new SharedJournalStore();
    const journal = new TabJournal(store);
    journal.acquireWriter = async () => {
      throw new StudioOpfsRecoveryJournalError("STORAGE_FAILED", "저장에 실패했습니다.");
    };
    const brokenSession = new StudioAutosaveOpfsSession({
      autosaveKey: AUTOSAVE_KEY,
      journal,
      ownerId: "autosave-tab-1",
      now: () => store.now,
    });

    await expect(persistStudioAutosaveWithOpfsPrimary({
      session: brokenSession,
      sqlite: null,
      storage: memoryStorage(),
      key: AUTOSAVE_KEY,
      payload: payload("2026-08-13T00:00:00.000Z", ["stroke-a"]),
    })).rejects.toBeInstanceOf(StudioAutosaveDurabilityError);
  });
});

describe("withStudioAutosaveDocumentLeadership", () => {
  it("withholds the second authority from a follower so side-door writes cannot fork", async () => {
    const sqlite = memorySqliteStore();
    expect(withStudioAutosaveDocumentLeadership(sqlite, { role: "follower" })).toBeNull();
    expect(withStudioAutosaveDocumentLeadership(sqlite, { role: "leader" })).toBe(sqlite);
    // An unknown lease keeps today's behaviour rather than silently disabling durability.
    expect(withStudioAutosaveDocumentLeadership(sqlite, null)).toBe(sqlite);
  });

  it("keeps a guarded follower's emergency write out of the shared row", async () => {
    const store = new SharedJournalStore();
    const storage = memoryStorage();
    const sqlite = memorySqliteStore();
    const leader = tabSession(store, "autosave-tab-1");

    await persistStudioAutosaveWithOpfsPrimary({
      session: leader,
      sqlite,
      storage,
      key: AUTOSAVE_KEY,
      payload: payload("2026-08-13T00:00:00.000Z", ["stroke-a", "stroke-b", "stroke-c"]),
    });

    // The pagehide path races both authorities directly. With the guard the follower has none.
    const followerSqlite = withStudioAutosaveDocumentLeadership(sqlite, { role: "follower" });
    expect(followerSqlite).toBeNull();
    expect(strokeIdsOf(
      (sqlite.values.get(AUTOSAVE_KEY) as { payload?: StudioAutosavePayload } | null)?.payload,
    )).toEqual(["stroke-a", "stroke-b", "stroke-c"]);
  });
});

describe("studioAutosaveDocumentBusy", () => {
  it("recognises the journal lease conflict through wrapping causes", () => {
    const busy = new StudioOpfsRecoveryJournalError("LEASE_BUSY", "다른 탭이 사용 중입니다.");
    expect(studioAutosaveDocumentBusy(busy)).toBe(true);
    expect(studioAutosaveDocumentBusy(new StudioAutosaveDocumentBusyError(busy))).toBe(true);
    expect(studioAutosaveDocumentBusy(new Error("nope"))).toBe(false);
    expect(studioAutosaveDocumentBusy(null)).toBe(false);
  });

  it("treats Promise.any rejection as busy when every authority lost to another tab", () => {
    const rejected = new AggregateError(
      [
        new StudioOpfsRecoveryJournalError(
          "LEASE_LOST",
          "OPFS 복구 저널 writer lease가 만료되었거나 교체되었습니다.",
        ),
        new Error("SQLite autosave authority is unavailable"),
      ],
      "All promises were rejected",
    );
    expect(studioAutosaveDocumentBusy(rejected)).toBe(true);
    expect(
      studioAutosaveDocumentBusy(
        new AggregateError(
          [new Error("SQLITE_CORRUPT: database disk image is malformed")],
          "All promises were rejected",
        ),
      ),
    ).toBe(false);
  });
});
