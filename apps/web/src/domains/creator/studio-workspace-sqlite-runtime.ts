import { isStudioLocalDatabaseOwnershipBusyError } from "./studio-local-database-ownership";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";
import {
  STUDIO_WORKSPACE_RAW_MAX_BYTES,
  STUDIO_WORKSPACE_STATE_VERSION,
  createStudioWorkspaceDefaultState,
  normalizeStudioWorkspaceStateForOwner,
  studioWorkspaceOwnerScope,
  studioWorkspaceStateOwnerScope,
  type StudioWorkspaceLoadResult,
  type StudioWorkspacePersistenceFailure,
  type StudioWorkspaceSaveResult,
  type StudioWorkspaceState,
} from "./studio-workspaces";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";
import type { StudioWorkspaceThreeWayMergeResult } from "./studio-workspace-three-way-merge";

export const STUDIO_WORKSPACE_SQLITE_NAMESPACE = "studio-workspaces-v12" as const;
export const STUDIO_WORKSPACE_INVALIDATION_CHANNEL =
  "toonspectrum.studio.workspaces.invalidate.v1" as const;

const SNAPSHOT_KIND = "toonspectrum.studio.workspace.sqlite" as const;
const SNAPSHOT_VERSION = 1 as const;
const INVALIDATION_TYPE = "studio-workspace-invalidated" as const;
const OWNER_SCOPE_PATTERN = /^(?:guest|owner-[0-9a-f]{16})$/u;
const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const MAX_COMMIT_ATTEMPTS = 4;

export type StudioWorkspaceDurableAuthority =
  | "loading"
  | "sqlite-opfs"
  | "memory-only";

export interface StudioWorkspaceSqliteSnapshot {
  readonly kind: typeof SNAPSHOT_KIND;
  readonly version: typeof SNAPSHOT_VERSION;
  readonly ownerScope: string;
  readonly revision: number;
  readonly writerInstanceId: string;
  readonly mutationId: string;
  readonly state: StudioWorkspaceState;
}

export interface StudioWorkspaceSqliteSaveResult {
  readonly accepted: boolean;
  readonly snapshot: StudioWorkspaceSqliteSnapshot;
}

export interface StudioWorkspaceSqliteRepository {
  readonly authority: "sqlite-opfs";
  load(ownerScope: string): Promise<StudioWorkspaceSqliteSnapshot | null>;
  save(snapshot: StudioWorkspaceSqliteSnapshot): Promise<StudioWorkspaceSqliteSaveResult>;
  flush(): Promise<void>;
}

export interface StudioWorkspaceInvalidationChannel {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown): void;
  close(): void;
}

export interface StudioWorkspaceInvalidation {
  readonly ownerScope: string;
  readonly revision: number;
}

export interface StudioWorkspaceRuntimeHydrationResult extends StudioWorkspaceLoadResult {
  readonly authority: StudioWorkspaceDurableAuthority;
  readonly revision: number;
  /** Dirty revision observed after the SQLite read and any guarded merge. */
  readonly guardRevision: number;
  readonly conflictPaths: readonly string[];
}

export interface StudioWorkspaceRuntimeSaveResult extends StudioWorkspaceSaveResult {
  readonly authority: StudioWorkspaceDurableAuthority;
  readonly revision: number;
  readonly guardRevision: number;
  readonly conflictPaths: readonly string[];
  readonly mergedExternalState: boolean;
}

export interface StudioWorkspaceRuntimeReconcileInput {
  readonly sourceOwnerScope: string;
  readonly baseState: StudioWorkspaceState;
  readonly getLocalState: () => StudioWorkspaceState;
  readonly getDirtyRevision: () => number;
}

export interface StudioWorkspacePersistenceRuntime {
  readonly ownerScope: string;
  authority(): StudioWorkspaceDurableAuthority;
  liveSync(): "broadcast" | "unavailable";
  hydrate(input: {
    readonly getCurrentState: () => StudioWorkspaceState;
    readonly getDirtyRevision: () => number;
  }): Promise<StudioWorkspaceRuntimeHydrationResult>;
  save(
    state: StudioWorkspaceState,
    sourceOwnerScope: string,
    guardRevision: number,
  ): Promise<StudioWorkspaceRuntimeSaveResult>;
  reconcile(
    input: StudioWorkspaceRuntimeReconcileInput,
  ): Promise<StudioWorkspaceRuntimeSaveResult>;
  subscribeInvalidation(
    listener: (invalidation: StudioWorkspaceInvalidation) => void,
  ): () => void;
  flush(): Promise<void>;
  close(): void;
}

export interface CreateStudioWorkspacePersistenceRuntimeOptions {
  readonly userId: string | null | undefined;
  readonly writerInstanceId?: string;
  readonly createMutationId?: () => string;
  readonly repositoryFactory?: () => Promise<StudioWorkspaceSqliteRepository>;
  readonly channelFactory?: () => StudioWorkspaceInvalidationChannel | null;
}

export class StudioWorkspaceSqliteError extends Error {
  readonly failure: StudioWorkspacePersistenceFailure;

  constructor(
    failure: StudioWorkspacePersistenceFailure,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "StudioWorkspaceSqliteError";
    this.failure = failure;
  }
}

type InvalidationMessage = Readonly<{
  v: 1;
  type: typeof INVALIDATION_TYPE;
  ownerScope: string;
  revision: number;
}>;

let runtimeIdentitySequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length
    && actual.every((key) => typeof key === "string" && keys.includes(key));
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertOwnerScope(ownerScope: string): string {
  if (!OWNER_SCOPE_PATTERN.test(ownerScope)) {
    throw new StudioWorkspaceSqliteError(
      "owner-mismatch",
      "Studio workspace owner scope is invalid.",
    );
  }
  return ownerScope;
}

function assertRuntimeId(value: string, label: string): string {
  if (!RUNTIME_ID_PATTERN.test(value)) {
    throw new TypeError(`Studio workspace ${label} is invalid.`);
  }
  return value;
}

function createRuntimeId(prefix: "writer" | "mutation"): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  runtimeIdentitySequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${runtimeIdentitySequence.toString(36)}`;
}

function snapshotKey(ownerScope: string): string {
  return assertOwnerScope(ownerScope);
}

function sameWorkspaceState(left: StudioWorkspaceState, right: StudioWorkspaceState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compareStudioWorkspaceSqliteSnapshots(
  left: StudioWorkspaceSqliteSnapshot,
  right: StudioWorkspaceSqliteSnapshot,
): number {
  if (left.revision !== right.revision) return left.revision < right.revision ? -1 : 1;
  if (left.writerInstanceId !== right.writerInstanceId) {
    return left.writerInstanceId < right.writerInstanceId ? -1 : 1;
  }
  if (left.mutationId === right.mutationId) return 0;
  return left.mutationId < right.mutationId ? -1 : 1;
}

export function createStudioWorkspaceSqliteSnapshot(input: {
  readonly ownerScope: string;
  readonly revision: number;
  readonly writerInstanceId: string;
  readonly mutationId: string;
  readonly state: StudioWorkspaceState;
}): StudioWorkspaceSqliteSnapshot {
  const ownerScope = assertOwnerScope(input.ownerScope);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new TypeError("Studio workspace revision must be a positive safe integer.");
  }
  const stateOwnerScope = studioWorkspaceStateOwnerScope(input.state);
  if (stateOwnerScope !== null && stateOwnerScope !== ownerScope) {
    throw new StudioWorkspaceSqliteError(
      "owner-mismatch",
      "Studio workspace state belongs to a different owner.",
    );
  }
  return Object.freeze({
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    ownerScope,
    revision: input.revision,
    writerInstanceId: assertRuntimeId(input.writerInstanceId, "writer id"),
    mutationId: assertRuntimeId(input.mutationId, "mutation id"),
    state: normalizeStudioWorkspaceStateForOwner(input.state, ownerScope),
  });
}

function encodeSnapshot(snapshot: StudioWorkspaceSqliteSnapshot): string {
  const normalized = createStudioWorkspaceSqliteSnapshot(snapshot);
  const encoded = JSON.stringify(normalized);
  if (utf8ByteLength(encoded) > STUDIO_WORKSPACE_RAW_MAX_BYTES) {
    throw new StudioWorkspaceSqliteError(
      "payload-too-large",
      "Studio workspace SQLite payload exceeds its bounded budget.",
    );
  }
  return encoded;
}

export function parseStudioWorkspaceSqliteSnapshot(
  raw: string,
  expectedOwnerScope: string,
): StudioWorkspaceSqliteSnapshot {
  const ownerScope = assertOwnerScope(expectedOwnerScope);
  if (!raw || utf8ByteLength(raw) > STUDIO_WORKSPACE_RAW_MAX_BYTES) {
    throw new StudioWorkspaceSqliteError(
      "invalid-payload",
      "Studio workspace SQLite payload is empty or oversized.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new StudioWorkspaceSqliteError(
      "invalid-payload",
      "Studio workspace SQLite payload is not valid JSON.",
      { cause },
    );
  }
  if (!isRecord(decoded) || !hasExactKeys(decoded, [
    "kind",
    "version",
    "ownerScope",
    "revision",
    "writerInstanceId",
    "mutationId",
    "state",
  ])) {
    throw new StudioWorkspaceSqliteError(
      "invalid-payload",
      "Studio workspace SQLite envelope shape is invalid.",
    );
  }
  if (
    decoded.kind !== SNAPSHOT_KIND
    || decoded.version !== SNAPSHOT_VERSION
    || decoded.ownerScope !== ownerScope
    || !Number.isSafeInteger(decoded.revision)
    || (decoded.revision as number) < 1
    || typeof decoded.writerInstanceId !== "string"
    || !RUNTIME_ID_PATTERN.test(decoded.writerInstanceId)
    || typeof decoded.mutationId !== "string"
    || !RUNTIME_ID_PATTERN.test(decoded.mutationId)
    || !isRecord(decoded.state)
    || decoded.state.version !== STUDIO_WORKSPACE_STATE_VERSION
  ) {
    throw new StudioWorkspaceSqliteError(
      decoded.ownerScope !== ownerScope ? "owner-mismatch" : "invalid-payload",
      "Studio workspace SQLite envelope identity or version is invalid.",
    );
  }
  const state = normalizeStudioWorkspaceStateForOwner(decoded.state, ownerScope);
  if (JSON.stringify(state) !== JSON.stringify(decoded.state)) {
    throw new StudioWorkspaceSqliteError(
      "invalid-payload",
      "Studio workspace SQLite state is not canonical.",
    );
  }
  return Object.freeze({
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    ownerScope,
    revision: decoded.revision as number,
    writerInstanceId: decoded.writerInstanceId,
    mutationId: decoded.mutationId,
    state,
  });
}

export function createStudioWorkspaceSqliteRepository(
  store: StudioAsyncKeyValueStore,
): StudioWorkspaceSqliteRepository {
  let writeTail: Promise<void> = Promise.resolve();

  const load = async (ownerScope: string): Promise<StudioWorkspaceSqliteSnapshot | null> => {
    const raw = await store.get(snapshotKey(ownerScope));
    return raw === null ? null : parseStudioWorkspaceSqliteSnapshot(raw, ownerScope);
  };

  return Object.freeze({
    authority: "sqlite-opfs" as const,
    load,
    save(snapshot: StudioWorkspaceSqliteSnapshot) {
      const candidate = createStudioWorkspaceSqliteSnapshot(snapshot);
      const encoded = encodeSnapshot(candidate);
      const operation = writeTail
        .catch(() => undefined)
        .then(async (): Promise<StudioWorkspaceSqliteSaveResult> => {
          const current = await load(candidate.ownerScope);
          if (current && compareStudioWorkspaceSqliteSnapshots(candidate, current) < 0) {
            return Object.freeze({ accepted: false, snapshot: current });
          }
          if (current && compareStudioWorkspaceSqliteSnapshots(candidate, current) === 0) {
            return Object.freeze({ accepted: true, snapshot: current });
          }
          await store.set(snapshotKey(candidate.ownerScope), encoded);
          const verifiedRaw = await store.get(snapshotKey(candidate.ownerScope));
          if (verifiedRaw === encoded) {
            return Object.freeze({ accepted: true, snapshot: candidate });
          }
          if (verifiedRaw !== null) {
            const verified = parseStudioWorkspaceSqliteSnapshot(
              verifiedRaw,
              candidate.ownerScope,
            );
            return Object.freeze({ accepted: false, snapshot: verified });
          }
          throw new StudioWorkspaceSqliteError(
            "verification-failed",
            "Studio workspace SQLite write could not be verified.",
          );
        });
      writeTail = operation.then(() => undefined, () => undefined);
      return operation;
    },
    flush() {
      return writeTail;
    },
  });
}

let sharedRepository: Promise<StudioWorkspaceSqliteRepository> | null = null;

export function acquireProductStudioWorkspaceSqliteRepository(): Promise<StudioWorkspaceSqliteRepository> {
  sharedRepository ??= acquireStudioLocalDatabase().then((database) =>
    createStudioWorkspaceSqliteRepository(
      database.asAsyncKeyValueStore(STUDIO_WORKSPACE_SQLITE_NAMESPACE),
    ));
  sharedRepository.catch(() => {
    sharedRepository = null;
  });
  return sharedRepository;
}

export function resetStudioWorkspaceSqliteRepositoryForTests(): void {
  sharedRepository = null;
}

function createProductChannel(): StudioWorkspaceInvalidationChannel | null {
  try {
    return typeof BroadcastChannel === "function"
      ? new BroadcastChannel(STUDIO_WORKSPACE_INVALIDATION_CHANNEL)
      : null;
  } catch {
    return null;
  }
}

function parseInvalidationMessage(value: unknown): InvalidationMessage | null {
  if (!isRecord(value) || !hasExactKeys(value, ["v", "type", "ownerScope", "revision"])) {
    return null;
  }
  if (
    value.v !== 1
    || value.type !== INVALIDATION_TYPE
    || typeof value.ownerScope !== "string"
    || !OWNER_SCOPE_PATTERN.test(value.ownerScope)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
  ) return null;
  return Object.freeze({
    v: 1 as const,
    type: INVALIDATION_TYPE,
    ownerScope: value.ownerScope,
    revision: value.revision as number,
  });
}

function failureFrom(error: unknown, fallback: StudioWorkspacePersistenceFailure) {
  if (isStudioLocalDatabaseOwnershipBusyError(error)) return "ownership-busy";
  return error instanceof StudioWorkspaceSqliteError ? error.failure : fallback;
}

async function mergeWorkspaceStates(
  base: StudioWorkspaceState,
  local: StudioWorkspaceState,
  external: StudioWorkspaceState,
): Promise<StudioWorkspaceThreeWayMergeResult> {
  const { mergeStudioWorkspaceStates } = await import("./studio-workspace-three-way-merge");
  return mergeStudioWorkspaceStates(base, local, external);
}

export function createStudioWorkspacePersistenceRuntime(
  options: CreateStudioWorkspacePersistenceRuntimeOptions,
): StudioWorkspacePersistenceRuntime {
  const ownerScope = studioWorkspaceOwnerScope(options.userId);
  const writerInstanceId = assertRuntimeId(
    options.writerInstanceId ?? createRuntimeId("writer"),
    "writer id",
  );
  const createMutationId = () => assertRuntimeId(
    (options.createMutationId ?? (() => createRuntimeId("mutation")))(),
    "mutation id",
  );
  const repositoryFactory = options.repositoryFactory
    ?? acquireProductStudioWorkspaceSqliteRepository;
  const channelFactory = options.channelFactory ?? createProductChannel;
  let channel: StudioWorkspaceInvalidationChannel | null = null;
  try {
    channel = channelFactory();
  } catch {
    channel = null;
  }
  let durableAuthority: StudioWorkspaceDurableAuthority = "loading";
  let repositoryPromise: Promise<StudioWorkspaceSqliteRepository> | null = null;
  let hydratePromise: Promise<StudioWorkspaceRuntimeHydrationResult> | null = null;
  let operationTail: Promise<void> = Promise.resolve();
  let baseState = createStudioWorkspaceDefaultState(options.userId);
  let baseSnapshot: StudioWorkspaceSqliteSnapshot | null = null;
  let observedRevision = 0;
  let closed = false;
  const invalidationListeners = new Set<
    (invalidation: StudioWorkspaceInvalidation) => void
  >();

  const acquireRepository = async () => {
    repositoryPromise ??= Promise.resolve().then(repositoryFactory);
    try {
      const repository = await repositoryPromise;
      if (closed) {
        throw new StudioWorkspaceSqliteError(
          "storage-unavailable",
          "Studio workspace persistence runtime is closed.",
        );
      }
      durableAuthority = "sqlite-opfs";
      return repository;
    } catch (cause) {
      durableAuthority = "memory-only";
      throw cause;
    }
  };

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = operationTail.catch(() => undefined).then(operation);
    operationTail = pending.then(() => undefined, () => undefined);
    return pending;
  };

  const closeChannel = () => {
    if (!channel) return;
    channel.onmessage = null;
    try {
      channel.close();
    } catch {
      // Closing an already-closed BroadcastChannel is harmless to runtime ownership.
    }
    channel = null;
  };

  const broadcastInvalidation = (snapshot: StudioWorkspaceSqliteSnapshot) => {
    if (!channel || closed) return;
    try {
      // Deliberately carries no workspace state. Receivers must re-read SQLite authority.
      channel.postMessage(Object.freeze({
        v: 1 as const,
        type: INVALIDATION_TYPE,
        ownerScope: snapshot.ownerScope,
        revision: snapshot.revision,
      }));
    } catch {
      closeChannel();
    }
  };

  const scopeState = (state: StudioWorkspaceState): StudioWorkspaceState =>
    normalizeStudioWorkspaceStateForOwner(state, ownerScope);

  const sessionSaveResult = (
    state: StudioWorkspaceState,
    guardRevision: number,
    failure: StudioWorkspacePersistenceFailure,
    conflictPaths: readonly string[] = [],
  ): StudioWorkspaceRuntimeSaveResult => Object.freeze({
    state: scopeState(state),
    ownerScope,
    status: "session-only" as const,
    failure,
    authority: "memory-only" as const,
    revision: observedRevision,
    guardRevision,
    conflictPaths: Object.freeze([...conflictPaths]),
    mergedExternalState: conflictPaths.length > 0,
  });

  const commit = async (
    repository: StudioWorkspaceSqliteRepository,
    requestedState: StudioWorkspaceState,
    guardRevision: number,
    initialConflictPaths: readonly string[] = [],
  ): Promise<StudioWorkspaceRuntimeSaveResult> => {
    let desiredState = scopeState(requestedState);
    const conflicts = new Set(initialConflictPaths);
    let mergedExternalState = initialConflictPaths.length > 0;

    for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
      const current = await repository.load(ownerScope);
      if (current) observedRevision = Math.max(observedRevision, current.revision);
      if (
        current
        && (!baseSnapshot
          || compareStudioWorkspaceSqliteSnapshots(current, baseSnapshot) !== 0)
      ) {
        const merged = await mergeWorkspaceStates(baseState, desiredState, current.state);
        desiredState = scopeState(merged.state);
        for (const path of merged.conflictPaths) conflicts.add(path);
        mergedExternalState = true;
        baseState = current.state;
        baseSnapshot = current;
      }

      const candidate = createStudioWorkspaceSqliteSnapshot({
        ownerScope,
        revision: Math.max(observedRevision, current?.revision ?? 0) + 1,
        writerInstanceId,
        mutationId: createMutationId(),
        state: desiredState,
      });
      const saved = await repository.save(candidate);
      observedRevision = Math.max(observedRevision, saved.snapshot.revision);
      if (!saved.accepted) continue;

      baseSnapshot = saved.snapshot;
      baseState = saved.snapshot.state;
      durableAuthority = "sqlite-opfs";
      broadcastInvalidation(saved.snapshot);
      return Object.freeze({
        state: saved.snapshot.state,
        ownerScope,
        status: "persisted" as const,
        failure: null,
        authority: "sqlite-opfs" as const,
        revision: saved.snapshot.revision,
        guardRevision,
        conflictPaths: Object.freeze([...conflicts].sort()),
        mergedExternalState,
      });
    }

    throw new StudioWorkspaceSqliteError(
      "verification-failed",
      "Studio workspace SQLite authority changed during every commit attempt.",
    );
  };

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      if (closed) return;
      const message = parseInvalidationMessage(event.data);
      if (!message || message.ownerScope !== ownerScope) return;
      for (const listener of invalidationListeners) {
        listener(Object.freeze({
          ownerScope: message.ownerScope,
          revision: message.revision,
        }));
      }
    };
  }

  return Object.freeze({
    ownerScope,
    authority: () => durableAuthority,
    liveSync: () => channel ? "broadcast" : "unavailable",
    hydrate(input: {
      readonly getCurrentState: () => StudioWorkspaceState;
      readonly getDirtyRevision: () => number;
    }) {
      const startedDirtyRevision = input.getDirtyRevision();
      hydratePromise ??= enqueue(async () => {
        try {
          const repository = await acquireRepository();
          const stored = await repository.load(ownerScope);
          if (stored) observedRevision = Math.max(observedRevision, stored.revision);
          const guardRevision = input.getDirtyRevision();

          if (guardRevision !== startedDirtyRevision) {
            const local = scopeState(input.getCurrentState());
            const external = stored?.state ?? createStudioWorkspaceDefaultState(options.userId);
            const merged = await mergeWorkspaceStates(baseState, local, external);
            baseState = external;
            baseSnapshot = stored;
            const saved = await commit(
              repository,
              merged.state,
              guardRevision,
              merged.conflictPaths,
            );
            return Object.freeze({
              ...saved,
              source: stored ? "current" as const : "default" as const,
            });
          }

          baseSnapshot = stored;
          baseState = stored?.state ?? createStudioWorkspaceDefaultState(options.userId);
          return Object.freeze({
            state: baseState,
            ownerScope,
            source: stored ? "current" as const : "default" as const,
            status: stored ? "persisted" as const : "session-only" as const,
            failure: null,
            authority: "sqlite-opfs" as const,
            revision: stored?.revision ?? 0,
            guardRevision,
            conflictPaths: Object.freeze([]),
          });
        } catch (cause) {
          durableAuthority = "memory-only";
          const guardRevision = input.getDirtyRevision();
          const state = scopeState(input.getCurrentState());
          return Object.freeze({
            state,
            ownerScope,
            source: "default" as const,
            status: "session-only" as const,
            failure: failureFrom(cause, "read-failed"),
            authority: "memory-only" as const,
            revision: observedRevision,
            guardRevision,
            conflictPaths: Object.freeze([]),
          });
        }
      });
      return hydratePromise;
    },
    save(
      state: StudioWorkspaceState,
      sourceOwnerScope: string,
      guardRevision: number,
    ) {
      const stateOwnerScope = studioWorkspaceStateOwnerScope(state);
      if (
        sourceOwnerScope !== ownerScope
        || (stateOwnerScope !== null && stateOwnerScope !== ownerScope)
      ) {
        return Promise.resolve(sessionSaveResult(
          state,
          guardRevision,
          "owner-mismatch",
        ));
      }
      const requested = scopeState(state);
      return enqueue(async () => {
        try {
          return await commit(await acquireRepository(), requested, guardRevision);
        } catch (cause) {
          durableAuthority = "memory-only";
          return sessionSaveResult(
            requested,
            guardRevision,
            failureFrom(cause, "write-failed"),
          );
        }
      });
    },
    reconcile(input: StudioWorkspaceRuntimeReconcileInput) {
      if (input.sourceOwnerScope !== ownerScope) {
        const guardRevision = input.getDirtyRevision();
        return Promise.resolve(sessionSaveResult(
          input.getLocalState(),
          guardRevision,
          "owner-mismatch",
        ));
      }
      return enqueue(async () => {
        const guardRevision = input.getDirtyRevision();
        let local = scopeState(input.getLocalState());
        try {
          const repository = await acquireRepository();
          const current = await repository.load(ownerScope);
          const latestGuardRevision = input.getDirtyRevision();
          if (latestGuardRevision !== guardRevision) {
            local = scopeState(input.getLocalState());
          }
          if (!current) {
            baseSnapshot = null;
            baseState = scopeState(input.baseState);
            if (sameWorkspaceState(local, baseState)) {
              return Object.freeze({
                state: local,
                ownerScope,
                status: "session-only" as const,
                failure: null,
                authority: "sqlite-opfs" as const,
                revision: observedRevision,
                guardRevision: latestGuardRevision,
                conflictPaths: Object.freeze([]),
                mergedExternalState: false,
              });
            }
            return await commit(repository, local, latestGuardRevision);
          }

          observedRevision = Math.max(observedRevision, current.revision);
          const mergeBase = scopeState(input.baseState);
          const merged = await mergeWorkspaceStates(mergeBase, local, current.state);
          baseSnapshot = current;
          baseState = current.state;
          if (sameWorkspaceState(merged.state, current.state)) {
            durableAuthority = "sqlite-opfs";
            return Object.freeze({
              state: current.state,
              ownerScope,
              status: "persisted" as const,
              failure: null,
              authority: "sqlite-opfs" as const,
              revision: current.revision,
              guardRevision: latestGuardRevision,
              conflictPaths: merged.conflictPaths,
              mergedExternalState: !sameWorkspaceState(local, current.state),
            });
          }
          return await commit(
            repository,
            merged.state,
            latestGuardRevision,
            merged.conflictPaths,
          );
        } catch (cause) {
          durableAuthority = "memory-only";
          return sessionSaveResult(
            local,
            input.getDirtyRevision(),
            failureFrom(cause, "read-failed"),
          );
        }
      });
    },
    subscribeInvalidation(
      listener: (invalidation: StudioWorkspaceInvalidation) => void,
    ) {
      if (closed) return () => undefined;
      invalidationListeners.add(listener);
      return () => invalidationListeners.delete(listener);
    },
    async flush() {
      await operationTail;
      if (!repositoryPromise) return;
      await (await repositoryPromise).flush();
    },
    close() {
      if (closed) return;
      closed = true;
      invalidationListeners.clear();
      closeChannel();
    },
  });
}
