import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createStudioShared3dSceneSession } from "../studio-shared-3d-scene-bridge";
import { createAvatarForgeState } from "../vrm/studio-vrm-avatar-forge";
import { createStudioVrmSceneDocument } from "../vrm/studio-vrm-scene-document";

import type { StudioShared3dCharacterSource } from "../studio-shared-3d-scene-bridge";

const runtimeMocks = vi.hoisted(() => ({
  activeAdapter: null as null | {
    getModelGeneration: () => string | number;
    reapplyAuthoredPose: () => boolean | void;
  },
  applyGeneration: 0,
  bodyScale: vi.fn(),
  dispose: vi.fn(),
  fingers: vi.fn(),
  headReliable: true,
  order: [] as string[],
  pose: vi.fn(() => true),
}));

vi.mock("../vrm/studio-vrm-asset-runtime", () => ({
  STUDIO_VRM_BASE_ROTATION_Y_KEY: "studioVrmBaseRotationY",
  loadStudioVrmAsset: vi.fn(),
}));

vi.mock("../vrm/vrm-library", () => ({
  getStoredVrmModelByHash: vi.fn(),
  selectableSampleVrmUrl: vi.fn(),
}));

vi.mock("../vrm/studio-vrm-poser-utils", () => ({
  applyBodyScale: (...args: unknown[]) => {
    runtimeMocks.order.push("legacy-body-scale");
    runtimeMocks.bodyScale(...args);
  },
  applyExpressionWeightsToVrm: vi.fn(),
  applyFingerRotations: (...args: unknown[]) => {
    runtimeMocks.order.push("fingers");
    runtimeMocks.fingers(...args);
  },
  applyPoseToVrm: (..._args: unknown[]) => {
    runtimeMocks.order.push("pose");
    return runtimeMocks.pose();
  },
  applyVrmCustomColors: vi.fn(),
  applyVrmMaterialFx: vi.fn(),
}));

vi.mock("../vrm/studio-vrm-prop-rig", () => ({
  createAutoGripFingerOverrides: vi.fn(() => ({})),
  inspectAutoGripReadiness: vi.fn(() => ({ kind: "ready" })),
  scaleVrmPropRigMetrics: (metrics: unknown) => metrics,
}));

vi.mock("../vrm/studio-vrm-proportion-vrm-adapter", () => ({
  createStudioVrmProportionVrmAdapter: (input: {
    getCurrentModelGeneration: () => string | number;
    reapplyAuthoredPose: () => boolean | void;
  }) => {
    runtimeMocks.activeAdapter = {
      getModelGeneration: input.getCurrentModelGeneration,
      reapplyAuthoredPose: input.reapplyAuthoredPose,
    };
    return runtimeMocks.activeAdapter;
  },
  measureStudioVrmProportionHeadLength: () => ({
    version: 1,
    value: 0.2,
    modelHeight: 1.6,
    source: runtimeMocks.headReliable ? "eye-landmarks" : "mesh-bounds-estimate",
    reliable: runtimeMocks.headReliable,
  }),
}));

vi.mock("../vrm/studio-vrm-proportion-fit-transaction", () => ({
  createStudioVrmProportionFitTransaction: (
    _vrm: unknown,
    reapplyAuthoredState: () => boolean | void,
  ) => {
    let measured = false;
    const wardrobe = { height: 1.6 };
    const props = { missingBones: [] };
    return {
      reapply: () => {
        runtimeMocks.order.push("rest-metrics");
        measured = true;
        return reapplyAuthoredState();
      },
      measurements: () => measured
        ? { wardrobe, props }
        : { wardrobe: null, props: null },
    };
  },
}));

vi.mock("../vrm/studio-vrm-proportion-rig-runtime", () => ({
  createStudioVrmProportionRigRuntime: (adapter: {
    getModelGeneration: () => string | number;
    reapplyAuthoredPose: () => boolean | void;
  }) => {
    const receipt = (operation: "apply" | "dispose") => ({
      ok: true as const,
      runtimeVersion: 1,
      operation,
      modelGeneration: adapter.getModelGeneration(),
      applyGeneration: runtimeMocks.applyGeneration,
      authoredProportions: createAvatarForgeState().proportions,
      runtimeProportions: createAvatarForgeState().proportions,
      presetResolution: null,
      headMeasurement: {
        version: 1,
        source: runtimeMocks.headReliable ? "eye-landmarks" : "mesh-bounds-estimate",
        reliable: runtimeMocks.headReliable,
      },
      targets: [],
      worldPositions: [],
      metrics: {},
      stages: [],
    });
    const runtime = {
      runtimeVersion: 1,
      modelGeneration: adapter.getModelGeneration(),
      snapshot: {},
      disposed: false,
      apply: () => {
        runtimeMocks.applyGeneration += 1;
        runtimeMocks.order.push(
          "proportions",
          "normalized-rebuild",
          "constraint-init",
          "spring-init",
        );
        if (adapter.reapplyAuthoredPose() === false) {
          return {
            ok: false as const,
            runtimeVersion: 1,
            operation: "apply" as const,
            code: "lifecycle-failed",
            modelGeneration: adapter.getModelGeneration(),
            observedModelGeneration: adapter.getModelGeneration(),
            applyGeneration: runtimeMocks.applyGeneration,
            recovery: "restored" as const,
            message: "reapply failed",
          };
        }
        return receipt("apply");
      },
      restore: vi.fn(),
      dispose: () => {
        runtimeMocks.dispose(adapter.getModelGeneration());
        runtimeMocks.applyGeneration += 1;
        return receipt("dispose");
      },
    };
    return { ok: true as const, runtime };
  },
}));

const {
  createStudioBg3dLinkedVrmRuntimeOwner,
} = await import("./studio-bg3d-shared-vrm-runtime");

function sourceWithScene(
  scene = createStudioVrmSceneDocument(),
  positionX = 0,
): StudioShared3dCharacterSource {
  return createStudioShared3dSceneSession([{
    elementId: "shared-character",
    scene,
    stageTransform: { position: [positionX, 0, 0], rotationY: 0 },
  }]).characters[0]!;
}

function runtimeVrm() {
  return {
    scene: new THREE.Group(),
    update: vi.fn(),
  } as never;
}

describe("Studio BG3D linked VRM proportion owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.activeAdapter = null;
    runtimeMocks.applyGeneration = 0;
    runtimeMocks.headReliable = true;
    runtimeMocks.order.length = 0;
    runtimeMocks.pose.mockReturnValue(true);
  });

  it("prepares proportions and rebuilt-rest fit before pose, fingers, and legacy bodyScale", () => {
    const source = sourceWithScene();
    const created = createStudioBg3dLinkedVrmRuntimeOwner(
      runtimeVrm(),
      source.modelRuntimeKey,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = created.owner.prepare(source, "appearance-a");

    expect(result.ok).toBe(true);
    expect(runtimeMocks.order).toEqual([
      "proportions",
      "normalized-rebuild",
      "constraint-init",
      "spring-init",
      "rest-metrics",
      "pose",
      "fingers",
      "legacy-body-scale",
    ]);
    if (result.ok) {
      expect(result.prepared.preparedIdentityKey).toContain("appearance-a");
      expect(result.prepared.rigRevision).toBe(1);
    }
  });

  it("reuses one committed rest cache for a placement-only identity and keeps rigRevision stable", () => {
    const first = sourceWithScene();
    const second = sourceWithScene(first.scene, 1.25);
    const created = createStudioBg3dLinkedVrmRuntimeOwner(
      runtimeVrm(),
      first.modelRuntimeKey,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const firstResult = created.owner.prepare(first, "appearance-a");
    expect(firstResult.ok).toBe(true);
    runtimeMocks.order.length = 0;

    const secondResult = created.owner.prepare(second, "appearance-b");

    expect(secondResult.ok).toBe(true);
    expect(runtimeMocks.order).toEqual(["pose", "fingers", "legacy-body-scale"]);
    if (firstResult.ok && secondResult.ok) {
      expect(secondResult.prepared.rigRevision).toBe(firstResult.prepared.rigRevision);
      expect(secondResult.prepared.preparedIdentityKey)
        .not.toBe(firstResult.prepared.preparedIdentityKey);
    }
  });

  it("rebuilds the normalized rig and republishes fit metrics for a changed proportion authority", () => {
    const neutral = createAvatarForgeState();
    const baseScene = createStudioVrmSceneDocument();
    const first = sourceWithScene({
      ...baseScene,
      appearance: { ...baseScene.appearance, avatarForge: neutral },
    });
    const second = sourceWithScene({
      ...baseScene,
      appearance: {
        ...baseScene.appearance,
        avatarForge: {
          ...neutral,
          proportions: { ...neutral.proportions, legLength: 1.12 },
        },
      },
    });
    const created = createStudioBg3dLinkedVrmRuntimeOwner(
      runtimeVrm(),
      first.modelRuntimeKey,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const firstResult = created.owner.prepare(first, "appearance-a");
    expect(firstResult.ok).toBe(true);
    runtimeMocks.order.length = 0;

    const secondResult = created.owner.prepare(second, "appearance-b");

    expect(secondResult.ok).toBe(true);
    expect(runtimeMocks.order).toEqual([
      "proportions",
      "normalized-rebuild",
      "constraint-init",
      "spring-init",
      "rest-metrics",
      "pose",
      "fingers",
      "legacy-body-scale",
    ]);
    if (firstResult.ok && secondResult.ok) {
      expect(secondResult.prepared.rigRevision).toBeGreaterThan(
        firstResult.prepared.rigRevision,
      );
    }
  });

  it("preserves a model-specific preset with the same explicit estimated-head provenance", () => {
    runtimeMocks.headReliable = false;
    const neutral = createAvatarForgeState();
    const scene = createStudioVrmSceneDocument();
    const source = sourceWithScene({
      ...scene,
      appearance: {
        ...scene.appearance,
        avatarForge: {
          ...neutral,
          proportions: {
            ...neutral.proportions,
            presetId: "webtoon-7",
            headBodyRatio: 1.166667,
          },
        },
      },
    });
    const created = createStudioBg3dLinkedVrmRuntimeOwner(
      runtimeVrm(),
      source.modelRuntimeKey,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = created.owner.prepare(source, "estimated-preset");
    expect(result).toMatchObject({
      ok: true,
      prepared: {
        receipt: {
          headMeasurement: {
            source: "mesh-bounds-estimate",
            reliable: false,
          },
        },
      },
    });
    expect(runtimeMocks.order).toEqual([
      "proportions",
      "normalized-rebuild",
      "constraint-init",
      "spring-init",
      "rest-metrics",
      "pose",
      "fingers",
      "legacy-body-scale",
    ]);
  });

  it("disposes while its generation is current, then invalidates stale callbacks", () => {
    const source = sourceWithScene();
    const created = createStudioBg3dLinkedVrmRuntimeOwner(
      runtimeVrm(),
      source.modelRuntimeKey,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const generation = created.owner.modelGeneration;

    expect(created.owner.dispose().ok).toBe(true);
    expect(runtimeMocks.dispose).toHaveBeenCalledWith(generation);
    expect(runtimeMocks.activeAdapter?.getModelGeneration()).toBe(`${generation}:disposed`);
    expect(created.owner.prepare(source, "late-source")).toMatchObject({
      ok: false,
      code: "disposed",
    });
  });
});
