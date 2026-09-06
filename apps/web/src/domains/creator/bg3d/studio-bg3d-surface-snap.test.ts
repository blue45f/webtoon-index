import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  collectStudioBg3dSurfaceSelectionSubtreeIds,
  collectStudioBg3dSurfaceTargetPathIds,
  planStudioBg3dMultiSurfaceSnap,
  resolveStudioBg3dSurfaceSnap,
  resolveStudioBg3dSurfaceSnapOrientation,
  type ResolveStudioBg3dSurfaceSnapInput,
} from "./studio-bg3d-surface-snap";

const BASE: ResolveStudioBg3dSurfaceSnapInput = {
  selectedIds: ["subject"],
  selectionId: "subject",
  selectionSubtreeIds: ["subject", "subject-child"],
  locked: false,
  localPosition: [2, 4, 1],
  rotation: [0.1, -0.2, 0.3],
  worldBounds: { min: [1, 2, 3], max: [5, 8, 7] },
  hit: {
    targetPathIds: ["table-top", "table"],
    point: [10, 20, 30],
    normal: [0, 2, 0],
  },
  surfaceOffset: 1,
};

function expectFailure(
  input: ResolveStudioBg3dSurfaceSnapInput,
  reason: Exclude<ReturnType<typeof resolveStudioBg3dSurfaceSnap>, { ok: true }>["reason"],
): void {
  expect(resolveStudioBg3dSurfaceSnap(input)).toEqual({ ok: false, reason });
}

describe("Studio BG3D surface snap", () => {
  it("builds the exact runtime subtree and leaf-first target ancestry", () => {
    const parentById = new Map<string, string | null>([
      ["subject", null],
      ["subject-child", "subject"],
      ["subject-grandchild", "subject-child"],
      ["table", null],
      ["table-top", "table"],
    ]);
    const childrenByParent = new Map<string, readonly string[]>([
      ["subject", ["subject-child"]],
      ["subject-child", ["subject-grandchild"]],
      ["table", ["table-top"]],
    ]);

    expect(collectStudioBg3dSurfaceSelectionSubtreeIds("subject", childrenByParent)).toEqual([
      "subject",
      "subject-child",
      "subject-grandchild",
    ]);
    expect(collectStudioBg3dSurfaceTargetPathIds("table-top", parentById)).toEqual([
      "table-top",
      "table",
    ]);
  });

  it("fails closed on stale hierarchy links and cycles", () => {
    expect(collectStudioBg3dSurfaceTargetPathIds("missing", new Map())).toBeNull();
    expect(collectStudioBg3dSurfaceTargetPathIds("a", new Map([
      ["a", "b"],
      ["b", "a"],
    ]))).toBeNull();
    expect(collectStudioBg3dSurfaceSelectionSubtreeIds("a", new Map([
      ["a", ["b"]],
      ["b", ["a"]],
    ]))).toBeNull();
  });

  it("moves the world-bounds bottom centre to the offset hit and preserves rotation", () => {
    const result = resolveStudioBg3dSurfaceSnap(BASE);
    expect(result).toEqual({
      ok: true,
      localPosition: [9, 23, 26],
      worldPosition: [9, 23, 26],
      worldDelta: [7, 19, 25],
      sourceBottomCenter: [3, 2, 5],
      targetPoint: [10, 21, 30],
      rotation: [0.1, -0.2, 0.3],
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.localPosition)).toBe(true);
      expect(Object.isFrozen(result.rotation)).toBe(true);
    }
  });

  it("uses measured rotated/scaled world bounds and converts through an invertible parent", () => {
    const parent = new THREE.Object3D();
    parent.position.set(8, -3, 5);
    parent.rotation.set(0.2, -0.4, Math.PI / 3);
    parent.scale.set(2, 3, 0.5);

    const subject = new THREE.Object3D();
    subject.position.set(1.5, -2, 4);
    subject.rotation.set(0.45, -0.25, 0.15);
    subject.scale.set(1.5, 0.75, 2);
    parent.add(subject);
    parent.updateMatrixWorld(true);

    const worldBounds = new THREE.Box3(
      new THREE.Vector3(-1, -2, -0.5),
      new THREE.Vector3(1, 2, 0.5),
    ).applyMatrix4(subject.matrixWorld);
    const bottomCenter = new THREE.Vector3(
      (worldBounds.min.x + worldBounds.max.x) / 2,
      worldBounds.min.y,
      (worldBounds.min.z + worldBounds.max.z) / 2,
    );
    const hitPoint = new THREE.Vector3(20, 7, -4);
    const beforeWorldPosition = subject.getWorldPosition(new THREE.Vector3());
    const expectedWorldPosition = beforeWorldPosition.clone().add(
      hitPoint.clone().sub(bottomCenter),
    );

    const result = resolveStudioBg3dSurfaceSnap({
      ...BASE,
      localPosition: subject.position.toArray(),
      rotation: subject.rotation.toArray().slice(0, 3) as [number, number, number],
      worldBounds: {
        min: worldBounds.min.toArray(),
        max: worldBounds.max.toArray(),
      },
      parentWorldMatrix: [...parent.matrixWorld.elements],
      hit: {
        targetPathIds: ["platform-mesh", "platform"],
        point: hitPoint.toArray(),
        normal: [0, 1, 0],
      },
      surfaceOffset: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.worldPosition[0]).toBeCloseTo(expectedWorldPosition.x, 9);
    expect(result.worldPosition[1]).toBeCloseTo(expectedWorldPosition.y, 9);
    expect(result.worldPosition[2]).toBeCloseTo(expectedWorldPosition.z, 9);
    const roundTrippedWorld = new THREE.Vector3(...result.localPosition).applyMatrix4(parent.matrixWorld);
    expect(roundTrippedWorld.x).toBeCloseTo(expectedWorldPosition.x, 9);
    expect(roundTrippedWorld.y).toBeCloseTo(expectedWorldPosition.y, 9);
    expect(roundTrippedWorld.z).toBeCloseTo(expectedWorldPosition.z, 9);
    expect(result.rotation).toEqual(subject.rotation.toArray().slice(0, 3));
  });

  it("excludes hits owned by the selected object or any selected descendant identifier", () => {
    expectFailure({
      ...BASE,
      hit: { ...BASE.hit, targetPathIds: ["subject", "scene"] },
    }, "self-hit");
    expectFailure({
      ...BASE,
      hit: { ...BASE.hit, targetPathIds: ["mesh-leaf", "subject-child", "subject"] },
    }, "self-hit");
    expect(resolveStudioBg3dSurfaceSnap({
      ...BASE,
      hit: { ...BASE.hit, targetPathIds: ["external-child", "external-root"] },
    }).ok).toBe(true);
  });

  it("enforces the single-selection and unlocked v1 admission boundary", () => {
    expectFailure({ ...BASE, selectedIds: [] }, "selection-count");
    expectFailure({ ...BASE, selectedIds: ["subject", "other"] }, "selection-count");
    expectFailure({ ...BASE, selectedIds: ["other"] }, "selection-mismatch");
    expectFailure({ ...BASE, locked: true }, "locked");
  });

  it("rejects malformed identifier policies instead of weakening self-hit exclusion", () => {
    expectFailure({ ...BASE, selectionSubtreeIds: ["subject-child"] }, "invalid-input");
    expectFailure({ ...BASE, selectionSubtreeIds: ["subject", "subject"] }, "invalid-input");
    expectFailure({
      ...BASE,
      hit: { ...BASE.hit, targetPathIds: [] },
    }, "invalid-input");
    expectFailure({
      ...BASE,
      hit: { ...BASE.hit, targetPathIds: ["__proto__"] },
    }, "invalid-input");
  });

  it("fails closed for malformed/non-finite bounds and hits", () => {
    expectFailure({
      ...BASE,
      worldBounds: { min: [2, 0, 0], max: [1, 1, 1] },
    }, "invalid-bounds");
    expectFailure({
      ...BASE,
      worldBounds: { min: [0, 0, 0], max: [1, Number.NaN, 1] },
    }, "invalid-bounds");
    expectFailure({
      ...BASE,
      hit: { ...BASE.hit, point: [0, Number.POSITIVE_INFINITY, 0] },
    }, "invalid-hit");
    expectFailure({
      ...BASE,
      hit: { ...BASE.hit, normal: [0, 0, 0] },
    }, "invalid-hit");
    expectFailure({ ...BASE, surfaceOffset: Number.NaN }, "invalid-hit");
    expectFailure({ ...BASE, localPosition: [0, Number.NaN, 0] }, "invalid-input");
  });

  it("rejects singular, projective, and non-finite parent transforms", () => {
    const singular = new THREE.Matrix4().makeScale(1, 0, 1).elements;
    expectFailure({ ...BASE, parentWorldMatrix: [...singular] }, "invalid-parent-transform");
    const projective = new THREE.Matrix4().elements.slice();
    projective[3] = 0.5;
    expectFailure({ ...BASE, parentWorldMatrix: projective }, "invalid-parent-transform");
    const nonFinite = new THREE.Matrix4().elements.slice();
    nonFinite[10] = Number.NaN;
    expectFailure({ ...BASE, parentWorldMatrix: nonFinite }, "invalid-parent-transform");
  });

  it("does not publish a patch that would leave the canonical world-coordinate budget", () => {
    expectFailure({
      ...BASE,
      localPosition: [9_999, 0, 0],
      worldBounds: { min: [9_997, 0, 0], max: [9_999, 2, 2] },
      hit: {
        targetPathIds: ["far-platform"],
        point: [10_000, 0, 0],
        normal: [0, 1, 0],
      },
      surfaceOffset: 0,
    }, "result-out-of-bounds");
  });

  it("preserves rotation by default and rejects non-boolean alignRotationToNormal", () => {
    const defaultResult = resolveStudioBg3dSurfaceSnap(BASE);
    expect(defaultResult.ok).toBe(true);
    if (!defaultResult.ok) return;
    expect(defaultResult.rotation).toEqual([0.1, -0.2, 0.3]);

    const explicitFalse = resolveStudioBg3dSurfaceSnap({
      ...BASE,
      alignRotationToNormal: false,
    });
    expect(explicitFalse.ok).toBe(true);
    if (!explicitFalse.ok) return;
    expect(explicitFalse.rotation).toEqual([0.1, -0.2, 0.3]);

    expectFailure({
      ...BASE,
      alignRotationToNormal: "yes" as unknown as boolean,
    }, "invalid-input");
  });

  it("aligns local +Y to the hit normal when alignRotationToNormal is true", () => {
    const result = resolveStudioBg3dSurfaceSnap({
      ...BASE,
      alignRotationToNormal: true,
      hit: { ...BASE.hit, normal: [0, 0, 2] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = resolveStudioBg3dSurfaceSnapOrientation([0, 0, 2]);
    expect(expected).not.toBeNull();
    expect(result.rotation[0]).toBeCloseTo(expected![0], 9);
    expect(result.rotation[1]).toBeCloseTo(expected![1], 9);
    expect(result.rotation[2]).toBeCloseTo(expected![2], 9);
    // Position path stays identical to the non-aligned case.
    const unaligned = resolveStudioBg3dSurfaceSnap({
      ...BASE,
      hit: { ...BASE.hit, normal: [0, 0, 2] },
    });
    expect(unaligned.ok).toBe(true);
    if (!unaligned.ok) return;
    expect(result.localPosition).toEqual(unaligned.localPosition);
    expect(result.worldPosition).toEqual(unaligned.worldPosition);
  });
});

describe("resolveStudioBg3dSurfaceSnapOrientation", () => {
  it("maps identity normal +Y to a near-zero Euler", () => {
    const orientation = resolveStudioBg3dSurfaceSnapOrientation([0, 2, 0]);
    expect(orientation).not.toBeNull();
    expect(orientation![0]).toBeCloseTo(0, 9);
    expect(orientation![1]).toBeCloseTo(0, 9);
    expect(orientation![2]).toBeCloseTo(0, 9);
    expect(Object.isFrozen(orientation)).toBe(true);
  });

  it("aligns local +Y with an arbitrary normal and fails closed on zero-length", () => {
    const orientation = resolveStudioBg3dSurfaceSnapOrientation([1, 0, 0]);
    expect(orientation).not.toBeNull();
    const yAxis = new THREE.Vector3(0, 1, 0).applyEuler(
      new THREE.Euler(orientation![0], orientation![1], orientation![2], "XYZ"),
    );
    expect(yAxis.x).toBeCloseTo(1, 6);
    expect(yAxis.y).toBeCloseTo(0, 6);
    expect(yAxis.z).toBeCloseTo(0, 6);

    expect(resolveStudioBg3dSurfaceSnapOrientation([0, 0, 0])).toBeNull();
    expect(resolveStudioBg3dSurfaceSnapOrientation([Number.NaN, 0, 1])).toBeNull();
    expect(resolveStudioBg3dSurfaceSnapOrientation([0, 1, 0], { up: [0, 0, 0] })).toBeNull();
  });

  it("accepts a custom up vector when resolving roll", () => {
    const withDefaultUp = resolveStudioBg3dSurfaceSnapOrientation([0, 0, 1]);
    const withCustomUp = resolveStudioBg3dSurfaceSnapOrientation([0, 0, 1], { up: [1, 0, 0] });
    expect(withDefaultUp).not.toBeNull();
    expect(withCustomUp).not.toBeNull();
    // Both map +Y to +Z; roll around the normal may differ.
    for (const orientation of [withDefaultUp!, withCustomUp!]) {
      const yAxis = new THREE.Vector3(0, 1, 0).applyEuler(
        new THREE.Euler(orientation[0], orientation[1], orientation[2], "XYZ"),
      );
      expect(yAxis.x).toBeCloseTo(0, 6);
      expect(yAxis.y).toBeCloseTo(0, 6);
      expect(yAxis.z).toBeCloseTo(1, 6);
    }
  });
});

describe("planStudioBg3dMultiSurfaceSnap", () => {
  it("returns per-input results and succeeds when at least one snap succeeds", () => {
    const locked: ResolveStudioBg3dSurfaceSnapInput = { ...BASE, locked: true, selectionId: "subject", selectedIds: ["subject"] };
    const okSibling: ResolveStudioBg3dSurfaceSnapInput = {
      ...BASE,
      selectionId: "prop",
      selectedIds: ["prop"],
      selectionSubtreeIds: ["prop"],
      hit: {
        targetPathIds: ["floor"],
        point: [0, 0, 0],
        normal: [0, 1, 0],
      },
      surfaceOffset: 0,
    };

    const plan = planStudioBg3dMultiSurfaceSnap([locked, okSibling]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.results).toHaveLength(2);
    expect(plan.results[0]).toEqual({ ok: false, reason: "locked" });
    expect(plan.results[1]?.ok).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.results)).toBe(true);
  });

  it("keeps self-hit and locked failures isolated so siblings still resolve", () => {
    const selfHit: ResolveStudioBg3dSurfaceSnapInput = {
      ...BASE,
      hit: { ...BASE.hit, targetPathIds: ["subject"] },
    };
    const good: ResolveStudioBg3dSurfaceSnapInput = {
      ...BASE,
      selectionId: "other",
      selectedIds: ["other"],
      selectionSubtreeIds: ["other"],
      hit: {
        targetPathIds: ["platform"],
        point: [1, 2, 3],
        normal: [0, 1, 0],
      },
      surfaceOffset: 0,
    };
    const plan = planStudioBg3dMultiSurfaceSnap([selfHit, good]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.results[0]).toEqual({ ok: false, reason: "self-hit" });
    expect(plan.results[1]?.ok).toBe(true);
  });

  it("fails closed on empty input, oversized lists, and all-fail batches", () => {
    expect(planStudioBg3dMultiSurfaceSnap([])).toEqual({
      ok: false,
      reason: "empty-inputs",
    });
    expect(planStudioBg3dMultiSurfaceSnap(null as unknown as [])).toEqual({
      ok: false,
      reason: "invalid-input",
    });

    const allLocked = planStudioBg3dMultiSurfaceSnap([
      { ...BASE, locked: true },
      {
        ...BASE,
        selectionId: "prop",
        selectedIds: ["prop"],
        selectionSubtreeIds: ["prop"],
        locked: true,
      },
    ]);
    expect(allLocked.ok).toBe(false);
    if (allLocked.ok) return;
    expect(allLocked.reason).toBe("locked");
    expect(allLocked.results).toHaveLength(2);

    const tooMany = Array.from({ length: 65 }, (_, index) => ({
      ...BASE,
      selectionId: `id${index}`,
      selectedIds: [`id${index}`],
      selectionSubtreeIds: [`id${index}`],
    }));
    expect(planStudioBg3dMultiSurfaceSnap(tooMany)).toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
  });

  it("never mutates caller-owned inputs", () => {
    const input: ResolveStudioBg3dSurfaceSnapInput = {
      ...BASE,
      localPosition: [2, 4, 1],
      rotation: [0.1, -0.2, 0.3],
    };
    const snapshot = structuredClone(input);
    const plan = planStudioBg3dMultiSurfaceSnap([input]);
    expect(plan.ok).toBe(true);
    expect(input).toEqual(snapshot);
  });
});
