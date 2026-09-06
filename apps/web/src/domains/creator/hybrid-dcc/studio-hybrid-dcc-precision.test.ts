import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  createStudioHybridDccIdentityTransform,
  inverseTransformStudioHybridDccPoint,
  transformStudioHybridDccPoint,
  type StudioHybridDccObjectTransform,
} from "./studio-hybrid-dcc-object-transform";
import { parseStudioHybridDccPrecisionInput as parse } from "./studio-hybrid-dcc-precision-input";
import {
  alignStudioHybridDccPrecisionBounds as align,
  applyStudioHybridDccPrecisionCommand as apply,
  measureStudioHybridDccPrecisionBounds as measure,
  snapStudioHybridDccPrecisionToGrid as snap,
} from "./studio-hybrid-dcc-precision-transform";
import { createStudioHybridDccWorkspace, workspaceAddUnitCube, workspaceCommitObjectTransform, workspaceUndo, workspaceRedo } from "./studio-hybrid-dcc-workspace";

const identity = createStudioHybridDccIdentityTransform;
const mixed: StudioHybridDccObjectTransform = {
  revision: 1, position: [3, -2, 5], rotationEulerRad: [0.7, -0.8, 1.2], scale: [2, -0.5, 1.3],
};
function matrix(transform: StudioHybridDccObjectTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(...transform.rotationEulerRad, "XYZ")),
    new Vector3(...transform.scale),
  );
}
function close(actual: readonly number[], expected: readonly number[], digits = 9): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, digits));
}

describe("Hybrid DCC precision / renderer parity", () => {
  it("matches actual Three.js XYZ matrices in 512 mixed-axis forward and inverse cases", () => {
    for (let index = 0; index < 512; index += 1) {
      const transform: StudioHybridDccObjectTransform = {
        ...mixed, rotationEulerRad: [Math.sin(index) * 3, Math.cos(index * 0.7) * 1.57, index * 0.019],
      };
      const local = [Math.sin(index * 0.3), Math.cos(index * 0.4), index * 0.013] as const;
      const projected = new Vector3(...local).applyMatrix4(matrix(transform));
      const expected = [projected.x, projected.y, projected.z] as const;
      close(transformStudioHybridDccPoint(local, transform), expected);
      close(inverseTransformStudioHybridDccPoint(expected, transform), local);
    }
  });
  it.each(["world", "local"] as const)("composes %s pivot rotations without Euler-component addition", (space) => {
    const pivot = new Vector3(1, -2, 3);
    for (let index = 0; index < 90; index += 1) {
      const angle = index * 0.03;
      const axis = new Vector3(0, 1, 0);
      if (space === "local") axis.applyQuaternion(new Quaternion().setFromEuler(new Euler(...mixed.rotationEulerRad, "XYZ")));
      const delta = new Matrix4().makeRotationAxis(axis, angle);
      const aroundPivot = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
        .multiply(delta).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      const next = apply(mixed, { kind: "rotate", axis: "y", space, value: angle, pivot: [pivot.x, pivot.y, pivot.z] });
      close(matrix(next).elements, aroundPivot.multiply(matrix(mixed)).elements);
    }
  });
  it("preserves the pivot during local nonuniform and reflected scaling", () => {
    const pivot = [1, 2, -3] as const;
    const next = apply(mixed, { kind: "scale", axis: "x", space: "local", value: -2, pivot });
    close(transformStudioHybridDccPoint(inverseTransformStudioHybridDccPoint(pivot, mixed), next), pivot);
    expect(next.scale[0]).toBe(-4);
  });
  it("uses orientation rather than signed scale for local distance", () => {
    const next = apply({ ...identity(), rotationEulerRad: [0, 0, Math.PI / 2], scale: [-20, 5, 3] },
      { kind: "translate", axis: "x", space: "local", value: 2 });
    close(next.position, [0, 2, 0]);
  });
  it("measures real vertices, avoiding floating placement caused by a rotated AABB", () => {
    const vertices = new Float32Array([1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0]);
    const transform = { ...identity(), rotationEulerRad: [0, 0, Math.PI / 4] as const };
    const bounds = measure(vertices, transform);
    close(bounds.min, [-Math.SQRT1_2, -Math.SQRT1_2, 0]);
    const placed = align(transform, bounds, "ground");
    expect(measure(vertices, placed).min[1]).toBeCloseTo(0, 12);
  });
  it("fits world-axis dimensions uniformly and preserves reflected scale", () => {
    const vertices = new Float32Array([-1, 0, 0, 0, 2, 0, 2, -1, 3]);
    const next = apply(mixed, { kind: "dimension", axis: "x", space: "world", value: 5 }, measure(vertices, mixed));
    const bounds = measure(vertices, next);
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(5, 10);
    expect(next.scale[1]).toBeLessThan(0);
    close(next.scale.map((value, index) => value / mixed.scale[index]!), [next.scale[0] / 2, next.scale[0] / 2, next.scale[0] / 2]);
  });
  it("snaps symmetrically and idempotently without changing orientation", () => {
    const source = { ...mixed, position: [0.25, -0.25, 0.01] as const };
    const next = snap(source, 0.1);
    close(next.position, [0.3, -0.3, 0]);
    expect(snap(next, 0.1)).toEqual(next);
    expect(next.rotationEulerRad).toEqual(mixed.rotationEulerRad);
    expect(next.scale).toEqual(mixed.scale);
  });
  it("fails closed for zero scale, world shear, invalid intervals and geometry", () => {
    expect(() => apply(mixed, { kind: "scale", axis: "all", space: "local", value: 0 })).toThrow();
    expect(() => apply(mixed, { kind: "scale", axis: "x", space: "world", value: 2 })).toThrow(/로컬/u);
    expect(() => snap(mixed, 0)).toThrow();
    expect(() => measure([1, 2], mixed)).toThrow();
    expect(() => measure([Number.NaN, 0, 0], mixed)).toThrow();
    expect(() => measure({ length: 750_003 }, mixed)).toThrow();
  });
  it("commits through existing undo/redo without changing geometry authority", () => {
    let workspace = workspaceAddUnitCube(createStudioHybridDccWorkspace("precision-history"), "cube");
    const before = workspace.session.state.objectTransforms.cube!;
    const meshHash = workspace.session.state.geometry.records.cube!.meshHash;
    const next = apply(before, { kind: "translate", axis: "x", space: "world", value: parse("1m+25cm", "length") });
    workspace = workspaceCommitObjectTransform(workspace, "cube", next);
    expect(workspace.session.state.objectTransforms.cube).toEqual(next);
    expect(workspace.session.state.geometry.records.cube!.meshHash).toBe(meshHash);
    workspace = workspaceUndo(workspace);
    expect(workspace.session.state.objectTransforms.cube).toEqual(before);
    workspace = workspaceRedo(workspace);
    expect(workspace.session.state.objectTransforms.cube).toEqual(next);
  });
});

describe("bounded dimensional expressions", () => {
  it.each([
    ["1m+25cm", "length", 1.25], ["(25mm+75mm)/2", "length", 0.05],
    ["1e-3m", "length", 0.001], ["90/2", "angle", Math.PI / 4],
    ["90deg/2", "angle", Math.PI / 4], [".5rad", "angle", 0.5],
    ["110%", "scalar", 1.1], ["(2+3)*4/2", "scalar", 10],
  ] as const)("evaluates %s as %s", (text, quantity, expected) => expect(parse(text, quantity)).toBeCloseTo(expected, 12));
  it.each(["", "1/0", "1e999", "globalThis.process.exit()", "1;alert(1)", "2(3)", "1m+2deg", "1m+2", "1m*2m", "1/2m", "0xFF", "1**2", "(2"])("rejects %s", (text) => expect(() => parse(text, "length")).toThrow());
  it("bounds input length and recursion depth", () => {
    expect(() => parse("1".repeat(97), "scalar")).toThrow();
    expect(() => parse("(".repeat(17) + "1" + ")".repeat(17), "scalar")).toThrow();
  });
});
