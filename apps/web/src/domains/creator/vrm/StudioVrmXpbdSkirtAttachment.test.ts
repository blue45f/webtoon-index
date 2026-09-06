import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { FALLBACK_WARDROBE_METRICS } from "./studio-vrm-wardrobe";
import { STUDIO_VRM_XPBD_SKIRT_BUDGETS } from "./studio-vrm-xpbd-skirt";
import {
  createStudioVrmXpbdSkirtAttachmentRuntime,
  createStudioVrmXpbdSkirtSolveCadence,
  planStudioVrmXpbdSkirtDeviceTier,
} from "./StudioVrmXpbdSkirtAttachment";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

function createRig(options: { missingFeet?: boolean } = {}) {
  const scene = new THREE.Group();
  const bones = new Map<VRMHumanBoneName, THREE.Bone>();
  const add = (name: VRMHumanBoneName, position: THREE.Vector3Tuple) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(...position);
    scene.add(bone);
    bones.set(name, bone);
  };
  add("hips", [0, 0.9, 0]);
  add("spine", [0, 1.12, 0]);
  add("leftUpperLeg", [0.1, 0.88, 0]);
  add("rightUpperLeg", [-0.1, 0.88, 0]);
  add("leftLowerLeg", [0.1, 0.52, 0]);
  add("rightLowerLeg", [-0.1, 0.52, 0]);
  if (!options.missingFeet) {
    add("leftFoot", [0.1, 0.12, 0.08]);
    add("rightFoot", [-0.1, 0.12, 0.08]);
  }
  const vrm = {
    scene,
    humanoid: {
      getRawBoneNode: (name: VRMHumanBoneName) => bones.get(name) ?? null,
    },
  } as unknown as VRM;
  return { vrm, bones };
}

function createRuntime(kind: "pleated" | "longskirt" = "pleated") {
  const rig = createRig();
  const result = createStudioVrmXpbdSkirtAttachmentRuntime({
    vrm: rig.vrm,
    kind,
    metrics: FALLBACK_WARDROBE_METRICS,
    effectiveFit: 1,
    topologyGeneration: 7,
    devicePlan: planStudioVrmXpbdSkirtDeviceTier({
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      mobileUserAgent: false,
    }),
    color: "#334155",
    fabricId: "satin",
  });
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return { ...rig, runtime: result.runtime };
}

describe("Studio VRM XPBD skirt product attachment", () => {
  it("renders the authoritative arrays through one indexed BufferGeometry SkinnedMesh", () => {
    const { runtime } = createRuntime("pleated");
    const { geometry, mesh, receipt, skeleton } = runtime.surface;

    expect(mesh.isSkinnedMesh).toBe(true);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.skeleton).toBe(skeleton);
    expect(geometry.getAttribute("position").count).toBe(runtime.topology.particleCount);
    expect(geometry.getAttribute("skinIndex").count).toBe(runtime.topology.particleCount);
    expect(geometry.getAttribute("skinWeight").count).toBe(runtime.topology.particleCount);
    expect(geometry.index?.count).toBe(runtime.topology.triangleCount * 3);
    expect(receipt).toMatchObject({
      mode: "xpbd-skirt-v1",
      selfCollisionEnabled: false,
      vertexCount: runtime.topology.particleCount,
      triangleCount: runtime.topology.triangleCount,
    });
  });

  it("updates hip/thigh pose proxies into the same GPU buffer and fences stale work", () => {
    const { bones, runtime } = createRuntime("pleated");
    const position = runtime.surface.geometry.getAttribute("position");
    const before = new Float32Array(position.array as Float32Array);

    const first = runtime.step(7, 0);
    expect(first.ok).toBe(true);
    expect(runtime.solveCount).toBe(1);
    expect(runtime.surface.mesh.userData.studioVrmXpbdSkirtSolveReceipt).toBeDefined();

    bones.get("leftLowerLeg")!.position.x = 0.24;
    const second = runtime.step(7, 1);
    expect(second.ok).toBe(true);
    expect(runtime.solveCount).toBe(2);
    expect(new Float32Array(position.array as Float32Array)).not.toEqual(before);

    const geometryBeforeStale = new Float32Array(position.array as Float32Array);
    expect(runtime.step(8, 2)).toMatchObject({
      ok: false,
      code: "stale-topology-generation",
    });
    expect(runtime.step(7, 1)).toMatchObject({
      ok: false,
      code: "stale-pose-generation",
    });
    expect(new Float32Array(position.array as Float32Array)).toEqual(geometryBeforeStale);
    expect(runtime.solveCount).toBe(2);
  });

  it("fails closed for a long skirt without calf endpoints without constructing another garment", () => {
    const { vrm } = createRig({ missingFeet: true });
    const result = createStudioVrmXpbdSkirtAttachmentRuntime({
      vrm,
      kind: "longskirt",
      metrics: FALLBACK_WARDROBE_METRICS,
      effectiveFit: 1,
      topologyGeneration: 0,
      devicePlan: planStudioVrmXpbdSkirtDeviceTier({ mobileUserAgent: true }),
      color: "#6e2434",
      fabricId: "satin",
    });

    expect(result).toMatchObject({ ok: false, code: "missing-bone" });
  });

  it("caps solve decisions and never repeats an unchanged pose outside capture", () => {
    for (const [tier, expectedMax] of [["desktop", 21], ["mobile", 11]] as const) {
      const plan = planStudioVrmXpbdSkirtDeviceTier({
        mobileUserAgent: tier === "mobile",
        hardwareConcurrency: tier === "mobile" ? 4 : 8,
        deviceMemoryGb: tier === "mobile" ? 4 : 8,
      });
      const cadence = createStudioVrmXpbdSkirtSolveCadence(plan.maxSolveHz);
      let changingPoseSolves = 0;
      for (let frame = 0; frame < 60; frame += 1) {
        const signature = `pose-${frame}`;
        if (!cadence.shouldSolve(1 / 60, signature, false)) continue;
        changingPoseSolves += 1;
        cadence.markSolved(signature);
      }
      expect(changingPoseSolves, tier).toBeLessThanOrEqual(expectedMax);

      const unchanged = createStudioVrmXpbdSkirtSolveCadence(plan.maxSolveHz);
      let unchangedSolves = 0;
      for (let frame = 0; frame < 120; frame += 1) {
        if (!unchanged.shouldSolve(1 / 60, "same-pose", false)) continue;
        unchangedSolves += 1;
        unchanged.markSolved("same-pose");
      }
      expect(unchangedSolves, tier).toBe(1);

      // A capture rising edge forces one exact refresh even when the pose did not change.
      expect(unchanged.shouldSolve(0, "same-pose", true), tier).toBe(true);
      unchanged.markSolved("same-pose");
      expect(unchanged.shouldSolve(0, "same-pose", true), tier).toBe(false);
    }
  });

  it("keeps mobile topology and solve work under explicit core budgets", () => {
    const plan = planStudioVrmXpbdSkirtDeviceTier({ mobileUserAgent: true });
    for (const ringCount of [plan.pleatedRingCount, plan.longSkirtRingCount]) {
      const particles = plan.segmentCount * ringCount;
      const triangles = plan.segmentCount * (ringCount - 1) * 2;
      expect(particles).toBeLessThanOrEqual(STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxParticles);
      expect(triangles).toBeLessThanOrEqual(STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxTriangles);
    }
    expect(plan.solverIterations).toBeLessThanOrEqual(
      STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxSolverIterations,
    );
    expect(plan.longSkirtRestToPoseSteps).toBeLessThanOrEqual(
      STUDIO_VRM_XPBD_SKIRT_BUDGETS.maxRestToPoseSteps,
    );
    expect(plan.maxSolveHz).toBeLessThanOrEqual(10);
  });

  it("defers disposal across StrictMode cleanup/setup replay and disposes exactly once", async () => {
    const { runtime } = createRuntime("pleated");
    const geometryDispose = vi.spyOn(runtime.surface.geometry, "dispose");
    const materialDispose = vi.spyOn(runtime.surface.material, "dispose");
    const skeletonDispose = vi.spyOn(runtime.surface.skeleton, "dispose");

    expect(runtime.retain()).toBe(true);
    runtime.release();
    expect(runtime.retain()).toBe(true);
    await Promise.resolve();
    expect(runtime.surface.disposed).toBe(false);
    expect(geometryDispose).not.toHaveBeenCalled();

    runtime.release();
    await Promise.resolve();
    expect(runtime.surface.disposed).toBe(true);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(skeletonDispose).toHaveBeenCalledTimes(1);
    runtime.release();
    await Promise.resolve();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
  });
});
