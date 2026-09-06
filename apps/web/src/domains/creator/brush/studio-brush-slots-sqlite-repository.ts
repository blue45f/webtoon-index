/** SQLite/OPFS product authority for device-scoped brush quick slots. */

import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";

import {
  emptyStudioBrushSlots,
  normalizeStudioBrushSlot,
  normalizeStudioBrushSlotsState,
  STUDIO_BRUSH_SLOT_COUNT,
  STUDIO_BRUSH_SLOTS_LEGACY_AUTO_MIGRATION,
} from "./studio-brush-slots";

import type {
  StudioBrushSlot,
  StudioBrushSlotsState,
} from "./studio-brush-slots";
import type { StudioLocalDatabase } from "../studio-local-database";

export const STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE =
  "studio-brush-quick-slots-v12";
export const STUDIO_BRUSH_QUICK_SLOTS_SCHEMA =
  "toonspectrum.studio.brush-quick-slots";
export const STUDIO_BRUSH_QUICK_SLOTS_SCHEMA_VERSION = 1 as const;
export const STUDIO_BRUSH_QUICK_SLOTS_LEGACY_MIGRATION =
  STUDIO_BRUSH_SLOTS_LEGACY_AUTO_MIGRATION;

const OWNER_SCOPE_MAX_LENGTH = 256;
const DEVICE_PROFILE_MAX_LENGTH = 192;

export interface StudioBrushQuickSlotsScope {
  readonly ownerScope: string;
  readonly deviceProfile: string;
}

export interface StudioBrushQuickSlotsSnapshot extends StudioBrushSlotsState {
  readonly ownerScope: string;
  readonly deviceProfile: string;
  readonly revision: number;
  readonly updatedAt: number;
}

export type StudioBrushQuickSlotsSqliteRepositoryErrorCode =
  | "conflict"
  | "invalid"
  | "unavailable";

export class StudioBrushQuickSlotsSqliteRepositoryError extends Error {
  readonly code: StudioBrushQuickSlotsSqliteRepositoryErrorCode;

  constructor(
    code: StudioBrushQuickSlotsSqliteRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioBrushQuickSlotsSqliteRepositoryError";
    this.code = code;
  }
}

export interface StudioBrushQuickSlotsSqliteRepository {
  readonly authority: "sqlite";
  readonly legacyMigration: "disabled";
  load(scope: StudioBrushQuickSlotsScope): Promise<StudioBrushQuickSlotsSnapshot>;
  save(
    scope: StudioBrushQuickSlotsScope,
    state: StudioBrushSlotsState,
    expectedRevision: number,
  ): Promise<StudioBrushQuickSlotsSnapshot>;
  clear(
    scope: StudioBrushQuickSlotsScope,
    expectedRevision: number,
  ): Promise<StudioBrushQuickSlotsSnapshot>;
  subscribe(listener: (snapshot: StudioBrushQuickSlotsSnapshot) => void): () => void;
}

export interface StudioBrushQuickSlotsSqliteRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  readonly now?: () => number;
}

interface PersistedStudioBrushQuickSlot extends StudioBrushSlot {
  readonly slotIndex: number;
}

interface PersistedStudioBrushQuickSlotsEnvelope {
  readonly schema: typeof STUDIO_BRUSH_QUICK_SLOTS_SCHEMA;
  readonly version: typeof STUDIO_BRUSH_QUICK_SLOTS_SCHEMA_VERSION;
  readonly ownerScope: string;
  readonly deviceProfile: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly slots: readonly PersistedStudioBrushQuickSlot[];
}

function invalid(message: string, options?: ErrorOptions): never {
  throw new StudioBrushQuickSlotsSqliteRepositoryError("invalid", message, options);
}

function unavailable(error: unknown, operation: string): never {
  if (error instanceof StudioBrushQuickSlotsSqliteRepositoryError) throw error;
  throw new StudioBrushQuickSlotsSqliteRepositoryError(
    "unavailable",
    `브러시 퀵 슬롯 SQLite ${operation}를 완료하지 못했습니다: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}

function canonicalIdentifier(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    invalid(`브러시 퀵 슬롯 ${field}가 문자열이 아닙니다.`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0
    || Array.from(normalized).length > maxLength
    || normalized.includes("\u0000")
  ) {
    invalid(`브러시 퀵 슬롯 ${field}가 비어 있거나 허용 길이를 벗어났습니다.`);
  }
  return normalized;
}

function canonicalScope(scope: StudioBrushQuickSlotsScope): StudioBrushQuickSlotsScope {
  return {
    ownerScope: canonicalIdentifier(scope.ownerScope, "ownerScope", OWNER_SCOPE_MAX_LENGTH),
    deviceProfile: canonicalIdentifier(
      scope.deviceProfile,
      "deviceProfile",
      DEVICE_PROFILE_MAX_LENGTH,
    ),
  };
}

function canonicalRevision(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`브러시 퀵 슬롯 ${field}이 안전한 0 이상의 정수가 아닙니다.`);
  }
  return value as number;
}

function canonicalTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid("브러시 퀵 슬롯 updatedAt이 안전한 0 이상의 정수가 아닙니다.");
  }
  return value as number;
}

export function studioBrushQuickSlotsSqliteKey(
  scope: StudioBrushQuickSlotsScope,
): string {
  const canonical = canonicalScope(scope);
  return `profile-v1:${JSON.stringify([canonical.ownerScope, canonical.deviceProfile])}`;
}

function persistedSlots(state: StudioBrushSlotsState): PersistedStudioBrushQuickSlot[] {
  return normalizeStudioBrushSlotsState(state).slots.flatMap((slot, slotIndex) =>
    slot === null ? [] : [{ slotIndex, ...slot }]);
}

function envelopeFromSnapshot(
  snapshot: StudioBrushQuickSlotsSnapshot,
): PersistedStudioBrushQuickSlotsEnvelope {
  const scope = canonicalScope(snapshot);
  return {
    schema: STUDIO_BRUSH_QUICK_SLOTS_SCHEMA,
    version: STUDIO_BRUSH_QUICK_SLOTS_SCHEMA_VERSION,
    ownerScope: scope.ownerScope,
    deviceProfile: scope.deviceProfile,
    revision: canonicalRevision(snapshot.revision, "revision"),
    updatedAt: canonicalTimestamp(snapshot.updatedAt),
    slots: persistedSlots(snapshot),
  };
}

export function serializeStudioBrushQuickSlotsSnapshot(
  snapshot: StudioBrushQuickSlotsSnapshot,
): string {
  return JSON.stringify(envelopeFromSnapshot(snapshot));
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function snapshotFromEnvelope(
  envelope: Record<string, unknown>,
): StudioBrushQuickSlotsSnapshot {
  if (
    envelope.schema !== STUDIO_BRUSH_QUICK_SLOTS_SCHEMA
    || envelope.version !== STUDIO_BRUSH_QUICK_SLOTS_SCHEMA_VERSION
    || !Array.isArray(envelope.slots)
  ) {
    invalid("브러시 퀵 슬롯 SQLite 행의 스키마 또는 버전이 올바르지 않습니다.");
  }
  const scope = canonicalScope({
    ownerScope: envelope.ownerScope as string,
    deviceProfile: envelope.deviceProfile as string,
  });
  const slots = emptyStudioBrushSlots().slots;
  const occupied = new Set<number>();
  let previousSlotIndex = -1;
  for (const candidate of envelope.slots) {
    const record = objectRecord(candidate);
    if (record === null || !Number.isInteger(record.slotIndex)) {
      invalid("브러시 퀵 슬롯 SQLite 행에 유효한 slotIndex가 없습니다.");
    }
    const slotIndex = record.slotIndex as number;
    if (
      slotIndex < 0
      || slotIndex >= STUDIO_BRUSH_SLOT_COUNT
      || occupied.has(slotIndex)
      || slotIndex <= previousSlotIndex
    ) {
      invalid("브러시 퀵 슬롯 SQLite 행의 slotIndex가 중복되었거나 정렬되지 않았습니다.");
    }
    const slot = normalizeStudioBrushSlot(record);
    if (slot === null) {
      invalid("브러시 퀵 슬롯 SQLite 행에 알 수 없는 브러시가 있습니다.");
    }
    occupied.add(slotIndex);
    previousSlotIndex = slotIndex;
    slots[slotIndex] = slot;
  }
  return {
    ...scope,
    revision: canonicalRevision(envelope.revision, "revision"),
    updatedAt: canonicalTimestamp(envelope.updatedAt),
    slots,
  };
}

export function parseStudioBrushQuickSlotsSnapshot(
  raw: string,
): StudioBrushQuickSlotsSnapshot {
  try {
    const record = objectRecord(JSON.parse(raw));
    if (record === null) {
      invalid("브러시 퀵 슬롯 SQLite 행이 객체가 아닙니다.");
    }
    const snapshot = snapshotFromEnvelope(record);
    if (serializeStudioBrushQuickSlotsSnapshot(snapshot) !== raw) {
      invalid("브러시 퀵 슬롯 SQLite 행이 손상되었거나 비정규 형식입니다.");
    }
    return snapshot;
  } catch (error) {
    if (error instanceof StudioBrushQuickSlotsSqliteRepositoryError) throw error;
    invalid("브러시 퀵 슬롯 SQLite 행을 해석하지 못했습니다.", { cause: error });
  }
}

function emptySnapshot(scope: StudioBrushQuickSlotsScope): StudioBrushQuickSlotsSnapshot {
  return {
    ...canonicalScope(scope),
    ...emptyStudioBrushSlots(),
    revision: 0,
    updatedAt: 0,
  };
}

function nextSnapshot(
  current: StudioBrushQuickSlotsSnapshot,
  state: StudioBrushSlotsState,
  updatedAt: number,
): StudioBrushQuickSlotsSnapshot {
  if (current.revision >= Number.MAX_SAFE_INTEGER) {
    invalid("브러시 퀵 슬롯 revision이 더 이상 증가할 수 없습니다.");
  }
  return {
    ownerScope: current.ownerScope,
    deviceProfile: current.deviceProfile,
    ...normalizeStudioBrushSlotsState(state),
    revision: current.revision + 1,
    updatedAt: canonicalTimestamp(updatedAt),
  };
}

export function createStudioBrushQuickSlotsSqliteRepository(
  options: StudioBrushQuickSlotsSqliteRepositoryOptions = {},
): StudioBrushQuickSlotsSqliteRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  const now = options.now ?? Date.now;
  const listeners = new Set<(snapshot: StudioBrushQuickSlotsSnapshot) => void>();
  let mutationTail: Promise<void> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(work, work);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function open(): Promise<StudioLocalDatabase> {
    try {
      return await acquireDatabase();
    } catch (error) {
      unavailable(error, "열기");
    }
  }

  async function read(
    database: StudioLocalDatabase,
    scope: StudioBrushQuickSlotsScope,
  ): Promise<StudioBrushQuickSlotsSnapshot> {
    const canonical = canonicalScope(scope);
    const raw = await database.kvGet(
      STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE,
      studioBrushQuickSlotsSqliteKey(canonical),
    );
    if (raw === null) return emptySnapshot(canonical);
    const snapshot = parseStudioBrushQuickSlotsSnapshot(raw);
    if (
      snapshot.ownerScope !== canonical.ownerScope
      || snapshot.deviceProfile !== canonical.deviceProfile
    ) {
      invalid("브러시 퀵 슬롯 SQLite 키와 저장 scope가 일치하지 않습니다.");
    }
    return snapshot;
  }

  async function restore(
    database: StudioLocalDatabase,
    key: string,
    previousRaw: string | null,
  ): Promise<void> {
    if (previousRaw === null) {
      await database.kvDelete(STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE, key);
    } else {
      await database.kvSet(STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE, key, previousRaw);
    }
  }

  async function mutate(
    scope: StudioBrushQuickSlotsScope,
    state: StudioBrushSlotsState,
    expectedRevision: number,
  ): Promise<StudioBrushQuickSlotsSnapshot> {
    const canonicalExpectedRevision = canonicalRevision(expectedRevision, "expectedRevision");
    const canonical = canonicalScope(scope);
    const database = await open();
    const key = studioBrushQuickSlotsSqliteKey(canonical);
    const previousRaw = await database.kvGet(
      STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE,
      key,
    );
    const current = previousRaw === null
      ? emptySnapshot(canonical)
      : parseStudioBrushQuickSlotsSnapshot(previousRaw);
    if (
      current.ownerScope !== canonical.ownerScope
      || current.deviceProfile !== canonical.deviceProfile
    ) {
      invalid("브러시 퀵 슬롯 SQLite 키와 저장 scope가 일치하지 않습니다.");
    }
    if (current.revision !== canonicalExpectedRevision) {
      throw new StudioBrushQuickSlotsSqliteRepositoryError(
        "conflict",
        `브러시 퀵 슬롯 revision 충돌: expected ${canonicalExpectedRevision}, actual ${
          current.revision
        }`,
      );
    }

    const next = nextSnapshot(current, state, now());
    const canonicalRaw = serializeStudioBrushQuickSlotsSnapshot(next);
    try {
      await database.kvSet(
        STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE,
        key,
        canonicalRaw,
      );
      const verified = await database.kvGet(
        STUDIO_BRUSH_QUICK_SLOTS_SQLITE_NAMESPACE,
        key,
      );
      if (verified !== canonicalRaw) {
        throw new Error("브러시 퀵 슬롯 SQLite 저장 후 byte 검증에 실패했습니다.");
      }
    } catch (error) {
      try {
        await restore(database, key, previousRaw);
      } catch (rollbackError) {
        throw new StudioBrushQuickSlotsSqliteRepositoryError(
          "unavailable",
          "브러시 퀵 슬롯 SQLite 저장과 이전 상태 복구가 모두 실패했습니다.",
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
      unavailable(error, "저장");
    }
    for (const listener of listeners) {
      try {
        listener(next);
      } catch {
        // A view listener cannot turn a verified durable commit into a reported write failure.
      }
    }
    return next;
  }

  return {
    authority: "sqlite",
    legacyMigration: "disabled",

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async load(scope) {
      await mutationTail;
      try {
        return await read(await open(), scope);
      } catch (error) {
        unavailable(error, "읽기");
      }
    },

    save(scope, state, expectedRevision) {
      return enqueue(async () => {
        try {
          return await mutate(scope, state, expectedRevision);
        } catch (error) {
          unavailable(error, "저장");
        }
      });
    },

    clear(scope, expectedRevision) {
      return enqueue(async () => {
        try {
          return await mutate(scope, emptyStudioBrushSlots(), expectedRevision);
        } catch (error) {
          unavailable(error, "삭제");
        }
      });
    },
  };
}

let productRepository: StudioBrushQuickSlotsSqliteRepository | null = null;

export function getProductStudioBrushQuickSlotsSqliteRepository():
StudioBrushQuickSlotsSqliteRepository {
  productRepository ??= createStudioBrushQuickSlotsSqliteRepository();
  return productRepository;
}
