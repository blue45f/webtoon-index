import {
  parseStudioCompanionWindowLayout,
  type StudioCompanionWindowLayoutSurface,
  type StudioCompanionWindowLayoutV1,
} from "./studio-companion-window-layout";
import {
  createStudioCompanionCommandId,
  createStudioCompanionInstanceId,
  isStudioCompanionSessionId,
} from "./studio-tools-companion";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

async function acquireStudioCompanionWindowDatabase() {
  const { acquireStudioLocalDatabase } = await import("./studio-local-database-runtime");
  return acquireStudioLocalDatabase();
}

export const STUDIO_COMPANION_WINDOW_PREFERENCES_SQLITE_NAMESPACE =
  "studio-companion-window-preferences-v1";
export const STUDIO_COMPANION_WINDOW_PREFERENCES_CHANNEL =
  "toonspectrum.studio.companion-window-preferences.v1";

const SNAPSHOT_KIND = "toonspectrum.studio.companion-window-preferences" as const;
const SNAPSHOT_VERSION = 1 as const;
const MESSAGE_TYPE = "studio-companion-window-preferences" as const;
let fallbackIdentitySequence = 0;

export interface StudioCompanionWindowPreferenceSnapshot {
  readonly kind: typeof SNAPSHOT_KIND;
  readonly version: typeof SNAPSHOT_VERSION;
  readonly surface: StudioCompanionWindowLayoutSurface;
  readonly revision: number;
  readonly writerInstanceId: string;
  readonly mutationId: string;
  readonly rememberEnabled: boolean;
  readonly layout: StudioCompanionWindowLayoutV1 | null;
}

export interface StudioCompanionWindowPreferenceSaveResult {
  readonly accepted: boolean;
  readonly snapshot: StudioCompanionWindowPreferenceSnapshot;
}

export interface StudioCompanionWindowPreferencesRepository {
  readonly authority: "sqlite-opfs";
  load(
    surface: StudioCompanionWindowLayoutSurface,
  ): Promise<StudioCompanionWindowPreferenceSnapshot | null>;
  save(
    snapshot: StudioCompanionWindowPreferenceSnapshot,
  ): Promise<StudioCompanionWindowPreferenceSaveResult>;
  flush(): Promise<void>;
}

export interface StudioCompanionWindowPreferencesChannel {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

export type StudioCompanionWindowPreferencesAuthority =
  | "loading"
  | "sqlite-opfs"
  | "memory-only";

export type StudioCompanionWindowPreferencesLiveSync = "broadcast" | "memory-only";

export interface StudioCompanionWindowPreferencesRuntimeState {
  readonly authority: StudioCompanionWindowPreferencesAuthority;
  readonly liveSync: StudioCompanionWindowPreferencesLiveSync;
  readonly snapshot: StudioCompanionWindowPreferenceSnapshot;
}

export interface StudioCompanionWindowPreferencesRuntime {
  current(): StudioCompanionWindowPreferencesRuntimeState;
  hydrate(): Promise<StudioCompanionWindowPreferencesRuntimeState>;
  subscribe(listener: (state: StudioCompanionWindowPreferencesRuntimeState) => void): () => void;
  setRememberEnabled(enabled: boolean): StudioCompanionWindowPreferenceSnapshot;
  setLayout(layout: StudioCompanionWindowLayoutV1 | null): StudioCompanionWindowPreferenceSnapshot;
  clearLayout(): StudioCompanionWindowPreferenceSnapshot;
  close(): void;
}

export interface CreateStudioCompanionWindowPreferencesRuntimeOptions {
  readonly surface: StudioCompanionWindowLayoutSurface;
  readonly initialRememberEnabled: boolean;
  readonly writerInstanceId?: string;
  readonly createMutationId?: () => string;
  readonly repositoryFactory?: () => Promise<StudioCompanionWindowPreferencesRepository>;
  readonly channelFactory?: () => StudioCompanionWindowPreferencesChannel | null;
}

type PreferenceMessage = Readonly<{
  v: 1;
  type: typeof MESSAGE_TYPE;
  snapshot: StudioCompanionWindowPreferenceSnapshot;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length
    && actual.every((key) => typeof key === "string" && keys.includes(key));
}

function preferenceKey(surface: StudioCompanionWindowLayoutSurface): string {
  return `layout.${surface}`;
}

export function compareStudioCompanionWindowPreferenceSnapshots(
  left: StudioCompanionWindowPreferenceSnapshot,
  right: StudioCompanionWindowPreferenceSnapshot,
): number {
  if (left.revision !== right.revision) return left.revision < right.revision ? -1 : 1;
  if (left.writerInstanceId !== right.writerInstanceId) {
    return left.writerInstanceId < right.writerInstanceId ? -1 : 1;
  }
  if (left.mutationId === right.mutationId) return 0;
  return left.mutationId < right.mutationId ? -1 : 1;
}

export function parseStudioCompanionWindowPreferenceSnapshot(
  value: unknown,
): StudioCompanionWindowPreferenceSnapshot | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "kind",
    "version",
    "surface",
    "revision",
    "writerInstanceId",
    "mutationId",
    "rememberEnabled",
    "layout",
  ])) return null;
  const surface = value.surface;
  if (
    value.kind !== SNAPSHOT_KIND
    || value.version !== SNAPSHOT_VERSION
    || (surface !== "workspace" && surface !== "navigator" && surface !== "review" && surface !== "reference")
    || typeof value.revision !== "number"
    || !Number.isSafeInteger(value.revision)
    || value.revision < 0
    || !isStudioCompanionSessionId(value.writerInstanceId)
    || !isStudioCompanionSessionId(value.mutationId)
    || typeof value.rememberEnabled !== "boolean"
  ) return null;

  let layout: StudioCompanionWindowLayoutV1 | null = null;
  if (value.layout !== null) {
    try {
      layout = parseStudioCompanionWindowLayout(JSON.stringify(value.layout), surface);
    } catch {
      return null;
    }
    if (!layout) return null;
  }

  return Object.freeze({
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    surface,
    revision: value.revision,
    writerInstanceId: value.writerInstanceId,
    mutationId: value.mutationId,
    rememberEnabled: value.rememberEnabled,
    layout,
  });
}

function parseStoredSnapshot(
  raw: string | null,
  surface: StudioCompanionWindowLayoutSurface,
): StudioCompanionWindowPreferenceSnapshot | null {
  if (raw === null || raw.length === 0 || raw.length > 8 * 1024) return null;
  try {
    const snapshot = parseStudioCompanionWindowPreferenceSnapshot(JSON.parse(raw) as unknown);
    return snapshot?.surface === surface ? snapshot : null;
  } catch {
    return null;
  }
}

export function createStudioCompanionWindowPreferencesRepository(
  store: StudioAsyncKeyValueStore,
): StudioCompanionWindowPreferencesRepository {
  let writeTail: Promise<void> = Promise.resolve();

  const load = async (surface: StudioCompanionWindowLayoutSurface) =>
    parseStoredSnapshot(await store.get(preferenceKey(surface)), surface);

  return Object.freeze({
    authority: "sqlite-opfs" as const,
    load,
    save(snapshot: StudioCompanionWindowPreferenceSnapshot) {
      const candidate = parseStudioCompanionWindowPreferenceSnapshot(snapshot);
      if (!candidate) return Promise.reject(new TypeError("Invalid companion window preference snapshot"));
      const operation = writeTail
        .catch(() => undefined)
        .then(async (): Promise<StudioCompanionWindowPreferenceSaveResult> => {
          const current = await load(candidate.surface);
          if (current && compareStudioCompanionWindowPreferenceSnapshots(candidate, current) < 0) {
            return Object.freeze({ accepted: false, snapshot: current });
          }
          if (!current || compareStudioCompanionWindowPreferenceSnapshots(candidate, current) > 0) {
            await store.set(preferenceKey(candidate.surface), JSON.stringify(candidate));
          }
          return Object.freeze({ accepted: true, snapshot: candidate });
        });
      writeTail = operation.then(() => undefined, () => undefined);
      return operation;
    },
    flush() {
      return writeTail;
    },
  });
}

let sharedRepository: Promise<StudioCompanionWindowPreferencesRepository> | null = null;

export function acquireProductStudioCompanionWindowPreferencesRepository(): Promise<StudioCompanionWindowPreferencesRepository> {
  sharedRepository ??= acquireStudioCompanionWindowDatabase().then((database) =>
    createStudioCompanionWindowPreferencesRepository(
      database.asAsyncKeyValueStore(STUDIO_COMPANION_WINDOW_PREFERENCES_SQLITE_NAMESPACE),
    ));
  sharedRepository.catch(() => {
    sharedRepository = null;
  });
  return sharedRepository;
}

export function resetStudioCompanionWindowPreferencesRepositoryForTests(): void {
  sharedRepository = null;
}

function createProductChannel(): StudioCompanionWindowPreferencesChannel | null {
  try {
    return typeof BroadcastChannel === "function"
      ? new BroadcastChannel(STUDIO_COMPANION_WINDOW_PREFERENCES_CHANNEL)
      : null;
  } catch {
    return null;
  }
}

function parsePreferenceMessage(value: unknown): PreferenceMessage | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["v", "type", "snapshot"])) return null;
  if (value.v !== 1 || value.type !== MESSAGE_TYPE) return null;
  const snapshot = parseStudioCompanionWindowPreferenceSnapshot(value.snapshot);
  return snapshot
    ? Object.freeze({ v: 1 as const, type: MESSAGE_TYPE, snapshot })
    : null;
}

function createInitialSnapshot(
  surface: StudioCompanionWindowLayoutSurface,
  rememberEnabled: boolean,
  writerInstanceId: string,
  mutationId: string,
): StudioCompanionWindowPreferenceSnapshot {
  return Object.freeze({
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    surface,
    revision: 0,
    writerInstanceId,
    mutationId,
    rememberEnabled,
    layout: null,
  });
}

export function createStudioCompanionWindowPreferenceSnapshot(input: {
  readonly surface: StudioCompanionWindowLayoutSurface;
  readonly revision: number;
  readonly writerInstanceId: string;
  readonly mutationId: string;
  readonly rememberEnabled: boolean;
  readonly layout: StudioCompanionWindowLayoutV1 | null;
}): StudioCompanionWindowPreferenceSnapshot {
  const snapshot = parseStudioCompanionWindowPreferenceSnapshot({
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    ...input,
  });
  if (!snapshot) throw new TypeError("Invalid companion window preference snapshot");
  return snapshot;
}

export function createStudioCompanionWindowPreferencesRuntime(
  options: CreateStudioCompanionWindowPreferencesRuntimeOptions,
): StudioCompanionWindowPreferencesRuntime {
  const fallbackIdentity = (role: "writer" | "mutation") => {
    fallbackIdentitySequence += 1;
    return `memory-${role}-${Date.now().toString(36)}-${fallbackIdentitySequence}`;
  };
  const generatedWriterId = options.writerInstanceId ?? createStudioCompanionInstanceId();
  const writerInstanceId = isStudioCompanionSessionId(generatedWriterId)
    ? generatedWriterId
    : options.writerInstanceId === undefined
      ? fallbackIdentity("writer")
      : generatedWriterId;
  const createMutationId = () => {
    const candidate = (options.createMutationId ?? createStudioCompanionCommandId)();
    if (isStudioCompanionSessionId(candidate)) return candidate;
    if (options.createMutationId) return candidate;
    return fallbackIdentity("mutation");
  };
  if (!isStudioCompanionSessionId(writerInstanceId)) {
    throw new TypeError("A valid companion preference writer id is required");
  }
  const initialMutationId = createMutationId();
  if (!isStudioCompanionSessionId(initialMutationId)) {
    throw new TypeError("A valid companion preference mutation id is required");
  }

  const repositoryFactory = options.repositoryFactory
    ?? acquireProductStudioCompanionWindowPreferencesRepository;
  const channelFactory = options.channelFactory ?? createProductChannel;
  let channel: StudioCompanionWindowPreferencesChannel | null = null;
  try {
    channel = channelFactory();
  } catch {
    channel = null;
  }
  let repository: StudioCompanionWindowPreferencesRepository | null = null;
  let authority: StudioCompanionWindowPreferencesAuthority = "loading";
  let snapshot = createInitialSnapshot(
    options.surface,
    options.initialRememberEnabled,
    writerInstanceId,
    initialMutationId,
  );
  let observedRevision = 0;
  let localMutationCount = 0;
  let hydratePromise: Promise<StudioCompanionWindowPreferencesRuntimeState> | null = null;
  let closed = false;
  const listeners = new Set<(state: StudioCompanionWindowPreferencesRuntimeState) => void>();

  const current = (): StudioCompanionWindowPreferencesRuntimeState => Object.freeze({
    authority,
    liveSync: channel ? "broadcast" : "memory-only",
    snapshot,
  });
  const publish = () => {
    if (closed) return;
    const state = current();
    for (const listener of listeners) listener(state);
  };
  const broadcast = (candidate: StudioCompanionWindowPreferenceSnapshot) => {
    if (!channel || closed) return;
    try {
      channel.postMessage(Object.freeze({
        v: 1 as const,
        type: MESSAGE_TYPE,
        snapshot: candidate,
      }));
    } catch {
      try {
        channel.close();
      } catch {
        // A hardened browser may close the channel before throwing from postMessage.
      }
      channel = null;
      publish();
    }
  };
  const accept = (candidate: StudioCompanionWindowPreferenceSnapshot): boolean => {
    observedRevision = Math.max(observedRevision, candidate.revision);
    if (
      candidate.surface !== options.surface
      || compareStudioCompanionWindowPreferenceSnapshots(candidate, snapshot) <= 0
    ) return false;
    snapshot = candidate;
    publish();
    return true;
  };
  const persist = async (candidate: StudioCompanionWindowPreferenceSnapshot) => {
    if (!repository || closed) return;
    try {
      const result = await repository.save(candidate);
      if (!result.accepted) accept(result.snapshot);
    } catch {
      if (closed) return;
      repository = null;
      authority = "memory-only";
      publish();
    }
  };
  const mutate = (patch: {
    rememberEnabled?: boolean;
    layout?: StudioCompanionWindowLayoutV1 | null;
  }): StudioCompanionWindowPreferenceSnapshot => {
    const mutationId = createMutationId();
    if (!isStudioCompanionSessionId(mutationId)) {
      throw new TypeError("A valid companion preference mutation id is required");
    }
    localMutationCount += 1;
    observedRevision = Math.max(observedRevision, snapshot.revision) + 1;
    snapshot = createStudioCompanionWindowPreferenceSnapshot({
      surface: options.surface,
      revision: observedRevision,
      writerInstanceId,
      mutationId,
      rememberEnabled: patch.rememberEnabled ?? snapshot.rememberEnabled,
      layout: patch.layout === undefined ? snapshot.layout : patch.layout,
    });
    publish();
    broadcast(snapshot);
    void persist(snapshot);
    return snapshot;
  };

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      if (closed) return;
      const message = parsePreferenceMessage(event.data);
      if (!message || !accept(message.snapshot)) return;
      void persist(message.snapshot);
    };
  }

  return Object.freeze({
    current,
    hydrate() {
      hydratePromise ??= (async () => {
        try {
          const resolvedRepository = await repositoryFactory();
          const loaded = await resolvedRepository.load(options.surface);
          if (closed) return current();
          repository = resolvedRepository;
          authority = "sqlite-opfs";
          if (loaded) observedRevision = Math.max(observedRevision, loaded.revision);

          if (localMutationCount > 0) {
            const mutationId = createMutationId();
            if (!isStudioCompanionSessionId(mutationId)) {
              throw new TypeError("A valid companion preference mutation id is required");
            }
            snapshot = createStudioCompanionWindowPreferenceSnapshot({
              surface: options.surface,
              revision: observedRevision + 1,
              writerInstanceId,
              mutationId,
              rememberEnabled: snapshot.rememberEnabled,
              layout: snapshot.layout,
            });
            observedRevision = snapshot.revision;
            publish();
            broadcast(snapshot);
            await persist(snapshot);
          } else if (loaded && accept(loaded)) {
            broadcast(loaded);
          } else if (snapshot.revision > 0 && (!loaded
            || compareStudioCompanionWindowPreferenceSnapshots(snapshot, loaded) > 0)) {
            broadcast(snapshot);
            await persist(snapshot);
          } else {
            publish();
          }
        } catch {
          if (!closed) {
            repository = null;
            authority = "memory-only";
            publish();
          }
        }
        return current();
      })();
      return hydratePromise;
    },
    subscribe(listener: (state: StudioCompanionWindowPreferencesRuntimeState) => void) {
      if (closed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setRememberEnabled(enabled: boolean) {
      return mutate({
        rememberEnabled: enabled,
        ...(enabled ? {} : { layout: null }),
      });
    },
    setLayout(layout: StudioCompanionWindowLayoutV1 | null) {
      return mutate({ layout });
    },
    clearLayout() {
      return mutate({ layout: null });
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      if (channel) {
        channel.onmessage = null;
        try {
          channel.close();
        } catch {
          // Idempotent cleanup remains complete even if the browser already closed the channel.
        }
      }
      channel = null;
      repository = null;
    },
  });
}
