/** V12 SQLite/OPFS authority for the engine-neutral VRM pose-material library. */

import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";
import {
  EMPTY_STUDIO_POSE_MATERIAL_LIBRARY,
  parseStudioPoseMaterialLibraryPayload,
  serializeStudioPoseMaterialLibraryPayload,
  STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES,
  type StudioPoseMaterialLibraryPayload,
} from "../studio-pose-material-library";

import type { StudioLocalDatabase } from "../studio-local-database";

export const STUDIO_VRM_POSE_MATERIAL_SQLITE_NAMESPACE =
  "studio-vrm-pose-materials-v12";
export const STUDIO_VRM_POSE_MATERIAL_SQLITE_KEY = "library-v1";

export type StudioVrmPoseMaterialSqliteErrorCode = "invalid" | "unavailable";

export class StudioVrmPoseMaterialSqliteError extends Error {
  readonly code: StudioVrmPoseMaterialSqliteErrorCode;

  constructor(
    code: StudioVrmPoseMaterialSqliteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioVrmPoseMaterialSqliteError";
    this.code = code;
  }
}

export interface StudioVrmPoseMaterialSqliteRepository {
  readonly authority: "sqlite";
  load(): Promise<StudioPoseMaterialLibraryPayload>;
  save(payload: StudioPoseMaterialLibraryPayload): Promise<StudioPoseMaterialLibraryPayload>;
}

export interface StudioVrmPoseMaterialSqliteRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function parseCanonicalStudioVrmPoseMaterialLibrary(
  raw: string,
): StudioPoseMaterialLibraryPayload {
  if (byteLength(raw) > STUDIO_POSE_MATERIAL_LIBRARY_MAX_BYTES) {
    throw new StudioVrmPoseMaterialSqliteError(
      "invalid",
      "VRM pose-material SQLite row exceeds the 256 KiB budget.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    throw new StudioVrmPoseMaterialSqliteError(
      "invalid",
      "VRM pose-material SQLite JSON is corrupt.",
    );
  }
  const payload = parseStudioPoseMaterialLibraryPayload(decoded);
  const canonical = payload ? serializeStudioPoseMaterialLibraryPayload(payload) : null;
  if (!payload || canonical !== raw) {
    throw new StudioVrmPoseMaterialSqliteError(
      "invalid",
      "VRM pose-material SQLite row is invalid or non-canonical.",
    );
  }
  return payload;
}

function serializePayload(payload: StudioPoseMaterialLibraryPayload): string {
  const serialized = serializeStudioPoseMaterialLibraryPayload(payload);
  if (!serialized) {
    throw new StudioVrmPoseMaterialSqliteError(
      "invalid",
      "VRM pose-material payload failed its strict count, schema, or byte budget.",
    );
  }
  return serialized;
}

function unavailable(error: unknown, operation: string): never {
  if (error instanceof StudioVrmPoseMaterialSqliteError) throw error;
  throw new StudioVrmPoseMaterialSqliteError(
    "unavailable",
    `VRM pose-material SQLite ${operation} failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}

export function createStudioVrmPoseMaterialSqliteRepository(
  options: StudioVrmPoseMaterialSqliteRepositoryOptions = {},
): StudioVrmPoseMaterialSqliteRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  let mutationTail: Promise<void> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function database(): Promise<StudioLocalDatabase> {
    try {
      return await acquireDatabase();
    } catch (error) {
      unavailable(error, "open");
    }
  }

  return {
    authority: "sqlite",

    async load() {
      await mutationTail;
      try {
        const raw = await (await database()).kvGet(
          STUDIO_VRM_POSE_MATERIAL_SQLITE_NAMESPACE,
          STUDIO_VRM_POSE_MATERIAL_SQLITE_KEY,
        );
        return raw === null
          ? EMPTY_STUDIO_POSE_MATERIAL_LIBRARY
          : parseCanonicalStudioVrmPoseMaterialLibrary(raw);
      } catch (error) {
        unavailable(error, "read");
      }
    },

    save(payload) {
      const serialized = serializePayload(payload);
      const canonical = parseCanonicalStudioVrmPoseMaterialLibrary(serialized);
      return enqueue(async () => {
        try {
          await (await database()).kvSet(
            STUDIO_VRM_POSE_MATERIAL_SQLITE_NAMESPACE,
            STUDIO_VRM_POSE_MATERIAL_SQLITE_KEY,
            serialized,
          );
          return canonical;
        } catch (error) {
          unavailable(error, "write");
        }
      });
    },
  };
}
