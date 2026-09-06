import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import {
  STUDIO_PRO_DRAW_PREFERENCES_SQLITE_KEY,
  StudioProDrawStaleRevisionError,
  createStudioProDrawPreferenceRuntime,
  createStudioProDrawPreferencesRepository,
  parseStudioProDrawPreferenceSnapshot,
  type StudioProDrawPreferencesRepository,
} from "./studio-pro-draw-preferences-sqlite";
import {
  normalizeStudioProDrawPrefs,
  rememberRecentBrushId,
  toggleFavoriteBrushId,
} from "./studio-pro-draw-prefs";

import type {
  StudioAsyncKeyValueStore,
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "./studio-local-database";

class RuntimeChannel {
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  postMessage(): void {}

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
  }

  emit(value: unknown): void {
    for (const listener of [...this.listeners]) {
      listener({ data: value } as MessageEvent<unknown>);
    }
  }
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function memoryStore(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(STUDIO_PRO_DRAW_PREFERENCES_SQLITE_KEY, initial);
  const store: StudioAsyncKeyValueStore = {
    get: vi.fn(async (key) => values.get(key) ?? null),
    set: vi.fn(async (key, value) => { values.set(key, value); }),
    delete: vi.fn(async (key) => { values.delete(key); }),
  };
  return { values, store };
}

function savedEnvelope(options: {
  revision?: number;
  writerId?: string;
  favoriteBrushIds?: string[];
  recentBrushIds?: string[];
  appliedIntentIds?: string[];
} = {}): string {
  return JSON.stringify({
    v: 1,
    revision: options.revision ?? 1,
    writerId: options.writerId ?? "other-tab",
    appliedIntentIds: options.appliedIntentIds ?? [],
    prefs: normalizeStudioProDrawPrefs({
      favoriteBrushIds: options.favoriteBrushIds ?? [],
      recentBrushIds: options.recentBrushIds ?? [],
    }),
  });
}

let sqlite3: StudioSqliteApiHandle;
const opened: StudioLocalDatabase[] = [];

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of opened) await database.close();
});

describe("Studio Pro Draw SQLite/OPFS repository", () => {
  it("round-trips a revisioned snapshot through real sqlite-wasm SQL", async () => {
    const database = await openStudioLocalDatabase({
      vfs: "memory",
      loadSqlite: async () => sqlite3,
      now: () => 2_000_000_000_000,
    });
    opened.push(database);
    const repository = createStudioProDrawPreferencesRepository(
      database.asAsyncKeyValueStore("pro-draw-test"),
    );

    const saved = await repository.save({
      expectedRevision: 0,
      writerId: "tab-real-sqlite",
      intentIds: ["tab-real-sqlite:1"],
      prefs: normalizeStudioProDrawPrefs({
        sizeLocked: true,
        recentBrushIds: ["gpen"],
        favoriteBrushIds: ["watercolor"],
      }),
    });

    expect(saved).toMatchObject({
      revision: 1,
      writerId: "tab-real-sqlite",
      persisted: true,
      malformed: false,
      prefs: {
        sizeLocked: true,
        recentBrushIds: ["gpen"],
        favoriteBrushIds: ["watercolor"],
      },
    });
    await expect(repository.load()).resolves.toEqual(saved);
  });

  it("distinguishes missing and malformed rows while failing closed to defaults", async () => {
    expect(parseStudioProDrawPreferenceSnapshot(null)).toMatchObject({
      persisted: false,
      malformed: false,
      revision: 0,
    });
    for (const malformed of ["{broken", "null", JSON.stringify({ v: 1, revision: -1 })]) {
      expect(parseStudioProDrawPreferenceSnapshot(malformed)).toMatchObject({
        persisted: true,
        malformed: true,
        revision: 0,
        prefs: {
          sizeLocked: false,
          opacityLocked: false,
          recentBrushIds: [],
          favoriteBrushIds: [],
        },
      });
    }
  });

  it("rejects a stale expected revision instead of overwriting a newer tab", async () => {
    const fixture = memoryStore(savedEnvelope({ revision: 4, favoriteBrushIds: ["gpen"] }));
    const repository = createStudioProDrawPreferencesRepository(fixture.store);

    await expect(repository.save({
      expectedRevision: 3,
      writerId: "stale-tab",
      intentIds: ["stale-tab:1"],
      prefs: normalizeStudioProDrawPrefs({ favoriteBrushIds: ["watercolor"] }),
    })).rejects.toMatchObject({
      name: "StudioProDrawStaleRevisionError",
      expectedRevision: 3,
      actualRevision: 4,
    });
    await expect(repository.load()).resolves.toMatchObject({
      revision: 4,
      prefs: { favoriteBrushIds: ["gpen"] },
    });
  });

  it("serializes writes and remains retryable after a failed SQLite transaction", async () => {
    const fixture = memoryStore();
    const firstGate = deferred<void>();
    const writes: string[] = [];
    let failFirst = true;
    fixture.store.set = vi.fn(async (key, value) => {
      const parsed = parseStudioProDrawPreferenceSnapshot(value);
      writes.push(parsed.prefs.recentBrushIds[0] ?? "none");
      if (writes.length === 1) await firstGate.promise;
      if (failFirst) {
        failFirst = false;
        throw new Error("SQLITE_FULL");
      }
      fixture.values.set(key, value);
    });
    const repository = createStudioProDrawPreferencesRepository(fixture.store);
    const first = repository.save({
      expectedRevision: 0,
      writerId: "tab-a",
      intentIds: ["tab-a:1"],
      prefs: normalizeStudioProDrawPrefs({ recentBrushIds: ["pen"] }),
    });
    const second = repository.save({
      expectedRevision: 0,
      writerId: "tab-a",
      intentIds: ["tab-a:2"],
      prefs: normalizeStudioProDrawPrefs({ recentBrushIds: ["gpen"] }),
    });

    await vi.waitFor(() => expect(writes).toEqual(["pen"]));
    firstGate.resolve();
    await expect(first).rejects.toThrow("SQLITE_FULL");
    await expect(second).resolves.toMatchObject({
      revision: 1,
      prefs: { recentBrushIds: ["gpen"] },
    });
    expect(writes).toEqual(["pen", "gpen"]);
  });
});

describe("Studio Pro Draw async persistence runtime", () => {
  it("replays an edit made before late hydration over the newest durable snapshot", async () => {
    const loadGate = deferred<ReturnType<typeof parseStudioProDrawPreferenceSnapshot>>();
    let durable = parseStudioProDrawPreferenceSnapshot(savedEnvelope({
      revision: 7,
      favoriteBrushIds: ["watercolor"],
    }));
    const repository: StudioProDrawPreferencesRepository = {
      authority: "sqlite-opfs",
      load: vi.fn()
        .mockImplementationOnce(() => loadGate.promise)
        .mockImplementation(async () => durable),
      save: vi.fn(async (input) => {
        durable = parseStudioProDrawPreferenceSnapshot(JSON.stringify({
          v: 1,
          revision: input.expectedRevision + 1,
          writerId: input.writerId,
          appliedIntentIds: input.intentIds,
          prefs: input.prefs,
        }));
        return durable;
      }),
      flush: vi.fn(async () => undefined),
    };
    const runtime = createStudioProDrawPreferenceRuntime({
      acquireRepository: async () => repository,
      createChannel: () => null,
      writerId: "late-tab",
    });

    const hydration = runtime.hydrate();
    const mutation = runtime.mutate((prefs) => toggleFavoriteBrushId(prefs, "gpen"));
    expect(mutation.prefs.favoriteBrushIds).toEqual(["gpen"]);
    loadGate.resolve(durable);

    await expect(hydration).resolves.toBe(true);
    await expect(mutation.persistence).resolves.toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      revision: 8,
      prefs: { favoriteBrushIds: ["watercolor", "gpen"] },
    });
  });

  it("surfaces a write failure as memory-only and explicitly retries the full intent", async () => {
    const fixture = memoryStore();
    let failWrites = true;
    fixture.store.set = vi.fn(async (key, value) => {
      if (failWrites) throw new Error("SQLITE_FULL");
      fixture.values.set(key, value);
    });
    const repository = createStudioProDrawPreferencesRepository(fixture.store);
    const runtime = createStudioProDrawPreferenceRuntime({
      acquireRepository: async () => repository,
      createChannel: () => null,
      writerId: "retry-tab",
    });
    await expect(runtime.hydrate()).resolves.toBe(true);

    const mutation = runtime.mutate((prefs) => rememberRecentBrushId(prefs, "marker"));
    expect(mutation.persisted).toBe(false);
    await expect(mutation.persistence).resolves.toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "memory-only",
      durable: false,
      prefs: { recentBrushIds: ["marker"] },
    });
    expect(runtime.getSnapshot().message).toContain("SQLite/OPFS");

    failWrites = false;
    await expect(runtime.retry()).resolves.toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      durable: true,
      revision: 1,
      prefs: { recentBrushIds: ["marker"] },
    });
    await expect(repository.load()).resolves.toMatchObject({
      prefs: { recentBrushIds: ["marker"] },
    });
  });

  it("reloads and retries an intent when a stale revision is reported", async () => {
    const initial = parseStudioProDrawPreferenceSnapshot(savedEnvelope({ revision: 2 }));
    const remote = parseStudioProDrawPreferenceSnapshot(savedEnvelope({
      revision: 3,
      writerId: "remote-tab",
      favoriteBrushIds: ["watercolor"],
    }));
    let loadCount = 0;
    const repository: StudioProDrawPreferencesRepository = {
      authority: "sqlite-opfs",
      load: vi.fn(async () => {
        loadCount += 1;
        return loadCount < 3 ? initial : remote;
      }),
      save: vi.fn()
        .mockRejectedValueOnce(new StudioProDrawStaleRevisionError(2, 3))
        .mockImplementationOnce(async (input) => parseStudioProDrawPreferenceSnapshot(JSON.stringify({
          v: 1,
          revision: input.expectedRevision + 1,
          writerId: input.writerId,
          appliedIntentIds: input.intentIds,
          prefs: input.prefs,
        }))),
      flush: vi.fn(async () => undefined),
    };
    const runtime = createStudioProDrawPreferenceRuntime({
      acquireRepository: async () => repository,
      createChannel: () => null,
      writerId: "rebasing-tab",
    });
    await runtime.hydrate();

    const mutation = runtime.mutate((prefs) => toggleFavoriteBrushId(prefs, "gpen"));
    await expect(mutation.persistence).resolves.toBe(true);
    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot()).toMatchObject({
      state: "durable",
      revision: 4,
      prefs: { favoriteBrushIds: ["watercolor", "gpen"] },
    });
  });

  it("recovers a locally committed intent when a same-revision remote overwrite is broadcast", async () => {
    const fixture = memoryStore();
    const repository = createStudioProDrawPreferencesRepository(fixture.store);
    const channel = new RuntimeChannel();
    const runtime = createStudioProDrawPreferenceRuntime({
      acquireRepository: async () => repository,
      createChannel: () => channel,
      writerId: "conflict-tab",
    });
    runtime.activate();
    await runtime.hydrate();

    const local = runtime.mutate((prefs) => toggleFavoriteBrushId(prefs, "gpen"));
    await expect(local.persistence).resolves.toBe(true);
    expect(runtime.getSnapshot().revision).toBe(1);

    fixture.values.set(STUDIO_PRO_DRAW_PREFERENCES_SQLITE_KEY, savedEnvelope({
      revision: 1,
      writerId: "remote-overwriter",
      favoriteBrushIds: ["watercolor"],
      appliedIntentIds: ["remote-overwriter:1"],
    }));
    channel.emit({
      v: 1,
      type: "changed",
      revision: 1,
      writerId: "remote-overwriter",
    });

    await vi.waitFor(() => {
      expect(runtime.getSnapshot()).toMatchObject({
        state: "durable",
        revision: 2,
        prefs: { favoriteBrushIds: ["watercolor", "gpen"] },
      });
    });
    await expect(repository.load()).resolves.toMatchObject({
      revision: 2,
      appliedIntentIds: expect.arrayContaining([
        "remote-overwriter:1",
        "conflict-tab:1",
      ]),
    });
    runtime.dispose();
  });
});
