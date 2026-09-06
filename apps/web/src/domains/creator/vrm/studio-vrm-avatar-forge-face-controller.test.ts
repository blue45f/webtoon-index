import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createStudioVrmAvatarForgeFaceController,
  deriveStudioVrmAvatarForgeFaceScale,
  resolveStudioVrmAvatarForgeVisualProportionMetrics,
} from "./studio-vrm-avatar-forge-face-controller";

import type { AvatarForgeFaceParams } from "./studio-vrm-avatar-forge";

const FACE: AvatarForgeFaceParams = {
  headWidth: 1.1,
  headHeight: 1.08,
  headDepth: 0.94,
  cheekVolume: 0.6,
  chinLength: 1.04,
};

function replaceInput(
  rawHead: THREE.Object3D | null,
  normalizedHead: THREE.Object3D | null,
  rigRevision = 1,
) {
  return { rawHead, normalizedHead, rigRevision, face: FACE } as const;
}

describe("Avatar Forge face controller", () => {
  it("reports visual head units separately from the rig receipt after face-height sculpting", () => {
    const metrics = {
      totalHeight: 1.8,
      headLength: 0.225,
      headUnits: 8,
      footHeight: 0.08,
      hipsHeight: 0.95,
      legLength: 0.88,
      armLength: 0.72,
      shoulderSpan: 0.4,
    };
    const visual = resolveStudioVrmAvatarForgeVisualProportionMetrics(metrics, {
      ...FACE,
      headHeight: 1.1,
      chinLength: 1,
    });

    expect(visual.headLength).toBeCloseTo(0.2475, 12);
    expect(visual.totalHeight).toBeCloseTo(1.8225, 12);
    expect(visual.headUnits).toBeCloseTo(1.8225 / 0.2475, 12);
    expect(visual.headUnits).toBeLessThan(metrics.headUnits);
    expect(metrics).toEqual(expect.objectContaining({ headUnits: 8, totalHeight: 1.8 }));
    expect(Object.isFrozen(visual)).toBe(true);
  });

  it("preserves the previous face arithmetic and restores exact non-unit baselines", () => {
    const rawHead = new THREE.Object3D();
    const normalizedHead = new THREE.Object3D();
    rawHead.scale.set(0.8, 1.25, 1.1);
    normalizedHead.scale.set(1.3, 0.9, 0.75);
    const rawBaseline = rawHead.scale.clone();
    const normalizedBaseline = normalizedHead.scale.clone();
    const scale = deriveStudioVrmAvatarForgeFaceScale(FACE);
    const controller = createStudioVrmAvatarForgeFaceController();

    const applied = controller.replace(replaceInput(rawHead, normalizedHead));

    expect(applied.disposition).toBe("applied");
    expect(applied.snapshot).toMatchObject({
      version: 1,
      status: "applied",
      rigRevision: 1,
      nodeCount: 2,
      failure: null,
    });
    expect(rawHead.scale.toArray()).toEqual([
      rawBaseline.x * scale[0],
      rawBaseline.y * scale[1],
      rawBaseline.z * scale[2],
    ]);
    expect(normalizedHead.scale.toArray()).toEqual([
      normalizedBaseline.x * scale[0],
      normalizedBaseline.y * scale[1],
      normalizedBaseline.z * scale[2],
    ]);

    expect(controller.release().disposition).toBe("released");
    expect(rawHead.scale.toArray()).toEqual(rawBaseline.toArray());
    expect(normalizedHead.scale.toArray()).toEqual(normalizedBaseline.toArray());
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
  });

  it("deduplicates a raw/normalized identity shared by unusual rigs", () => {
    const sharedHead = new THREE.Object3D();
    sharedHead.scale.set(1.2, 0.8, 1.1);
    const baseline = sharedHead.scale.clone();
    const controller = createStudioVrmAvatarForgeFaceController();

    const receipt = controller.replace(replaceInput(sharedHead, sharedHead));

    const scale = deriveStudioVrmAvatarForgeFaceScale(FACE);
    expect(receipt.snapshot.nodeCount).toBe(1);
    expect(sharedHead.scale.toArray()).toEqual([
      baseline.x * scale[0],
      baseline.y * scale[1],
      baseline.z * scale[2],
    ]);
    controller.release();
    expect(sharedHead.scale.toArray()).toEqual(baseline.toArray());
  });

  it("treats an identical replace as a no-op instead of compounding scale", () => {
    const rawHead = new THREE.Object3D();
    const normalizedHead = new THREE.Object3D();
    const controller = createStudioVrmAvatarForgeFaceController();
    const first = controller.replace(replaceInput(rawHead, normalizedHead));
    const once = rawHead.scale.clone();

    const second = controller.replace(replaceInput(rawHead, normalizedHead));

    expect(second.disposition).toBe("unchanged");
    expect(second.snapshot.stateRevision).toBe(first.snapshot.stateRevision);
    expect(rawHead.scale.toArray()).toEqual(once.toArray());
  });

  it("releases the old lease before replacing it and follows rebuilt node identities", () => {
    const rawHead = new THREE.Object3D();
    const retiredNormalizedHead = new THREE.Object3D();
    rawHead.scale.set(1.2, 1.1, 0.9);
    retiredNormalizedHead.scale.set(0.9, 1.3, 1.05);
    const rawBaseline = rawHead.scale.clone();
    const retiredBaseline = retiredNormalizedHead.scale.clone();
    const controller = createStudioVrmAvatarForgeFaceController();
    controller.replace(replaceInput(rawHead, retiredNormalizedHead, 4));

    const rebuiltNormalizedHead = new THREE.Object3D();
    rebuiltNormalizedHead.scale.set(0.75, 0.85, 1.15);
    const rebuiltBaseline = rebuiltNormalizedHead.scale.clone();
    const replacement = controller.replace({
      rawHead,
      normalizedHead: rebuiltNormalizedHead,
      rigRevision: 5,
      scale: [1.02, 1.04, 0.98],
    });

    expect(replacement.disposition).toBe("applied");
    expect(replacement.snapshot.rigRevision).toBe(5);
    expect(retiredNormalizedHead.scale.toArray()).toEqual(retiredBaseline.toArray());
    expect(rawHead.scale.toArray()).toEqual([
      rawBaseline.x * 1.02,
      rawBaseline.y * 1.04,
      rawBaseline.z * 0.98,
    ]);
    expect(rebuiltNormalizedHead.scale.toArray()).toEqual([
      rebuiltBaseline.x * 1.02,
      rebuiltBaseline.y * 1.04,
      rebuiltBaseline.z * 0.98,
    ]);
  });

  it.each([
    ["zero", [1, 0, 1]],
    ["negative", [1, -0.1, 1]],
    ["NaN", [1, Number.NaN, 1]],
    ["Infinity", [1, Number.POSITIVE_INFINITY, 1]],
  ])("fails closed for a %s face scale", (_label, invalidScale) => {
    const rawHead = new THREE.Object3D();
    rawHead.scale.set(0.8, 1.2, 0.9);
    const baseline = rawHead.scale.clone();
    const controller = createStudioVrmAvatarForgeFaceController();
    controller.replace({
      rawHead,
      normalizedHead: null,
      rigRevision: 1,
      scale: [1.1, 1.1, 1.1],
    });

    const rejected = controller.replace({
      rawHead,
      normalizedHead: null,
      rigRevision: 2,
      scale: invalidScale as [number, number, number],
    });

    expect(rejected).toMatchObject({
      disposition: "rejected",
      reason: "invalid-scale",
      snapshot: { status: "rejected", nodeCount: 0 },
    });
    expect(rawHead.scale.toArray()).toEqual(baseline.toArray());
  });

  it("rolls back every node when application fails partway", () => {
    const rawHead = new THREE.Object3D();
    const normalizedHead = new THREE.Object3D();
    rawHead.scale.set(0.8, 1.2, 0.9);
    normalizedHead.scale.set(1.4, 0.7, 1.1);
    const rawBaseline = rawHead.scale.clone();
    const normalizedBaseline = normalizedHead.scale.clone();
    vi.spyOn(normalizedHead, "updateMatrixWorld").mockImplementation(() => {
      throw new Error("detached rig failure");
    });
    const controller = createStudioVrmAvatarForgeFaceController();

    const rejected = controller.replace(replaceInput(rawHead, normalizedHead));

    expect(rejected.reason).toBe("apply-failed");
    expect(rawHead.scale.toArray()).toEqual(rawBaseline.toArray());
    expect(normalizedHead.scale.toArray()).toEqual(normalizedBaseline.toArray());
  });

  it("makes release/dispose repeatable and rejects replacement after disposal", () => {
    const rawHead = new THREE.Object3D();
    const baseline = rawHead.scale.clone();
    const controller = createStudioVrmAvatarForgeFaceController();
    controller.replace(replaceInput(rawHead, null));

    const released = controller.release();
    expect(controller.release().disposition).toBe("unchanged");
    expect(controller.release().snapshot).toBe(released.snapshot);
    expect(rawHead.scale.toArray()).toEqual(baseline.toArray());

    const disposed = controller.dispose();
    expect(disposed.snapshot.status).toBe("disposed");
    expect(controller.dispose()).toMatchObject({ disposition: "unchanged" });
    expect(controller.release()).toMatchObject({ disposition: "unchanged" });
    expect(controller.replace(replaceInput(rawHead, null))).toMatchObject({
      disposition: "rejected",
      reason: "disposed",
      snapshot: { status: "disposed" },
    });
  });

  it("fails closed for missing nodes, conflicting sources, and invalid face-derived scale", () => {
    const controller = createStudioVrmAvatarForgeFaceController();
    expect(controller.replace(replaceInput(null, null))).toMatchObject({
      reason: "missing-head-node",
      snapshot: { status: "rejected" },
    });
    expect(controller.replace({
      rawHead: new THREE.Object3D(),
      normalizedHead: null,
      rigRevision: 2,
      face: FACE,
      scale: [1, 1, 1],
    })).toMatchObject({ reason: "ambiguous-scale-source" });
    expect(controller.replace({
      rawHead: new THREE.Object3D(),
      normalizedHead: null,
      rigRevision: 3,
      face: { ...FACE, headDepth: Number.NaN },
    })).toMatchObject({ reason: "invalid-scale" });
  });
});
