/** SQLite/OPFS authority for device-specific VRM tracking calibration. */

import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";

import {
  deserializeCalibration,
  serializeCalibration,
  type TrackingCalibration,
} from "./studio-vrm-tracking-calibration";

import type { StudioLocalDatabase } from "../studio-local-database";

export const STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_NAMESPACE =
  "studio-vrm-tracking-calibration-v12";
export const STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_KEY = "device-default-v1";

export type StudioVrmTrackingCalibrationRepositoryErrorCode =
  | "invalid"
  | "unavailable";

export class StudioVrmTrackingCalibrationRepositoryError extends Error {
  readonly code: StudioVrmTrackingCalibrationRepositoryErrorCode;

  constructor(
    code: StudioVrmTrackingCalibrationRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioVrmTrackingCalibrationRepositoryError";
    this.code = code;
  }
}

export interface StudioVrmTrackingCalibrationRepository {
  readonly authority: "sqlite";
  load(): Promise<TrackingCalibration | null>;
  save(calibration: TrackingCalibration): Promise<void>;
  clear(): Promise<void>;
}

export interface StudioVrmTrackingCalibrationRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
}

function parseCanonicalCalibration(raw: string): TrackingCalibration {
  const calibration = deserializeCalibration(raw);
  if (calibration === null || serializeCalibration(calibration) !== raw) {
    throw new StudioVrmTrackingCalibrationRepositoryError(
      "invalid",
      "VRM 트래킹 캘리브레이션 SQLite 행이 손상되었거나 비정규 형식입니다.",
    );
  }
  return calibration;
}

function canonicalCalibration(calibration: TrackingCalibration): string {
  const serialized = serializeCalibration(calibration);
  const parsed = deserializeCalibration(serialized);
  if (parsed === null || serializeCalibration(parsed) !== serialized) {
    throw new StudioVrmTrackingCalibrationRepositoryError(
      "invalid",
      "VRM 트래킹 캘리브레이션에 유한하지 않거나 누락된 값이 있습니다.",
    );
  }
  return serializeCalibration(parsed);
}

function unavailable(error: unknown, operation: string): never {
  if (error instanceof StudioVrmTrackingCalibrationRepositoryError) throw error;
  throw new StudioVrmTrackingCalibrationRepositoryError(
    "unavailable",
    `VRM 트래킹 캘리브레이션 SQLite ${operation}를 완료하지 못했습니다: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}

export function createStudioVrmTrackingCalibrationSqliteRepository(
  options: StudioVrmTrackingCalibrationRepositoryOptions = {},
): StudioVrmTrackingCalibrationRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  let mutationTail: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): Promise<void> {
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

  return {
    authority: "sqlite",

    async load() {
      await mutationTail;
      try {
        const database = await open();
        const raw = await database.kvGet(
          STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_NAMESPACE,
          STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_KEY,
        );
        return raw === null ? null : parseCanonicalCalibration(raw);
      } catch (error) {
        unavailable(error, "읽기");
      }
    },

    save(calibration) {
      return enqueue(async () => {
        try {
          const canonical = canonicalCalibration(calibration);
          const database = await open();
          await database.kvSet(
            STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_NAMESPACE,
            STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_KEY,
            canonical,
          );
        } catch (error) {
          unavailable(error, "저장");
        }
      });
    },

    clear() {
      return enqueue(async () => {
        try {
          const database = await open();
          await database.kvDelete(
            STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_NAMESPACE,
            STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_KEY,
          );
        } catch (error) {
          unavailable(error, "삭제");
        }
      });
    },
  };
}
