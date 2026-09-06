import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  sanitizeBrushSnapshot,
  type StudioBrushSnapshot,
} from "./brush/studio-brush-library";
import {
  resolveStudioBrushPresetOperation,
  type StudioToolOperation,
} from "./studio-brush";

import type {
  StudioAsyncKeyValueStore,
  StudioLocalDatabase,
} from "./studio-local-database";
import type { StudioToolOperationMemory } from "./studio-tool-operation-memory";

export const STUDIO_TOOL_OPERATION_MEMORY_SQLITE_NAMESPACE =
  "studio-tool-operation-memory-v12";
export const STUDIO_TOOL_OPERATION_MEMORY_SQLITE_KEY = "profile-v1";
export const STUDIO_TOOL_OPERATION_MEMORY_SCHEMA =
  "toonspectrum.studio.tool-operation-memory";
export const STUDIO_TOOL_OPERATION_MEMORY_COALESCE_MS = 250;
const PERSISTED_STUDIO_TOOL_OPERATION_MEMORY_VERSION = 1 as const;

const PERSISTED_DEFAULT_STANDARD_ERASER_SNAPSHOT: StudioBrushSnapshot = {
  ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  brushId: "standard-eraser",
  strokeWidth: 20,
  brushOpacity: 1,
  stampTuning: null,
};

interface NormalizedPersistenceSnapshot {
  readonly snapshot: StudioBrushSnapshot;
  readonly repaired: boolean;
}

function normalizePersistenceSnapshot(
  raw: unknown,
  operation: StudioToolOperation,
): NormalizedPersistenceSnapshot {
  const { snapshot, adjustedFields } = sanitizeBrushSnapshot(raw);
  if (resolveStudioBrushPresetOperation(snapshot.brushId) !== operation) {
    return {
      snapshot: operation === "erase"
        ? { ...PERSISTED_DEFAULT_STANDARD_ERASER_SNAPSHOT }
        : { ...DEFAULT_STUDIO_BRUSH_SNAPSHOT },
      repaired: true,
    };
  }
  return { snapshot, repaired: adjustedFields.length > 0 };
}

function normalizePersistenceMemory(value: unknown): StudioToolOperationMemory {
  const record = objectRecord(value) ?? {};
  return {
    version: PERSISTED_STUDIO_TOOL_OPERATION_MEMORY_VERSION,
    paint: normalizePersistenceSnapshot(record.paint, "paint").snapshot,
    erase: normalizePersistenceSnapshot(record.erase, "erase").snapshot,
  };
}

interface PersistedStudioToolOperationMemory extends StudioToolOperationMemory {
  readonly schema: typeof STUDIO_TOOL_OPERATION_MEMORY_SCHEMA;
}

export type StudioToolOperationMemoryPersistenceErrorCode =
  | "corrupt"
  | "unavailable";

export class StudioToolOperationMemoryPersistenceError extends Error {
  readonly code: StudioToolOperationMemoryPersistenceErrorCode;

  constructor(
    code: StudioToolOperationMemoryPersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioToolOperationMemoryPersistenceError";
    this.code = code;
  }
}

interface ParsedStudioToolOperationMemory {
  readonly memory: StudioToolOperationMemory;
  readonly repaired: boolean;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseStudioToolOperationMemory(
  raw: string,
): ParsedStudioToolOperationMemory {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (cause) {
    throw new StudioToolOperationMemoryPersistenceError(
      "corrupt",
      "도구 작업 메모리 SQLite 행이 유효한 JSON이 아닙니다.",
      { cause },
    );
  }
  const record = objectRecord(decoded);
  if (
    record === null
    || record.schema !== STUDIO_TOOL_OPERATION_MEMORY_SCHEMA
    || record.version !== PERSISTED_STUDIO_TOOL_OPERATION_MEMORY_VERSION
  ) {
    throw new StudioToolOperationMemoryPersistenceError(
      "corrupt",
      "도구 작업 메모리 SQLite 행의 스키마 또는 버전이 올바르지 않습니다.",
    );
  }
  const paint = normalizePersistenceSnapshot(record.paint, "paint");
  const erase = normalizePersistenceSnapshot(record.erase, "erase");
  return {
    memory: {
      version: PERSISTED_STUDIO_TOOL_OPERATION_MEMORY_VERSION,
      paint: paint.snapshot,
      erase: erase.snapshot,
    },
    repaired: paint.repaired || erase.repaired,
  };
}

export function serializeStudioToolOperationMemory(
  memory: StudioToolOperationMemory,
): string {
  const normalized = normalizePersistenceMemory(memory);
  return JSON.stringify({
    schema: STUDIO_TOOL_OPERATION_MEMORY_SCHEMA,
    ...normalized,
  } satisfies PersistedStudioToolOperationMemory);
}

export interface StudioToolOperationMemoryPersistencePort {
  load(): Promise<string | null>;
  save(serialized: string): Promise<void>;
}

export interface StudioToolOperationMemorySqlitePersistenceOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

/**
 * Adapts the app-lifetime Worker-backed SQLite authority to this small domain port.
 * There is intentionally no second durable backend: an unavailable database leaves the
 * controller usable in memory and reports the failure through its snapshot.
 */
export function createStudioToolOperationMemorySqlitePersistence(
  options: StudioToolOperationMemorySqlitePersistenceOptions = {},
): StudioToolOperationMemoryPersistencePort {
  const acquireDatabase = options.acquireDatabase ?? (async () => {
    const { acquireStudioLocalDatabase } = await import("./studio-local-database-runtime"
    );
    return acquireStudioLocalDatabase();
  });
  let store: Promise<StudioAsyncKeyValueStore> | null = null;

  function resolveStore(): Promise<StudioAsyncKeyValueStore> {
    if (store === null) {
      const acquisition = acquireDatabase().then((database) =>
        database.asAsyncKeyValueStore(STUDIO_TOOL_OPERATION_MEMORY_SQLITE_NAMESPACE));
      store = acquisition;
      void acquisition.catch(() => {
        if (store === acquisition) store = null;
      });
    }
    return store;
  }

  return {
    async load() {
      return (await resolveStore()).get(STUDIO_TOOL_OPERATION_MEMORY_SQLITE_KEY);
    },
    async save(serialized) {
      await (await resolveStore()).set(
        STUDIO_TOOL_OPERATION_MEMORY_SQLITE_KEY,
        serialized,
      );
    },
  };
}

export type StudioToolOperationMemoryPersistencePhase =
  | "idle"
  | "hydrating"
  | "ready"
  | "degraded";

export interface StudioToolOperationMemoryControllerSnapshot {
  readonly memory: StudioToolOperationMemory;
  readonly phase: StudioToolOperationMemoryPersistencePhase;
  readonly repairedCorruption: boolean;
  readonly lastError: StudioToolOperationMemoryPersistenceError | null;
  /** True until the latest normalized snapshot has a successful SQLite receipt. */
  readonly dirty: boolean;
  readonly writeInFlight: boolean;
}

export interface StudioToolOperationMemoryController {
  getSnapshot(): StudioToolOperationMemoryControllerSnapshot;
  subscribe(listener: () => void): () => void;
  hydrate(): Promise<StudioToolOperationMemory>;
  /** Synchronous, bounded latest-value scheduling for active property changes. */
  scheduleSave(memory: StudioToolOperationMemory): void;
  /** Explicit immediate persistence. Concurrent calls share one bounded flush. */
  save(memory: StudioToolOperationMemory): Promise<boolean>;
  /** Retries the current dirty snapshot without creating another queue entry. */
  retry(): Promise<boolean>;
  flush(): Promise<boolean>;
}

export interface StudioToolOperationMemoryControllerOptions {
  readonly coalesceMs?: number;
}

function unavailablePersistenceError(
  operation: "읽기" | "저장",
  cause: unknown,
): StudioToolOperationMemoryPersistenceError {
  if (cause instanceof StudioToolOperationMemoryPersistenceError) return cause;
  return new StudioToolOperationMemoryPersistenceError(
    "unavailable",
    `도구 작업 메모리 SQLite ${operation}를 완료하지 못했습니다: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
    { cause },
  );
}

function snapshotChanged(
  left: StudioBrushSnapshot,
  right: StudioBrushSnapshot,
): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export function createStudioToolOperationMemoryController(
  persistence: StudioToolOperationMemoryPersistencePort,
  options: StudioToolOperationMemoryControllerOptions = {},
): StudioToolOperationMemoryController {
  const coalesceMs = options.coalesceMs
    ?? STUDIO_TOOL_OPERATION_MEMORY_COALESCE_MS;
  if (!Number.isFinite(coalesceMs) || coalesceMs < 0) {
    throw new RangeError(`coalesceMs must be finite and non-negative, got ${coalesceMs}`);
  }
  const listeners = new Set<() => void>();
  const dirtyBeforeHydration = new Set<StudioToolOperation>();
  let snapshot: StudioToolOperationMemoryControllerSnapshot = {
    memory: normalizePersistenceMemory(null),
    phase: "idle",
    repairedCorruption: false,
    lastError: null,
    dirty: false,
    writeInFlight: false,
  };
  let hydration: Promise<StudioToolOperationMemory> | null = null;
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  let persistPromise: Promise<boolean> | null = null;
  let flushPromise: Promise<boolean> | null = null;
  let lastPersistSucceeded = true;
  let memoryRevision = 0;
  let durableRevision = 0;

  function publish(
    next: StudioToolOperationMemoryControllerSnapshot,
  ): StudioToolOperationMemoryControllerSnapshot {
    snapshot = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Observers cannot turn a valid in-memory transition into a persistence failure.
      }
    }
    return next;
  }

  function hydrate(): Promise<StudioToolOperationMemory> {
    hydration ??= (async () => {
      publish({ ...snapshot, phase: "hydrating", lastError: null });
      try {
        const raw = await persistence.load();
        let persisted = normalizePersistenceMemory(null);
        let repairedCorruption = false;
        let parseError: StudioToolOperationMemoryPersistenceError | null = null;
        if (raw !== null) {
          try {
            const parsed = parseStudioToolOperationMemory(raw);
            persisted = parsed.memory;
            repairedCorruption = parsed.repaired;
            if (parsed.repaired) {
              parseError = new StudioToolOperationMemoryPersistenceError(
                "corrupt",
                "도구 작업 메모리 SQLite 행의 일부 슬롯을 독립 기본값으로 복구했습니다.",
              );
            }
          } catch (error) {
            parseError = unavailablePersistenceError("읽기", error);
          }
        }
        const memory = normalizePersistenceMemory({
          paint: dirtyBeforeHydration.has("paint")
            ? snapshot.memory.paint
            : persisted.paint,
          erase: dirtyBeforeHydration.has("erase")
            ? snapshot.memory.erase
            : persisted.erase,
        });
        let dirty = snapshot.dirty;
        if (repairedCorruption || parseError?.code === "corrupt") {
          memoryRevision += 1;
          dirty = true;
        } else if (!dirty) {
          durableRevision = memoryRevision;
        }
        lastPersistSucceeded = parseError === null;
        publish({
          memory,
          phase: parseError === null ? "ready" : "degraded",
          repairedCorruption:
            repairedCorruption || parseError?.code === "corrupt",
          lastError: parseError,
          dirty,
          writeInFlight: false,
        });
        return memory;
      } catch (error) {
        const lastError = unavailablePersistenceError("읽기", error);
        lastPersistSucceeded = false;
        publish({
          ...snapshot,
          phase: "degraded",
          lastError,
        });
        hydration = null;
        return snapshot.memory;
      }
    })();
    return hydration;
  }

  function markDirty(memory: StudioToolOperationMemory): void {
    const normalized = normalizePersistenceMemory(memory);
    const paintChanged = snapshotChanged(snapshot.memory.paint, normalized.paint);
    const eraseChanged = snapshotChanged(snapshot.memory.erase, normalized.erase);
    if (snapshot.phase === "idle" || snapshot.phase === "hydrating") {
      if (paintChanged) {
        dirtyBeforeHydration.add("paint");
      }
      if (eraseChanged) {
        dirtyBeforeHydration.add("erase");
      }
    }
    if (paintChanged || eraseChanged) memoryRevision += 1;
    publish({
      ...snapshot,
      memory: normalized,
      dirty: snapshot.dirty || paintChanged || eraseChanged,
    });
  }

  function clearCoalesceTimer(): void {
    if (coalesceTimer === null) return;
    globalThis.clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }

  function armCoalescedWrite(): void {
    if (!snapshot.dirty || coalesceTimer !== null) return;
    coalesceTimer = globalThis.setTimeout(() => {
      coalesceTimer = null;
      void persistLatest();
    }, coalesceMs);
  }

  function persistLatest(): Promise<boolean> {
    if (persistPromise !== null) return persistPromise;
    persistPromise = (async (): Promise<boolean> => {
      await hydrate();
      if (!snapshot.dirty) return true;
      const targetRevision = memoryRevision;
      const targetMemory = snapshot.memory;
      publish({ ...snapshot, writeInFlight: true });
      try {
        await persistence.save(serializeStudioToolOperationMemory(targetMemory));
        durableRevision = Math.max(durableRevision, targetRevision);
        lastPersistSucceeded = true;
        const dirty = memoryRevision > durableRevision;
        publish({
          ...snapshot,
          phase: "ready",
          repairedCorruption: false,
          lastError: null,
          dirty,
          writeInFlight: false,
        });
        if (dirty) armCoalescedWrite();
        else clearCoalesceTimer();
        return true;
      } catch (error) {
        lastPersistSucceeded = false;
        publish({
          ...snapshot,
          phase: "degraded",
          lastError: unavailablePersistenceError("저장", error),
          dirty: true,
          writeInFlight: false,
        });
        return false;
      }
    })().finally(() => {
      persistPromise = null;
    });
    return persistPromise;
  }

  function flush(): Promise<boolean> {
    if (flushPromise !== null) return flushPromise;
    clearCoalesceTimer();
    flushPromise = (async (): Promise<boolean> => {
      while (snapshot.dirty) {
        const success = await persistLatest();
        if (!success) return false;
      }
      return lastPersistSucceeded;
    })().finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  }

  async function retry(): Promise<boolean> {
    if (snapshot.phase === "degraded" && hydration === null) {
      await hydrate();
    }
    return snapshot.dirty ? flush() : lastPersistSucceeded;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate,
    scheduleSave(memory) {
      markDirty(memory);
      armCoalescedWrite();
    },
    save(memory) {
      markDirty(memory);
      return flush();
    },
    retry,
    flush,
  };
}

let productController: StudioToolOperationMemoryController | null = null;

export function getProductStudioToolOperationMemoryController():
StudioToolOperationMemoryController {
  productController ??= createStudioToolOperationMemoryController(
    createStudioToolOperationMemorySqlitePersistence(),
  );
  return productController;
}
