import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  StudioCrdtRecoverySqlCapacityError,
  openStudioLocalDatabase,
  requireStudioCrdtRecoveryDatabase,
} from "../studio-local-database";

import {
  STUDIO_CRDT_PROTOCOL_VERSION,
  encodeStudioCrdtUpdate,
  type StudioCrdtUpdateRequest,
} from "./studio-crdt-protocol";
import {
  PersistentStudioCrdtRecoveryVault,
  StudioCrdtRecoveryCorruptionError,
  StudioCrdtRecoveryDurabilityError,
  createStudioCrdtRecoverySqlitePersistence,
} from "./studio-crdt-recovery-vault";

import type {
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
  tracked?: boolean;
  now?: () => number;
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

function request(updateId: string, workId = "work-sqlite"): StudioCrdtUpdateRequest {
  return {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    workId,
    updateId,
    clientSequence: 1,
    update: encodeStudioCrdtUpdate(new Uint8Array([1, 2, 3, 4])),
  };
}

function vaultFor(
  database: StudioLocalDatabase,
  options: { now?: () => number; randomId?: () => string } = {},
): PersistentStudioCrdtRecoveryVault {
  return new PersistentStudioCrdtRecoveryVault(
    createStudioCrdtRecoverySqlitePersistence(() => Promise.resolve(database)),
    options.now ?? Date.now,
    options.randomId ?? (() => crypto.randomUUID()),
  );
}

describe("V12 SQLite/OPFS CRDT recovery authority", () => {
  it("survives a real sqlite-wasm named memory-VFS close/reopen with marker and chunks intact", async () => {
    const filename = `crdt-recovery-reopen-${crypto.randomUUID()}.sqlite3`;
    const updates = Array.from({ length: 257 }, (_, index) => request(
      `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
      "work-reopen",
    ));
    const first = await openDatabase({ filename, tracked: false });
    const firstVault = vaultFor(first, { now: () => 1_000, randomId: () => "vault-reopen" });
    await firstVault.preserveRejectionMarker({
      scope: "user-reopen",
      workId: "work-reopen",
      failureCode: "invalid_payload",
      failureMessage: "large rejected frontier",
      rejectedUpdateId: updates[0]!.updateId,
      recoveryUpdateCount: updates.length,
    });
    await firstVault.preserve({
      scope: "user-reopen",
      workId: "work-reopen",
      failureCode: "invalid_payload",
      failureMessage: "large rejected frontier",
      rejectedUpdateId: updates[0]!.updateId,
      updates,
    });
    await first.close();

    const reopened = await openDatabase({ filename });
    const reopenedVault = vaultFor(reopened);
    await expect(reopenedVault.listRejectionMarkers("user-reopen", "work-reopen"))
      .resolves.toEqual([
        expect.objectContaining({
          rejectedUpdateId: updates[0]!.updateId,
          recoveryUpdateCount: 257,
        }),
      ]);
    const restored = await reopenedVault.list("user-reopen", "work-reopen");
    expect(restored).toHaveLength(1);
    expect(restored[0]?.vaultId).toBe("vault-reopen");
    expect(restored[0]?.updates.map(({ updateId }) => updateId))
      .toEqual(updates.map(({ updateId }) => updateId));
  });

  it("commits the permanent marker before chunks and fails closed after a forced manifest fault", async () => {
    const filename = `crdt-recovery-manifest-fault-${crypto.randomUUID()}.sqlite3`;
    const bootstrap = await openDatabase({ filename, tracked: false });
    await bootstrap.close();
    const triggerHandle = rawHandle(filename);
    triggerHandle.exec(`CREATE TRIGGER crdt_recovery_forced_manifest_failure
      BEFORE INSERT ON crdt_recovery_v12_rows
      WHEN NEW.row_kind = 'frontier-manifest'
      BEGIN SELECT RAISE(ABORT, 'forced recovery manifest failure'); END`);
    triggerHandle.close();

    const database = await openDatabase({ filename, tracked: false });
    const vault = vaultFor(database, { now: () => 2_000, randomId: () => "vault-fault" });
    const rejected = request(
      "33333333-3333-4333-8333-333333333333",
      "work-fault",
    );
    await vault.preserveRejectionMarker({
      scope: "user-fault",
      workId: "work-fault",
      failureCode: "forbidden",
      failureMessage: "role changed",
      rejectedUpdateId: rejected.updateId,
      recoveryUpdateCount: 1,
    });
    await expect(vault.preserve({
      scope: "user-fault",
      workId: "work-fault",
      failureCode: "forbidden",
      failureMessage: "role changed",
      rejectedUpdateId: rejected.updateId,
      updates: [rejected],
    })).rejects.toBeInstanceOf(StudioCrdtRecoveryDurabilityError);
    await database.close();

    const inspect = rawHandle(filename);
    expect(rawValue(inspect, `SELECT COUNT(*) FROM crdt_recovery_v12_rows
      WHERE row_kind = 'permanent-rejection'`)).toBe(1);
    expect(rawValue(inspect, `SELECT COUNT(*) FROM crdt_recovery_v12_rows
      WHERE row_kind = 'frontier-chunk'`)).toBe(1);
    expect(rawValue(inspect, `SELECT COUNT(*) FROM crdt_recovery_v12_rows
      WHERE row_kind = 'frontier-manifest'`)).toBe(0);
    inspect.close();

    const reopened = await openDatabase({ filename });
    const reopenedVault = vaultFor(reopened);
    await expect(reopenedVault.list("user-fault", "work-fault"))
      .rejects.toThrow(/manifest가 누락/);
    await expect(reopenedVault.listRejectionMarkers("user-fault", "work-fault"))
      .resolves.toEqual([
        expect.objectContaining({ rejectedUpdateId: rejected.updateId }),
      ]);
  });

  it("fails closed on canonical-payload corruption with a matching stored byte count", async () => {
    const filename = `crdt-recovery-corrupt-${crypto.randomUUID()}.sqlite3`;
    const first = await openDatabase({ filename, tracked: false });
    const vault = vaultFor(first, { randomId: () => "vault-corrupt" });
    const rejected = request(
      "44444444-4444-4444-8444-444444444444",
      "work-corrupt",
    );
    await vault.preserve({
      scope: "user-corrupt",
      workId: "work-corrupt",
      failureCode: "invalid_payload",
      failureMessage: "corrupt me",
      rejectedUpdateId: rejected.updateId,
      updates: [rejected],
    });
    await first.close();

    const raw = rawHandle(filename);
    raw.exec(`UPDATE crdt_recovery_v12_rows
      SET payload = '{}', payload_bytes = 2
      WHERE scope = 'user-corrupt' AND work_id = 'work-corrupt'
        AND row_kind = 'frontier-chunk'`);
    raw.close();

    const reopened = await openDatabase({ filename });
    await expect(vaultFor(reopened).list("user-corrupt", "work-corrupt"))
      .rejects.toBeInstanceOf(StudioCrdtRecoveryCorruptionError);
  });

  it("surfaces degraded durability while retaining only an explicit same-page marker latch", async () => {
    const failure = new Error("sqlite unavailable");
    const vault = new PersistentStudioCrdtRecoveryVault({
      list: async () => [],
      get: async () => null,
      put: async () => {
        throw new StudioCrdtRecoveryDurabilityError("row commit", failure);
      },
    });
    const markerInput = {
      scope: `ephemeral-user-${crypto.randomUUID()}`,
      workId: "ephemeral-work",
      failureCode: "invalid_payload",
      failureMessage: "rejected",
      rejectedUpdateId: "55555555-5555-4555-8555-555555555555",
      recoveryUpdateCount: 1,
    } as const;

    const rejected = await vault.preserveRejectionMarker(markerInput).catch((error) => error);
    expect(rejected).toBeInstanceOf(StudioCrdtRecoveryDurabilityError);
    expect(rejected).toMatchObject({ durability: "degraded" });
    await expect(vault.listRejectionMarkers(markerInput.scope, markerInput.workId))
      .resolves.toEqual([expect.objectContaining({ rejectedUpdateId: markerInput.rejectedUpdateId })]);
  });

  it("rejects a bounded SQL row without evicting the prior recovery authority", async () => {
    const database = await openDatabase();
    const sql = requireStudioCrdtRecoveryDatabase(database);
    const limits = { maxRows: 1, maxBytes: 1_000, maxRowBytes: 500 };
    const firstPayload = JSON.stringify({ marker: "first" });
    await sql.putCrdtRecoveryRecord({
      scope: "capacity-user",
      workId: "capacity-work",
      rowKey: "first",
      rowKind: "permanent-rejection",
      payload: firstPayload,
      payloadBytes: new TextEncoder().encode(firstPayload).byteLength,
    }, limits);
    const secondPayload = JSON.stringify({ marker: "second" });

    await expect(sql.putCrdtRecoveryRecord({
      scope: "capacity-user",
      workId: "capacity-work",
      rowKey: "second",
      rowKind: "permanent-rejection",
      payload: secondPayload,
      payloadBytes: new TextEncoder().encode(secondPayload).byteLength,
    }, limits)).rejects.toBeInstanceOf(StudioCrdtRecoverySqlCapacityError);
    await expect(sql.listCrdtRecoveryCandidates("capacity-user", "capacity-work"))
      .resolves.toMatchObject([{ rowKey: "first", payload: firstPayload }]);
  });
});
