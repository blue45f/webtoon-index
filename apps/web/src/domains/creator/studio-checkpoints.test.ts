import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendStudioAiOperation,
  createEmptyStudioAiProvenanceDocument,
} from "./ai/studio-ai-provenance";
import {
  createDurableStudioCheckpoint,
  createStudioCheckpoint,
  deleteDurableStudioCheckpoint,
  deleteStudioCheckpoint,
  listDurableStudioCheckpoints,
  listStudioCheckpoints,
  renameDurableStudioCheckpoint,
  renameStudioCheckpoint,
  STUDIO_CHECKPOINT_LIMIT,
  studioServerRestoreCheckpointName,
  studioCheckpointKey,
} from "./studio-checkpoints";

const PRIVATE_PROMPT = "체크포인트에 남으면 안 되는 원문 프롬프트";

function retainedAiProvenance() {
  return appendStudioAiOperation(
    createEmptyStudioAiProvenanceDocument(),
    {
      id: "operation-1",
      kind: "text",
      task: "dialogue",
      provider: "deepseek",
      model: "deepseek-chat",
      transport: "server",
      promptVersion: 1,
      prompt: PRIVATE_PROMPT,
      createdAt: "2026-07-10T00:00:00.000Z",
    },
    { retainRawPrompt: true }
  );
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

interface FakeCheckpointIndexedDbState {
  readonly records: Map<string, unknown>;
  readonly requestedVersions: number[];
  failOpen: boolean;
  failWrites: boolean;
  storeCreated: boolean;
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;
  onerror: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;

  succeed(result: T): void {
    this.result = result;
    this.onsuccess?.call(this as unknown as IDBRequest<T>, new Event("success"));
  }

  fail(): void {
    this.onerror?.call(this as unknown as IDBRequest<T>, new Event("error"));
  }
}

class FakeCheckpointTransaction {
  error: DOMException | null = null;
  oncomplete: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onabort: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  private pending = 0;
  private completionQueued = false;
  private completed = false;

  constructor(private readonly state: FakeCheckpointIndexedDbState) {
    this.queueCompletion();
  }

  objectStore(): IDBObjectStore {
    return new FakeCheckpointObjectStore(this.state, this) as unknown as IDBObjectStore;
  }

  request<T>(operation: () => T): IDBRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      try {
        request.succeed(operation());
      } catch {
        request.fail();
        this.completed = true;
        this.onerror?.call(this as unknown as IDBTransaction, new Event("error"));
        this.onabort?.call(this as unknown as IDBTransaction, new Event("abort"));
      } finally {
        this.pending -= 1;
        this.queueCompletion();
      }
    });
    return request as unknown as IDBRequest<T>;
  }

  private queueCompletion(): void {
    if (this.completionQueued || this.completed) return;
    this.completionQueued = true;
    queueMicrotask(() => {
      this.completionQueued = false;
      if (this.pending > 0 || this.completed) return;
      this.completed = true;
      this.oncomplete?.call(this as unknown as IDBTransaction, new Event("complete"));
    });
  }
}

class FakeCheckpointObjectStore {
  constructor(
    private readonly state: FakeCheckpointIndexedDbState,
    private readonly transaction: FakeCheckpointTransaction
  ) {}

  get(key: IDBValidKey): IDBRequest<unknown> {
    return this.transaction.request(() => structuredClone(this.state.records.get(String(key))));
  }

  put(value: unknown): IDBRequest<IDBValidKey> {
    return this.transaction.request<IDBValidKey>(() => {
      if (this.state.failWrites) throw new Error("quota");
      if (!value || typeof value !== "object" || !("key" in value) || typeof value.key !== "string") {
        throw new Error("invalid record");
      }
      this.state.records.set(value.key, structuredClone(value));
      return value.key;
    });
  }
}

class FakeCheckpointDatabase {
  readonly objectStoreNames: DOMStringList;

  constructor(private readonly state: FakeCheckpointIndexedDbState) {
    this.objectStoreNames = {
      contains: () => state.storeCreated,
    } as unknown as DOMStringList;
  }

  createObjectStore(): IDBObjectStore {
    this.state.storeCreated = true;
    return new FakeCheckpointObjectStore(
      this.state,
      new FakeCheckpointTransaction(this.state)
    ) as unknown as IDBObjectStore;
  }

  transaction(): IDBTransaction {
    return new FakeCheckpointTransaction(this.state) as unknown as IDBTransaction;
  }

  close(): void {
    // The in-memory records intentionally survive each open() call.
  }
}

function installFakeIndexedDb(
  options: { failOpen?: boolean; failWrites?: boolean } = {}
): FakeCheckpointIndexedDbState {
  const state: FakeCheckpointIndexedDbState = {
    records: new Map(),
    requestedVersions: [],
    failOpen: options.failOpen ?? false,
    failWrites: options.failWrites ?? false,
    storeCreated: false,
  };
  const database = new FakeCheckpointDatabase(state);
  let upgraded = false;
  const factory = {
    open: (_name: string, version: number) => {
      state.requestedVersions.push(version);
      const request = new FakeRequest<IDBDatabase>() as FakeRequest<IDBDatabase> & {
        onblocked: ((this: IDBOpenDBRequest, event: Event) => unknown) | null;
        onupgradeneeded: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null;
      };
      request.onblocked = null;
      request.onupgradeneeded = null;
      queueMicrotask(() => {
        if (state.failOpen) {
          request.fail();
          return;
        }
        request.result = database as unknown as IDBDatabase;
        if (!upgraded) {
          upgraded = true;
          request.onupgradeneeded?.call(
            request as unknown as IDBOpenDBRequest,
            new Event("upgradeneeded") as IDBVersionChangeEvent
          );
        }
        request.succeed(database as unknown as IDBDatabase);
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as IDBFactory;
  vi.stubGlobal("indexedDB", factory);
  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("studio checkpoints", () => {
  it("isolates checkpoints by user and document context", () => {
    expect(studioCheckpointKey({ userId: "u1", workId: "w1" })).not.toBe(
      studioCheckpointKey({ userId: "u1", workId: "w2" })
    );
    expect(studioCheckpointKey({ userId: "u1", workId: "w1" })).not.toBe(
      studioCheckpointKey({ userId: "u2", workId: "w1" })
    );
    expect(studioCheckpointKey({ userId: "u1", remixId: "w1" })).not.toBe(
      studioCheckpointKey({ userId: "u1", workId: "w1" })
    );
  });

  it("creates newest-first checkpoints and preserves the project payload", () => {
    const storage = memoryStorage();
    const key = studioCheckpointKey({ userId: "u1", workId: "w1" });
    createStudioCheckpoint(storage, key, {
      name: "초안",
      payload: { version: 2, title: "작품" },
      now: new Date("2026-07-10T01:00:00.000Z"),
      idFactory: () => "c1",
    });
    const checkpoints = createStudioCheckpoint(storage, key, {
      name: "  대사 수정  ",
      payload: { version: 2, title: "수정본" },
      now: new Date("2026-07-10T02:00:00.000Z"),
      idFactory: () => "c2",
    });
    expect(checkpoints.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "c2", name: "대사 수정" },
      { id: "c1", name: "초안" },
    ]);
    expect(checkpoints[0].payload).toEqual({ version: 2, title: "수정본" });
  });

  it("redacts raw AI prompts when creating and reloading checkpoints", () => {
    const storage = memoryStorage();
    const checkpoints = createStudioCheckpoint(storage, "ai-history", {
      name: "AI 초안",
      payload: { version: 2, aiProvenance: retainedAiProvenance() },
      now: new Date("2026-07-10T02:00:00.000Z"),
      idFactory: () => "ai-checkpoint",
    });
    const serializedStorage = storage.getItem("ai-history") ?? "";
    const restored = listStudioCheckpoints(storage, "ai-history");
    const createdPayload = checkpoints[0].payload as { aiProvenance: ReturnType<typeof retainedAiProvenance> };
    const restoredPayload = restored[0].payload as { aiProvenance: ReturnType<typeof retainedAiProvenance> };

    expect(createdPayload.aiProvenance.operations[0].prompt.retention).toBe("hash-only");
    expect(restoredPayload.aiProvenance.operations).toHaveLength(1);
    expect(serializedStorage).not.toContain(PRIVATE_PROMPT);
    expect(JSON.stringify(restored)).not.toContain(PRIVATE_PROMPT);
  });

  it("redacts raw prompts while migrating legacy checkpoint containers", () => {
    const storage = memoryStorage();
    storage.setItem(
      "legacy-ai",
      JSON.stringify([
        {
          id: "legacy-ai",
          name: "과거 AI 초안",
          createdAt: "2026-07-10T00:00:00.000Z",
          payload: { aiProvenance: retainedAiProvenance() },
        },
      ])
    );

    const restored = listStudioCheckpoints(storage, "legacy-ai");
    const payload = restored[0].payload as { aiProvenance: ReturnType<typeof retainedAiProvenance> };
    expect(payload.aiProvenance.operations[0].prompt).not.toHaveProperty("raw");
    expect(JSON.stringify(restored)).not.toContain(PRIVATE_PROMPT);
  });

  it("migrates the legacy array container and drops malformed records", () => {
    const storage = memoryStorage();
    const key = "legacy";
    storage.setItem(
      key,
      JSON.stringify([
        { id: "good", name: "정상", createdAt: "2026-07-10T00:00:00.000Z", payload: { ok: true } },
        { id: "bad", name: "", createdAt: "invalid", payload: null },
      ])
    );
    expect(listStudioCheckpoints(storage, key)).toHaveLength(1);
    expect(listStudioCheckpoints(storage, key)[0].id).toBe("good");
  });

  it("keeps only the bounded newest checkpoints", () => {
    const storage = memoryStorage();
    const key = "bounded";
    for (let index = 0; index < STUDIO_CHECKPOINT_LIMIT + 3; index++) {
      createStudioCheckpoint(storage, key, {
        name: `v${index}`,
        payload: { index },
        now: new Date(Date.UTC(2026, 0, 1, 0, index)),
        idFactory: () => `id-${index}`,
      });
    }
    const checkpoints = listStudioCheckpoints(storage, key);
    expect(checkpoints).toHaveLength(STUDIO_CHECKPOINT_LIMIT);
    expect(checkpoints[0].name).toBe(`v${STUDIO_CHECKPOINT_LIMIT + 2}`);
    expect(checkpoints.at(-1)?.name).toBe("v3");
  });

  it("renames and deletes a checkpoint without changing payload order", () => {
    const storage = memoryStorage();
    const key = "edit";
    createStudioCheckpoint(storage, key, {
      name: "초안",
      payload: { keep: true },
      idFactory: () => "one",
    });
    expect(renameStudioCheckpoint(storage, key, "one", "  최종 전  ")[0]).toMatchObject({
      id: "one",
      name: "최종 전",
      payload: { keep: true },
    });
    expect(deleteStudioCheckpoint(storage, key, "one")).toEqual([]);
    expect(storage.getItem(key)).toBeNull();
  });

  it("rejects blank names and reports storage quota failures", () => {
    const storage = memoryStorage();
    expect(() => createStudioCheckpoint(storage, "key", { name: "   ", payload: {} })).toThrow(/이름/);
    expect(() =>
      createStudioCheckpoint(
        { ...storage, setItem: () => { throw new Error("quota"); } },
        "key",
        { name: "저장", payload: {} }
      )
    ).toThrow(/저장공간/);
  });

  it("creates a bounded, recognizable pre-restore checkpoint name", () => {
    const name = studioServerRestoreCheckpointName(12, new Date("2026-07-13T09:42:00.000Z"));
    expect(name).toContain("서버 r12 복원 전");
    expect(name.length).toBeLessThanOrEqual(80);
    expect(() => studioServerRestoreCheckpointName(0)).toThrow(/revision/);
  });
});

describe("durable studio checkpoints", () => {
  it("stores Blob-heavy payloads in IndexedDB without touching quota-limited localStorage", async () => {
    const state = installFakeIndexedDb();
    const memory = memoryStorage();
    const storage = {
      ...memory,
      setItem: () => {
        throw new Error("local quota");
      },
    };
    const key = studioCheckpointKey({ userId: "blob-user", workId: "image-heavy" });
    const blob = new Blob([new Uint8Array(512 * 1024)], { type: "image/png" });

    const created = await createDurableStudioCheckpoint(storage, key, {
      name: "서버 복원 전",
      payload: { version: 2, image: blob },
      idFactory: () => "blob-checkpoint",
      now: new Date("2026-07-13T10:00:00.000Z"),
    });
    state.failWrites = true;
    const restored = await listDurableStudioCheckpoints(storage, key);

    expect(state.requestedVersions).toEqual([1, 1]);
    expect(created[0].id).toBe("blob-checkpoint");
    expect((restored[0].payload as { image: Blob }).image).toBeInstanceOf(Blob);
    expect((restored[0].payload as { image: Blob }).image.size).toBe(blob.size);
    expect(memory.values.size).toBe(0);
  });

  it("migrates legacy localStorage checkpoints into the bounded IndexedDB record", async () => {
    const state = installFakeIndexedDb();
    const storage = memoryStorage();
    const key = studioCheckpointKey({ userId: "legacy-user", workId: "legacy-work" });
    createStudioCheckpoint(storage, key, {
      name: "기존 복구 지점",
      payload: { version: 2, title: "레거시" },
      idFactory: () => "legacy-checkpoint",
      now: new Date("2026-07-13T09:00:00.000Z"),
    });

    const migrated = await listDurableStudioCheckpoints(storage, key);
    const stored = state.records.get(key) as {
      legacyImported: boolean;
      checkpoints: Array<{ id: string }>;
    };

    expect(migrated.map((checkpoint) => checkpoint.id)).toEqual(["legacy-checkpoint"]);
    expect(stored.legacyImported).toBe(true);
    expect(stored.checkpoints.map((checkpoint) => checkpoint.id)).toEqual(["legacy-checkpoint"]);
    expect(storage.getItem(key)).toBeNull();
  });

  it("imports a later synchronous checkpoint write instead of treating it as stale legacy data", async () => {
    installFakeIndexedDb();
    const storage = memoryStorage();
    const key = "mixed-api-migration";
    await createDurableStudioCheckpoint(storage, key, {
      name: "내구 저장본",
      payload: { source: "indexed-db" },
      idFactory: () => "indexed-db-checkpoint",
      now: new Date("2026-07-13T09:00:00.000Z"),
    });
    createStudioCheckpoint(storage, key, {
      name: "기존 UI 저장본",
      payload: { source: "local-storage" },
      idFactory: () => "sync-checkpoint",
      now: new Date("2026-07-13T10:00:00.000Z"),
    });

    const merged = await listDurableStudioCheckpoints(storage, key);
    expect(merged.map((checkpoint) => checkpoint.id)).toEqual([
      "sync-checkpoint",
      "indexed-db-checkpoint",
    ]);
    expect(storage.getItem(key)).toBeNull();
  });

  it("keeps durable retention bounded and supports rename/delete mutations", async () => {
    installFakeIndexedDb();
    const storage = memoryStorage();
    const key = "durable-bounded";
    for (let index = 0; index < STUDIO_CHECKPOINT_LIMIT + 2; index++) {
      await createDurableStudioCheckpoint(storage, key, {
        name: `r${index}`,
        payload: { index },
        idFactory: () => `durable-${index}`,
        now: new Date(Date.UTC(2026, 0, 1, 0, index)),
      });
    }

    const renamed = await renameDurableStudioCheckpoint(
      storage,
      key,
      `durable-${STUDIO_CHECKPOINT_LIMIT + 1}`,
      "  최신 안전본  "
    );
    const deleted = await deleteDurableStudioCheckpoint(
      storage,
      key,
      `durable-${STUDIO_CHECKPOINT_LIMIT}`
    );

    expect(renamed).toHaveLength(STUDIO_CHECKPOINT_LIMIT);
    expect(renamed[0].name).toBe("최신 안전본");
    expect(deleted).toHaveLength(STUDIO_CHECKPOINT_LIMIT - 1);
    expect(deleted.some((checkpoint) => checkpoint.id === `durable-${STUDIO_CHECKPOINT_LIMIT}`)).toBe(false);
  });

  it("falls back to JSON-safe localStorage and imports it when IndexedDB recovers", async () => {
    const state = installFakeIndexedDb({ failOpen: true });
    const storage = memoryStorage();
    const key = "durable-fallback";

    const fallback = await createDurableStudioCheckpoint(storage, key, {
      name: "오프라인 안전본",
      payload: { version: 2, title: "로컬" },
      idFactory: () => "fallback-checkpoint",
      now: new Date("2026-07-13T11:00:00.000Z"),
    });
    expect(fallback[0].id).toBe("fallback-checkpoint");
    expect(await listDurableStudioCheckpoints(storage, key)).toHaveLength(1);

    state.failOpen = false;
    const migrated = await listDurableStudioCheckpoints(storage, key);
    expect(migrated.map((checkpoint) => checkpoint.id)).toEqual(["fallback-checkpoint"]);
    expect(state.records.has(key)).toBe(true);
  });

  it("does not report an aborted IndexedDB write as success before the local fallback commits", async () => {
    const state = installFakeIndexedDb({ failWrites: true });
    const storage = memoryStorage();
    const key = "transaction-abort-fallback";

    const fallback = await createDurableStudioCheckpoint(storage, key, {
      name: "트랜잭션 실패 안전본",
      payload: { version: 2, safe: true },
      idFactory: () => "transaction-fallback",
    });
    expect(fallback[0].id).toBe("transaction-fallback");
    expect(state.records.has(key)).toBe(false);
    expect(storage.values.size).toBe(1);

    state.failWrites = false;
    expect((await listDurableStudioCheckpoints(storage, key))[0].id).toBe("transaction-fallback");
    expect(state.records.has(key)).toBe(true);
  });

  it("fails closed when neither IndexedDB nor a lossless local fallback can persist", async () => {
    installFakeIndexedDb({ failOpen: true });
    const memory = memoryStorage();
    const quotaStorage = {
      ...memory,
      setItem: () => {
        throw new Error("quota");
      },
    };

    await expect(
      createDurableStudioCheckpoint(quotaStorage, "no-storage", {
        name: "복원 전",
        payload: { version: 2 },
      })
    ).rejects.toThrow(/안전한 복구 지점/);

    await expect(
      createDurableStudioCheckpoint(memory, "blob-without-indexed-db", {
        name: "Blob 복원 전",
        payload: { image: new Blob(["image"]) },
      })
    ).rejects.toThrow(/안전한 복구 지점/);

    const sparse = new Array<unknown>(1);
    await expect(
      createDurableStudioCheckpoint(memory, "sparse-without-indexed-db", {
        name: "희소 배열 복원 전",
        payload: { sparse },
      })
    ).rejects.toThrow(/안전한 복구 지점/);

    const getter = vi.fn(() => "private-value");
    const accessorPayload: Record<string, unknown> = {};
    Object.defineProperty(accessorPayload, "private", { enumerable: true, get: getter });
    await expect(
      createDurableStudioCheckpoint(memory, "accessor-without-indexed-db", {
        name: "접근자 복원 전",
        payload: accessorPayload,
      })
    ).rejects.toThrow(/안전한 복구 지점/);
    expect(getter).not.toHaveBeenCalled();
    expect(memory.values.size).toBe(0);
  });
});
