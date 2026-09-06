import {
  readStudioAutosave,
  serializeStudioAutosave,
  studioAutosaveHasContent,
  type StudioAutosavePayload,
} from "./studio-autosave";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";

import type { StudioLocalDatabase } from "./studio-local-database";

export const STUDIO_AUTOSAVE_SQLITE_NAMESPACE = "studio-autosave-v1" as const;
export const STUDIO_AUTOSAVE_SQLITE_ENVELOPE_KIND =
  "toonspectrum:studio-autosave-sqlite" as const;
export const STUDIO_AUTOSAVE_SQLITE_ENVELOPE_VERSION = 1 as const;

type StudioAutosaveSqliteEnvelope = Readonly<{
  kind: typeof STUDIO_AUTOSAVE_SQLITE_ENVELOPE_KIND;
  version: typeof STUDIO_AUTOSAVE_SQLITE_ENVELOPE_VERSION;
  state: "snapshot" | "cleared";
  savedAt: string;
  payload: string | null;
}>;

export type StudioAutosaveSqliteReadResult =
  | Readonly<{
      state: "snapshot";
      savedAt: string;
      payload: StudioAutosavePayload;
    }>
  | Readonly<{
      state: "cleared";
      savedAt: string;
    }>
  | null;

export interface StudioAutosaveSqlitePort {
  read(key: string): Promise<StudioAutosaveSqliteReadResult>;
  write(key: string, payload: StudioAutosavePayload): Promise<void>;
  clear(key: string, savedAt?: string): Promise<void>;
}

function validSavedAt(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length >= 20
    && value.length <= 64
    && Number.isFinite(Date.parse(value))
  );
}

function encodeEnvelope(
  state: "snapshot" | "cleared",
  savedAt: string,
  payload: StudioAutosavePayload | null,
): string {
  if (!validSavedAt(savedAt)) {
    throw new Error("SQLite 자동저장 시각이 올바르지 않습니다.");
  }
  const envelope: StudioAutosaveSqliteEnvelope = Object.freeze({
    kind: STUDIO_AUTOSAVE_SQLITE_ENVELOPE_KIND,
    version: STUDIO_AUTOSAVE_SQLITE_ENVELOPE_VERSION,
    state,
    savedAt,
    payload: payload === null ? null : serializeStudioAutosave(payload),
  });
  return JSON.stringify(envelope);
}

function decodeEnvelope(raw: string, key: string): StudioAutosaveSqliteReadResult {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (cause) {
    throw new Error("SQLite 자동저장 envelope JSON이 손상되었습니다.", { cause });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("SQLite 자동저장 envelope 형식이 올바르지 않습니다.");
  }
  const envelope = value as Partial<StudioAutosaveSqliteEnvelope>;
  if (
    envelope.kind !== STUDIO_AUTOSAVE_SQLITE_ENVELOPE_KIND
    || envelope.version !== STUDIO_AUTOSAVE_SQLITE_ENVELOPE_VERSION
    || (envelope.state !== "snapshot" && envelope.state !== "cleared")
    || !validSavedAt(envelope.savedAt)
  ) {
    throw new Error("SQLite 자동저장 envelope 계약이 일치하지 않습니다.");
  }
  if (envelope.state === "cleared") {
    if (envelope.payload !== null) {
      throw new Error("SQLite 자동저장 tombstone에 payload가 포함되어 있습니다.");
    }
    return Object.freeze({ state: "cleared", savedAt: envelope.savedAt });
  }
  if (typeof envelope.payload !== "string") {
    throw new Error("SQLite 자동저장 snapshot payload가 없습니다.");
  }
  const normalized = readStudioAutosave(
    { getItem: (candidate) => (candidate === key ? envelope.payload! : null) },
    key,
  )?.payload ?? null;
  if (!normalized || !studioAutosaveHasContent(normalized)) {
    throw new Error("SQLite 자동저장 snapshot에 복구할 Studio 내용이 없습니다.");
  }
  if (normalized.savedAt !== envelope.savedAt) {
    throw new Error("SQLite 자동저장 envelope와 payload 시각이 일치하지 않습니다.");
  }
  return Object.freeze({
    state: "snapshot",
    savedAt: envelope.savedAt,
    payload: normalized,
  });
}

export function createStudioAutosaveSqliteStore(
  database: Pick<StudioLocalDatabase, "kvGet" | "kvSet">,
): StudioAutosaveSqlitePort {
  return Object.freeze({
    async read(key: string) {
      const raw = await database.kvGet(STUDIO_AUTOSAVE_SQLITE_NAMESPACE, key);
      return raw === null ? null : decodeEnvelope(raw, key);
    },
    async write(key: string, payload: StudioAutosavePayload) {
      if (!studioAutosaveHasContent(payload)) {
        throw new Error("내용이 없는 Studio 자동저장은 SQLite snapshot으로 기록하지 않습니다.");
      }
      await database.kvSet(
        STUDIO_AUTOSAVE_SQLITE_NAMESPACE,
        key,
        encodeEnvelope("snapshot", payload.savedAt, payload),
      );
    },
    async clear(key: string, savedAt = new Date().toISOString()) {
      await database.kvSet(
        STUDIO_AUTOSAVE_SQLITE_NAMESPACE,
        key,
        encodeEnvelope("cleared", savedAt, null),
      );
    },
  });
}

/** Lazy product entry: shares the single app-lifetime OPFS SQLite handle with history/tournament. */
export async function acquireStudioAutosaveSqliteStore(): Promise<StudioAutosaveSqlitePort> {
  return createStudioAutosaveSqliteStore(await acquireStudioLocalDatabase());
}
