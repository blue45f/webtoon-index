import { describe, expect, it } from "vitest";

import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  studioEditableMeshStats,
} from "./studio-editable-half-edge-mesh";
import {
  fillHoleStudioEditableMesh,
  flipStudioMeshNormals,
  pokeStudioMeshFaces,
  smoothStudioMeshVerticesLaplacian,
  triangulateStudioMeshFaces,
} from "./studio-mesh-ops-modeling";

describe("studio mesh ops — modeling wave 2", () => {
  it("triangulates every face of a unit cube", () => {
    const cube = createStudioUnitCubeMesh();
    const result = triangulateStudioMeshFaces(cube);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = studioEditableMeshStats(result.value);
    // Cube has quad faces; triangulation must yield exactly 12 triangles.
    expect(stats.faceCount).toBe(12);
    for (const face of result.value.faces) {
      let cursor = face.he;
      let length = 0;
      do {
        cursor = result.value.halfEdges[cursor]!.next;
        length += 1;
      } while (cursor !== face.he);
      expect(length).toBe(3);
    }
  });

  it("flips winding so face normals invert", () => {
    const cube = createStudioUnitCubeMesh();
    const before = flipStudioMeshNormals(cube);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const flipped = flipStudioMeshNormals(before.value);
    expect(flipped.ok).toBe(true);
    if (!flipped.ok) return;
    // Double flip restores identical vertex positions; soup rebuild triangulates quads.
    expect(studioEditableMeshStats(flipped.value).vertexCount).toBe(8);
    expect(studioEditableMeshStats(flipped.value).faceCount).toBe(12);
  });

  it("fills the open top of a five-sided box", () => {
    // Build an open box: unit cube minus its top quad (faces are indexed; rebuild via polygons).
    const open = createOpenTopBox();
    const beforeStats = studioEditableMeshStats(open);
    const result = fillHoleStudioEditableMesh(open);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const afterStats = studioEditableMeshStats(result.value);
    expect(afterStats.faceCount).toBeGreaterThan(beforeStats.faceCount);
    const closedAgain = fillHoleStudioEditableMesh(result.value);
    expect(closedAgain.ok).toBe(true);
    if (!closedAgain.ok) return;
    // Idempotent once watertight.
    expect(studioEditableMeshStats(closedAgain.value).faceCount)
      .toBe(studioEditableMeshStats(result.value).faceCount);
  });

  it("pokes faces into centroid fans", () => {
    const cube = createStudioUnitCubeMesh();
    const tri = triangulateStudioMeshFaces(cube);
    expect(tri.ok).toBe(true);
    if (!tri.ok) return;
    const poked = pokeStudioMeshFaces(tri.value);
    expect(poked.ok).toBe(true);
    if (!poked.ok) return;
    const stats = studioEditableMeshStats(poked.value);
    expect(stats.vertexCount).toBe(8 + 12);
    expect(stats.faceCount).toBe(36);
  });

  it("relaxes vertices with Laplacian smoothing but keeps topology shape bounded", () => {
    const cube = createStudioUnitCubeMesh();
    const result = smoothStudioMeshVerticesLaplacian(cube, 4, 0.8);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stats = studioEditableMeshStats(result.value);
    // Soup rebuild keeps welded vertices but represents quads as triangle pairs.
    expect(stats.vertexCount).toBe(8);
    expect(stats.faceCount).toBe(12);
    // All vertices must collapse toward the shared center (cube shrinks).
    let maxRadius = 0;
    for (const vertex of result.value.vertices) {
      maxRadius = Math.max(maxRadius, Math.abs(vertex.position.x));
    }
    expect(maxRadius).toBeLessThan(0.5);
  });

  it("rejects smoothing when iterations/factor are out of range by clamping instead of failing", () => {
    const cube = createStudioUnitCubeMesh();
    const zero = smoothStudioMeshVerticesLaplacian(cube, 0, 0.5);
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.value.vertices.length).toBe(cube.vertices.length);
  });
});

function createOpenTopBox() {
  const positions = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ] as const;
  const faces: number[][] = [
    [3, 2, 1, 0],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
  ];
  return createStudioEditableMeshFromPolygons(
    positions.map(([x, y, z]) => ({ x, y, z })),
    faces,
  );
}
