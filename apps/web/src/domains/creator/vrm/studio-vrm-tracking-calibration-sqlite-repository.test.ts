import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "../studio-local-database";

import {
  serializeCalibration,
  type TrackingCalibration,
} from "./studio-vrm-tracking-calibration";
import {
  createStudioVrmTrackingCalibrationSqliteRepository,
  STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_KEY,
  STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_NAMESPACE,
} from "./studio-vrm-tracking-calibration-sqlite-repository";

import type { StudioLocalDatabase } from "../studio-local-database";

const databases: StudioLocalDatabase[] = [];

const authored: TrackingCalibration = {
  headPitch: 0.11,
  headYaw: -0.22,
  headRoll: 0.03,
  gazeX: 0.14,
  gazeY: -0.15,
  blinkOpenL: 0.08,
  blinkOpenR: 0.09,
  mouthOpenBase: 0.04,
};

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("VRM tracking calibration SQLite repository", () => {
  it("round-trips the exact canonical pressure-adjacent tracking baseline", async () => {
    const database = await memoryDatabase();
    const repository = createStudioVrmTrackingCalibrationSqliteRepository({
      acquireDatabase: async () => database,
    });

    await repository.save(authored);

    await expect(database.kvGet(
      STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_NAMESPACE,
      STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_KEY,
    )).resolves.toBe(serializeCalibration(authored));
    await expect(createStudioVrmTrackingCalibrationSqliteRepository({
      acquireDatabase: async () => database,
    }).load()).resolves.toEqual(authored);
  });

  it("clears the SQLite row without creating a browser-storage fallback", async () => {
    const database = await memoryDatabase();
    const repository = createStudioVrmTrackingCalibrationSqliteRepository({
      acquireDatabase: async () => database,
    });
    await repository.save(authored);

    await repository.clear();

    await expect(repository.load()).resolves.toBeNull();
  });

  it("fails closed for malformed, noncanonical, future and non-finite rows", async () => {
    const database = await memoryDatabase();
    const repository = createStudioVrmTrackingCalibrationSqliteRepository({
      acquireDatabase: async () => database,
    });
    const cases = [
      "{broken",
      JSON.stringify({ ...JSON.parse(serializeCalibration(authored)), future: true }),
      JSON.stringify({ ...JSON.parse(serializeCalibration(authored)), v: 2 }),
      JSON.stringify({ ...JSON.parse(serializeCalibration(authored)), headPitch: "NaN" }),
      JSON.stringify(JSON.parse(serializeCalibration(authored)), null, 2),
    ];

    for (const raw of cases) {
      await database.kvSet(
        STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_NAMESPACE,
        STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_KEY,
        raw,
      );
      await expect(repository.load()).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("rejects invalid authored values before touching SQLite", async () => {
    const database = await memoryDatabase();
    const repository = createStudioVrmTrackingCalibrationSqliteRepository({
      acquireDatabase: async () => database,
    });

    await expect(repository.save({ ...authored, gazeX: Number.NaN })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(repository.save({
      ...authored,
      future: true,
    } as TrackingCalibration)).rejects.toMatchObject({ code: "invalid" });
    await expect(database.kvGet(
      STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_NAMESPACE,
      STUDIO_VRM_TRACKING_CALIBRATION_SQLITE_KEY,
    )).resolves.toBeNull();
  });

  it("serializes save then clear so stale calibration cannot reappear", async () => {
    const database = await memoryDatabase();
    let releaseWrite!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const delayed = {
      kvGet: database.kvGet.bind(database),
      kvDelete: database.kvDelete.bind(database),
      kvSet: vi.fn(async (namespace: string, key: string, value: string) => {
        await blocked;
        await database.kvSet(namespace, key, value);
      }),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioVrmTrackingCalibrationSqliteRepository({
      acquireDatabase: async () => delayed,
    });

    const save = repository.save(authored);
    const clear = repository.clear();
    await vi.waitFor(() => expect(delayed.kvSet).toHaveBeenCalledTimes(1));
    releaseWrite();
    await Promise.all([save, clear]);

    await expect(repository.load()).resolves.toBeNull();
  });

  it("never silently downgrades an OPFS failure to localStorage", async () => {
    const repository = createStudioVrmTrackingCalibrationSqliteRepository({
      acquireDatabase: async () => {
        throw new Error("OPFS unavailable");
      },
    });

    await expect(repository.load()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("OPFS unavailable"),
    });
    await expect(repository.save(authored)).rejects.toMatchObject({ code: "unavailable" });
  });
});
