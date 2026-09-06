/**
 * Unsaved Studio documents need an identity before they have a creator_work row. This module owns
 * only that browser-local identity and the future lazy-provision/promotion wire contract. It does
 * not pretend that a durable collaboration room exists before the server confirms one.
 */
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";
import { studioWorkspaceOwnerScope } from "./studio-workspaces";

import type { StudioAsyncKeyValueStore } from "./studio-local-database";

export const STUDIO_DRAFT_COLLABORATION_SQLITE_NAMESPACE =
  "studio-draft-collaboration-v12" as const;

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_SCOPE_LENGTH = 200;
const MAX_WORK_ID_LENGTH = 160;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DRAFT_DOCUMENT_ID_PATTERN =
  /^draft_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DRAFT_ROOM_ID_PATTERN =
  /^draft-room_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const STUDIO_DRAFT_COLLABORATION_POLICY = Object.freeze({
  /** An actively reopened local draft keeps its identity; abandoned identities are pruned. */
  localIdentityIdleTtlMs: 30 * DAY_MS,
  /** Temporary server rooms should be cheaper than durable saved works. */
  temporaryRoomIdleTtlMs: 7 * DAY_MS,
  invitationTtlMs: 7 * DAY_MS,
  maxPersistedIdentities: 16,
  maxStorageBytes: 32 * 1_024,
  /** Matches the current Studio CRDT authoritative snapshot ceiling. */
  maxInitialSnapshotBytes: 16 * 1_024 * 1_024,
  /** Matches the current live-room admission ceiling, not the larger saved-work member ceiling. */
  maxTemporaryRoomMembers: 30,
  provisionAttemptsPerWindow: 5,
  provisionRateWindowMs: 10 * 60 * 1_000,
});

export type StudioDraftCollaborationPersistence = "persistent" | "memory-only";
export const STUDIO_DRAFT_COLLABORATION_PROVISION_INTENTS = [
  "share-link",
  "invite-member",
  "cloud-save",
] as const;
export const STUDIO_DRAFT_COLLABORATION_FINAL_STATUSES = [
  "draft",
  "published",
] as const;
export type StudioDraftCollaborationProvisionIntent =
  (typeof STUDIO_DRAFT_COLLABORATION_PROVISION_INTENTS)[number];
export type StudioDraftCollaborationFinalStatus =
  (typeof STUDIO_DRAFT_COLLABORATION_FINAL_STATUSES)[number];

export interface StudioDraftCollaborationIdentity {
  readonly version: 1;
  readonly draftDocumentId: string;
  readonly documentScopeKey: string;
  readonly ownerScopeKey: string;
  readonly createdAt: string;
  readonly lastOpenedAt: string;
  readonly expiresAt: string;
  readonly persistence: StudioDraftCollaborationPersistence;
}

export type StudioDraftCollaborationReadiness =
  | {
      readonly status: "local";
      readonly identity: StudioDraftCollaborationIdentity;
    }
  | {
      readonly status: "provisioning";
      readonly identity: StudioDraftCollaborationIdentity;
      readonly intent: StudioDraftCollaborationProvisionIntent;
    }
  | {
      readonly status: "ready";
      readonly identity: StudioDraftCollaborationIdentity;
      readonly room: StudioDraftCollaborationTemporaryRoom;
    }
  | {
      readonly status: "error";
      readonly identity: StudioDraftCollaborationIdentity;
      readonly message: string;
    };

export interface StudioDraftCollaborationTemporaryRoom {
  readonly version: 1;
  readonly roomId: string;
  /**
   * Canonical creator_work allocated in the lazy-provision transaction. Promotion keeps this ID
   * so every membership, comment and CRDT FK continues to reference the same graph.
   */
  readonly provisionalWorkId: string;
  readonly draftDocumentId: string;
  readonly ownerScopeKey: string;
  readonly graphRevision: number;
  readonly provisionedAt: string;
  readonly expiresAt: string;
}

export interface StudioDraftCollaborationProvisionRequest {
  readonly version: 1;
  readonly draftDocumentId: string;
  readonly ownerScopeKey: string;
  readonly intent: StudioDraftCollaborationProvisionIntent;
  readonly clientMutationId: string;
  readonly initialSnapshotByteLength: number;
  readonly requestedAt: string;
}

export interface StudioDraftCollaborationPromotionRequest {
  readonly version: 1;
  readonly draftDocumentId: string;
  readonly roomId: string;
  readonly ownerScopeKey: string;
  readonly targetWorkId: string;
  readonly expectedGraphRevision: number;
  readonly expectedWorkRevision: number;
  readonly finalStatus: StudioDraftCollaborationFinalStatus;
  readonly clientMutationId: string;
  readonly requestedAt: string;
}

export interface StudioDraftCollaborationProvisionGate {
  readonly draftDocumentId: string;
  readonly ownerScopeKey: string;
  readonly windowStartedAt: number;
  readonly attempts: number;
}

export interface StudioDraftCollaborationProvisionGateResult {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  readonly next: StudioDraftCollaborationProvisionGate;
}

interface PersistedDraftCollaborationIdentity {
  readonly draftDocumentId: string;
  readonly documentScopeKey: string;
  readonly ownerScopeKey: string;
  readonly createdAt: string;
  readonly lastOpenedAt: string;
  readonly expiresAt: string;
}

interface PersistedDraftCollaborationEnvelope {
  readonly version: 1;
  readonly identities: readonly PersistedDraftCollaborationIdentity[];
}

export interface LoadOrCreateStudioDraftCollaborationInput {
  readonly documentScopeKey: string;
  readonly ownerScopeKey: string;
  readonly now?: number;
  readonly createUuid?: () => string;
}

export interface StudioDraftCollaborationIdentityRepository {
  readonly authority: "sqlite-opfs";
  loadOrCreate(
    input: LoadOrCreateStudioDraftCollaborationInput,
  ): Promise<StudioDraftCollaborationIdentity>;
  /** Removes only the exact persisted draft identity; a stale caller cannot retire a replacement. */
  retireExact(identity: StudioDraftCollaborationIdentity): Promise<boolean>;
  flush(): Promise<void>;
}

function exactBoundedScope(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SCOPE_LENGTH ||
    value.trim() !== value
  ) {
    return null;
  }
  return value;
}

function exactBoundedWorkId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_WORK_ID_LENGTH ||
    value.trim() !== value
  ) {
    return null;
  }
  return value;
}

function finiteTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function iso(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error("초안 협업 시각이 올바르지 않습니다.");
  }
  return new Date(timestamp).toISOString();
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function secureUuid(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("이 브라우저에서는 안전한 초안 협업 ID를 만들 수 없습니다.");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function requestedUuid(createUuid?: () => string): string {
  const value = createUuid?.() ?? secureUuid();
  if (!UUID_PATTERN.test(value)) {
    throw new Error("초안 협업 ID 생성기가 올바른 UUID를 반환하지 않았습니다.");
  }
  return value.toLowerCase();
}

function parsePersistedIdentity(
  value: unknown,
  now: number
): PersistedDraftCollaborationIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const draftDocumentId =
    typeof record.draftDocumentId === "string" &&
    DRAFT_DOCUMENT_ID_PATTERN.test(record.draftDocumentId)
      ? record.draftDocumentId
      : null;
  const documentScopeKey = exactBoundedScope(record.documentScopeKey);
  const ownerScopeKey = exactBoundedScope(record.ownerScopeKey);
  const createdAt = finiteTimestamp(record.createdAt);
  const lastOpenedAt = finiteTimestamp(record.lastOpenedAt);
  const expiresAt = finiteTimestamp(record.expiresAt);
  if (
    !draftDocumentId ||
    !documentScopeKey ||
    !ownerScopeKey ||
    createdAt === null ||
    lastOpenedAt === null ||
    expiresAt === null ||
    createdAt > lastOpenedAt ||
    lastOpenedAt > expiresAt ||
    expiresAt - lastOpenedAt >
      STUDIO_DRAFT_COLLABORATION_POLICY.localIdentityIdleTtlMs ||
    expiresAt <= now
  ) {
    return null;
  }
  return {
    draftDocumentId,
    documentScopeKey,
    ownerScopeKey,
    createdAt: iso(createdAt),
    lastOpenedAt: iso(lastOpenedAt),
    expiresAt: iso(expiresAt),
  };
}

function parseIdentityEnvelope(
  raw: string | null,
  now: number,
): PersistedDraftCollaborationIdentity[] {
  if (raw === null) return [];
  if (!raw || utf8ByteLength(raw) > STUDIO_DRAFT_COLLABORATION_POLICY.maxStorageBytes) {
    throw new Error("초안 협업 SQLite 데이터가 비어 있거나 허용 크기를 초과했습니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new Error("초안 협업 SQLite JSON이 손상되었습니다.", { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("초안 협업 SQLite envelope 형식이 올바르지 않습니다.");
  }
  const envelope = parsed as Partial<PersistedDraftCollaborationEnvelope>;
  if (envelope.version !== 1 || !Array.isArray(envelope.identities)) {
    throw new Error("초안 협업 SQLite envelope 버전이 올바르지 않습니다.");
  }
  const uniqueIds = new Set<string>();
  const identities = envelope.identities
    .slice(0, STUDIO_DRAFT_COLLABORATION_POLICY.maxPersistedIdentities * 2)
    .map((identity) => parsePersistedIdentity(identity, now))
    .filter((identity): identity is PersistedDraftCollaborationIdentity => {
      if (!identity || uniqueIds.has(identity.draftDocumentId)) return false;
      uniqueIds.add(identity.draftDocumentId);
      return true;
    });
  if (envelope.identities.length > 0 && identities.length === 0) {
    throw new Error("초안 협업 SQLite identity가 모두 손상되었습니다.");
  }
  return identities;
}

function encodeIdentityEnvelope(
  identities: readonly PersistedDraftCollaborationIdentity[],
): string {
  const bounded = identities
    .slice()
    .sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt))
    .slice(0, STUDIO_DRAFT_COLLABORATION_POLICY.maxPersistedIdentities);
  while (bounded.length > 0) {
    const envelope = JSON.stringify({ version: 1, identities: bounded });
    if (utf8ByteLength(envelope) <= STUDIO_DRAFT_COLLABORATION_POLICY.maxStorageBytes) {
      return envelope;
    }
    bounded.pop();
  }
  throw new Error("초안 협업 SQLite envelope를 허용 크기로 줄일 수 없습니다.");
}

function publicIdentity(
  identity: PersistedDraftCollaborationIdentity,
  persistence: StudioDraftCollaborationPersistence
): StudioDraftCollaborationIdentity {
  return { version: 1, ...identity, persistence };
}

function exactRetirementIdentity(
  identity: StudioDraftCollaborationIdentity,
): Pick<
  PersistedDraftCollaborationIdentity,
  "draftDocumentId" | "documentScopeKey" | "ownerScopeKey"
> {
  const documentScopeKey = exactBoundedScope(identity.documentScopeKey);
  const ownerScopeKey = exactBoundedScope(identity.ownerScopeKey);
  if (
    identity.version !== 1
    || !DRAFT_DOCUMENT_ID_PATTERN.test(identity.draftDocumentId)
    || !documentScopeKey
    || !ownerScopeKey
  ) {
    throw new Error("retire할 초안 협업 identity가 올바르지 않습니다.");
  }
  return {
    draftDocumentId: identity.draftDocumentId,
    documentScopeKey,
    ownerScopeKey,
  };
}

function isExactRetirementTarget(
  persisted: PersistedDraftCollaborationIdentity,
  target: ReturnType<typeof exactRetirementIdentity>,
): boolean {
  return persisted.draftDocumentId === target.draftDocumentId
    && persisted.documentScopeKey === target.documentScopeKey
    && persisted.ownerScopeKey === target.ownerScopeKey;
}

function nextDraftCollaborationIdentity(
  identities: readonly PersistedDraftCollaborationIdentity[],
  input: LoadOrCreateStudioDraftCollaborationInput,
): {
  readonly identity: PersistedDraftCollaborationIdentity;
  readonly identities: readonly PersistedDraftCollaborationIdentity[];
} {
  const documentScopeKey = exactBoundedScope(input.documentScopeKey);
  const ownerScopeKey = exactBoundedScope(input.ownerScopeKey);
  if (!documentScopeKey || !ownerScopeKey) {
    throw new Error("초안 협업 문서 또는 소유자 범위가 올바르지 않습니다.");
  }
  const now = input.now ?? Date.now();
  const openedAt = iso(now);
  const expiresAt = iso(now + STUDIO_DRAFT_COLLABORATION_POLICY.localIdentityIdleTtlMs);
  const matchingIndex = identities.findIndex(
    (identity) =>
      identity.documentScopeKey === documentScopeKey && identity.ownerScopeKey === ownerScopeKey
  );
  const current = matchingIndex >= 0 ? identities[matchingIndex] : null;
  const next: PersistedDraftCollaborationIdentity = current
    ? { ...current, lastOpenedAt: openedAt, expiresAt }
    : {
        draftDocumentId: `draft_${requestedUuid(input.createUuid)}`,
        documentScopeKey,
        ownerScopeKey,
        createdAt: openedAt,
        lastOpenedAt: openedAt,
        expiresAt,
      };
  const remaining = identities.filter((_, index) => index !== matchingIndex);
  return Object.freeze({
    identity: next,
    identities: Object.freeze([next, ...remaining]),
  });
}

class DraftCollaborationIdentityWriteError extends Error {
  readonly identity: PersistedDraftCollaborationIdentity;

  constructor(identity: PersistedDraftCollaborationIdentity, cause: unknown) {
    super("초안 협업 SQLite 쓰기를 확인하지 못했습니다.", { cause });
    this.name = "DraftCollaborationIdentityWriteError";
    this.identity = identity;
  }
}

/** One owner-scoped row per account; all writes share one serialized SQLite queue. */
export function createStudioDraftCollaborationIdentityRepository(
  store: StudioAsyncKeyValueStore,
): StudioDraftCollaborationIdentityRepository {
  let writeTail: Promise<void> = Promise.resolve();

  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const operation = writeTail.catch(() => undefined).then(run);
    writeTail = operation.then(() => undefined, () => undefined);
    return operation;
  };

  return Object.freeze({
    authority: "sqlite-opfs" as const,
    loadOrCreate(input: LoadOrCreateStudioDraftCollaborationInput) {
      const ownerScopeKey = exactBoundedScope(input.ownerScopeKey);
      if (!ownerScopeKey) {
        return Promise.reject(new Error("초안 협업 소유자 범위가 올바르지 않습니다."));
      }
      const sqliteOwnerKey = studioWorkspaceOwnerScope(ownerScopeKey);
      return serialize(async () => {
        const now = input.now ?? Date.now();
        const current = parseIdentityEnvelope(await store.get(sqliteOwnerKey), now);
        if (current.some((identity) => identity.ownerScopeKey !== ownerScopeKey)) {
          throw new Error("초안 협업 SQLite owner 행이 다른 계정 identity를 포함합니다.");
        }
        const next = nextDraftCollaborationIdentity(current, input);
        const encoded = encodeIdentityEnvelope(next.identities);
        try {
          await store.set(sqliteOwnerKey, encoded);
          if (await store.get(sqliteOwnerKey) !== encoded) {
            throw new Error("SQLite verification mismatch");
          }
        } catch (cause) {
          throw new DraftCollaborationIdentityWriteError(next.identity, cause);
        }
        return publicIdentity(next.identity, "persistent");
      });
    },
    retireExact(identity: StudioDraftCollaborationIdentity) {
      const target = exactRetirementIdentity(identity);
      const sqliteOwnerKey = studioWorkspaceOwnerScope(target.ownerScopeKey);
      return serialize(async () => {
        // Retirement must also see expired identities, so parse against the Unix epoch instead of
        // pruning by today's clock. Only the exact UUID+document+owner tuple may be removed.
        const current = parseIdentityEnvelope(await store.get(sqliteOwnerKey), 0);
        const matchingIndex = current.findIndex((candidate) =>
          isExactRetirementTarget(candidate, target));
        if (matchingIndex < 0) return false;
        const remaining = current.filter((_, index) => index !== matchingIndex);
        if (remaining.length === 0) {
          await store.delete(sqliteOwnerKey);
          if (await store.get(sqliteOwnerKey) !== null) {
            throw new Error("초안 협업 identity retire 삭제를 확인하지 못했습니다.");
          }
          return true;
        }
        const encoded = encodeIdentityEnvelope(remaining);
        await store.set(sqliteOwnerKey, encoded);
        if (await store.get(sqliteOwnerKey) !== encoded) {
          throw new Error("초안 협업 identity retire 쓰기를 확인하지 못했습니다.");
        }
        return true;
      });
    },
    flush() {
      return writeTail;
    },
  });
}

let sharedIdentityRepository: Promise<StudioDraftCollaborationIdentityRepository> | null = null;

export function acquireProductStudioDraftCollaborationIdentityRepository(): Promise<StudioDraftCollaborationIdentityRepository> {
  sharedIdentityRepository ??= acquireStudioLocalDatabase().then((database) =>
    createStudioDraftCollaborationIdentityRepository(
      database.asAsyncKeyValueStore(STUDIO_DRAFT_COLLABORATION_SQLITE_NAMESPACE),
    ));
  sharedIdentityRepository.catch(() => {
    sharedIdentityRepository = null;
  });
  return sharedIdentityRepository;
}

export function resetStudioDraftCollaborationIdentityRepositoryForTests(): void {
  sharedIdentityRepository = null;
}

/**
 * Resolves one stable identity per (document, owner) pair from SQLite/OPFS. The pre-cutover
 * localStorage envelope is deliberately never probed or imported. If SQLite is unavailable, the
 * returned identity is explicitly marked memory-only so the host can warn before sharing.
 */
export async function loadOrCreateStudioDraftCollaborationIdentity(
  input: LoadOrCreateStudioDraftCollaborationInput,
  acquireRepository: () => Promise<StudioDraftCollaborationIdentityRepository> =
    acquireProductStudioDraftCollaborationIdentityRepository,
): Promise<StudioDraftCollaborationIdentity> {
  // Validate before opening SQLite so malformed scopes never become a memory-only pseudo-success.
  if (!exactBoundedScope(input.documentScopeKey) || !exactBoundedScope(input.ownerScopeKey)) {
    throw new Error("초안 협업 문서 또는 소유자 범위가 올바르지 않습니다.");
  }
  iso(input.now ?? Date.now());
  try {
    return await (await acquireRepository()).loadOrCreate(input);
  } catch (cause) {
    if (cause instanceof DraftCollaborationIdentityWriteError) {
      return publicIdentity(cause.identity, "memory-only");
    }
    const fallback = nextDraftCollaborationIdentity([], input);
    return publicIdentity(fallback.identity, "memory-only");
  }
}

/**
 * Retires a successfully promoted local draft identity without any memory-only fallback. Failure
 * must remain visible to the save coordinator, otherwise the next new work could reuse its room.
 */
export async function retireStudioDraftCollaborationIdentity(
  identity: StudioDraftCollaborationIdentity,
  acquireRepository: () => Promise<StudioDraftCollaborationIdentityRepository> =
    acquireProductStudioDraftCollaborationIdentityRepository,
): Promise<boolean> {
  exactRetirementIdentity(identity);
  // A memory-only identity has no SQLite row to remove. Treat that absence as a completed retire
  // so a successful server promotion does not become unrecoverable solely because OPFS is blocked.
  if (identity.persistence === "memory-only") return true;
  return (await acquireRepository()).retireExact(identity);
}

function assertCurrentOwnedIdentity(
  identity: StudioDraftCollaborationIdentity,
  actorAuthScopeKey: string,
  now: number
): void {
  const actor = exactBoundedScope(actorAuthScopeKey);
  if (
    identity.version !== 1 ||
    !DRAFT_DOCUMENT_ID_PATTERN.test(identity.draftDocumentId) ||
    !actor ||
    identity.ownerScopeKey !== actor
  ) {
    throw new Error("현재 계정은 이 초안 협업 문서를 소유하지 않습니다.");
  }
  const expiresAt = finiteTimestamp(identity.expiresAt);
  if (expiresAt === null || expiresAt <= now) {
    throw new Error("초안 협업 ID가 만료되었습니다. 작업실을 다시 열어 주세요.");
  }
}

/**
 * Creates the body for the first share/invite or explicit cloud-save request. The server must
 * repeat every check and provision transactionally; this client check prevents accidental eager
 * or oversized requests.
 */
export function createStudioDraftCollaborationProvisionRequest(input: {
  readonly identity: StudioDraftCollaborationIdentity;
  readonly actorAuthScopeKey: string;
  readonly intent: StudioDraftCollaborationProvisionIntent;
  readonly initialSnapshotByteLength: number;
  readonly now?: number;
  readonly createUuid?: () => string;
}): StudioDraftCollaborationProvisionRequest {
  const now = input.now ?? Date.now();
  assertCurrentOwnedIdentity(input.identity, input.actorAuthScopeKey, now);
  if (!STUDIO_DRAFT_COLLABORATION_PROVISION_INTENTS.includes(input.intent)) {
    throw new Error("초안 협업 시작 목적이 올바르지 않습니다.");
  }
  if (
    !Number.isSafeInteger(input.initialSnapshotByteLength) ||
    input.initialSnapshotByteLength < 0 ||
    input.initialSnapshotByteLength >
      STUDIO_DRAFT_COLLABORATION_POLICY.maxInitialSnapshotBytes
  ) {
    throw new Error("초안 협업 스냅샷이 허용 크기를 초과했습니다.");
  }
  return {
    version: 1,
    draftDocumentId: input.identity.draftDocumentId,
    ownerScopeKey: input.identity.ownerScopeKey,
    intent: input.intent,
    clientMutationId: requestedUuid(input.createUuid),
    initialSnapshotByteLength: input.initialSnapshotByteLength,
    requestedAt: iso(now),
  };
}

/**
 * Cheap local back-pressure for repeated clicks. This is intentionally not an authorization
 * control; the future API must enforce a distributed owner+draft rate limit as well.
 */
export function consumeStudioDraftCollaborationProvisionAttempt(
  current: StudioDraftCollaborationProvisionGate | null,
  input: {
    readonly identity: StudioDraftCollaborationIdentity;
    readonly now?: number;
  }
): StudioDraftCollaborationProvisionGateResult {
  const now = input.now ?? Date.now();
  iso(now);
  const sameWindow =
    current?.draftDocumentId === input.identity.draftDocumentId &&
    current.ownerScopeKey === input.identity.ownerScopeKey &&
    now >= current.windowStartedAt &&
    now - current.windowStartedAt < STUDIO_DRAFT_COLLABORATION_POLICY.provisionRateWindowMs;
  const windowStartedAt = sameWindow && current ? current.windowStartedAt : now;
  const attempts = sameWindow && current ? current.attempts : 0;
  if (attempts >= STUDIO_DRAFT_COLLABORATION_POLICY.provisionAttemptsPerWindow) {
    return {
      allowed: false,
      retryAfterMs: Math.max(
        0,
        STUDIO_DRAFT_COLLABORATION_POLICY.provisionRateWindowMs - (now - windowStartedAt)
      ),
      next: {
        draftDocumentId: input.identity.draftDocumentId,
        ownerScopeKey: input.identity.ownerScopeKey,
        windowStartedAt,
        attempts,
      },
    };
  }
  return {
    allowed: true,
    retryAfterMs: 0,
    next: {
      draftDocumentId: input.identity.draftDocumentId,
      ownerScopeKey: input.identity.ownerScopeKey,
      windowStartedAt,
      attempts: attempts + 1,
    },
  };
}

/**
 * Builds the idempotent promotion command. A server implementation must retain provisionalWorkId,
 * mark the room/work durable in one transaction and increment graphRevision exactly once. It must
 * never copy or re-key membership, events, comments or CRDT roots during promotion.
 */
export function createStudioDraftCollaborationPromotionRequest(input: {
  readonly identity: StudioDraftCollaborationIdentity;
  readonly room: StudioDraftCollaborationTemporaryRoom;
  readonly actorAuthScopeKey: string;
  readonly targetWorkId: string;
  readonly expectedWorkRevision: number;
  readonly finalStatus: StudioDraftCollaborationFinalStatus;
  readonly now?: number;
  readonly createUuid?: () => string;
}): StudioDraftCollaborationPromotionRequest {
  const now = input.now ?? Date.now();
  assertCurrentOwnedIdentity(input.identity, input.actorAuthScopeKey, now);
  const targetWorkId = exactBoundedWorkId(input.targetWorkId);
  const provisionalWorkId = exactBoundedWorkId(input.room.provisionalWorkId);
  const roomProvisionedAt = finiteTimestamp(input.room.provisionedAt);
  const roomExpiresAt = finiteTimestamp(input.room.expiresAt);
  if (
    input.room.version !== 1 ||
    !DRAFT_ROOM_ID_PATTERN.test(input.room.roomId) ||
    input.room.draftDocumentId !== input.identity.draftDocumentId ||
    input.room.ownerScopeKey !== input.identity.ownerScopeKey ||
    !provisionalWorkId ||
    targetWorkId !== provisionalWorkId ||
    !Number.isSafeInteger(input.room.graphRevision) ||
    input.room.graphRevision < 0 ||
    !Number.isSafeInteger(input.expectedWorkRevision) ||
    input.expectedWorkRevision < 1 ||
    input.expectedWorkRevision > 2_147_483_647 ||
    !STUDIO_DRAFT_COLLABORATION_FINAL_STATUSES.includes(input.finalStatus) ||
    roomProvisionedAt === null ||
    roomExpiresAt === null ||
    roomProvisionedAt >= roomExpiresAt ||
    roomExpiresAt - now >
      STUDIO_DRAFT_COLLABORATION_POLICY.temporaryRoomIdleTtlMs ||
    roomExpiresAt <= now ||
    !targetWorkId
  ) {
    throw new Error("초안 협업 작업실을 이 작품으로 승격할 수 없습니다.");
  }
  return {
    version: 1,
    draftDocumentId: input.identity.draftDocumentId,
    roomId: input.room.roomId,
    ownerScopeKey: input.identity.ownerScopeKey,
    targetWorkId,
    expectedGraphRevision: input.room.graphRevision,
    expectedWorkRevision: input.expectedWorkRevision,
    finalStatus: input.finalStatus,
    clientMutationId: requestedUuid(input.createUuid),
    requestedAt: iso(now),
  };
}
