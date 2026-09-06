import {
  DEFAULT_STUDIO_PRO_DRAW_PREFS,
  normalizeStudioProDrawPrefs,
  type StudioProDrawPrefs,
} from "./studio-pro-draw-prefs";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

async function acquireStudioProDrawDatabase() {
  const { acquireStudioLocalDatabase } = await import("./studio-local-database-runtime");
  return acquireStudioLocalDatabase();
}

export const STUDIO_PRO_DRAW_PREFERENCES_SQLITE_NAMESPACE =
  "studio-pro-draw-preferences-v12";
export const STUDIO_PRO_DRAW_PREFERENCES_SQLITE_KEY = "snapshot";
export const STUDIO_PRO_DRAW_PREFERENCES_BROADCAST_CHANNEL =
  "toonspectrum-studio-pro-draw-preferences-v12";

const ENVELOPE_VERSION = 1;
const MAX_WRITER_ID_LENGTH = 160;
const MAX_INTENT_ID_LENGTH = 220;
const MAX_APPLIED_INTENT_IDS = 128;
const MAX_STALE_RETRIES = 8;

export interface StudioProDrawPreferenceSnapshot {
  readonly prefs: StudioProDrawPrefs;
  readonly revision: number;
  readonly writerId: string | null;
  readonly appliedIntentIds: readonly string[];
  readonly persisted: boolean;
  readonly malformed: boolean;
}

export interface StudioProDrawPreferenceSaveInput {
  readonly expectedRevision: number;
  readonly writerId: string;
  readonly intentIds: readonly string[];
  readonly prefs: StudioProDrawPrefs;
}

export interface StudioProDrawPreferencesRepository {
  readonly authority: "sqlite-opfs";
  load(): Promise<StudioProDrawPreferenceSnapshot>;
  save(input: StudioProDrawPreferenceSaveInput): Promise<StudioProDrawPreferenceSnapshot>;
  flush(): Promise<void>;
}

export type StudioProDrawExclusiveRunner = <T>(
  operation: () => Promise<T>,
) => Promise<T>;

export interface StudioProDrawPreferencesRepositoryOptions {
  runExclusive?: StudioProDrawExclusiveRunner;
}

export class StudioProDrawStaleRevisionError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `studio pro draw preferences revision changed: expected ${expectedRevision}, ` +
        `actual ${actualRevision}`,
    );
    this.name = "StudioProDrawStaleRevisionError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function immutablePrefs(value: unknown): StudioProDrawPrefs {
  const normalized = normalizeStudioProDrawPrefs(value);
  const prefs: StudioProDrawPrefs = {
    ...normalized,
    recentBrushIds: [...normalized.recentBrushIds],
    favoriteBrushIds: [...normalized.favoriteBrushIds],
    brushLibraryView: {
      paint: { ...normalized.brushLibraryView.paint },
      erase: { ...normalized.brushLibraryView.erase },
    },
  };
  Object.freeze(prefs.recentBrushIds);
  Object.freeze(prefs.favoriteBrushIds);
  Object.freeze(prefs.brushLibraryView.paint);
  Object.freeze(prefs.brushLibraryView.erase);
  Object.freeze(prefs.brushLibraryView);
  return Object.freeze(prefs);
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function validBoundedId(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function normalizeIntentIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!validBoundedId(entry, MAX_INTENT_ID_LENGTH) || seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
  }
  return Object.freeze(ids.slice(-MAX_APPLIED_INTENT_IDS));
}

function emptySnapshot(persisted = false, malformed = false): StudioProDrawPreferenceSnapshot {
  return Object.freeze({
    prefs: immutablePrefs(DEFAULT_STUDIO_PRO_DRAW_PREFS),
    revision: 0,
    writerId: null,
    appliedIntentIds: Object.freeze([]),
    persisted,
    malformed,
  });
}

export function parseStudioProDrawPreferenceSnapshot(
  raw: string | null,
): StudioProDrawPreferenceSnapshot {
  if (raw === null) return emptySnapshot();
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") return emptySnapshot(true, true);
    const record = value as Record<string, unknown>;
    if (
      record.v !== ENVELOPE_VERSION
      || !validRevision(record.revision)
      || !validBoundedId(record.writerId, MAX_WRITER_ID_LENGTH)
      || !("prefs" in record)
    ) {
      return emptySnapshot(true, true);
    }
    return Object.freeze({
      prefs: immutablePrefs(record.prefs),
      revision: record.revision,
      writerId: record.writerId,
      appliedIntentIds: normalizeIntentIds(record.appliedIntentIds),
      persisted: true,
      malformed: false,
    });
  } catch {
    return emptySnapshot(true, true);
  }
}

function serializeSnapshot(
  revision: number,
  writerId: string,
  intentIds: readonly string[],
  prefs: StudioProDrawPrefs,
): string {
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    revision,
    writerId,
    appliedIntentIds: normalizeIntentIds(intentIds),
    prefs: normalizeStudioProDrawPrefs(prefs),
  });
}

async function defaultExclusiveRunner<T>(operation: () => Promise<T>): Promise<T> {
  const manager = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!manager) return operation();
  return manager.request(
    STUDIO_PRO_DRAW_PREFERENCES_BROADCAST_CHANNEL,
    { mode: "exclusive" },
    operation,
  );
}

/**
 * SQLite/OPFS repository with an optimistic revision fence. Web Locks makes the read/check/write
 * region cross-tab atomic on supporting browsers; the before/after reads remain mandatory so a
 * stale caller is rejected explicitly even when Web Locks is unavailable or test-injected.
 */
export function createStudioProDrawPreferencesRepository(
  store: StudioAsyncKeyValueStore,
  options: StudioProDrawPreferencesRepositoryOptions = {},
): StudioProDrawPreferencesRepository {
  const runExclusive = options.runExclusive ?? defaultExclusiveRunner;
  let writeTail: Promise<void> = Promise.resolve();

  async function load(): Promise<StudioProDrawPreferenceSnapshot> {
    return parseStudioProDrawPreferenceSnapshot(
      await store.get(STUDIO_PRO_DRAW_PREFERENCES_SQLITE_KEY),
    );
  }

  return Object.freeze({
    authority: "sqlite-opfs" as const,
    load,
    save(input: StudioProDrawPreferenceSaveInput) {
      if (!validRevision(input.expectedRevision)) {
        return Promise.reject(new RangeError("expectedRevision must be a non-negative safe integer"));
      }
      if (!validBoundedId(input.writerId, MAX_WRITER_ID_LENGTH)) {
        return Promise.reject(new RangeError("writerId must be a bounded non-empty string"));
      }
      const operation = writeTail
        .catch(() => undefined)
        .then(() => runExclusive(async () => {
          const current = await load();
          if (current.revision !== input.expectedRevision) {
            throw new StudioProDrawStaleRevisionError(
              input.expectedRevision,
              current.revision,
            );
          }
          const revision = input.expectedRevision + 1;
          const appliedIntentIds = normalizeIntentIds([
            ...current.appliedIntentIds,
            ...input.intentIds,
          ]);
          await store.set(
            STUDIO_PRO_DRAW_PREFERENCES_SQLITE_KEY,
            serializeSnapshot(revision, input.writerId, appliedIntentIds, input.prefs),
          );
          const verified = await load();
          if (verified.revision !== revision || verified.writerId !== input.writerId) {
            throw new StudioProDrawStaleRevisionError(revision, verified.revision);
          }
          return verified;
        }));
      writeTail = operation.then(() => undefined, () => undefined);
      return operation;
    },
    flush: () => writeTail,
  });
}

let sharedRepository: Promise<StudioProDrawPreferencesRepository> | null = null;

export async function acquireProductStudioProDrawPreferencesRepository(): Promise<
  StudioProDrawPreferencesRepository
> {
  sharedRepository ??= acquireStudioProDrawDatabase().then((database) =>
    createStudioProDrawPreferencesRepository(
      database.asAsyncKeyValueStore(STUDIO_PRO_DRAW_PREFERENCES_SQLITE_NAMESPACE),
    ));
  try {
    return await sharedRepository;
  } catch (cause) {
    sharedRepository = null;
    throw cause;
  }
}

/** Test/session seam; the shared SQLite handle remains owned by the app runtime. */
export function resetStudioProDrawPreferencesRepositoryForTests(): void {
  sharedRepository = null;
}

export type StudioProDrawPersistenceState =
  | "hydrating"
  | "saving"
  | "durable"
  | "memory-only";

export interface StudioProDrawRuntimeSnapshot {
  readonly authority: "sqlite-opfs";
  readonly prefs: StudioProDrawPrefs;
  readonly state: StudioProDrawPersistenceState;
  readonly durable: boolean;
  readonly revision: number;
  readonly message: string | null;
  readonly cause: unknown;
}

export type StudioProDrawPreferenceMutation = (
  latest: StudioProDrawPrefs,
) => StudioProDrawPrefs;

export interface StudioProDrawRuntimeMutationResult {
  readonly prefs: StudioProDrawPrefs;
  /** A newly accepted mutation is never reported durable before its async SQLite commit finishes. */
  readonly persisted: false;
  readonly persistence: Promise<boolean>;
}

export interface StudioProDrawBroadcastChannelLike {
  postMessage(value: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

export interface StudioProDrawPreferenceRuntimeOptions {
  acquireRepository?: () => Promise<StudioProDrawPreferencesRepository>;
  createChannel?: (name: string) => StudioProDrawBroadcastChannelLike | null;
  writerId?: string;
}

export interface StudioProDrawPreferenceRuntime {
  getSnapshot(): StudioProDrawRuntimeSnapshot;
  subscribe(listener: () => void): () => void;
  activate(): void;
  deactivate(): void;
  hydrate(): Promise<boolean>;
  retry(): Promise<boolean>;
  mutate(mutation: StudioProDrawPreferenceMutation): StudioProDrawRuntimeMutationResult;
  refresh(): Promise<boolean>;
  dispose(): void;
}

interface PendingIntent {
  readonly id: string;
  readonly mutate: StudioProDrawPreferenceMutation;
  settled: boolean;
  resolve(persisted: boolean): void;
}

interface CommittedIntent {
  readonly id: string;
  readonly mutate: StudioProDrawPreferenceMutation;
  readonly revision: number;
}

interface StudioProDrawBroadcastMessage {
  readonly v: 1;
  readonly type: "changed";
  readonly revision: number;
  readonly writerId: string;
}

function defaultWriterId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `pro-draw:${randomId}`;
  return `pro-draw:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function defaultChannelFactory(name: string): StudioProDrawBroadcastChannelLike | null {
  // 존재는 생성 가능성이 아니다. 스토리지가 분할된 인앱 WebView(인스타그램 iOS, DOM 저장소를
  // 끈 안드로이드 WebView)는 BroadcastChannel 생성자를 노출한 채 `new` 에서 SecurityError 를
  // 던진다. typeof 검사만으로는 그 throw 를 막지 못한다 —
  // studio-workspace-sqlite-runtime.ts 의 createProductChannel 이 같은 이유로 try 안에 있다.
  try {
    if (typeof BroadcastChannel !== "function") return null;
    return new BroadcastChannel(name);
  } catch {
    // 탭 간 동기화만 잃는다. 설정 자체는 이 탭에서 그대로 동작한다.
    return null;
  }
}

function persistenceFailureMessage(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return (
    "SQLite/OPFS에 Pro Draw 설정을 저장하지 못했습니다. 현재 탭 메모리에서만 " +
    `유지되며 새로고침하면 사라집니다: ${detail}`
  );
}

function validBroadcastMessage(value: unknown): value is StudioProDrawBroadcastMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.v === 1
    && record.type === "changed"
    && validRevision(record.revision)
    && validBoundedId(record.writerId, MAX_WRITER_ID_LENGTH);
}

function applyIntents(
  prefs: StudioProDrawPrefs,
  intents: readonly Pick<PendingIntent, "mutate">[],
): StudioProDrawPrefs {
  let next = immutablePrefs(prefs);
  for (const intent of intents) next = immutablePrefs(intent.mutate(next));
  return next;
}

/**
 * Async preference state machine used by the React hook. Artist edits are retained as intents,
 * not only as a flattened object, so late hydration and revision conflicts can replay them over
 * the newest durable snapshot without dropping another tab's independent changes.
 */
export function createStudioProDrawPreferenceRuntime(
  options: StudioProDrawPreferenceRuntimeOptions = {},
): StudioProDrawPreferenceRuntime {
  const acquireRepository =
    options.acquireRepository ?? acquireProductStudioProDrawPreferencesRepository;
  const createChannel = options.createChannel ?? defaultChannelFactory;
  const writerId = options.writerId ?? defaultWriterId();
  if (!validBoundedId(writerId, MAX_WRITER_ID_LENGTH)) {
    throw new RangeError("writerId must be a bounded non-empty string");
  }

  const listeners = new Set<() => void>();
  const pending: PendingIntent[] = [];
  const committed = new Map<string, CommittedIntent>();
  let repository: StudioProDrawPreferencesRepository | null = null;
  let channel: StudioProDrawBroadcastChannelLike | null = null;
  let activeConsumers = 0;
  let intentSequence = 0;
  let hydrationPromise: Promise<boolean> | null = null;
  let flushPromise: Promise<boolean> | null = null;
  let refreshPromise: Promise<boolean> | null = null;
  let disposed = false;
  let snapshot: StudioProDrawRuntimeSnapshot = Object.freeze({
    authority: "sqlite-opfs" as const,
    prefs: immutablePrefs(DEFAULT_STUDIO_PRO_DRAW_PREFS),
    state: "hydrating" as const,
    durable: false,
    revision: 0,
    message: null,
    cause: null,
  });

  function publish(
    prefs: StudioProDrawPrefs,
    state: StudioProDrawPersistenceState,
    revision = snapshot.revision,
    message: string | null = null,
    cause: unknown = null,
  ): void {
    snapshot = Object.freeze({
      authority: "sqlite-opfs" as const,
      prefs: immutablePrefs(prefs),
      state,
      durable: state === "durable",
      revision,
      message,
      cause,
    });
    for (const listener of [...listeners]) listener();
  }

  function settle(intent: PendingIntent, persisted: boolean): void {
    if (intent.settled) return;
    intent.settled = true;
    intent.resolve(persisted);
  }

  function settlePendingAsMemoryOnly(): void {
    for (const intent of pending) settle(intent, false);
  }

  function rememberCommitted(batch: readonly PendingIntent[], revision: number): void {
    for (const intent of batch) {
      committed.delete(intent.id);
      committed.set(intent.id, { id: intent.id, mutate: intent.mutate, revision });
    }
    while (committed.size > MAX_APPLIED_INTENT_IDS / 2) {
      const oldest = committed.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      committed.delete(oldest);
    }
  }

  function missingCommittedIntents(
    durable: StudioProDrawPreferenceSnapshot,
  ): CommittedIntent[] {
    const applied = new Set(durable.appliedIntentIds);
    const alreadyPending = new Set(pending.map((intent) => intent.id));
    return [...committed.values()].filter(
      (intent) => !applied.has(intent.id) && !alreadyPending.has(intent.id),
    );
  }

  function requeueCommitted(intents: readonly CommittedIntent[]): void {
    for (const committedIntent of intents) {
      pending.push({
        id: committedIntent.id,
        mutate: committedIntent.mutate,
        settled: true,
        resolve: () => undefined,
      });
    }
  }

  function notifyPeers(revision: number): void {
    channel?.postMessage({
      v: 1,
      type: "changed",
      revision,
      writerId,
    } satisfies StudioProDrawBroadcastMessage);
  }

  function enterMemoryOnly(cause: unknown): false {
    settlePendingAsMemoryOnly();
    publish(
      snapshot.prefs,
      "memory-only",
      snapshot.revision,
      persistenceFailureMessage(cause),
      cause,
    );
    return false;
  }

  function startFlush(): Promise<boolean> {
    if (flushPromise) return flushPromise;
    if (!repository) return Promise.resolve(false);
    const targetRepository = repository;
    flushPromise = (async () => {
      let staleAttempts = 0;
      while (!disposed && repository === targetRepository && pending.length > 0) {
        const batch = [...pending];
        try {
          const durable = await targetRepository.load();
          const recovered = missingCommittedIntents(durable);
          if (recovered.length > 0) {
            requeueCommitted(recovered);
            batch.push(...pending.slice(batch.length));
          }
          const nextPrefs = applyIntents(durable.prefs, batch);
          publish(nextPrefs, "saving", durable.revision);
          const saved = await targetRepository.save({
            expectedRevision: durable.revision,
            writerId,
            intentIds: batch.map((intent) => intent.id),
            prefs: nextPrefs,
          });
          staleAttempts = 0;
          const savedIds = new Set(batch.map((intent) => intent.id));
          for (let index = pending.length - 1; index >= 0; index -= 1) {
            const intent = pending[index];
            if (intent && savedIds.has(intent.id)) pending.splice(index, 1);
          }
          rememberCommitted(batch, saved.revision);
          for (const intent of batch) settle(intent, true);
          const visible = applyIntents(saved.prefs, pending);
          publish(visible, pending.length > 0 ? "saving" : "durable", saved.revision);
          notifyPeers(saved.revision);
        } catch (cause) {
          if (cause instanceof StudioProDrawStaleRevisionError) {
            staleAttempts += 1;
            if (staleAttempts <= MAX_STALE_RETRIES) continue;
          }
          return enterMemoryOnly(cause);
        }
      }
      return pending.length === 0 && snapshot.state === "durable";
    })().finally(() => {
      flushPromise = null;
      if (
        !disposed
        && repository === targetRepository
        && pending.length > 0
        && snapshot.state !== "memory-only"
      ) {
        queueMicrotask(() => {
          if (!flushPromise) void startFlush();
        });
      }
    });
    return flushPromise;
  }

  function startHydration(retryMemoryOnly: boolean): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (snapshot.state === "durable" && pending.length === 0) return Promise.resolve(true);
    if (hydrationPromise) return hydrationPromise;
    if (flushPromise) return flushPromise;
    if (snapshot.state === "memory-only" && !retryMemoryOnly) return Promise.resolve(false);
    publish(snapshot.prefs, "hydrating", snapshot.revision);
    hydrationPromise = (async () => {
      try {
        repository ??= await acquireRepository();
        const durable = await repository.load();
        const recovered = missingCommittedIntents(durable);
        if (recovered.length > 0) requeueCommitted(recovered);
        const visible = applyIntents(durable.prefs, pending);
        publish(
          visible,
          pending.length > 0 ? "saving" : "durable",
          durable.revision,
        );
        if (pending.length > 0) return startFlush();
        return true;
      } catch (cause) {
        repository = null;
        return enterMemoryOnly(cause);
      } finally {
        hydrationPromise = null;
      }
    })();
    return hydrationPromise;
  }

  function refresh(): Promise<boolean> {
    if (disposed || !repository) return Promise.resolve(false);
    if (refreshPromise) return refreshPromise;
    const targetRepository = repository;
    refreshPromise = (async () => {
      try {
        const durable = await targetRepository.load();
        const recovered = missingCommittedIntents(durable);
        if (recovered.length > 0) requeueCommitted(recovered);
        const visible = applyIntents(durable.prefs, pending);
        publish(
          visible,
          pending.length > 0 ? "saving" : "durable",
          durable.revision,
        );
        if (pending.length > 0) return startFlush();
        return true;
      } catch (cause) {
        return enterMemoryOnly(cause);
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  const onBroadcast = (event: MessageEvent<unknown>): void => {
    if (!validBroadcastMessage(event.data) || event.data.writerId === writerId) return;
    void refresh();
  };

  function openChannel(): void {
    if (channel || disposed) return;
    channel = createChannel(STUDIO_PRO_DRAW_PREFERENCES_BROADCAST_CHANNEL);
    channel?.addEventListener("message", onBroadcast);
  }

  function closeChannel(): void {
    if (!channel) return;
    channel.removeEventListener("message", onBroadcast);
    channel.close();
    channel = null;
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activate() {
      if (disposed) return;
      activeConsumers += 1;
      openChannel();
    },
    deactivate() {
      activeConsumers = Math.max(0, activeConsumers - 1);
      if (activeConsumers === 0) closeChannel();
    },
    hydrate: () => startHydration(false),
    retry: () => startHydration(true),
    mutate(mutation: StudioProDrawPreferenceMutation) {
      const id = `${writerId}:${++intentSequence}`;
      let resolvePersistence!: (persisted: boolean) => void;
      const persistence = new Promise<boolean>((resolve) => {
        resolvePersistence = resolve;
      });
      const intent: PendingIntent = {
        id,
        mutate: mutation,
        settled: false,
        resolve: resolvePersistence,
      };
      pending.push(intent);
      const prefs = immutablePrefs(mutation(snapshot.prefs));
      publish(
        prefs,
        snapshot.state === "memory-only"
          ? "memory-only"
          : repository
            ? "saving"
            : "hydrating",
        snapshot.revision,
        snapshot.state === "memory-only" ? snapshot.message : null,
        snapshot.state === "memory-only" ? snapshot.cause : null,
      );
      if (disposed || snapshot.state === "memory-only") {
        settle(intent, false);
      } else if (hydrationPromise) {
        // The hydration owner replays every pending intent after its SQLite read settles.
      } else if (repository) {
        void startFlush();
      } else {
        void startHydration(false);
      }
      return Object.freeze({ prefs, persisted: false as const, persistence });
    },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      closeChannel();
      activeConsumers = 0;
      settlePendingAsMemoryOnly();
      listeners.clear();
    },
  });
}
