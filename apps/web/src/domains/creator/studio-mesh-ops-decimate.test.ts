import { describe, expect, it } from "vitest";

import {
  createStudioUnitCubeMesh,
  studioEditableMeshStats,
} from "./studio-editable-half-edge-mesh";
import {
  decimateStudioMesh,
  subdivideStudioMeshCatmullLite,
} from "./studio-mesh-ops-advanced";

describe("MOD-018 shortest-edge-collapse decimation", () => {
  it("reduces a dense sphere-like mesh toward the requested ratio", () => {
    const dense = subdivideStudioMeshCatmullLite(createStudioUnitCubeMesh(), 2);
    expect(dense.ok).toBe(true);
    if (!dense.ok) return;
    const before = studioEditableMeshStats(dense.value);
    const result = decimateStudioMesh(dense.value, 0.3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = studioEditableMeshStats(result.value);
    expect(after.faceCount).toBeLessThan(before.faceCount);
    expect(after.vertexCount).toBeLessThan(before.vertexCount);
    expect(after.faceCount).toBeGreaterThan(4);
  });

  it("keeps the cube shell closed (no boundary edges) after decimation", () => {
    const result = decimateStudioMesh(createStudioUnitCubeMesh(), 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = studioEditableMeshStats(result.value);
    // Edge-collapse merges keep the shell watertight instead of punching stride holes.
    expect(stats.boundaryEdgeCount).toBe(0);
    expect(stats.faceCount).toBeGreaterThanOrEqual(4);
  });

  it("is deterministic for identical inputs", () => {
    const run = () => decimateStudioMesh(createStudioUnitCubeMesh(), 0.4);
    const first = run();
    const second = run();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.vertices.map((v) => v.position)).toEqual(
      second.value.vertices.map((v) => v.position),
    );
    expect(first.value.faces.length).toBe(second.value.faces.length);
  });

  it("returns the mesh unchanged at ratio 1 and rejects degenerate output targets", () => {
    const cube = createStudioUnitCubeMesh();
    const untouched = decimateStudioMesh(cube, 1);
    expect(untouched.ok).toBe(true);
    if (!untouched.ok) return;
    expect(untouched.value.faces.length).toBe(cube.faces.length);
    const tiny = decimateStudioMesh(cube, 0.05);
    expect(tiny.ok).toBe(true);
    if (!tiny.ok) return;
    expect(studioEditableMeshStats(tiny.value).faceCount).toBeGreaterThanOrEqual(4);
  });
});
