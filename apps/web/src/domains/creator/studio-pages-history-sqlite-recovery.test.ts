import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import { createDefaultStudioPagesHistoryDurableRuntime } from "./studio-pages-history-durable-runtime";
import { createStudioPagesHistorySqliteRecovery } from "./studio-pages-history-sqlite-recovery";

import type {
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "./studio-local-database";
import type { StudioHistoryJournalNavigationTarget } from "./studio-pages-history-command-journal";

const IDENTITY = Object.freeze({
  documentId: "history-sqlite-test",
  documentVersion: 1,
  engineVersion: "studio-pages-history-command-journal-1",
});
const opened: StudioLocalDatabase[] = [];
let sqlite3: StudioSqliteApiHandle;

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of opened) await database.close();
});

async function openMemoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  opened.push(database);
  return database;
}

function target(elementCount: number): StudioHistoryJournalNavigationTarget {
  return {
    historyIndex: elementCount,
    pages: [{
      id: "page-sqlite",
      elements: Array.from({ length: elementCount }, (_, index) => ({ id: `element-${index}` })),
      canvasH: 2_000,
    }],
  };
}

function transition(previousCount: number, nextCount: number) {
  return {
    mutationKind: "elements.commit",
    previousPages: target(previousCount).pages,
    nextPages: target(nextCount).pages,
    previousHistoryIndex: previousCount,
    nextHistoryIndex: nextCount,
  };
}

describe("Studio pages history SQLite recovery", () => {
  it("stores a CRC-valid contiguous frontier and compacts through alternating A/B snapshots", async () => {
    const database = await openMemoryDatabase();
    const first = createStudioPagesHistorySqliteRecovery({ database, identity: IDENTITY });
    await first.acquireWriter({ ownerId: "writer-a" });
    await first.appendCommand({
      id: "operation-1",
      pageId: "page-sqlite",
      revision: 1,
      payload: new Uint8Array([1, 2, 3]),
    });
    await first.compact({
      id: "checkpoint-2",
      pageId: "page-sqlite",
      revision: 2,
      payload: new Uint8Array([4, 5, 6, 7]),
      compactThroughSequence: 1,
    });
    await first.appendCommand({
      id: "operation-3",
      pageId: "page-sqlite",
      revision: 3,
      payload: new Uint8Array([8, 9]),
    });

    const reopened = createStudioPagesHistorySqliteRecovery({ database, identity: IDENTITY });
    const scan = await reopened.scanLatest();
    expect(scan).toMatchObject({
      lastSequence: 3,
      selectedSlot: "a",
      ignoredSlots: [],
      totalPayloadBytes: 6,
    });
    expect(scan.entries.map(({ kind, sequence }) => ({ kind, sequence }))).toEqual([
      { kind: "checkpoint", sequence: 2 },
      { kind: "operation", sequence: 3 },
    ]);
    expect(await reopened.readLatestPayload()).toEqual(new Uint8Array([8, 9]));
  });

  it("cuts recovery at a torn SQL row instead of exposing a later frontier", async () => {
    const database = await openMemoryDatabase();
    const recovery = createStudioPagesHistorySqliteRecovery({ database, identity: IDENTITY });
    await recovery.acquireWriter({ ownerId: "writer-a" });
    await recovery.appendCommand({
      id: "operation-1",
      pageId: "page-sqlite",
      revision: 1,
      payload: new Uint8Array([11]),
    });
    await database.appendJournalEntry(`history:${IDENTITY.documentId}`, {
      seq: 2,
      payload: "{\"format\":\"torn",
      crc32: 0,
    });

    const reopened = createStudioPagesHistorySqliteRecovery({ database, identity: IDENTITY });
    const scan = await reopened.scanLatest();
    expect(scan.lastSequence).toBe(1);
    expect(scan.entries).toHaveLength(1);
    expect(await reopened.readLatestPayload()).toEqual(new Uint8Array([11]));
  });

  it("is the product default and restores the verified undo frontier on reopen", async () => {
    const database = await openMemoryDatabase();
    const first = await createDefaultStudioPagesHistoryDurableRuntime({
      initialTarget: target(0),
      openDatabase: () => Promise.resolve(database),
    });
    expect(first.persistenceKind).toBe("sqlite-opfs");
    first.recordTransition(transition(0, 1));
    await first.flush();
    await first.close();

    const reopened = await createDefaultStudioPagesHistoryDurableRuntime({
      initialTarget: target(1),
      openDatabase: () => Promise.resolve(database),
    });
    expect(reopened.persistenceKind).toBe("sqlite-opfs");
    expect(reopened.recordUndo(target(0))).toBe("recorded");
    await reopened.flush();
    await reopened.close();
  });

  it("rebases rather than applying a durable frontier to a different autosave generation", async () => {
    const database = await openMemoryDatabase();
    const first = await createDefaultStudioPagesHistoryDurableRuntime({
      initialTarget: target(0),
      openDatabase: () => Promise.resolve(database),
    });
    first.recordTransition(transition(0, 1));
    await first.flush();
    await first.close();

    const mismatched = await createDefaultStudioPagesHistoryDurableRuntime({
      initialTarget: target(3),
      openDatabase: () => Promise.resolve(database),
    });
    expect(mismatched.recordUndo(target(2))).toBe("rebased");
    await mismatched.close();
  });

  it("fences a second writer until the persisted lease is released", async () => {
    const database = await openMemoryDatabase();
    let now = 10_000;
    const first = createStudioPagesHistorySqliteRecovery({
      database,
      identity: IDENTITY,
      now: () => now,
    });
    const second = createStudioPagesHistorySqliteRecovery({
      database,
      identity: IDENTITY,
      now: () => now,
    });
    await first.acquireWriter({ ownerId: "writer-a" });
    await expect(second.acquireWriter({ ownerId: "writer-b" })).rejects.toThrow(/lease is busy/);
    await first.abort();
    now += 1;
    await expect(second.acquireWriter({ ownerId: "writer-b" })).resolves.toMatchObject({
      ownerId: "writer-b",
      epoch: 2,
    });
    await second.abort();
  });

  it("renews its own uncontested lease during a long editing session", async () => {
    const database = await openMemoryDatabase();
    let now = 20_000;
    const recovery = createStudioPagesHistorySqliteRecovery({
      database,
      identity: IDENTITY,
      now: () => now,
    });
    await recovery.acquireWriter({ ownerId: "long-session" });
    now += 31_000;
    await expect(recovery.appendCommand({
      id: "after-idle",
      pageId: "page-sqlite",
      revision: 1,
      payload: new Uint8Array([42]),
    })).resolves.toMatchObject({ sequence: 1 });
    await recovery.abort();
  });
});
