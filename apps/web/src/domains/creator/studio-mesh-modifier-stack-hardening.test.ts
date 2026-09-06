import { describe, expect, it } from "vitest";

import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  studioEditableMeshStats,
  studioEditableMeshToTriangleSoup,
} from "./studio-editable-half-edge-mesh";
import {
  createStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  STUDIO_MESH_MODIFIER_STACK_LIMITS,
  type StudioMeshModifier,
  type StudioSolidBooleanBackend,
} from "./studio-mesh-modifier-stack";

function booleanStack(): ReturnType<typeof createStudioMeshModifierStack> {
  const source = createStudioUnitCubeMesh();
  const operand = studioEditableMeshToTriangleSoup(createStudioUnitCubeMesh());
  return createStudioMeshModifierStack(source, [{
    kind: "boolean",
    id: "boolean-contract",
    enabled: true,
    operation: "union",
    operand,
  }]);
}

describe("mesh modifier evaluation budgets", () => {
  it("rejects multiplicative topology before the over-budget Array allocation", async () => {
    const stack = createStudioMeshModifierStack(createStudioUnitCubeMesh(), [
      {
        kind: "array",
        id: "array-64",
        enabled: true,
        count: 64,
        offset: { x: 0, y: 0, z: 0 },
        mode: "linear",
        realizeInstances: true,
      },
      {
        kind: "array",
        id: "array-4",
        enabled: true,
        count: 4,
        offset: { x: 0, y: 0, z: 0 },
        mode: "linear",
        realizeInstances: true,
      },
      {
        kind: "array",
        id: "array-over-budget",
        enabled: true,
        count: 64,
        offset: { x: 0, y: 0, z: 0 },
        mode: "linear",
        realizeInstances: true,
      },
    ]);

    const result = await evaluateStudioMeshModifierStack(stack);

    expect(result).toMatchObject({
      ok: false,
      code: "budget-exceeded",
    });
    if (!result.ok) expect(result.detail).toContain("array-over-budget");
    expect(stack.source.vertices).toHaveLength(8);
    expect(stack.source.faces).toHaveLength(6);
  });

  it("preflights the cumulative Boolean operand byte budget before cloning operands", () => {
    const sharedLargeIndices = new Uint32Array(1_200_000);
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]);
    const modifiers = Array.from({ length: 4 }, (_, index): StudioMeshModifier => ({
      kind: "boolean",
      id: `large-operand-${index}`,
      enabled: true,
      operation: "union",
      operand: { positions, indices: sharedLargeIndices },
    }));

    expect(() => createStudioMeshModifierStack(createStudioUnitCubeMesh(), modifiers))
      .toThrow(/cumulative boolean operand byte budget/u);
    expect((positions.byteLength + sharedLargeIndices.byteLength) * modifiers.length)
      .toBeGreaterThan(STUDIO_MESH_MODIFIER_STACK_LIMITS.maxBooleanOperandBytes);
  });

  it("rejects malformed in-memory nested contracts without leaking a native TypeError", () => {
    const malformedArray = {
      kind: "array",
      id: "missing-offset",
      enabled: true,
      count: 2,
      mode: "linear",
      realizeInstances: true,
    } as unknown as StudioMeshModifier;
    const malformedBoolean = {
      kind: "boolean",
      id: "missing-operand",
      enabled: true,
      operation: "union",
    } as unknown as StudioMeshModifier;

    expect(() => createStudioMeshModifierStack(createStudioUnitCubeMesh(), [malformedArray]))
      .toThrow(/offset must be a vector/u);
    expect(() => createStudioMeshModifierStack(createStudioUnitCubeMesh(), [malformedBoolean]))
      .toThrow(/operand must be a triangle soup/u);
  });
});

describe("solid Boolean backend boundary", () => {
  it("rejects non-typed, non-finite, and out-of-range backend output before mesh conversion", async () => {
    const cubeSoup = studioEditableMeshToTriangleSoup(createStudioUnitCubeMesh());
    const nonFinitePositions = new Float32Array(cubeSoup.positions);
    nonFinitePositions[0] = Number.NaN;
    const badIndices = new Uint32Array(cubeSoup.indices);
    badIndices[0] = 999_999;
    const outputs: readonly unknown[] = [
      { positions: Array.from(cubeSoup.positions), indices: cubeSoup.indices },
      { positions: nonFinitePositions, indices: cubeSoup.indices },
      { positions: cubeSoup.positions, indices: badIndices },
    ];

    for (const output of outputs) {
      const backend = {
        async boolean() {
          return output;
        },
      } as unknown as StudioSolidBooleanBackend;
      const result = await evaluateStudioMeshModifierStack(booleanStack(), {
        booleanBackend: backend,
      });
      expect(result).toMatchObject({ ok: false, code: "boolean-failed" });
    }
  });

  it("rejects an oversized typed backend output before scanning or rebuilding it", async () => {
    const indices = new Uint32Array(
      STUDIO_MESH_MODIFIER_STACK_LIMITS.maxEvaluatedIndexValues + 3,
    );
    const backend: StudioSolidBooleanBackend = {
      async boolean() {
        return {
          positions: new Float32Array([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
          ]),
          indices,
        };
      },
    };

    const result = await evaluateStudioMeshModifierStack(booleanStack(), {
      booleanBackend: backend,
    });

    expect(result).toMatchObject({ ok: false, code: "budget-exceeded" });
  });
});

describe("modifier parameter contracts", () => {
  it("merges and clips Mirror center-seam vertices without duplicating the seam", async () => {
    const halfPlane = createStudioEditableMeshFromPolygons([
      { x: 0, y: -1, z: 0 },
      { x: 1, y: -1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ], [[0, 1, 2, 3]]);
    const stack = createStudioMeshModifierStack(halfPlane, [{
      kind: "mirror",
      id: "seam",
      enabled: true,
      axis: "x",
      merge: true,
      mergeThreshold: 1e-4,
      bisect: false,
      clip: true,
    }]);

    const result = await evaluateStudioMeshModifierStack(stack);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mesh.vertices).toHaveLength(6);
    expect(result.value.mesh.faces).toHaveLength(4);
    expect(result.value.mesh.vertices.filter(({ position }) => position.x === 0)).toHaveLength(2);
    expect(result.value.mesh.vertices.some(({ position }) => position.x === -1)).toBe(true);
  });

  it("bisects to the positive axis half-space before mirroring", async () => {
    const crossingPlane = createStudioEditableMeshFromPolygons([
      { x: -2, y: -1, z: 0 },
      { x: 1, y: -1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: -2, y: 1, z: 0 },
    ], [[0, 1, 2, 3]]);
    const stack = createStudioMeshModifierStack(crossingPlane, [{
      kind: "mirror",
      id: "bisect",
      enabled: true,
      axis: "x",
      merge: true,
      mergeThreshold: 1e-5,
      bisect: true,
      clip: true,
    }]);

    const result = await evaluateStudioMeshModifierStack(stack);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xs = result.value.mesh.vertices.map(({ position }) => position.x);
    expect(Math.max(...xs)).toBeCloseTo(1);
    expect(Math.min(...xs)).toBeCloseTo(-1);
    expect(xs).not.toContain(-2);
  });

  it("rotates radial Array instance orientation and rejects unrealized output", async () => {
    const triangle = createStudioEditableMeshFromPolygons([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ], [[0, 1, 2]]);
    const radial = createStudioMeshModifierStack(triangle, [{
      kind: "array",
      id: "radial",
      enabled: true,
      count: 2,
      offset: { x: 2, y: 0, z: 0 },
      mode: "radial",
      radialAngleRad: Math.PI * 2,
      realizeInstances: true,
    }]);
    const unrealized = createStudioMeshModifierStack(triangle, [{
      ...radial.modifiers[0] as Extract<StudioMeshModifier, { kind: "array" }>,
      id: "unrealized",
      realizeInstances: false,
    }]);

    const radialResult = await evaluateStudioMeshModifierStack(radial);
    const unrealizedResult = await evaluateStudioMeshModifierStack(unrealized);

    expect(radialResult.ok).toBe(true);
    if (radialResult.ok) {
      expect(radialResult.value.mesh.vertices.some(({ position }) => (
        Math.abs(position.x + 2) < 1e-5 && Math.abs(position.z + 1) < 1e-5
      ))).toBe(true);
    }
    expect(unrealizedResult).toMatchObject({ ok: false, code: "invalid-parameter" });
  });

  it("adds Solidify rims only on boundary edges and closes an open sheet", async () => {
    const plane = createStudioEditableMeshFromPolygons([
      { x: -1, y: -1, z: 0 },
      { x: 1, y: -1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: -1, y: 1, z: 0 },
    ], [[0, 1, 2, 3]]);
    const stack = createStudioMeshModifierStack(plane, [{
      kind: "solidify",
      id: "sheet",
      enabled: true,
      thickness: 0.1,
      evenThickness: true,
      rim: true,
    }]);

    const result = await evaluateStudioMeshModifierStack(stack);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = studioEditableMeshStats(result.value.mesh);
    expect(stats.faceCount).toBe(12);
    expect(stats.boundaryEdgeCount).toBe(0);
  });

  it("does not add internal Solidify rims to an already closed cube", async () => {
    const stack = createStudioMeshModifierStack(createStudioUnitCubeMesh(), [{
      kind: "solidify",
      id: "closed",
      enabled: true,
      thickness: 0.1,
      evenThickness: true,
      rim: true,
    }]);

    const result = await evaluateStudioMeshModifierStack(stack);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mesh.faces).toHaveLength(24);
    expect(studioEditableMeshStats(result.value.mesh).boundaryEdgeCount).toBe(0);
  });

  it("honors Bevel angle/weight no-op selection and rejects fake multi-segment success", async () => {
    const source = createStudioUnitCubeMesh();
    const angleFiltered = createStudioMeshModifierStack(source, [{
      kind: "bevel",
      id: "angle-filtered",
      enabled: true,
      amount: 0.1,
      segments: 1,
      angleLimitRad: Math.PI,
      weightInfluence: 0,
    }]);
    const weightFiltered = createStudioMeshModifierStack(source, [{
      kind: "bevel",
      id: "weight-filtered",
      enabled: true,
      amount: 0.1,
      segments: 1,
      angleLimitRad: 0,
      weightInfluence: 1,
    }]);
    const unsupportedSegments = createStudioMeshModifierStack(source, [{
      kind: "bevel",
      id: "segments",
      enabled: true,
      amount: 0.1,
      segments: 2,
      angleLimitRad: 0,
      weightInfluence: 0,
    }]);

    const angleResult = await evaluateStudioMeshModifierStack(angleFiltered);
    const weightResult = await evaluateStudioMeshModifierStack(weightFiltered);
    const segmentResult = await evaluateStudioMeshModifierStack(unsupportedSegments);

    expect(angleResult.ok).toBe(true);
    expect(weightResult.ok).toBe(true);
    if (angleResult.ok) expect(angleResult.value.resultHash).toBe(angleResult.value.sourceHash);
    if (weightResult.ok) expect(weightResult.value.resultHash).toBe(weightResult.value.sourceHash);
    expect(segmentResult).toMatchObject({ ok: false, code: "invalid-parameter" });
  });

  it("reconstructs a complete single-segment Bevel as a closed atomic shell", async () => {
    const stack = createStudioMeshModifierStack(createStudioUnitCubeMesh(), [{
      kind: "bevel",
      id: "closed-single-segment",
      enabled: true,
      amount: 0.1,
      segments: 1,
      angleLimitRad: Math.PI / 3,
      weightInfluence: 0,
    }]);

    const result = await evaluateStudioMeshModifierStack(stack);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = studioEditableMeshStats(result.value.mesh);
    expect(stats.vertexCount).toBe(24);
    expect(stats.faceCount).toBe(26);
    expect(stats.boundaryEdgeCount).toBe(0);
    expect(result.value.resultHash).not.toBe(result.value.sourceHash);
  });
});
