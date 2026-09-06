import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  openStudioLocalDatabase,
  requireStudioCrdtOutboxDatabase,
} from "../studio-local-database";

import {
  STUDIO_CRDT_OUTBOX_MAX_ENTRIES_PER_WORK,
  SqliteStudioCrdtOutbox,
  StudioCrdtOutboxCapacityError,
  StudioCrdtOutboxCorruptionError,
  StudioCrdtOutboxReadUnavailableError,
  createStudioCrdtOutbox,
} from "./studio-crdt-outbox";
import {
  STUDIO_CRDT_PROTOCOL_VERSION,
  encodeStudioCrdtUpdate,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";

import type {
  StudioCrdtOutboxDatabase,
  StudioLocalDatabase,
  StudioSqliteApiHandle,
  StudioSqliteDatabaseHandle,
} from "../studio-local-database";

let sqlite3: StudioSqliteApiHandle;
const opened: StudioLocalDatabase[] = [];

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of opened) await database.close();
});

async function openDatabase(options: {
  filename?: string;
  now?: () => number;
  tracked?: boolean;
} = {}): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
    ...(options.filename ? { memoryFilename: options.filename } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  if (options.tracked !== false) opened.push(database);
  return database;
}

function request(
  workId: string,
  updateId: string,
  clientSequence: number,
): StudioCrdtUpdateRequest {
  return {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    workId,
    updateId,
    clientSequence,
    update: encodeStudioCrdtUpdate(new Uint8Array([0, clientSequence & 0xff])),
  };
}

function uuid(index: number): string {
  return `12345678-1234-4234-8234-${String(index).padStart(12, "0")}`;
}

function rawHandle(filename: string): StudioSqliteDatabaseHandle {
  return new sqlite3.oo1.DB(filename, "c");
}

function rawValue(handle: StudioSqliteDatabaseHandle, sql: string): unknown {
  const statement = handle.prepare(sql);
  try {
    return statement.step() ? statement.get(0) : undefined;
  } finally {
    statement.finalize();
  }
}

describe("V12 SQLite/OPFS CRDT outbox product authority", () => {
  it("uses the shared SQLite path without touching the legacy IndexedDB boot seam", async () => {
    const database = await openDatabase();
    const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    const indexedDbRead = vi.fn(() => {
      throw new Error("legacy IndexedDB must not be read");
    });
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get: indexedDbRead,
    });
    try {
      const outbox = createStudioCrdtOutbox({
        acquireDatabase: () => Promise.resolve(database),
      });
      const pending = request("sqlite-product-work", uuid(1), 1);
      await outbox.put("sqlite-product-user", pending);
      await expect(outbox.list("sqlite-product-user", pending.workId)).resolves.toEqual([
        pending,
      ]);
      expect(indexedDbRead).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(globalThis, "indexedDB", original);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    }
  });

  it("lists deterministically by sequence, creation time, and update id", async () => {
    let now = 10;
    const database = await openDatabase({ now: () => ++now });
    const outbox = new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(database),
      now: () => ++now,
    });
    const scope = "ordering-user";
    const workId = "ordering-work";
    const requests = [
      request(workId, uuid(30), 3),
      request(workId, uuid(20), 2),
      request(workId, uuid(10), 1),
    ];
    await Promise.all(requests.map((pending) => outbox.put(scope, pending)));
    expect((await outbox.list(scope, workId)).map(({ clientSequence }) => clientSequence)).toEqual([
      1, 2, 3,
    ]);
  });

  it("applies explicit count backpressure without evicting an existing or incoming message", async () => {
    const database = await openDatabase();
    const outbox = new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(database),
      limits: { maxEntries: 2 },
    });
    const scope = "bounded-user";
    const workId = "bounded-work";
    const first = request(workId, uuid(101), 1);
    const second = request(workId, uuid(102), 2);
    const third = request(workId, uuid(103), 3);
    await outbox.put(scope, first);
    await outbox.put(scope, second);
    await expect(outbox.put(scope, third)).rejects.toBeInstanceOf(
      StudioCrdtOutboxCapacityError,
    );

    const sql = requireStudioCrdtOutboxDatabase(database);
    expect((await sql.listCrdtOutboxCandidates(scope, workId)).map(({ updateId }) => updateId))
      .toEqual([first.updateId, second.updateId]);
    expect(outbox.listEmergency(scope, workId)).toEqual([first, second, third]);
    expect(STUDIO_CRDT_OUTBOX_MAX_ENTRIES_PER_WORK).toBeGreaterThan(8_193);
  });

  it("applies the byte budget independently of the entry budget", async () => {
    const database = await openDatabase();
    const scope = "byte-bound-user";
    const workId = "byte-bound-work";
    const first = request(workId, uuid(151), 1);
    const second = request(workId, uuid(152), 2);
    const firstBytes = new TextEncoder().encode(JSON.stringify(first)).byteLength;
    const outbox = new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(database),
      limits: { maxBytes: firstBytes },
    });
    await outbox.put(scope, first);
    await expect(outbox.put(scope, second)).rejects.toBeInstanceOf(
      StudioCrdtOutboxCapacityError,
    );
    expect(
      await requireStudioCrdtOutboxDatabase(database).listCrdtOutboxCandidates(
        scope,
        workId,
      ),
    ).toHaveLength(1);
    expect(outbox.listEmergency(scope, workId)).toEqual([first, second]);
  });

  it("fails closed when the durable namespace cannot be enumerated", async () => {
    const failure = new Error("forced OPFS read failure");
    const outbox = createStudioCrdtOutbox({
      acquireDatabase: () => Promise.reject(failure),
    });
    const scope = "unreadable-user";
    const pending = request("unreadable-work", uuid(175), 1);
    await expect(outbox.put(scope, pending)).rejects.toBe(failure);
    expect(outbox.listEmergency?.(scope, pending.workId)).toEqual([pending]);
    await expect(outbox.list(scope, pending.workId)).rejects.toBeInstanceOf(
      StudioCrdtOutboxReadUnavailableError,
    );
  });

  it("ACKs and removes pending data atomically and prevents later resurrection", async () => {
    const database = await openDatabase();
    const outbox = new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(database),
    });
    const scope = "ack-user";
    const pending = request("ack-work", uuid(201), 1);
    await outbox.put(scope, pending);
    await outbox.remove(scope, pending.workId, pending.updateId);
    await outbox.put(scope, pending);
    await expect(outbox.list(scope, pending.workId)).resolves.toEqual([]);
    expect(
      await requireStudioCrdtOutboxDatabase(database).listCrdtOutboxCandidates(
        scope,
        pending.workId,
      ),
    ).toEqual([]);
  });

  it("stores monotonic bounded retry metadata without changing queue order", async () => {
    const database = await openDatabase();
    const outbox = new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(database),
    });
    const scope = "retry-user";
    const pending = request("retry-work", uuid(301), 7);
    await outbox.put(scope, pending);
    await outbox.recordRetry(scope, pending.workId, pending.updateId, {
      attemptCount: 2,
      attemptedAt: 1_000,
      nextRetryAt: 2_200,
      errorCode: "temporarily_unavailable",
      errorMessage: "retry later",
    });
    await outbox.recordRetry(scope, pending.workId, pending.updateId, {
      attemptCount: 1,
      attemptedAt: 900,
      nextRetryAt: 1_200,
      errorCode: "older",
      errorMessage: "must not replace newer metadata",
    });
    const row = (await requireStudioCrdtOutboxDatabase(database).listCrdtOutboxCandidates(
      scope,
      pending.workId,
    ))[0];
    expect(row).toMatchObject({
      attemptCount: 2,
      lastAttemptAt: 1_000,
      nextRetryAt: 2_200,
      lastErrorCode: "temporarily_unavailable",
      lastErrorMessage: "retry later",
    });
    await expect(outbox.list(scope, pending.workId)).resolves.toEqual([pending]);
  });

  it("preserves every writer update under concurrent serialized instances", async () => {
    const database = await openDatabase();
    const scope = "writers-user";
    const workId = "writers-work";
    const outbox = createStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(database),
    });
    const replacement = createStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(database),
    });
    const entries = Array.from({ length: 128 }, (_, index) =>
      request(workId, uuid(1_000 + index), index + 1),
    );
    await Promise.all(
      entries.map((entry, index) => (index % 2 === 0 ? outbox : replacement).put(scope, entry)),
    );
    const restored = await replacement.list(scope, workId);
    expect(restored).toHaveLength(entries.length);
    expect(restored.map(({ clientSequence }) => clientSequence)).toEqual(
      entries.map(({ clientSequence }) => clientSequence),
    );
  });
});

describe("real sqlite-wasm reopen and fault gates", () => {
  it("survives a real wasm-VFS close/reopen with identical pending rows and retry metadata", async () => {
    const filename = `crdt-outbox-reopen-${crypto.randomUUID()}.sqlite3`;
    const scope = "reopen-user";
    const workId = "reopen-work";
    const first = await openDatabase({ filename, tracked: false });
    const firstOutbox = new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(first),
    });
    const entries = [request(workId, uuid(401), 2), request(workId, uuid(402), 1)];
    for (const entry of entries) await firstOutbox.put(scope, entry);
    await firstOutbox.recordRetry(scope, workId, entries[0].updateId, {
      attemptCount: 3,
      attemptedAt: 5_000,
      nextRetryAt: 10_000,
      errorCode: "connection",
      errorMessage: "offline",
    });
    await first.close();

    const reopened = await openDatabase({ filename });
    const sql = requireStudioCrdtOutboxDatabase(reopened);
    const rows = await sql.listCrdtOutboxCandidates(scope, workId);
    expect(rows).toHaveLength(2);
    expect(rows.map(({ clientSequence }) => clientSequence)).toEqual([1, 2]);
    expect(rows.find(({ updateId }) => updateId === entries[0].updateId)).toMatchObject({
      attemptCount: 3,
      lastErrorCode: "connection",
    });
  });

  it("fails closed on a CRC-independent canonical payload corruption", async () => {
    const filename = `crdt-outbox-corrupt-${crypto.randomUUID()}.sqlite3`;
    const scope = "corrupt-user";
    const pending = request("corrupt-work", uuid(501), 1);
    const first = await openDatabase({ filename, tracked: false });
    await new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(first),
    }).put(scope, pending);
    await first.close();

    const raw = rawHandle(filename);
    raw.exec(`UPDATE crdt_outbox_v12_entries
      SET request_payload = '{}', payload_bytes = 2
      WHERE scope = '${scope}' AND work_id = '${pending.workId}'`);
    raw.close();

    const reopened = await openDatabase({ filename });
    const outbox = new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(reopened),
    });
    await expect(outbox.list(scope, pending.workId)).rejects.toBeInstanceOf(
      StudioCrdtOutboxCorruptionError,
    );
  });

  it("rolls the ACK tombstone back when the paired pending delete faults", async () => {
    const filename = `crdt-outbox-ack-fault-${crypto.randomUUID()}.sqlite3`;
    const scope = "ack-fault-user";
    const pending = request("ack-fault-work", uuid(601), 1);
    const database = await openDatabase({ filename, tracked: false });
    const outbox = new SqliteStudioCrdtOutbox({
      acquireDatabase: () => Promise.resolve(database),
    });
    await outbox.put(scope, pending);
    await database.close();

    const raw = rawHandle(filename);
    raw.exec(`CREATE TRIGGER crdt_outbox_forced_delete_failure
      BEFORE DELETE ON crdt_outbox_v12_entries
      BEGIN SELECT RAISE(ABORT, 'forced outbox delete failure'); END`);
    raw.close();

    const reopened = await openDatabase({ filename, tracked: false });
    const sql = requireStudioCrdtOutboxDatabase(reopened);
    await expect(
      sql.acknowledgeCrdtOutboxRecord(scope, pending.workId, pending.updateId, 10),
    ).rejects.toThrow(/forced outbox delete failure/);
    await reopened.close();

    const inspect = rawHandle(filename);
    expect(
      rawValue(inspect, "SELECT COUNT(*) FROM crdt_outbox_v12_entries"),
    ).toBe(1);
    expect(
      rawValue(inspect, "SELECT COUNT(*) FROM crdt_outbox_v12_acknowledgements"),
    ).toBe(0);
    inspect.close();
  });

  it("rolls back a conflicting duplicate enqueue and preserves the original payload", async () => {
    const database = await openDatabase();
    const sql: StudioCrdtOutboxDatabase = requireStudioCrdtOutboxDatabase(database);
    const pending = request("conflict-work", uuid(701), 1);
    const payload = JSON.stringify(pending);
    const base = {
      scope: "conflict-user",
      workId: pending.workId,
      updateId: pending.updateId,
      clientSequence: pending.clientSequence,
      requestPayload: payload,
      payloadBytes: new TextEncoder().encode(payload).byteLength,
      createdAt: 1,
    };
    await sql.enqueueCrdtOutboxRecord(base, { maxEntries: 10, maxBytes: 1_000_000 });
    await expect(
      sql.enqueueCrdtOutboxRecord(
        { ...base, requestPayload: `${payload} `, payloadBytes: base.payloadBytes + 1 },
        { maxEntries: 10, maxBytes: 1_000_000 },
      ),
    ).rejects.toThrow(/conflicts with a different durable payload/);
    expect(await sql.listCrdtOutboxCandidates(base.scope, base.workId)).toMatchObject([
      { requestPayload: payload, payloadBytes: base.payloadBytes },
    ]);
  });
});
