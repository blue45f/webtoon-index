import { describe, expect, it } from "vitest";

import {
  mutateStudioBg3dAimConstraint,
  mutateStudioBg3dPoseOverride,
  mutateStudioBg3dTwoBoneIkConstraint,
  resolveStudioBg3dRigSelection,
  type StudioBg3dRigSelectionDescriptor,
} from "./studio-bg3d-rig-selection";

const DESCRIPTORS: readonly StudioBg3dRigSelectionDescriptor[] = [
  { key: "upper-alias-a", canonicalKey: "upper-alias-a" },
  { key: "upper-alias-b", canonicalKey: "upper-alias-a" },
  { key: "middle-alias-a", canonicalKey: "middle-alias-a" },
  { key: "middle-alias-b", canonicalKey: "middle-alias-a" },
  { key: "end-alias-a", canonicalKey: "end-alias-a" },
  { key: "end-alias-b", canonicalKey: "end-alias-a" },
  { key: "other", canonicalKey: "other" },
];

describe("studio BG3D rig selection", () => {
  it("never leaks an equal ordinal key across model ownership and uses remembered/fallback state", () => {
    const descriptors = [
      { key: "skin-0:joint-0", canonicalKey: "skin-0:joint-0" },
      { key: "skin-0:joint-5", canonicalKey: "skin-0:joint-5" },
    ];
    expect(resolveStudioBg3dRigSelection({
      modelId: "model-b",
      descriptors,
      selection: { modelId: "model-a", key: "skin-0:joint-5" },
    })).toMatchObject({ modelId: "model-b", key: "skin-0:joint-0" });
    expect(resolveStudioBg3dRigSelection({
      modelId: "model-b",
      descriptors,
      selection: { modelId: "model-a", key: "skin-0:joint-5" },
      rememberedSelection: { modelId: "model-b", key: "skin-0:joint-5" },
    })).toEqual({
      modelId: "model-b",
      key: "skin-0:joint-5",
      canonicalKey: "skin-0:joint-5",
    });
    expect(resolveStudioBg3dRigSelection({ modelId: "model-b", descriptors: [] })).toBeNull();
  });

  it("resolves aliases to one physical identity and rejects conflicting/hostile descriptors", () => {
    expect(resolveStudioBg3dRigSelection({
      modelId: "model",
      descriptors: DESCRIPTORS,
      selection: { modelId: "model", key: "end-alias-b" },
    })).toEqual({ modelId: "model", key: "end-alias-b", canonicalKey: "end-alias-a" });
    expect(resolveStudioBg3dRigSelection({
      modelId: "model",
      descriptors: [
        { key: "joint", canonicalKey: "joint" },
        { key: "joint", canonicalKey: "other" },
      ],
    })).toBeNull();
    expect(resolveStudioBg3dRigSelection({
      modelId: "model",
      descriptors: [{ key: " ", canonicalKey: " " }],
    })).toBeNull();
  });

  it("upserts/removes one canonical pose override and dedupes alias input immutably", () => {
    const input = [
      { jointKey: "end-alias-a", rotationOffset: [0.1, 0, 0, 1] as const },
      { jointKey: "end-alias-b", rotationOffset: [0.2, 0, 0, 1] as const },
      { jointKey: "other", rotationOffset: [0, 0.1, 0, 1] as const },
    ];
    const snapshot = structuredClone(input);
    const common = {
      modelId: "model",
      descriptors: DESCRIPTORS,
      selection: { modelId: "model", key: "end-alias-b" },
      overrides: input,
    } as const;
    const updated = mutateStudioBg3dPoseOverride({
      ...common,
      next: { rotationOffset: [0, 0, 0.5, 1] },
    });
    expect(updated?.map(({ jointKey }) => jointKey)).toEqual(["end-alias-a", "other"]);
    expect(updated?.[0]?.rotationOffset[2]).toBeCloseTo(0.4472135955);
    expect(mutateStudioBg3dPoseOverride({ ...common, next: null })?.map(({ jointKey }) => jointKey))
      .toEqual(["other"]);
    expect(input).toEqual(snapshot);
  });

  it("updates one alias-equivalent aim while keeping unrelated constraints first-wins", () => {
    const updated = mutateStudioBg3dAimConstraint({
      modelId: "model",
      descriptors: DESCRIPTORS,
      selection: { modelId: "model", key: "end-alias-b" },
      constraints: [
        { jointKey: "end-alias-a", target: [1, 0, 0], axis: "+x", weight: 0.25 },
        { jointKey: "end-alias-b", target: [2, 0, 0], axis: "+y", weight: 0.5 },
        { jointKey: "other", target: [0, 1, 0], axis: "+y", weight: 1 },
      ],
      next: { target: [3, 2, 1], axis: "-z", weight: 0.75 },
    });
    expect(updated).toEqual([
      { jointKey: "end-alias-a", target: [3, 2, 1], axis: "-z", weight: 0.75 },
      { jointKey: "other", target: [0, 1, 0], axis: "+y", weight: 1 },
    ]);
  });

  it("updates/removes an IK selected through another alias and dedupes duplicate chains", () => {
    const chainA = {
      upperJointKey: "upper-alias-a",
      middleJointKey: "middle-alias-a",
      endJointKey: "end-alias-a",
      target: [1, 1, 0] as const,
      poleTarget: [0, 0, 1] as const,
      weight: 1,
    };
    const chainB = {
      ...chainA,
      upperJointKey: "upper-alias-b",
      middleJointKey: "middle-alias-b",
      endJointKey: "end-alias-b",
      target: [2, 2, 0] as const,
    };
    const common = {
      modelId: "model",
      descriptors: DESCRIPTORS,
      selection: { modelId: "model", key: "end-alias-b" },
      constraints: [chainA, chainB],
    } as const;
    const updated = mutateStudioBg3dTwoBoneIkConstraint({
      ...common,
      next: {
        upperJointKey: "upper-alias-b",
        middleJointKey: "middle-alias-b",
        target: [4, 3, 2],
        poleTarget: [0, 1, 0],
        weight: 0.5,
      },
    });
    expect(updated).toEqual([{
      upperJointKey: "upper-alias-a",
      middleJointKey: "middle-alias-a",
      endJointKey: "end-alias-a",
      target: [4, 3, 2],
      poleTarget: [0, 1, 0],
      weight: 0.5,
    }]);
    expect(mutateStudioBg3dTwoBoneIkConstraint({ ...common, next: null })).toEqual([]);
  });

  it("fails closed when a mutation belongs to another model or references an unknown bone", () => {
    expect(mutateStudioBg3dPoseOverride({
      modelId: "model-b",
      descriptors: DESCRIPTORS,
      selection: { modelId: "model-a", key: "other" },
      overrides: [],
      next: { rotationOffset: [0, 0, 0, 1] },
    })).toBeNull();
    expect(mutateStudioBg3dAimConstraint({
      modelId: "model",
      descriptors: DESCRIPTORS,
      selection: { modelId: "model", key: "other" },
      constraints: [{ jointKey: "unknown", target: [0, 0, 0], axis: "+x", weight: 1 }],
      next: null,
    })).toBeNull();
  });
});
