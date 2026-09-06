import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "../studio-local-database";
import {
  STUDIO_POSE_MATERIAL_KIND,
  STUDIO_POSE_MATERIAL_VERSION,
  STUDIO_POSE_ROTATION_CONVENTION,
  parseStudioPoseMaterial,
  type StudioPoseMaterial,
} from "../studio-pose-material";
import {
  STUDIO_POSE_MATERIAL_LIBRARY_KIND,
  STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
  type StudioPoseMaterialLibraryPayload,
} from "../studio-pose-material-library";

import {
  createStudioVrmPoseMaterialSqliteRepository,
  parseCanonicalStudioVrmPoseMaterialLibrary,
  STUDIO_VRM_POSE_MATERIAL_SQLITE_KEY,
  STUDIO_VRM_POSE_MATERIAL_SQLITE_NAMESPACE,
} from "./studio-vrm-pose-material-sqlite-repository";

import type { StudioLocalDatabase } from "../studio-local-database";

const opened: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  opened.push(database);
  return database;
}

function material(id = "pose-alpha", name = "알파 소재"): StudioPoseMaterial {
  const parsed = parseStudioPoseMaterial({
    kind: STUDIO_POSE_MATERIAL_KIND,
    version: STUDIO_POSE_MATERIAL_VERSION,
    rotationConvention: STUDIO_POSE_ROTATION_CONVENTION,
    id,
    name,
    scope: "upper",
    bones: [{ bone: "head", rotation: [0, 0, 0, 1] }],
    metadata: { description: "", tags: [] },
  });
  if (!parsed) throw new Error("invalid test pose material");
  return parsed;
}

function payload(...materials: StudioPoseMaterial[]): StudioPoseMaterialLibraryPayload {
  return {
    kind: STUDIO_POSE_MATERIAL_LIBRARY_KIND,
    version: STUDIO_POSE_MATERIAL_LIBRARY_VERSION,
    materials,
  };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.close()));
});

describe("VRM pose-material SQLite repository", () => {
  it("round-trips one strict canonical material library through real sqlite-wasm", async () => {
    const database = await memoryDatabase();
    const repository = createStudioVrmPoseMaterialSqliteRepository({
      acquireDatabase: async () => database,
    });
    const authored = payload(material());

    await expect(repository.load()).resolves.toMatchObject({ materials: [] });
    await expect(repository.save(authored)).resolves.toEqual(authored);
    await expect(repository.load()).resolves.toEqual(authored);
    const raw = await database.kvGet(
      STUDIO_VRM_POSE_MATERIAL_SQLITE_NAMESPACE,
      STUDIO_VRM_POSE_MATERIAL_SQLITE_KEY,
    );
    expect(raw).not.toBeNull();
    expect(parseCanonicalStudioVrmPoseMaterialLibrary(raw!)).toEqual(authored);
    expect(STUDIO_VRM_POSE_MATERIAL_SQLITE_NAMESPACE).toContain("v12");
  });

  it("fails closed on corrupt, future, and non-canonical rows", async () => {
    const database = await memoryDatabase();
    const repository = createStudioVrmPoseMaterialSqliteRepository({
      acquireDatabase: async () => database,
    });
    await database.kvSet(
      STUDIO_VRM_POSE_MATERIAL_SQLITE_NAMESPACE,
      STUDIO_VRM_POSE_MATERIAL_SQLITE_KEY,
      "{broken",
    );
    await expect(repository.load()).rejects.toMatchObject({ code: "invalid" });

    await database.kvSet(
      STUDIO_VRM_POSE_MATERIAL_SQLITE_NAMESPACE,
      STUDIO_VRM_POSE_MATERIAL_SQLITE_KEY,
      JSON.stringify({ ...payload(), version: 99 }),
    );
    await expect(repository.load()).rejects.toMatchObject({ code: "invalid" });

    await database.kvSet(
      STUDIO_VRM_POSE_MATERIAL_SQLITE_NAMESPACE,
      STUDIO_VRM_POSE_MATERIAL_SQLITE_KEY,
      JSON.stringify(payload(material()), null, 2),
    );
    await expect(repository.load()).rejects.toMatchObject({ code: "invalid" });
  });

  it("queues overlapping writes in invocation order", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let writes = 0;
    let latest = "";
    const database = {
      kvSet: vi.fn(async (_namespace: string, _key: string, value: string) => {
        if (++writes === 1) await gate;
        latest = value;
      }),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioVrmPoseMaterialSqliteRepository({
      acquireDatabase: async () => database,
    });

    const first = repository.save(payload(material("pose-same", "첫 저장")));
    const second = repository.save(payload(material("pose-same", "마지막 저장")));
    await vi.waitFor(() => expect(writes).toBe(1));
    releaseFirst();
    await Promise.all([first, second]);
    expect(parseCanonicalStudioVrmPoseMaterialLibrary(latest).materials[0]?.name)
      .toBe("마지막 저장");
  });

  it("surfaces OPFS failure without probing a browser storage fallback", async () => {
    const repository = createStudioVrmPoseMaterialSqliteRepository({
      acquireDatabase: async () => {
        throw new Error("OPFS unavailable");
      },
    });
    await expect(repository.load()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("OPFS unavailable"),
    });
  });
});
