import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createStudioBg3dCameraUpForDutchRoll } from "./studio-bg3d-camera-orientation";
import {
  STUDIO_BG3D_AR_MINIATURE_MAX_DISTANCE_METERS,
  STUDIO_BG3D_AR_MINIATURE_MAX_SCALE,
  STUDIO_BG3D_AR_MINIATURE_MIN_DISTANCE_METERS,
  STUDIO_BG3D_AR_MINIATURE_MIN_SCALE,
  planStudioBg3dImmersiveStage,
  type PlanStudioBg3dImmersiveStageInput,
  type StudioBg3dImmersiveStagePlan,
} from "./studio-bg3d-immersive-stage";

import type {
  StudioBg3dCollectedShadowBounds,
  StudioBg3dShadowBounds,
} from "./studio-bg3d-shadow-frustum";

const DEFAULT_CAMERA = Object.freeze({
  position: Object.freeze([0, 1.6, 5] as const),
  target: Object.freeze([0, 1, 0] as const),
});

function collected(
  bounds: StudioBg3dShadowBounds | null,
  overrides: Partial<StudioBg3dCollectedShadowBounds> = {},
): StudioBg3dCollectedShadowBounds {
  return {
    bounds,
    includedEntityCount: bounds ? 1 : 0,
    rejectedEntityCount: 0,
    clamped: false,
    ...overrides,
  };
}

function input(
  mode: PlanStudioBg3dImmersiveStageInput["mode"],
  bounds: StudioBg3dShadowBounds = { min: [-1, 0, -1], max: [1, 2, 1] },
): PlanStudioBg3dImmersiveStageInput {
  return { mode, sceneBounds: collected(bounds), camera: DEFAULT_CAMERA };
}

function expectSuccess(
  plan: StudioBg3dImmersiveStagePlan,
): asserts plan is Extract<StudioBg3dImmersiveStagePlan, { readonly ok: true }> {
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error(`Expected an immersive stage plan, received ${plan.reason}.`);
}

function expectFailure(
  plan: StudioBg3dImmersiveStagePlan,
  reason: Extract<StudioBg3dImmersiveStagePlan, { readonly ok: false }>["reason"],
): void {
  expect(plan).toEqual({ ok: false, reason });
}

function cameraForward(camera: PlanStudioBg3dImmersiveStageInput["camera"]): THREE.Vector3 {
  return new THREE.Vector3(...camera.target)
    .sub(new THREE.Vector3(...camera.position))
    .normalize();
}

function quaternionOf(values: readonly [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(values[0], values[1], values[2], values[3]);
}

function allPlanNumbers(plan: Extract<StudioBg3dImmersiveStagePlan, { readonly ok: true }>): number[] {
  return [
    ...plan.stageRootTransform.position,
    ...plan.stageRootTransform.quaternion,
    plan.stageRootTransform.uniformScale,
    ...plan.contentOffset,
    ...plan.cameraRigTransform.position,
    ...plan.cameraRigTransform.quaternion,
    plan.cameraRigTransform.uniformScale,
    plan.sourceBoundsRadius,
    plan.presentedBoundsRadius,
  ];
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

describe("Studio BG3D immersive stage planner", () => {
  it("frames an AR miniature around admitted bounds in the authored camera orientation", () => {
    const bounds = { min: [8, -2, -6], max: [12, 4, 2] } as const;
    const plan = planStudioBg3dImmersiveStage(input("immersive-ar", bounds));
    expectSuccess(plan);

    expect(plan).toMatchObject({
      mode: "immersive-ar",
      placement: "ar-miniature",
      referenceSpaceType: "local",
      cameraRigTransform: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        uniformScale: 1,
      },
    });
    expect(plan.contentOffset).toEqual([-10, -1, 2]);

    const center = new THREE.Vector3(10, 1, -2)
      .add(new THREE.Vector3(...plan.contentOffset))
      .multiplyScalar(plan.stageRootTransform.uniformScale)
      .applyQuaternion(quaternionOf(plan.stageRootTransform.quaternion))
      .add(new THREE.Vector3(...plan.stageRootTransform.position));
    expect(center.x).toBeCloseTo(plan.stageRootTransform.position[0], 12);
    expect(center.y).toBeCloseTo(plan.stageRootTransform.position[1], 12);
    expect(center.z).toBeCloseTo(plan.stageRootTransform.position[2], 12);

    const authoredForwardInAr = cameraForward(DEFAULT_CAMERA)
      .applyQuaternion(quaternionOf(plan.stageRootTransform.quaternion));
    expect(authoredForwardInAr.x).toBeCloseTo(0, 12);
    expect(authoredForwardInAr.y).toBeCloseTo(0, 12);
    expect(authoredForwardInAr.z).toBeCloseTo(-1, 12);
  });

  it("keeps VR content at authored scale and places a dedicated camera under the shot rig", () => {
    const plan = planStudioBg3dImmersiveStage(input("immersive-vr"));
    expectSuccess(plan);

    expect(plan).toMatchObject({
      mode: "immersive-vr",
      placement: "vr-authored-camera",
      referenceSpaceType: "local",
      stageRootTransform: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        uniformScale: 1,
      },
      contentOffset: [0, 0, 0],
      cameraRigTransform: { position: DEFAULT_CAMERA.position, uniformScale: 1 },
    });
    expect(plan.presentedBoundsRadius).toBe(plan.sourceBoundsRadius);

    const rigForward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(quaternionOf(plan.cameraRigTransform.quaternion));
    expect(rigForward.distanceTo(cameraForward(DEFAULT_CAMERA))).toBeLessThan(1e-12);
  });

  it("rejects an empty scene and fail-closes partial production bounds", () => {
    expectFailure(planStudioBg3dImmersiveStage({
      mode: "immersive-ar",
      sceneBounds: collected(null),
      camera: DEFAULT_CAMERA,
    }), "empty-scene");

    for (const sceneBounds of [
      collected({ min: [-1, -1, -1], max: [1, 1, 1] }, { clamped: true }),
      collected({ min: [-1, -1, -1], max: [1, 1, 1] }, { rejectedEntityCount: 1 }),
      collected(null, { rejectedEntityCount: 1 }),
    ]) {
      expectFailure(planStudioBg3dImmersiveStage({
        mode: "immersive-vr",
        sceneBounds,
        camera: DEFAULT_CAMERA,
      }), "incomplete-scene");
    }
  });

  it.each([
    { min: [Number.NaN, 0, 0], max: [1, 1, 1] },
    { min: [2, 0, 0], max: [1, 1, 1] },
    { min: [-10_001, 0, 0], max: [1, 1, 1] },
    { min: [-1, -1, -1], max: [Number.POSITIVE_INFINITY, 1, 1] },
  ] as const)("rejects hostile or non-canonical bounds: %j", (bounds) => {
    expectFailure(planStudioBg3dImmersiveStage({
      mode: "immersive-ar",
      sceneBounds: collected(bounds as unknown as StudioBg3dShadowBounds),
      camera: DEFAULT_CAMERA,
    }), "invalid-bounds");
  });

  it("rejects inconsistent admission metadata and unknown modes", () => {
    expectFailure(planStudioBg3dImmersiveStage({
      mode: "immersive-ar",
      sceneBounds: collected(null, { includedEntityCount: 1 }),
      camera: DEFAULT_CAMERA,
    }), "invalid-bounds");
    expectFailure(planStudioBg3dImmersiveStage({
      mode: "immersive-ar",
      sceneBounds: collected({ min: [-1, -1, -1], max: [1, 1, 1] }, {
        includedEntityCount: -1,
      }),
      camera: DEFAULT_CAMERA,
    }), "invalid-input");
    expectFailure(planStudioBg3dImmersiveStage({
      ...input("immersive-ar"),
      mode: "inline" as unknown as "immersive-ar",
    }), "invalid-input");
  });

  it.each([
    { position: [0, 0, 0], target: [0, 0, 0] },
    { position: [Number.NaN, 0, 0], target: [0, 0, -1] },
    { position: [0, 0, 0], target: [0, 0, -1], up: [0, 2, 0] },
    { position: [0, 0, 0], target: [0, 0, -1], up: [0, 0, 1] },
    { position: [10_001, 0, 0], target: [0, 0, 0] },
  ] as const)("rejects a hostile or degenerate camera: %j", (camera) => {
    expectFailure(planStudioBg3dImmersiveStage({
      ...input("immersive-vr"),
      camera: camera as unknown as PlanStudioBg3dImmersiveStageInput["camera"],
    }), "invalid-camera");
  });

  it("clamps a huge scene to the minimum finite AR scale and moves it farther away", () => {
    const plan = planStudioBg3dImmersiveStage(input("immersive-ar", {
      min: [-10_000, -10_000, -10_000],
      max: [10_000, 10_000, 10_000],
    }));
    expectSuccess(plan);

    expect(plan.stageRootTransform.uniformScale).toBe(STUDIO_BG3D_AR_MINIATURE_MIN_SCALE);
    expect(-plan.stageRootTransform.position[2]).toBeGreaterThan(
      STUDIO_BG3D_AR_MINIATURE_MIN_DISTANCE_METERS,
    );
    expect(-plan.stageRootTransform.position[2]).toBeLessThanOrEqual(
      STUDIO_BG3D_AR_MINIATURE_MAX_DISTANCE_METERS,
    );
    expect(plan.presentedBoundsRadius).toBeCloseTo(Math.sqrt(3), 12);
    expect(allPlanNumbers(plan).every(Number.isFinite)).toBe(true);
  });

  it("clamps a point-like tiny scene to the maximum finite AR scale", () => {
    const plan = planStudioBg3dImmersiveStage(input("immersive-ar", {
      min: [0, 0, 0],
      max: [0, 0, 0],
    }));
    expectSuccess(plan);

    expect(plan.stageRootTransform.uniformScale).toBe(STUDIO_BG3D_AR_MINIATURE_MAX_SCALE);
    expect(-plan.stageRootTransform.position[2]).toBe(
      STUDIO_BG3D_AR_MINIATURE_MIN_DISTANCE_METERS,
    );
    expect(plan.sourceBoundsRadius).toBe(0);
    expect(plan.presentedBoundsRadius).toBe(0);
    expect(allPlanNumbers(plan).every(Number.isFinite)).toBe(true);
  });

  it("preserves a Dutch camera's rolled up axis in VR and removes it from the AR viewer frame", () => {
    const up = createStudioBg3dCameraUpForDutchRoll(DEFAULT_CAMERA, 37);
    expect(up).not.toBeNull();
    const camera = { ...DEFAULT_CAMERA, up: up! };
    const sceneBounds = collected({ min: [-1, 0, -1], max: [1, 2, 1] });
    const vr = planStudioBg3dImmersiveStage({ mode: "immersive-vr", sceneBounds, camera });
    const ar = planStudioBg3dImmersiveStage({ mode: "immersive-ar", sceneBounds, camera });
    expectSuccess(vr);
    expectSuccess(ar);

    const vrUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(quaternionOf(vr.cameraRigTransform.quaternion));
    expect(vrUp.distanceTo(new THREE.Vector3(...up!))).toBeLessThan(1e-12);
    const authoredUpInAr = new THREE.Vector3(...up!)
      .applyQuaternion(quaternionOf(ar.stageRootTransform.quaternion));
    expect(authoredUpInAr.x).toBeCloseTo(0, 12);
    expect(authoredUpInAr.y).toBeCloseTo(1, 12);
    expect(authoredUpInAr.z).toBeCloseTo(0, 12);
  });

  it("uses a deterministic non-singular orientation for a top camera", () => {
    const camera = {
      position: [0, 10, 0] as const,
      target: [0, 0, 0] as const,
    };
    const first = planStudioBg3dImmersiveStage({
      ...input("immersive-vr"),
      camera,
    });
    const second = planStudioBg3dImmersiveStage({
      ...input("immersive-vr"),
      camera,
    });
    expectSuccess(first);
    expectSuccess(second);
    expect(second).toEqual(first);

    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(quaternionOf(first.cameraRigTransform.quaternion));
    const up = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(quaternionOf(first.cameraRigTransform.quaternion));
    expect(forward.x).toBeCloseTo(0, 12);
    expect(forward.y).toBeCloseTo(-1, 12);
    expect(forward.z).toBeCloseTo(0, 12);
    expect(up.x).toBeCloseTo(0, 12);
    expect(up.y).toBeCloseTo(0, 12);
    expect(up.z).toBeCloseTo(1, 12);
    expect(allPlanNumbers(first).every(Number.isFinite)).toBe(true);
  });

  it("does not mutate deeply frozen canonical input and returns deeply frozen transforms", () => {
    const frozenInput = deepFreeze({
      mode: "immersive-ar" as const,
      sceneBounds: collected({ min: [-3, -2, -1], max: [5, 4, 7] }),
      camera: {
        position: [7, 6, 5] as const,
        target: [1, 2, 3] as const,
        up: [0, 1, 0] as const,
      },
    });
    const before = JSON.stringify(frozenInput);
    const plan = planStudioBg3dImmersiveStage(frozenInput);
    expectSuccess(plan);

    expect(JSON.stringify(frozenInput)).toBe(before);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.stageRootTransform)).toBe(true);
    expect(Object.isFrozen(plan.stageRootTransform.position)).toBe(true);
    expect(Object.isFrozen(plan.stageRootTransform.quaternion)).toBe(true);
    expect(Object.isFrozen(plan.contentOffset)).toBe(true);
    expect(Object.isFrozen(plan.cameraRigTransform)).toBe(true);
    expect(Object.isFrozen(plan.cameraRigTransform.position)).toBe(true);
    expect(Object.isFrozen(plan.cameraRigTransform.quaternion)).toBe(true);
    expect(plan.stageRootTransform.uniformScale).toBeGreaterThanOrEqual(
      STUDIO_BG3D_AR_MINIATURE_MIN_SCALE,
    );
    expect(plan.stageRootTransform.uniformScale).toBeLessThanOrEqual(
      STUDIO_BG3D_AR_MINIATURE_MAX_SCALE,
    );
    expect(allPlanNumbers(plan).every(Number.isFinite)).toBe(true);
  });
});
