import { describe, expect, it, vi } from "vitest";

import {
  SqliteUnavailableError,
  openStudioLocalDatabase,
} from "./studio-local-database";
import {
  STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
  STUDIO_TOURNAMENT_WINNER_STORAGE_KEY,
  createStudioTournamentRuntime,
  type PersistedTournamentStateV1,
} from "./studio-renderer-tournament-runtime";
import {
  createCostSampleSink,
  createSqliteTournamentPersistence,
  StudioTournamentPersistenceUnavailableError,
} from "./studio-tournament-sqlite-persistence";

const STATE: PersistedTournamentStateV1 = {
  version: STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
  entries: [
    {
      bucket: "a4-n16-s2-g1-b0-t0-d0",
      deviceHash: "device-1",
      providerId: "vello-gpu-browser",
      expectedWarmMs: 2.7,
      decidedAtSample: 8,
    },
  ],
};

describe("studio-tournament-sqlite-persistence", () => {
  it("round-trips tournament state through a real sqlite kv store", async () => {
    const port = createSqliteTournamentPersistence({
      openDatabase: () => openStudioLocalDatabase({ vfs: "memory" }),
    });
    expect(await port.load()).toBeNull();
    await port.save(STATE);
    expect(await port.load()).toEqual(STATE);
  });

  it("opens the database once across repeated load/save calls", async () => {
    const openDatabase = vi.fn(() => openStudioLocalDatabase({ vfs: "memory" }));
    const port = createSqliteTournamentPersistence({ openDatabase });
    await port.save(STATE);
    await port.load();
    await port.load();
    expect(openDatabase).toHaveBeenCalledTimes(1);
  });

  it("resolves corrupt or foreign payloads to null instead of throwing", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const kv = database.asAsyncKeyValueStore("tournament");
    const port = createSqliteTournamentPersistence({
      openDatabase: () => Promise.resolve(database),
    });
    await kv.set(STUDIO_TOURNAMENT_WINNER_STORAGE_KEY, "not-json{");
    expect(await port.load()).toBeNull();
    await kv.set(
      STUDIO_TOURNAMENT_WINNER_STORAGE_KEY,
      JSON.stringify({ version: 999, entries: [] }),
    );
    expect(await port.load()).toBeNull();
  });

  it("reports explicit memory-only status without opening another browser store", async () => {
    const openDatabase = vi.fn(() =>
      Promise.reject(new SqliteUnavailableError("opfs unavailable in test")),
    );
    const port = createSqliteTournamentPersistence({ openDatabase });
    await expect(port.load()).rejects.toBeInstanceOf(
      StudioTournamentPersistenceUnavailableError,
    );
    await expect(port.save(STATE)).rejects.toBeInstanceOf(
      StudioTournamentPersistenceUnavailableError,
    );
    expect(port.status?.()).toMatchObject({
      mode: "memory-only",
      durable: false,
      reason: expect.stringContaining("opfs unavailable in test"),
    });
    expect(openDatabase).toHaveBeenCalledTimes(1);
  });

  it("becomes durable only after SQLite opens successfully", async () => {
    const port = createSqliteTournamentPersistence({
      openDatabase: () => openStudioLocalDatabase({ vfs: "memory" }),
    });
    expect(port.status?.()).toMatchObject({
      mode: "initializing-sqlite",
      durable: false,
    });
    expect(await port.load()).toBeNull();
    expect(port.status?.()).toEqual({ mode: "sqlite-opfs", durable: true, reason: null });
  });
});

describe("structured tournament_winners promotion", () => {
  const SECOND_ENTRY = {
    bucket: "b8-n32-s4-g1-b0-t0-d0",
    deviceHash: "device-2",
    providerId: "vello-cpu",
    expectedWarmMs: 6.5,
    decidedAtSample: 16,
  };

  it("saves into structured tournament_winners rows, not a kv blob", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const port = createSqliteTournamentPersistence({
      openDatabase: () => Promise.resolve(database),
    });
    await port.save(STATE);
    const rows = await database.listTournamentWinners();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(STATE.entries[0]);
    expect(
      await database.kvGet("tournament", STUDIO_TOURNAMENT_WINNER_STORAGE_KEY),
    ).toBeNull();
    expect(await port.load()).toEqual(STATE);
  });

  it("drops only rows with partially corrupted fields on load", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const port = createSqliteTournamentPersistence({
      openDatabase: () => Promise.resolve(database),
    });
    await database.putTournamentWinner(STATE.entries[0]);
    // 부분 필드 오염 — REAL 컬럼에 TEXT 가 앉은 행은 그 행만 드롭된다.
    await database.putTournamentWinner({
      ...SECOND_ENTRY,
      expectedWarmMs: "fast" as unknown as number,
    });
    expect(await port.load()).toEqual(STATE);
  });

  it("replaces atomically: a failed save leaves the previous state intact", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const port = createSqliteTournamentPersistence({
      openDatabase: () => Promise.resolve(database),
    });
    const previous: PersistedTournamentStateV1 = {
      version: STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
      entries: [STATE.entries[0], SECOND_ENTRY],
    };
    await port.save(previous);
    await expect(
      port.save({
        version: STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
        entries: [
          STATE.entries[0],
          { ...SECOND_ENTRY, expectedWarmMs: Number.NaN },
        ],
      }),
    ).rejects.toThrow();
    expect(await port.load()).toEqual(previous);
  });

  it("deletes orphan rows when the saved state shrinks", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const port = createSqliteTournamentPersistence({
      openDatabase: () => Promise.resolve(database),
    });
    await port.save({
      version: STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
      entries: [STATE.entries[0], SECOND_ENTRY],
    });
    await port.save(STATE);
    expect(await database.listTournamentWinners()).toHaveLength(1);
    expect(await port.load()).toEqual(STATE);
  });

  it("reads a legacy kv blob once and promotes it to structured rows on save", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const kv = database.asAsyncKeyValueStore("tournament");
    await kv.set(STUDIO_TOURNAMENT_WINNER_STORAGE_KEY, JSON.stringify(STATE));
    const port = createSqliteTournamentPersistence({
      openDatabase: () => Promise.resolve(database),
    });
    // 구조화 행이 없으니 구버전 blob 이 그대로 보인다.
    const loaded = await port.load();
    expect(loaded).toEqual(STATE);
    // save 가 구조화 테이블로 승격하면서 blob 을 지운다.
    await port.save(loaded ?? STATE);
    expect(await kv.get(STUDIO_TOURNAMENT_WINNER_STORAGE_KEY)).toBeNull();
    expect(await database.listTournamentWinners()).toHaveLength(1);
    expect(await port.load()).toEqual(STATE);
  });

  it("structured rows win over a stale legacy blob", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const kv = database.asAsyncKeyValueStore("tournament");
    await kv.set(
      STUDIO_TOURNAMENT_WINNER_STORAGE_KEY,
      JSON.stringify({
        version: STUDIO_TOURNAMENT_WINNER_SCHEMA_VERSION,
        entries: [SECOND_ENTRY],
      }),
    );
    await database.putTournamentWinner(STATE.entries[0]);
    const port = createSqliteTournamentPersistence({
      openDatabase: () => Promise.resolve(database),
    });
    expect(await port.load()).toEqual(STATE);
  });
});

describe("createCostSampleSink", () => {
  it("the SQLite persistence port receives accepted runtime samples without caller glue", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const port = createSqliteTournamentPersistence({
      openDatabase: () => Promise.resolve(database),
    });
    const runtime = createStudioTournamentRuntime({
      persistence: port,
      deviceHash: "dev-a",
    });
    expect(runtime.recordRenderSample("filter-lane-worker", "filter-512", 3.25)).toBe(
      true,
    );
    expect(
      runtime.recordRenderSample("filter-lane-worker", "filter-512", Number.NaN),
    ).toBe(false);

    await vi.waitFor(async () => {
      expect(
        await database.listCostSamples("filter-lane-worker", "filter-512"),
      ).toHaveLength(1);
    });
    expect(runtime.persistenceStatus()).toEqual({
      mode: "sqlite-opfs",
      durable: true,
      reason: null,
    });
  });

  it("flows accepted runtime render samples into persistent cost_samples", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    const sink = createCostSampleSink(database);
    const writes: Promise<void>[] = [];
    const runtime = createStudioTournamentRuntime({
      persistence: null,
      deviceHash: "dev-a",
      onRenderSample: (sample) => {
        writes.push(sink(sample));
      },
    });
    expect(runtime.recordRenderSample("vello-cpu", "brush-2048", 4.5)).toBe(true);
    expect(runtime.recordRenderSample("vello-cpu", "brush-2048", Number.NaN)).toBe(false);
    await Promise.all(writes);
    // 유효 샘플만 싱크에 닿고, warm 실측으로 영속된다.
    expect(writes).toHaveLength(1);
    const samples = await database.listCostSamples("vello-cpu", "brush-2048");
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ kind: "warm", ms: 4.5 });
  });

  it("swallows persistence failures instead of rejecting into the hot path", async () => {
    const database = await openStudioLocalDatabase({ vfs: "memory" });
    await database.close();
    const sink = createCostSampleSink(database);
    await expect(
      sink({ providerId: "vello-cpu", bucket: "brush-2048", ms: 1 }),
    ).resolves.toBeUndefined();
  });
});
