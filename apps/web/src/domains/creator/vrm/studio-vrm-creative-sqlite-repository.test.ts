import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "../studio-local-database";

import {
  createStudioVrmCreativeSqliteRepository,
  parseCanonicalStudioVrmCustomPoseLibrary,
  parseCanonicalStudioVrmFullStateLibrary,
  parseStudioVrmCustomPoseImport,
  serializeStudioVrmCustomPoseLibrary,
  serializeStudioVrmFullStateLibrary,
  STUDIO_VRM_CREATIVE_SQLITE_KEY,
  STUDIO_VRM_CUSTOM_POSE_LIBRARY_MAX_COUNT,
  STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE,
  STUDIO_VRM_FULL_STATE_SQLITE_NAMESPACE,
  type StudioVrmCustomPose,
} from "./studio-vrm-creative-sqlite-repository";
import { EMPTY_STUDIO_VRM_POSE_TRANSLATIONS } from "./studio-vrm-pose-translations";
import { serializeFullVrmState, type FullVrmState } from "./studio-vrm-poser-utils";

import type { StudioLocalDatabase } from "../studio-local-database";

const opened: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  opened.push(database);
  return database;
}

function customPose(id = "custom-alpha", label = "알파 포즈"): StudioVrmCustomPose {
  return {
    id,
    label,
    yOffset: 0.25,
    bones: {
      head: { rotation: [0.1, 0.2, 0.3] },
      leftHand: { direction: { sideX: 0.2, y: -0.9, z: 0 } },
    },
    poseTranslations: {
      version: 1,
      root: [0.2, 0, -0.1],
      hips: [0, 0.1, 0],
      spine: [0, 0.05, 0],
    },
    expressionWeights: { blink: 0.2, happy: 0.7 },
  };
}

function fullState(poseId = "state-alpha"): FullVrmState {
  return serializeFullVrmState({
    version: 3,
    poseId,
    bones: { head: { rotation: [0.1, 0, 0] } },
    yOffset: 0.1,
    poseTranslations: EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
    ikConstraints: [],
    bodyRotation: 0,
    expressionWeights: { happy: 0.5 },
  });
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.close()));
});

describe("VRM creative SQLite repository", () => {
  it("round-trips custom poses and full states through separate real sqlite-wasm namespaces", async () => {
    const database = await memoryDatabase();
    const repository = createStudioVrmCreativeSqliteRepository({
      acquireDatabase: async () => database,
    });
    const pose = customPose();
    const state = fullState();

    await expect(repository.loadCustomPoses()).resolves.toEqual([]);
    await expect(repository.loadFullStates()).resolves.toEqual({});
    await expect(repository.saveCustomPoses([pose])).resolves.toEqual([pose]);
    await expect(repository.saveFullStates({ "완성 상태": state })).resolves.toEqual({
      "완성 상태": state,
    });

    const reopened = createStudioVrmCreativeSqliteRepository({
      acquireDatabase: async () => database,
    });
    await expect(reopened.loadCustomPoses()).resolves.toEqual([pose]);
    await expect(reopened.loadFullStates()).resolves.toEqual({ "완성 상태": state });
    expect(
      await database.kvGet(
        STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE,
        STUDIO_VRM_CREATIVE_SQLITE_KEY,
      ),
    ).toBe(serializeStudioVrmCustomPoseLibrary([pose]));
    expect(
      await database.kvGet(
        STUDIO_VRM_FULL_STATE_SQLITE_NAMESPACE,
        STUDIO_VRM_CREATIVE_SQLITE_KEY,
      ),
    ).toBe(serializeStudioVrmFullStateLibrary({ "완성 상태": state }));
    expect(STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE).toContain("v12");
    expect(STUDIO_VRM_FULL_STATE_SQLITE_NAMESPACE).toContain("v12");
  });

  it("supports complete create, update, and delete snapshots without reading a legacy key", async () => {
    const database = await memoryDatabase();
    const repository = createStudioVrmCreativeSqliteRepository({
      acquireDatabase: async () => database,
    });
    await repository.saveCustomPoses([customPose()]);
    await repository.saveCustomPoses([customPose("custom-alpha", "수정 포즈")]);
    await expect(repository.loadCustomPoses()).resolves.toMatchObject([
      { id: "custom-alpha", label: "수정 포즈" },
    ]);
    await repository.saveCustomPoses([]);
    await expect(repository.loadCustomPoses()).resolves.toEqual([]);

    await repository.saveFullStates({ alpha: fullState("first") });
    await repository.saveFullStates({ alpha: fullState("updated") });
    await expect(repository.loadFullStates()).resolves.toMatchObject({
      alpha: { poseId: "updated" },
    });
    await repository.saveFullStates({});
    await expect(repository.loadFullStates()).resolves.toEqual({});
  });

  it("fails closed on corrupt, non-canonical, duplicate, or partially malformed rows", async () => {
    const database = await memoryDatabase();
    const repository = createStudioVrmCreativeSqliteRepository({
      acquireDatabase: async () => database,
    });
    await database.kvSet(
      STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE,
      STUDIO_VRM_CREATIVE_SQLITE_KEY,
      "{broken",
    );
    await expect(repository.loadCustomPoses()).rejects.toMatchObject({ code: "invalid" });

    const pose = customPose();
    const valid = JSON.parse(serializeStudioVrmCustomPoseLibrary([pose])) as {
      poses: StudioVrmCustomPose[];
    };
    valid.poses.push({ ...pose, label: "중복" });
    await database.kvSet(
      STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE,
      STUDIO_VRM_CREATIVE_SQLITE_KEY,
      JSON.stringify(valid),
    );
    await expect(repository.loadCustomPoses()).rejects.toMatchObject({ code: "invalid" });

    const stateJson = serializeStudioVrmFullStateLibrary({ alpha: fullState() });
    const nonCanonical = JSON.stringify(JSON.parse(stateJson), null, 2);
    await database.kvSet(
      STUDIO_VRM_FULL_STATE_SQLITE_NAMESPACE,
      STUDIO_VRM_CREATIVE_SQLITE_KEY,
      nonCanonical,
    );
    await expect(repository.loadFullStates()).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects oversized libraries and explicit imports atomically instead of filtering bad members", () => {
    const tooMany = Array.from(
      { length: STUDIO_VRM_CUSTOM_POSE_LIBRARY_MAX_COUNT + 1 },
      (_, index) => customPose(`custom-${index}`, `포즈 ${index}`),
    );
    expect(() => serializeStudioVrmCustomPoseLibrary(tooMany)).toThrow(/exceeds/u);
    expect(() => parseStudioVrmCustomPoseImport([
      customPose("custom-valid"),
      { ...customPose("custom-invalid"), bones: { arbitraryNode: { rotation: [0, 0, 0] } } },
    ], (index) => `custom-import-${index}`)).toThrow(/invalid/u);
    expect(() => serializeStudioVrmFullStateLibrary({
      ["상".repeat(25)]: fullState(),
    })).toThrow(/invalid/u);
  });

  it("serializes overlapping complete snapshots so the latest invocation wins", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const values = new Map<string, string>();
    let writes = 0;
    const database = {
      kvSet: vi.fn(async (namespace: string, _key: string, value: string) => {
        if (++writes === 1) await firstGate;
        values.set(namespace, value);
      }),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioVrmCreativeSqliteRepository({
      acquireDatabase: async () => database,
    });

    const first = repository.saveCustomPoses([customPose("custom-order", "첫 저장")]);
    const second = repository.saveCustomPoses([customPose("custom-order", "마지막 저장")]);
    await vi.waitFor(() => expect(writes).toBe(1));
    releaseFirst();
    await Promise.all([first, second]);
    expect(parseCanonicalStudioVrmCustomPoseLibrary(
      values.get(STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE)!,
    )[0]?.label).toBe("마지막 저장");
  });

  it("surfaces SQLite unavailability without a localStorage downgrade", async () => {
    const repository = createStudioVrmCreativeSqliteRepository({
      acquireDatabase: async () => {
        throw new Error("OPFS SAH pool denied");
      },
    });
    await expect(repository.loadCustomPoses()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("OPFS SAH pool denied"),
    });
  });
});

describe("VRM creative canonical decoders", () => {
  it("accepts only byte-canonical rows", () => {
    const poseJson = serializeStudioVrmCustomPoseLibrary([customPose()]);
    const stateJson = serializeStudioVrmFullStateLibrary({ alpha: fullState() });
    expect(serializeStudioVrmCustomPoseLibrary(
      parseCanonicalStudioVrmCustomPoseLibrary(poseJson),
    )).toBe(poseJson);
    expect(serializeStudioVrmFullStateLibrary(
      parseCanonicalStudioVrmFullStateLibrary(stateJson),
    )).toBe(stateJson);
  });
});
