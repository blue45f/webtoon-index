import { describe, it, expect } from "vitest";

import { Studio3DEditableMesh } from "./studio-3d-editable-mesh";

describe("Studio3DEditableMesh", () => {
  it("creates vertices and a triangular face", () => {
    const mesh = new Studio3DEditableMesh();
    const v0 = mesh.addVertex([0, 0, 0]);
    const v1 = mesh.addVertex([1, 0, 0]);
    const v2 = mesh.addVertex([0, 1, 0]);
    const face = mesh.addFace([v0.id, v1.id, v2.id]);

    expect(face).toBeDefined();
    const stats = mesh.getStats();
    expect(stats.vertices).toBe(3);
    expect(stats.faces).toBe(1);
    expect(stats.triangles).toBe(1);
  });

  it("supports quad faces and ngon detection", () => {
    const mesh = new Studio3DEditableMesh();
    const v0 = mesh.addVertex([0, 0, 0]);
    const v1 = mesh.addVertex([1, 0, 0]);
    const v2 = mesh.addVertex([1, 1, 0]);
    const v3 = mesh.addVertex([0, 1, 0]);
    mesh.addFace([v0.id, v1.id, v2.id, v3.id]);

    const stats = mesh.getStats();
    expect(stats.quads).toBe(1);
    expect(stats.triangles).toBe(0);
  });

  it("moves vertices and validates mesh", () => {
    const mesh = new Studio3DEditableMesh();
    const v0 = mesh.addVertex([0, 0, 0]);
    mesh.moveVertex(v0.id, [1, 2, 3]);
    expect(mesh.getVertex(v0.id)?.position).toEqual([1, 2, 3]);

    // 고립 정점 검증
    const result = mesh.validate();
    expect(result.issues.length).toBe(1); // v0 has no halfEdge
  });

  it("selects and deselects elements", () => {
    const mesh = new Studio3DEditableMesh();
    mesh.addVertex([0, 0, 0]);
    mesh.addVertex([1, 0, 0]);
    mesh.selectAll("vertex");
    expect(mesh.getSelected("vertex").length).toBe(2);
    mesh.deselectAll();
    expect(mesh.getSelected("vertex").length).toBe(0);
  });

  it("removes faces and cleans up topology", () => {
    const mesh = new Studio3DEditableMesh();
    const v0 = mesh.addVertex([0, 0, 0]);
    const v1 = mesh.addVertex([1, 0, 0]);
    const v2 = mesh.addVertex([0, 1, 0]);
    const face = mesh.addFace([v0.id, v1.id, v2.id])!;

    expect(mesh.getStats().faces).toBe(1);
    mesh.removeFace(face.id);
    expect(mesh.getStats().faces).toBe(0);
  });

  it("shares an edge and pairs twins between adjacent faces", () => {
    const mesh = new Studio3DEditableMesh();
    const v0 = mesh.addVertex([0, 0, 0]);
    const v1 = mesh.addVertex([1, 0, 0]);
    const v2 = mesh.addVertex([1, 1, 0]);
    const v3 = mesh.addVertex([0, 1, 0]);

    mesh.addFace([v0.id, v1.id, v2.id]);
    mesh.addFace([v0.id, v2.id, v3.id]);

    expect(mesh.getStats()).toMatchObject({
      vertices: 4,
      edges: 5,
      faces: 2,
      boundaryEdges: 4,
      nonManifoldEdges: 0,
    });
    expect(mesh.getAllHalfEdges().filter((halfEdge) => halfEdge.twinId)).toHaveLength(2);
    expect(mesh.validate()).toEqual({ valid: true, issues: [] });
  });

  it("rejects destructive vertex removal and degenerate faces", () => {
    const mesh = new Studio3DEditableMesh();
    const v0 = mesh.addVertex([0, 0, 0]);
    const v1 = mesh.addVertex([1, 0, 0]);
    const v2 = mesh.addVertex([0, 1, 0]);

    expect(mesh.addFace([v0.id, v1.id, v1.id])).toBeUndefined();
    expect(mesh.addFace([v0.id, v1.id, v2.id])).toBeDefined();
    expect(mesh.removeVertex(v0.id)).toBe(false);
  });

  it("detects a non-manifold edge shared by three faces", () => {
    const mesh = new Studio3DEditableMesh();
    const a = mesh.addVertex([0, 0, 0]);
    const b = mesh.addVertex([1, 0, 0]);
    const c = mesh.addVertex([0, 1, 0]);
    const d = mesh.addVertex([0, -1, 0]);
    const e = mesh.addVertex([0, 0, 1]);

    mesh.addFace([a.id, b.id, c.id]);
    mesh.addFace([b.id, a.id, d.id]);
    mesh.addFace([a.id, b.id, e.id]);

    expect(mesh.getStats().nonManifoldEdges).toBe(1);
    expect(mesh.validate().issues.some((issue) => issue.includes("비다양체"))).toBe(true);
  });

  it("keeps returned vertex tuples isolated from internal topology", () => {
    const mesh = new Studio3DEditableMesh();
    const position: [number, number, number] = [1, 2, 3];
    const vertex = mesh.addVertex(position);

    position[0] = 99;
    vertex.position[1] = 99;

    expect(mesh.getVertex(vertex.id)?.position).toEqual([1, 2, 3]);
  });
});
