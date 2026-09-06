import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_STUDIO_BRUSH_SNAPSHOT } from "./brush/studio-brush-library";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import { openStudioLocalDatabase } from "./studio-local-database";
import {
  mergeHydratedStudioToolOperationMemory,
  normalizeStudioToolOperationMemory,
  rememberStudioToolOperationSnapshot,
} from "./studio-tool-operation-memory";
import {
  createStudioToolOperationMemoryController,
  createStudioToolOperationMemorySqlitePersistence,
  parseStudioToolOperationMemory,
  serializeStudioToolOperationMemory,
  STUDIO_TOOL_OPERATION_MEMORY_SCHEMA,
  STUDIO_TOOL_OPERATION_MEMORY_SQLITE_KEY,
  STUDIO_TOOL_OPERATION_MEMORY_SQLITE_NAMESPACE,
  StudioToolOperationMemoryPersistenceError,
  type StudioToolOperationMemoryPersistencePort,
} from "./studio-tool-operation-memory-sqlite";

import type {
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "./studio-local-database";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function kneadedEraser(strokeWidth = 26) {
  return {
    ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
    brushId: "kneaded-eraser",
    strokeWidth,
    brushOpacity: 0.38,
  };
}

function paint(strokeWidth = 9) {
  return {
    ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
    brushId: "pen",
    strokeWidth,
    brushOpacity: 0.73,
  };
}

let sqlite3: StudioSqliteApiHandle;
const databases: StudioLocalDatabase[] = [];

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of databases) await database.close();
});

async function openMemoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  databases.push(database);
  return database;
}

describe("studio tool operation memory normalization", () => {
  it("starts paint and erase with independent canonical presets", () => {
    const memory = normalizeStudioToolOperationMemory(null);

    expect(memory.paint).toMatchObject({
      brushId: "pen",
      strokeWidth: 6,
      brushOpacity: 1,
    });
    expect(memory.erase).toMatchObject({
      brushId: "standard-eraser",
      strokeWidth: 20,
      brushOpacity: 1,
    });
  });

  it("preserves a kneaded eraser without allowing an erase preset into paint memory", () => {
    const base = normalizeStudioToolOperationMemory(null);
    const withEraser = rememberStudioToolOperationSnapshot(base, "erase", kneadedEraser());
    const rejectedPaint = rememberStudioToolOperationSnapshot(
      withEraser,
      "paint",
      kneadedEraser(),
    );

    expect(withEraser.erase).toMatchObject({
      brushId: "kneaded-eraser",
      strokeWidth: 26,
      brushOpacity: 0.38,
    });
    expect(rejectedPaint.paint.brushId).toBe("pen");
    expect(rejectedPaint.erase.brushId).toBe("kneaded-eraser");
  });

  it("normalizes corrupt family slots independently", () => {
    const memory = normalizeStudioToolOperationMemory({
      paint: { ...DEFAULT_STUDIO_BRUSH_SNAPSHOT, brushId: "standard-eraser" },
      erase: { ...DEFAULT_STUDIO_BRUSH_SNAPSHOT, brushId: "pen" },
    });

    expect(memory.paint.brushId).toBe("pen");
    expect(memory.erase.brushId).toBe("standard-eraser");
  });

  it("round-trips a canonical versioned SQLite envelope", () => {
    const memory = rememberStudioToolOperationSnapshot(
      normalizeStudioToolOperationMemory(null),
      "erase",
      kneadedEraser(31),
    );
    const raw = serializeStudioToolOperationMemory(memory);

    expect(JSON.parse(raw)).toMatchObject({
      schema: STUDIO_TOOL_OPERATION_MEMORY_SCHEMA,
      version: 1,
    });
    expect(parseStudioToolOperationMemory(raw)).toEqual({
      memory,
      repaired: false,
    });
  });

  it("reports malformed JSON and foreign schemas as corrupt instead of hiding them", () => {
    for (const raw of ["{", JSON.stringify({ version: 1, paint: {}, erase: {} })]) {
      expect(() => parseStudioToolOperationMemory(raw)).toThrowError(
        expect.objectContaining({ code: "corrupt" }),
      );
    }
  });

  it("repairs only the malformed persisted family and marks the repair", () => {
    const raw = JSON.stringify({
      schema: STUDIO_TOOL_OPERATION_MEMORY_SCHEMA,
      version: 1,
      paint: paint(14),
      erase: paint(77),
    });
    const parsed = parseStudioToolOperationMemory(raw);

    expect(parsed.repaired).toBe(true);
    expect(parsed.memory.paint.strokeWidth).toBe(14);
    expect(parsed.memory.erase).toMatchObject({
      brushId: "standard-eraser",
      strokeWidth: 20,
    });
  });
});

describe("studio tool operation memory SQLite controller", () => {
  it("preserves a fast active paint edit while accepting the hydrated erase slot", () => {
    const initialMemory = normalizeStudioToolOperationMemory(null);
    const hydratedMemory = rememberStudioToolOperationSnapshot(
      rememberStudioToolOperationSnapshot(initialMemory, "paint", paint(48)),
      "erase",
      kneadedEraser(37),
    );
    const merged = mergeHydratedStudioToolOperationMemory({
      hydratedMemory,
      initialMemory,
      activeOperation: "paint",
      activeSnapshot: paint(13),
      operationTransitionTouched: false,
    });

    expect(merged).toMatchObject({
      activeSnapshotDiverged: true,
      shouldApplyHydratedActiveSnapshot: false,
      memory: {
        paint: { brushId: "pen", strokeWidth: 13 },
        erase: { brushId: "kneaded-eraser", strokeWidth: 37 },
      },
    });
  });

  it("applies hydrated active state only while the initial snapshot remains untouched", () => {
    const initialMemory = normalizeStudioToolOperationMemory(null);
    const hydratedMemory = rememberStudioToolOperationSnapshot(
      initialMemory,
      "paint",
      paint(42),
    );
    const merged = mergeHydratedStudioToolOperationMemory({
      hydratedMemory,
      initialMemory,
      activeOperation: "paint",
      activeSnapshot: initialMemory.paint,
      operationTransitionTouched: false,
    });

    expect(merged).toEqual({
      memory: hydratedMemory,
      activeSnapshotDiverged: false,
      shouldApplyHydratedActiveSnapshot: true,
    });
  });

  it("keeps an explicit transition snapshot even when it matches initial defaults", () => {
    const initialMemory = normalizeStudioToolOperationMemory(null);
    const hydratedMemory = rememberStudioToolOperationSnapshot(
      initialMemory,
      "paint",
      paint(55),
    );
    const merged = mergeHydratedStudioToolOperationMemory({
      hydratedMemory,
      initialMemory,
      activeOperation: "paint",
      activeSnapshot: initialMemory.paint,
      operationTransitionTouched: true,
    });

    expect(merged.memory.paint).toEqual(initialMemory.paint);
    expect(merged.activeSnapshotDiverged).toBe(false);
    expect(merged.shouldApplyHydratedActiveSnapshot).toBe(false);
  });

  it("uses the real sqlite-wasm KV table and survives a controller restart", async () => {
    const database = await openMemoryDatabase();
    const persistence = createStudioToolOperationMemorySqlitePersistence({
      acquireDatabase: () => Promise.resolve(database),
    });
    const first = createStudioToolOperationMemoryController(persistence);
    const saved = rememberStudioToolOperationSnapshot(
      rememberStudioToolOperationSnapshot(
        normalizeStudioToolOperationMemory(null),
        "paint",
        paint(17),
      ),
      "erase",
      kneadedEraser(29),
    );

    await expect(first.save(saved)).resolves.toBe(true);
    expect(await database.kvGet(
      STUDIO_TOOL_OPERATION_MEMORY_SQLITE_NAMESPACE,
      STUDIO_TOOL_OPERATION_MEMORY_SQLITE_KEY,
    )).toBe(serializeStudioToolOperationMemory(saved));

    const restarted = createStudioToolOperationMemoryController(
      createStudioToolOperationMemorySqlitePersistence({
        acquireDatabase: () => Promise.resolve(database),
      }),
    );
    await expect(restarted.hydrate()).resolves.toEqual(saved);
    expect(restarted.getSnapshot()).toMatchObject({
      phase: "ready",
      repairedCorruption: false,
      lastError: null,
    });
  });

  it("consumes the Worker-compatible async KV adapter under one stable namespace", async () => {
    const values = new Map<string, string>();
    const calls: string[] = [];
    const database = {
      asAsyncKeyValueStore(namespace: string) {
        calls.push(`namespace:${namespace}`);
        return {
          async get(key: string) {
            calls.push(`get:${key}`);
            return values.get(key) ?? null;
          },
          async set(key: string, value: string) {
            calls.push(`set:${key}`);
            values.set(key, value);
          },
          async delete() {},
        };
      },
    } as unknown as StudioLocalDatabase;
    const persistence = createStudioToolOperationMemorySqlitePersistence({
      acquireDatabase: () => Promise.resolve(database),
    });

    await persistence.load();
    await persistence.save(serializeStudioToolOperationMemory(
      normalizeStudioToolOperationMemory(null),
    ));
    expect(calls).toEqual([
      `namespace:${STUDIO_TOOL_OPERATION_MEMORY_SQLITE_NAMESPACE}`,
      `get:${STUDIO_TOOL_OPERATION_MEMORY_SQLITE_KEY}`,
      `set:${STUDIO_TOOL_OPERATION_MEMORY_SQLITE_KEY}`,
    ]);
  });

  it("fails soft to deterministic memory when SQLite is unavailable", async () => {
    const failure = new Error("OPFS SAH pool unavailable");
    const persistence: StudioToolOperationMemoryPersistencePort = {
      load: () => Promise.reject(failure),
      save: () => Promise.reject(failure),
    };
    const controller = createStudioToolOperationMemoryController(persistence);

    await expect(controller.hydrate()).resolves.toMatchObject({
      paint: { brushId: "pen" },
      erase: { brushId: "standard-eraser" },
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "degraded",
      lastError: { code: "unavailable" },
    });
    await expect(controller.save(normalizeStudioToolOperationMemory(null))).resolves.toBe(false);
    await expect(controller.flush()).resolves.toBe(false);
  });

  it("surfaces corrupt rows while retaining independent deterministic defaults", async () => {
    const save = vi.fn(() => Promise.resolve());
    const controller = createStudioToolOperationMemoryController({
      load: () => Promise.resolve("{"),
      save,
    });

    await expect(controller.hydrate()).resolves.toMatchObject({
      paint: { brushId: "pen" },
      erase: { brushId: "standard-eraser" },
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "degraded",
      dirty: true,
      lastError: { code: "corrupt" },
    });
    await expect(controller.retry()).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      dirty: false,
      lastError: null,
    });
  });

  it("retries a failed Worker-backed database acquisition instead of caching rejection", async () => {
    let acquisitions = 0;
    const store = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const persistence = createStudioToolOperationMemorySqlitePersistence({
      acquireDatabase: async () => {
        acquisitions += 1;
        if (acquisitions === 1) throw new Error("Worker chunk unavailable");
        return {
          asAsyncKeyValueStore: () => store,
        } as unknown as StudioLocalDatabase;
      },
    });

    await expect(persistence.load()).rejects.toThrow(/Worker chunk unavailable/);
    await expect(persistence.load()).resolves.toBeNull();
    expect(acquisitions).toBe(2);
  });

  it("merges a pre-hydration paint edit without erasing the persisted erase slot", async () => {
    const load = deferred<string | null>();
    const writes: string[] = [];
    const controller = createStudioToolOperationMemoryController({
      load: () => load.promise,
      save: async (serialized) => {
        writes.push(serialized);
      },
    });
    const persisted = rememberStudioToolOperationSnapshot(
      normalizeStudioToolOperationMemory(null),
      "erase",
      kneadedEraser(44),
    );
    const editedPaint = rememberStudioToolOperationSnapshot(
      controller.getSnapshot().memory,
      "paint",
      paint(22),
    );

    const saving = controller.save(editedPaint);
    load.resolve(serializeStudioToolOperationMemory(persisted));
    await expect(saving).resolves.toBe(true);

    const finalMemory = controller.getSnapshot().memory;
    expect(finalMemory.paint.strokeWidth).toBe(22);
    expect(finalMemory.erase).toMatchObject({
      brushId: "kneaded-eraser",
      strokeWidth: 44,
    });
    expect(parseStudioToolOperationMemory(writes.at(-1) ?? "").memory).toEqual(finalMemory);
  });

  it("serializes concurrent saves and guarantees that the latest memory is durable last", async () => {
    const firstWrite = deferred<void>();
    const saved: string[] = [];
    let saveCount = 0;
    const controller = createStudioToolOperationMemoryController({
      load: () => Promise.resolve(null),
      save: (serialized) => {
        saved.push(serialized);
        saveCount += 1;
        return saveCount === 1 ? firstWrite.promise : Promise.resolve();
      },
    });
    await controller.hydrate();
    const firstMemory = rememberStudioToolOperationSnapshot(
      controller.getSnapshot().memory,
      "paint",
      paint(11),
    );
    const secondMemory = rememberStudioToolOperationSnapshot(
      firstMemory,
      "paint",
      paint(33),
    );

    const firstSave = controller.save(firstMemory);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    const secondSave = controller.save(secondMemory);
    await Promise.resolve();
    expect(saved).toHaveLength(1);
    firstWrite.resolve();
    await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([true, true]);
    expect(saved).toHaveLength(2);
    expect(parseStudioToolOperationMemory(saved[1]).memory.paint.strokeWidth).toBe(33);
  });

  it("proactively coalesces active snapshot changes into one latest SQLite write", async () => {
    vi.useFakeTimers();
    try {
      const saved: string[] = [];
      const controller = createStudioToolOperationMemoryController({
        load: () => Promise.resolve(null),
        save: async (serialized) => {
          saved.push(serialized);
        },
      }, { coalesceMs: 25 });
      await controller.hydrate();
      const first = rememberStudioToolOperationSnapshot(
        controller.getSnapshot().memory,
        "paint",
        paint(12),
      );
      const second = rememberStudioToolOperationSnapshot(first, "paint", paint(24));
      const latest = rememberStudioToolOperationSnapshot(second, "paint", paint(48));

      controller.scheduleSave(first);
      controller.scheduleSave(second);
      controller.scheduleSave(latest);
      expect(controller.getSnapshot()).toMatchObject({ dirty: true, writeInFlight: false });
      await vi.advanceTimersByTimeAsync(24);
      expect(saved).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);

      expect(saved).toHaveLength(1);
      expect(parseStudioToolOperationMemory(saved[0]!).memory.paint.strokeWidth).toBe(48);
      expect(controller.getSnapshot()).toMatchObject({
        phase: "ready",
        dirty: false,
        writeInFlight: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds edits during an in-flight write to one trailing latest write", async () => {
    vi.useFakeTimers();
    try {
      const firstWrite = deferred<void>();
      const saved: string[] = [];
      const controller = createStudioToolOperationMemoryController({
        load: () => Promise.resolve(null),
        save: (serialized) => {
          saved.push(serialized);
          return saved.length === 1 ? firstWrite.promise : Promise.resolve();
        },
      }, { coalesceMs: 10 });
      await controller.hydrate();
      const first = rememberStudioToolOperationSnapshot(
        controller.getSnapshot().memory,
        "erase",
        kneadedEraser(20),
      );
      const second = rememberStudioToolOperationSnapshot(first, "erase", kneadedEraser(30));
      const latest = rememberStudioToolOperationSnapshot(second, "erase", kneadedEraser(40));

      controller.scheduleSave(first);
      await vi.advanceTimersByTimeAsync(10);
      expect(saved).toHaveLength(1);
      controller.scheduleSave(second);
      controller.scheduleSave(latest);
      await vi.advanceTimersByTimeAsync(10);
      expect(saved).toHaveLength(1);

      firstWrite.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);
      await controller.flush();
      expect(saved).toHaveLength(2);
      expect(parseStudioToolOperationMemory(saved[1]!).memory.erase.strokeWidth).toBe(40);
      expect(controller.getSnapshot().dirty).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed later save dirty and degraded until an explicit retry succeeds", async () => {
    vi.useFakeTimers();
    try {
      let rejectSave = true;
      const save = vi.fn(async () => {
        if (rejectSave) throw new Error("OPFS quota temporarily unavailable");
      });
      const controller = createStudioToolOperationMemoryController({
        load: () => Promise.resolve(null),
        save,
      }, { coalesceMs: 5 });
      const snapshots: ReturnType<typeof controller.getSnapshot>[] = [];
      controller.subscribe(() => snapshots.push(controller.getSnapshot()));
      await controller.hydrate();
      controller.scheduleSave(rememberStudioToolOperationSnapshot(
        controller.getSnapshot().memory,
        "paint",
        paint(19),
      ));
      await vi.advanceTimersByTimeAsync(5);

      expect(controller.getSnapshot()).toMatchObject({
        phase: "degraded",
        dirty: true,
        writeInFlight: false,
        lastError: { code: "unavailable" },
      });
      expect(snapshots.some(({ lastError }) => lastError !== null)).toBe(true);

      rejectSave = false;
      await expect(controller.retry()).resolves.toBe(true);
      expect(save).toHaveBeenCalledTimes(2);
      expect(controller.getSnapshot()).toMatchObject({
        phase: "ready",
        dirty: false,
        lastError: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifies subscribers for hydration, memory updates, and persistence outcomes", async () => {
    const controller = createStudioToolOperationMemoryController({
      load: () => Promise.resolve(null),
      save: () => Promise.resolve(),
    });
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    await controller.hydrate();
    await controller.save(rememberStudioToolOperationSnapshot(
      controller.getSnapshot().memory,
      "erase",
      kneadedEraser(),
    ));
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
    unsubscribe();
    await controller.save(controller.getSnapshot().memory);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("contains no browser storage fallback or source access contract", () => {
    const staticSource = readFileSync(
      new URL("./studio-tool-operation-memory.ts", import.meta.url),
      "utf8",
    );
    const persistenceSource = readFileSync(
      new URL("./studio-tool-operation-memory-sqlite.ts", import.meta.url),
      "utf8",
    );
    const runtimeSource = readFileSync(
      new URL("./studio-local-database-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(staticSource).not.toContain("local" + "Storage");
    expect(staticSource).not.toContain("indexed" + "DB");
    expect(staticSource).not.toContain("acquireStudioLocalDatabase");
    expect(staticSource).not.toContain("asAsyncKeyValueStore");
    expect(persistenceSource).toContain(
      'import type { StudioToolOperationMemory } from "./studio-tool-operation-memory"',
    );
    expect(persistenceSource).not.toMatch(
      /import\s+\{[^}]*normalizeStudioToolOperationMemory[^}]*\}\s+from\s+["']\.\/studio-tool-operation-memory["']/,
    );
    expect(persistenceSource).not.toContain("local" + "Storage");
    expect(persistenceSource).not.toContain("indexed" + "DB");
    expect(persistenceSource).not.toContain("openStudioLocalDatabase(");
    expect(persistenceSource).not.toContain('vfs: "memory"');
    expect(persistenceSource).toContain("acquireStudioLocalDatabase");
    expect(persistenceSource).toMatch(
      /import\(\s*["']\.\/studio-local-database-runtime["']\s*\)/u,
    );
    expect(persistenceSource).not.toMatch(
      /import\s+\{[\s\S]*acquireStudioLocalDatabase[\s\S]*\}\s+from\s+["']\.\/studio-local-database-runtime["']/,
    );
    expect(persistenceSource).toContain("asAsyncKeyValueStore");
    expect(persistenceSource).toContain(STUDIO_TOOL_OPERATION_MEMORY_SQLITE_NAMESPACE);
    expect(runtimeSource).toContain("acquireStudioLocalDatabase");
  });

  it("pins dynamic loading, bounded pre-load coalescing, race merge, and later warnings", () => {
    const pageSource = readStudioCuttoonEditorSource();
    const hydrationStart = pageSource.indexOf(
      'const loading = import("./studio-tool-operation-memory-sqlite")',
    );
    const hydrationEnd = pageSource.indexOf(
      "function applySavedBrush",
      hydrationStart,
    );
    const hydration = pageSource.slice(hydrationStart, hydrationEnd);

    expect(hydrationStart).toBeGreaterThan(-1);
    expect(pageSource).not.toMatch(
      /import\s+[^;]*from\s+["']\.\/studio-tool-operation-memory-sqlite["']/,
    );
    expect(hydration).toContain('"./studio-tool-operation-memory-sqlite"');
    expect(pageSource).toContain("pendingToolOperationMemorySaveRef.current = memory");
    expect(pageSource).not.toContain("pendingToolOperationMemorySavesRef");
    expect(pageSource).not.toContain(".push(memory)");
    expect(hydration).toContain("const pendingMemory = pendingToolOperationMemorySaveRef.current");
    expect(hydration).toContain("pendingToolOperationMemorySaveRef.current = null");
    expect(hydration).toContain("persistence.scheduleSave(pendingMemory)");
    expect(hydration).toContain("persistence.subscribe(() => observePersistence(persistence))");
    expect(pageSource).toContain("persistence.scheduleSave(memory)");
    expect(pageSource).toContain("areStudioToolOperationSnapshotsEqual(");
    expect(hydration).toContain("mergeHydratedStudioToolOperationMemory({");
    expect(hydration).toContain("activeSnapshot: currentBrushSnapshotRef.current");
    expect(hydration).toContain("initialMemory: initialToolOperationMemory");
    expect(pageSource).toContain(
      "const persistenceSnapshot = persistence.getSnapshot()",
    );
    expect(pageSource).toContain("const persistenceError = persistenceSnapshot.lastError");
    expect(pageSource).toContain("toolOperationMemoryErrorAnnouncedRef.current === errorKey");
    expect(pageSource).toContain(
      "const announceToolOperationMemoryPersistenceError = useEffectEvent(",
    );
    expect(pageSource).toContain("announceDrawingShortcut(");
    expect(pageSource).toContain("변경 사항을 유지하고 다시 시도할게요.");
    expect(pageSource).toContain(
      "announceToolOperationMemoryPersistenceError(persistenceError.code)",
    );
    expect(hydration).toContain("hydrationMerge.activeSnapshotDiverged");
    expect(hydration).toContain(
      "queueToolOperationMemorySaveRef.current(hydrationMerge.memory)",
    );
    expect(hydration).toContain('globalThis.addEventListener("online", retryWhenOnline)');
    expect(pageSource).toContain(
      "toolOperationMemoryDirty: toolOperationMemoryPersistenceDirty",
    );
  });
});

describe("persistence error type", () => {
  it("retains an explicit machine-readable code", () => {
    const error = new StudioToolOperationMemoryPersistenceError(
      "unavailable",
      "offline",
    );
    expect(error).toMatchObject({
      name: "StudioToolOperationMemoryPersistenceError",
      code: "unavailable",
      message: "offline",
    });
  });
});
