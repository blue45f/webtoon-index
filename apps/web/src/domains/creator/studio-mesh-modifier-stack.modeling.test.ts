import { describe, expect, it } from "vitest";

import {
  createStudioUnitCubeMesh,
  studioEditableMeshStats,
  type StudioEditableMesh,
} from "./studio-editable-half-edge-mesh";
import {
  createStudioMeshModifierStack,
  deserializeStudioMeshModifierStack,
  evaluateStudioMeshModifierStack,
  hashStudioMeshModifierStack,
  serializeStudioMeshModifierStack,
  withStudioMeshModifier,
  type StudioMeshModifierStackDto,
} from "./studio-mesh-modifier-stack";

async function evaluated(
  stack: ReturnType<typeof createStudioMeshModifierStack>,
): Promise<StudioEditableMesh> {
  const result = await evaluateStudioMeshModifierStack(stack);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.detail);
  return result.value.mesh;
}

describe("modeling modifier wave — subdivision / weld / decimate / simple-deform", () => {
  it("subdivides the cube into a denser smooth mesh", async () => {
    const stack = withStudioMeshModifier(
      createStudioMeshModifierStack(createStudioUnitCubeMesh(), []),
      { kind: "subdivision", id: "sub-1", enabled: true, levels: 1, smooth: true },
    );
    const mesh = await evaluated(stack);
    const stats = studioEditableMeshStats(mesh);
    // 6 quads → 12 tris → 48 tris after one mid-edge subdivision pass.
    expect(stats.faceCount).toBe(48);
    expect(stats.vertexCount).toBe(8 + 18);
  });

  it("keeps subdivision linear when smoothing is disabled", async () => {
    const stack = withStudioMeshModifier(
      createStudioMeshModifierStack(createStudioUnitCubeMesh(), []),
      { kind: "subdivision", id: "sub-lin", enabled: true, levels: 1, smooth: false },
    );
    const mesh = await evaluated(stack);
    let maxAbs = 0;
    for (const vertex of mesh.vertices) {
      maxAbs = Math.max(maxAbs, Math.abs(vertex.position.x), Math.abs(vertex.position.y));
    }
    // Linear midpoint split keeps every original and new vertex on the unit-cube shell.
    expect(maxAbs).toBeCloseTo(0.5, 5);
  });

  it("welds duplicated vertices by quantum without losing the cube shell", async () => {
    const stack = withStudioMeshModifier(
      createStudioMeshModifierStack(createStudioUnitCubeMesh(), []),
      { kind: "weld", id: "weld-1", enabled: true, quantum: 1e-4 },
    );
    const mesh = await evaluated(stack);
    const stats = studioEditableMeshStats(mesh);
    expect(stats.vertexCount).toBe(8);
    expect(stats.boundaryEdgeCount).toBe(0);
  });

  it("decimates toward the requested triangle ratio deterministically", async () => {
    const stack = withStudioMeshModifier(
      createStudioMeshModifierStack(createStudioUnitCubeMesh(), [
        { kind: "subdivision", id: "dense", enabled: true, levels: 2, smooth: false },
      ]),
      { kind: "decimate", id: "dec-1", enabled: true, ratio: 0.25 },
    );
    const dense = await evaluated(createStudioMeshModifierStack(
      createStudioUnitCubeMesh(),
      [{ kind: "subdivision", id: "dense", enabled: true, levels: 2, smooth: false }],
    ));
    const decimated = await evaluated(stack);
    const denseTris = studioEditableMeshStats(dense).faceCount;
    const keptTris = studioEditableMeshStats(decimated).faceCount;
    expect(keptTris).toBeLessThan(denseTris);
    expect(keptTris).toBeGreaterThanOrEqual(Math.floor(denseTris * 0.2));
    const repeat = await evaluated(withStudioMeshModifier(
      createStudioMeshModifierStack(createStudioUnitCubeMesh(), [
        { kind: "subdivision", id: "dense", enabled: true, levels: 2, smooth: false },
      ]),
      { kind: "decimate", id: "dec-1", enabled: true, ratio: 0.25 },
    ));
    expect(studioEditableMeshStats(repeat).faceCount).toBe(keptTris);
  });

  it("twists vertices along the deform axis proportionally", async () => {
    const stack = withStudioMeshModifier(
      createStudioMeshModifierStack(createStudioUnitCubeMesh(), []),
      {
        kind: "simple-deform",
        id: "twist-1",
        enabled: true,
        mode: "twist",
        axis: "y",
        angleRad: Math.PI / 4,
        factor: 1,
      },
    );
    const mesh = await evaluated(stack);
    const stats = studioEditableMeshStats(mesh);
    expect(stats.vertexCount).toBe(8);
    const positions = mesh.vertices.map((vertex) => vertex.position);
    // Bottom ring (t=0) is untouched.
    const bottomUntouched = positions.some((position) =>
      position.y < -0.4 && Math.abs(position.x - 0.5) < 1e-6
      && Math.abs(position.z - 0.5) < 1e-6);
    // Top ring (t=1) rotates +45° about Y: corner (0.5, 0.5) → (√0.5, 0).
    const topRotated = positions.some((position) =>
      position.y > 0.4 && Math.abs(position.x - Math.SQRT1_2) < 1e-6
      && Math.abs(position.z) < 1e-6);
    expect(bottomUntouched).toBe(true);
    expect(topRotated).toBe(true);
  });

  it("round-trips the new modifier kinds through serialize/deserialize with a stable hash", () => {
    const stack = withStudioMeshModifier(
      withStudioMeshModifier(
        withStudioMeshModifier(
          withStudioMeshModifier(
            createStudioMeshModifierStack(createStudioUnitCubeMesh(), []),
            { kind: "subdivision", id: "sub-r", enabled: true, levels: 2, smooth: true },
          ),
          { kind: "weld", id: "weld-r", enabled: false, quantum: 0.01 },
        ),
        { kind: "decimate", id: "dec-r", enabled: true, ratio: 0.5 },
      ),
      {
        kind: "simple-deform",
        id: "def-r",
        enabled: true,
        mode: "taper",
        axis: "z",
        angleRad: 0,
        factor: 0.5,
      },
    );
    const dto = serializeStudioMeshModifierStack(stack);
    expect(dto.modifiers.map((modifier) => modifier.kind)).toEqual([
      "subdivision",
      "weld",
      "decimate",
      "simple-deform",
    ]);
    const decoded = deserializeStudioMeshModifierStack(dto, createStudioUnitCubeMesh());
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(hashStudioMeshModifierStack(decoded.value)).toBe(hashStudioMeshModifierStack(stack));
  });

  it("rejects out-of-range parameters for the new kinds", () => {
    const badLevels = deserializeStudioMeshModifierStack({
      revision: 1,
      modifiers: [{ kind: "subdivision", id: "bad", enabled: true, levels: 9, smooth: true }],
    } satisfies unknown as StudioMeshModifierStackDto, createStudioUnitCubeMesh());
    expect(badLevels.ok).toBe(false);

    const badRatio = deserializeStudioMeshModifierStack({
      revision: 1,
      modifiers: [{ kind: "decimate", id: "bad", enabled: true, ratio: 0.99 }],
    } satisfies unknown as StudioMeshModifierStackDto, createStudioUnitCubeMesh());
    expect(badRatio.ok).toBe(false);

    const badQuantum = deserializeStudioMeshModifierStack({
      revision: 1,
      modifiers: [{ kind: "weld", id: "bad", enabled: true, quantum: 0 }],
    } satisfies unknown as StudioMeshModifierStackDto, createStudioUnitCubeMesh());
    expect(badQuantum.ok).toBe(false);

    const badMode = deserializeStudioMeshModifierStack({
      revision: 1,
      modifiers: [{
        kind: "simple-deform",
        id: "bad",
        enabled: true,
        mode: "shear",
        axis: "x",
        angleRad: 0,
        factor: 1,
      }],
    } satisfies unknown as StudioMeshModifierStackDto, createStudioUnitCubeMesh());
    expect(badMode.ok).toBe(false);
  });
});
