import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  countDurableStudioCheckpoints,
  createDurableStudioCheckpoint,
  deleteDurableStudioCheckpoint,
  listDurableStudioCheckpoints,
  listDurableStudioCheckpointKeys,
  renameDurableStudioCheckpoint,
  STUDIO_CHECKPOINT_LIMIT,
  STUDIO_CHECKPOINT_SQLITE_NAMESPACE,
} from "./studio-checkpoints";

const sqlite = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get: vi.fn(async (namespace: string, key: string) =>
    sqlite.values.get(`${namespace}\u0000${key}`) ?? null
  ),
  set: vi.fn(async (namespace: string, key: string, value: string) => {
    sqlite.values.set(`${namespace}\u0000${key}`, value);
  }),
  remove: vi.fn(async (namespace: string, key: string) => {
    sqlite.values.delete(`${namespace}\u0000${key}`);
  }),
}));

vi.mock("./studio-local-database-runtime", () => ({
  acquireStudioLocalDatabase: vi.fn(async () => ({
    kvGet: sqlite.get,
    kvSet: sqlite.set,
    kvDelete: sqlite.remove,
  })),
}));

beforeEach(() => {
  sqlite.values.clear();
  sqlite.get.mockClear();
  sqlite.set.mockClear();
  sqlite.remove.mockClear();
});

describe("V12 SQLite named checkpoints", () => {
  it("uses the shared SQLite namespace without touching browser legacy stores", async () => {
    const localGet = vi.fn(() => {
      throw new Error("legacy localStorage must not be read");
    });
    const indexedOpen = vi.fn(() => {
      throw new Error("legacy IndexedDB must not be opened");
    });
    vi.stubGlobal("localStorage", { getItem: localGet });
    vi.stubGlobal("indexedDB", { open: indexedOpen });

    const created = await createDurableStudioCheckpoint(undefined, "work-a", {
      name: "  안전본  ",
      payload: { version: 12, title: "원고" },
      idFactory: () => "checkpoint-a",
      now: new Date("2026-08-09T00:00:00.000Z"),
    });
    const reopened = await listDurableStudioCheckpoints(undefined, "work-a");

    expect(created).toEqual(reopened);
    expect(reopened[0]).toMatchObject({ id: "checkpoint-a", name: "안전본" });
    expect(sqlite.set).toHaveBeenCalledWith(
      STUDIO_CHECKPOINT_SQLITE_NAMESPACE,
      "work-a",
      expect.any(String)
    );
    expect(localGet).not.toHaveBeenCalled();
    expect(indexedOpen).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("serializes concurrent creates and keeps the newest bounded set without lost updates", async () => {
    await Promise.all(Array.from({ length: STUDIO_CHECKPOINT_LIMIT + 10 }, (_, index) =>
      createDurableStudioCheckpoint(undefined, "work-concurrent", {
        name: `checkpoint-${index}`,
        payload: { index },
        idFactory: () => `id-${index}`,
        now: new Date(Date.UTC(2026, 7, 9, 0, index)),
      })
    ));

    const restored = await listDurableStudioCheckpoints(undefined, "work-concurrent");
    expect(restored).toHaveLength(STUDIO_CHECKPOINT_LIMIT);
    expect(restored[0]?.id).toBe("id-19");
    expect(restored.at(-1)?.id).toBe("id-10");
    expect(new Set(restored.map(({ id }) => id)).size).toBe(STUDIO_CHECKPOINT_LIMIT);
  });

  it("renames and removes rows through the same SQLite authority", async () => {
    await createDurableStudioCheckpoint(undefined, "work-edit", {
      name: "초안",
      payload: { keep: true },
      idFactory: () => "edit-me",
    });
    const renamed = await renameDurableStudioCheckpoint(
      undefined,
      "work-edit",
      "edit-me",
      "  최종 전  "
    );
    expect(renamed[0]).toMatchObject({ id: "edit-me", name: "최종 전" });

    expect(await deleteDurableStudioCheckpoint(undefined, "work-edit", "edit-me")).toEqual([]);
    expect(sqlite.remove).toHaveBeenCalledWith(
      STUDIO_CHECKPOINT_SQLITE_NAMESPACE,
      "work-edit"
    );
  });

  it("maintains a SQLite-only recovery-center inventory", async () => {
    await createDurableStudioCheckpoint(undefined, "work-b", {
      name: "B",
      payload: {},
      idFactory: () => "b",
    });
    await createDurableStudioCheckpoint(undefined, "work-a", {
      name: "A",
      payload: {},
      idFactory: () => "a",
    });

    expect(await listDurableStudioCheckpointKeys()).toEqual(["work-a", "work-b"]);
    expect(await countDurableStudioCheckpoints()).toBe(2);

    await deleteDurableStudioCheckpoint(undefined, "work-a", "a");
    expect(await listDurableStudioCheckpointKeys()).toEqual(["work-b"]);
  });

  it("fails closed on corrupted SQLite JSON instead of replacing it with an empty document", async () => {
    sqlite.values.set(
      `${STUDIO_CHECKPOINT_SQLITE_NAMESPACE}\u0000work-corrupt`,
      '{"version":1,"checkpoints":[{"id":"broken"}]}'
    );

    await expect(listDurableStudioCheckpoints(undefined, "work-corrupt"))
      .rejects.toThrow(/손상/);
    await expect(createDurableStudioCheckpoint(undefined, "work-corrupt", {
      name: "덮어쓰면 안 됨",
      payload: {},
    })).rejects.toThrow(/손상/);
    expect(sqlite.set).not.toHaveBeenCalled();
  });

  it("rejects non-JSON payloads instead of silently dropping structured data", async () => {
    await expect(createDurableStudioCheckpoint(undefined, "work-blob", {
      name: "Blob 안전본",
      payload: { image: new Blob(["pixels"]) },
    })).rejects.toThrow(/안전한 복구 지점/);
    expect(sqlite.values.size).toBe(0);
  });
});
