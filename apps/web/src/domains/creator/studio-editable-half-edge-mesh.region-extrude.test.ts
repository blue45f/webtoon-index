import { describe, expect, it } from "vitest";

import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  deserializeStudioEditableMesh,
  diagnoseStudioEditableMesh,
  extrudeStudioEditableMeshFaces,
  extrudeStudioEditableMeshFacesWithReceipt,
  hashStudioEditableMesh,
  isIssuedStudioEditableMeshExtrudeRegionReceipt,
  serializeStudioEditableMesh,
  STUDIO_EDITABLE_MESH_LIMITS,
  studioEditableMeshStats,
  type StudioEditableMesh,
  type StudioEditableMeshSnapshot,
} from "./studio-editable-half-edge-mesh";

function faceHalfEdgeCreases(mesh: StudioEditableMesh, faceId: number): readonly number[] {
  const face = mesh.faces.find((candidate) => candidate.id === faceId);
  if (!face) return [];
  const creases: number[] = [];
  let halfEdgeId = face.he;
  do {
    const halfEdge = mesh.halfEdges[halfEdgeId]!;
    creases.push(halfEdge.crease);
    halfEdgeId = halfEdge.next;
  } while (halfEdgeId !== face.he && creases.length <= mesh.halfEdges.length);
  return creases;
}

function facesShareEdge(
  mesh: StudioEditableMesh,
  firstFaceId: number,
  secondFaceId: number,
): boolean {
  return mesh.halfEdges.some((halfEdge) => (
    halfEdge.face === firstFaceId
    && halfEdge.twin >= 0
    && mesh.halfEdges[halfEdge.twin]?.face === secondFaceId
  ));
}

describe("Studio editable mesh connected-region extrude", () => {
  it("extrudes adjacent faces as one manifold region without internal side walls", () => {
    const source = createStudioUnitCubeMesh();
    const sourceHash = hashStudioEditableMesh(source);
    const selectedFaceIds = new Set([0, 2]);
    const internalSelectedHalfEdgeIds = source.halfEdges
      .filter((halfEdge) => (
        selectedFaceIds.has(halfEdge.face)
        && halfEdge.twin >= 0
        && selectedFaceIds.has(source.halfEdges[halfEdge.twin]!.face)
      ))
      .map(({ id }) => id);

    const result = extrudeStudioEditableMeshFacesWithReceipt(source, [2, 0, 2], 0.25);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { mesh, receipt } = result.value;
    expect(receipt).toMatchObject({
      operation: "extrude-region",
      sourceMeshHash: sourceHash,
      resultMeshHash: hashStudioEditableMesh(mesh),
      sourceFaceIds: [0, 2],
      connectedRegionCount: 1,
    });
    const faceRemap = new Map(receipt.faceRemap.entries);
    expect(faceRemap.size).toBe(source.faces.length);
    expect(faceRemap.get(0)).toBe(receipt.capFaceIds[0]);
    expect(faceRemap.get(2)).toBe(receipt.capFaceIds[1]);
    expect(receipt.selectionRemap.face?.entries).toEqual([
      [0, receipt.capFaceIds[0]],
      [2, receipt.capFaceIds[1]],
    ]);
    for (const sourceFace of source.faces) {
      const resultFaceId = faceRemap.get(sourceFace.id);
      expect(resultFaceId).not.toBeNull();
      expect(resultFaceId).not.toBeUndefined();
      expect(mesh.faces.find(({ id }) => id === resultFaceId)).toMatchObject({
        materialSlot: sourceFace.materialSlot,
        smooth: sourceFace.smooth,
      });
    }
    expect(receipt.boundaryHalfEdgeIds).toHaveLength(6);
    expect(receipt.sideFaceIds).toHaveLength(6);
    expect(receipt.boundaryHalfEdgeIds).not.toEqual(
      expect.arrayContaining(internalSelectedHalfEdgeIds),
    );
    expect(receipt.capFaceIds).toHaveLength(2);
    expect(facesShareEdge(mesh, receipt.capFaceIds[0]!, receipt.capFaceIds[1]!)).toBe(true);
    expect(studioEditableMeshStats(mesh)).toEqual({
      vertexCount: 14,
      halfEdgeCount: 48,
      edgeCount: 24,
      faceCount: 12,
      boundaryEdgeCount: 0,
    });
    expect(diagnoseStudioEditableMesh(mesh)).toEqual([]);
    expect(hashStudioEditableMesh(source)).toBe(sourceHash);
    expect(isIssuedStudioEditableMeshExtrudeRegionReceipt(receipt)).toBe(true);
    expect(isIssuedStudioEditableMeshExtrudeRegionReceipt({ ...receipt })).toBe(false);
    expect(isIssuedStudioEditableMeshExtrudeRegionReceipt(
      JSON.parse(JSON.stringify(receipt)),
    )).toBe(false);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.faceRemap)).toBe(true);
    expect(Object.isFrozen(receipt.faceRemap.entries)).toBe(true);
    expect(Object.isFrozen(receipt.faceRemap.entries[0])).toBe(true);
    expect(Object.isFrozen(receipt.selectionRemap)).toBe(true);
    expect(Object.isFrozen(receipt.selectionRemap.face)).toBe(true);
    expect(Object.isFrozen(receipt.selectionRemap.face?.entries)).toBe(true);
    expect(Object.isFrozen(receipt.sourceFaceIds)).toBe(true);
    expect(Object.isFrozen(receipt.capFaceIds)).toBe(true);
    const sourceFaceIdsBeforeMutationAttempt = [...receipt.sourceFaceIds];
    expect(() => {
      (receipt.sourceFaceIds as number[]).push(999);
    }).toThrow();
    expect(() => {
      (receipt as { connectedRegionCount: number }).connectedRegionCount = 999;
    }).toThrow();
    expect(() => {
      (receipt.faceRemap.entries[0] as [number, number | null])[1] = 999;
    }).toThrow();
    expect(receipt.sourceFaceIds).toEqual(sourceFaceIdsBeforeMutationAttempt);
    expect(receipt.connectedRegionCount).toBe(1);
  });

  it("is deterministic and preserves the existing mesh-only API wrapper", () => {
    const source = createStudioUnitCubeMesh();
    const first = extrudeStudioEditableMeshFacesWithReceipt(source, [2, 0, 2], 0.4);
    const second = extrudeStudioEditableMeshFacesWithReceipt(source, [0, 2], 0.4);
    const compatible = extrudeStudioEditableMeshFaces(source, [0, 2], 0.4);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(compatible.ok).toBe(true);
    if (!first.ok || !second.ok || !compatible.ok) return;
    expect(first.value.receipt).toEqual(second.value.receipt);
    expect(hashStudioEditableMesh(first.value.mesh)).toBe(hashStudioEditableMesh(second.value.mesh));
    expect(hashStudioEditableMesh(compatible.value)).toBe(hashStudioEditableMesh(first.value.mesh));
  });

  it("rejects non-dense counters and uses the receipt as cross-revision face authority", () => {
    const cube = createStudioUnitCubeMesh();
    const forged: StudioEditableMesh = {
      ...cube,
      nextVertexId: cube.nextVertexId + 1,
    };
    expect(extrudeStudioEditableMeshFacesWithReceipt(forged, [0, 2], 0.25)).toEqual({
      ok: false,
      code: "invalid-mesh",
      detail: "nextVertexId violates the canonical dense-ID authority invariant",
    });

    const first = extrudeStudioEditableMeshFacesWithReceipt(cube, [0, 2], 0.25);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.mesh).toMatchObject({
      nextVertexId: first.value.mesh.vertices.length,
      nextHalfEdgeId: first.value.mesh.halfEdges.length,
      nextFaceId: first.value.mesh.faces.length,
    });
    expect(new Map(first.value.receipt.faceRemap.entries).get(0)).toBe(
      first.value.receipt.capFaceIds[0],
    );
    const reopened = deserializeStudioEditableMesh(
      JSON.parse(JSON.stringify(serializeStudioEditableMesh(first.value.mesh))) as (
        ReturnType<typeof serializeStudioEditableMesh>
      ),
    );
    expect(reopened.nextVertexId).toBe(reopened.vertices.length);
    expect(reopened.nextHalfEdgeId).toBe(reopened.halfEdges.length);
    expect(reopened.nextFaceId).toBe(reopened.faces.length);
    expect(hashStudioEditableMesh(reopened)).toBe(hashStudioEditableMesh(first.value.mesh));
  });

  it("extrudes disconnected faces as two bounded regions with exact topology counts", () => {
    const result = extrudeStudioEditableMeshFacesWithReceipt(
      createStudioUnitCubeMesh(),
      [0, 1],
      0.25,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.receipt).toMatchObject({
      connectedRegionCount: 2,
      sourceFaceIds: [0, 1],
    });
    expect(result.value.receipt.capFaceIds).toHaveLength(2);
    expect(result.value.receipt.boundaryHalfEdgeIds).toHaveLength(8);
    expect(result.value.receipt.sideFaceIds).toHaveLength(8);
    expect(studioEditableMeshStats(result.value.mesh)).toEqual({
      vertexCount: 16,
      halfEdgeCount: 56,
      edgeCount: 28,
      faceCount: 14,
      boundaryEdgeCount: 0,
    });
    expect(diagnoseStudioEditableMesh(result.value.mesh)).toEqual([]);
  });

  it("preserves material, smoothing, vertex and ordered edge creases plus isolated vertices", () => {
    const cube = createStudioUnitCubeMesh();
    const source: StudioEditableMesh = {
      ...cube,
      vertices: [
        ...cube.vertices.map((vertex) => (
          vertex.id === 0 ? { ...vertex, crease: 0.625 } : vertex
        )),
        {
          id: cube.nextVertexId,
          position: { x: 9, y: 8, z: 7 },
          crease: 0.5,
          he: -1,
        },
      ],
      halfEdges: cube.halfEdges.map((halfEdge) => (
        halfEdge.id === 0
          ? { ...halfEdge, crease: 0.75 }
          : halfEdge.id === 4
            ? { ...halfEdge, crease: 0.375 }
            : halfEdge
      )),
      faces: cube.faces.map((face) => (
        face.id === 0
          ? { ...face, materialSlot: 7, smooth: true }
          : face.id === 1
            ? { ...face, materialSlot: 3 }
            : face
      )),
      nextVertexId: cube.nextVertexId + 1,
    };

    const result = extrudeStudioEditableMeshFacesWithReceipt(source, [0, 2], 0.25);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { mesh, receipt } = result.value;
    expect(studioEditableMeshStats(mesh)).toMatchObject({
      vertexCount: 15,
      halfEdgeCount: 48,
      edgeCount: 24,
      faceCount: 12,
      boundaryEdgeCount: 0,
    });
    const faceRemap = new Map(receipt.faceRemap.entries);
    for (const sourceFace of source.faces) {
      const resultFace = mesh.faces.find(({ id }) => id === faceRemap.get(sourceFace.id));
      expect(resultFace).toMatchObject({
        materialSlot: sourceFace.materialSlot,
        smooth: sourceFace.smooth,
      });
    }
    expect(mesh.vertices.filter(({ crease }) => crease === 0.625)).toHaveLength(2);
    expect(mesh.vertices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        position: { x: 9, y: 8, z: 7 },
        crease: 0.5,
        he: -1,
      }),
    ]));
    expect(faceHalfEdgeCreases(mesh, receipt.capFaceIds[0]!)).toEqual([0.75, 0, 0, 0]);
    const sideForCreasedBoundary = receipt.sideFaceIds[
      receipt.boundaryHalfEdgeIds.indexOf(0)
    ]!;
    expect(faceHalfEdgeCreases(mesh, sideForCreasedBoundary)).toEqual([0.75, 0, 0.75, 0]);
    expect(faceHalfEdgeCreases(mesh, faceRemap.get(1)!)).toEqual([0.375, 0, 0, 0]);
    expect(receipt.resultMeshHash).toBe(hashStudioEditableMesh(mesh));

    const materialChanged: StudioEditableMesh = {
      ...cube,
      faces: cube.faces.map((face) => (
        face.id === 0 ? { ...face, materialSlot: face.materialSlot + 1 } : face
      )),
    };
    const edgeCreaseChanged: StudioEditableMesh = {
      ...cube,
      halfEdges: cube.halfEdges.map((halfEdge) => (
        halfEdge.id === 0 ? { ...halfEdge, crease: 0.25 } : halfEdge
      )),
    };
    expect(hashStudioEditableMesh(materialChanged)).not.toBe(hashStudioEditableMesh(cube));
    expect(hashStudioEditableMesh(edgeCreaseChanged)).not.toBe(hashStudioEditableMesh(cube));
  });

  it("replaces selected interior source vertices instead of leaving isolated debris", () => {
    const source = createStudioEditableMeshFromPolygons(
      [
        { x: -1, y: -1, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 1, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      [
        [0, 1, 4, 3],
        [1, 2, 5, 4],
        [3, 4, 7, 6],
        [4, 5, 8, 7],
      ],
    );

    const result = extrudeStudioEditableMeshFacesWithReceipt(source, [0, 1, 2, 3], 0.25);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.receipt).toMatchObject({ connectedRegionCount: 1 });
    expect(result.value.receipt.capFaceIds).toHaveLength(4);
    expect(result.value.receipt.boundaryHalfEdgeIds).toHaveLength(8);
    expect(result.value.receipt.sideFaceIds).toHaveLength(8);
    expect(studioEditableMeshStats(result.value.mesh)).toEqual({
      vertexCount: 17,
      halfEdgeCount: 48,
      edgeCount: 28,
      faceCount: 12,
      boundaryEdgeCount: 8,
    });
    expect(diagnoseStudioEditableMesh(result.value.mesh)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "isolated-vertex" }),
    ]));
  });

  it.each([
    {
      label: "three-face edge use",
      faces: [[0, 1, 2], [1, 0, 3], [0, 1, 4]],
    },
    {
      label: "same-direction orientation conflict",
      faces: [[0, 1, 2], [0, 1, 3]],
    },
  ])("rejects non-manifold input before extrusion allocation: $label", ({ faces }) => {
    const source = createStudioEditableMeshFromPolygons(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      faces,
    );

    expect(extrudeStudioEditableMeshFacesWithReceipt(source, [0], 0.25)).toMatchObject({
      ok: false,
      code: "non-manifold",
    });
  });

  it("rejects a bow-tie vertex whose incident faces form disconnected fans", () => {
    const source = createStudioEditableMeshFromPolygons(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: -1, z: 0 },
      ],
      [[0, 1, 2], [0, 3, 4]],
    );

    expect(extrudeStudioEditableMeshFacesWithReceipt(source, [0], 0.25)).toEqual({
      ok: false,
      code: "non-manifold",
      detail: "vertex 0 has disconnected incident-face fans (bow-tie)",
    });
  });

  it.each([
    {
      label: "missing reciprocal twin",
      mutate: (source: StudioEditableMesh): StudioEditableMesh => {
        const selected = new Set([0, 2]);
        const shared = source.halfEdges.find((halfEdge) => (
          selected.has(halfEdge.face)
          && halfEdge.twin >= 0
          && selected.has(source.halfEdges[halfEdge.twin]!.face)
        ))!;
        const twinId = shared.twin;
        return {
          ...source,
          halfEdges: source.halfEdges.map((halfEdge) => (
            halfEdge.id === shared.id || halfEdge.id === twinId
              ? { ...halfEdge, twin: -1 }
              : halfEdge
          )),
        };
      },
      detail: "missing reciprocal twin",
    },
    {
      label: "next/prev reciprocity",
      mutate: (source: StudioEditableMesh): StudioEditableMesh => ({
        ...source,
        halfEdges: source.halfEdges.map((halfEdge) => (
          halfEdge.id === 0 ? { ...halfEdge, next: 2 } : halfEdge
        )),
      }),
      detail: "next/prev reciprocity",
    },
  ])("rejects broken source topology before region planning: $label", ({ mutate, detail }) => {
    const result = extrudeStudioEditableMeshFacesWithReceipt(
      mutate(createStudioUnitCubeMesh()),
      [0, 2],
      0.25,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid-mesh",
      detail: expect.stringContaining(detail),
    });
  });

  it.each([
    {
      label: "positive out-of-range outgoing half-edge",
      outgoing: (source: StudioEditableMesh): number => source.halfEdges.length + 7,
      detail: "invalid outgoing half-edge",
    },
    {
      label: "live but nonincident outgoing half-edge",
      outgoing: (source: StudioEditableMesh): number => source.halfEdges.find((halfEdge) => (
        source.halfEdges[halfEdge.prev]!.vertex !== 0
      ))!.id,
      detail: "outgoing half-edge is not incident",
    },
    {
      label: "used vertex marked isolated",
      outgoing: (): number => -1,
      detail: "missing its outgoing half-edge",
    },
  ])("rejects forged vertex.he authority: $label", ({ outgoing, detail }) => {
    const cube = createStudioUnitCubeMesh();
    const source: StudioEditableMesh = {
      ...cube,
      vertices: cube.vertices.map((vertex) => (
        vertex.id === 0 ? { ...vertex, he: outgoing(cube) } : vertex
      )),
    };

    expect(extrudeStudioEditableMeshFacesWithReceipt(source, [0], 0.25)).toMatchObject({
      ok: false,
      code: "invalid-mesh",
      detail: expect.stringContaining(detail),
    });
  });

  it("admits cumulative polygon corners before constructor or snapshot allocation", () => {
    const oversizedLoop = new Array<number>(STUDIO_EDITABLE_MESH_LIMITS.maxEdges + 1);
    Object.defineProperty(oversizedLoop, 0, {
      get: () => { throw new Error("over-budget polygon corner was read"); },
    });
    const snapshot: StudioEditableMeshSnapshot = {
      revision: 1,
      positions: [[0, 0, 0]],
      faces: [oversizedLoop],
    };

    expect(() => createStudioEditableMeshFromPolygons(
      [{ x: 0, y: 0, z: 0 }],
      [oversizedLoop],
    )).toThrow("half-edge budget exceeded");
    expect(() => deserializeStudioEditableMesh(snapshot)).toThrow("half-edge budget exceeded");
  });

  it.each([
    {
      label: "vertices",
      forge: (source: StudioEditableMesh): StudioEditableMesh => {
        const vertices = new Array(STUDIO_EDITABLE_MESH_LIMITS.maxVertices + 1);
        Object.defineProperty(vertices, 0, {
          get: () => { throw new Error("over-budget vertex was read"); },
        });
        return { ...source, vertices } as StudioEditableMesh;
      },
    },
    {
      label: "faces",
      forge: (source: StudioEditableMesh): StudioEditableMesh => {
        const faces = new Array(STUDIO_EDITABLE_MESH_LIMITS.maxFaces + 1);
        Object.defineProperty(faces, 0, {
          get: () => { throw new Error("over-budget face was read"); },
        });
        return { ...source, faces } as StudioEditableMesh;
      },
    },
    {
      label: "half-edges",
      forge: (source: StudioEditableMesh): StudioEditableMesh => {
        const halfEdges = new Array(STUDIO_EDITABLE_MESH_LIMITS.maxEdges + 1);
        Object.defineProperty(halfEdges, 0, {
          get: () => { throw new Error("over-budget half-edge was read"); },
        });
        return { ...source, halfEdges } as StudioEditableMesh;
      },
    },
  ])("rejects over-limit source $label before reading authority elements", ({ forge }) => {
    expect(extrudeStudioEditableMeshFacesWithReceipt(
      forge(createStudioUnitCubeMesh()),
      [0],
      0.25,
    )).toMatchObject({
      ok: false,
      code: "budget-exceeded",
    });
  });

  it.each([
    {
      label: "non-finite vertex crease",
      forge: (source: StudioEditableMesh): StudioEditableMesh => ({
        ...source,
        vertices: source.vertices.map((vertex) => (
          vertex.id === 0 ? { ...vertex, crease: Number.NaN } : vertex
        )),
      }),
      detail: "vertex 0 crease must be finite in [0,1]",
    },
    {
      label: "out-of-range vertex crease",
      forge: (source: StudioEditableMesh): StudioEditableMesh => ({
        ...source,
        vertices: source.vertices.map((vertex) => (
          vertex.id === 0 ? { ...vertex, crease: -0.01 } : vertex
        )),
      }),
      detail: "vertex 0 crease must be finite in [0,1]",
    },
    {
      label: "non-finite half-edge crease",
      forge: (source: StudioEditableMesh): StudioEditableMesh => ({
        ...source,
        halfEdges: source.halfEdges.map((halfEdge) => (
          halfEdge.id === 0 ? { ...halfEdge, crease: Number.POSITIVE_INFINITY } : halfEdge
        )),
      }),
      detail: "half-edge 0 crease must be finite in [0,1]",
    },
    {
      label: "out-of-range half-edge crease",
      forge: (source: StudioEditableMesh): StudioEditableMesh => ({
        ...source,
        halfEdges: source.halfEdges.map((halfEdge) => (
          halfEdge.id === 0 ? { ...halfEdge, crease: 1.01 } : halfEdge
        )),
      }),
      detail: "half-edge 0 crease must be finite in [0,1]",
    },
    {
      label: "negative face material slot",
      forge: (source: StudioEditableMesh): StudioEditableMesh => ({
        ...source,
        faces: source.faces.map((face) => (
          face.id === 0 ? { ...face, materialSlot: -1 } : face
        )),
      }),
      detail: "face 0 material slot must be a non-negative safe integer",
    },
    {
      label: "fractional face material slot",
      forge: (source: StudioEditableMesh): StudioEditableMesh => ({
        ...source,
        faces: source.faces.map((face) => (
          face.id === 0 ? { ...face, materialSlot: 0.5 } : face
        )),
      }),
      detail: "face 0 material slot must be a non-negative safe integer",
    },
    {
      label: "unsafe face material slot",
      forge: (source: StudioEditableMesh): StudioEditableMesh => ({
        ...source,
        faces: source.faces.map((face) => (
          face.id === 0 ? { ...face, materialSlot: Number.MAX_SAFE_INTEGER + 1 } : face
        )),
      }),
      detail: "face 0 material slot must be a non-negative safe integer",
    },
    {
      label: "non-boolean face smoothing flag",
      forge: (source: StudioEditableMesh): StudioEditableMesh => ({
        ...source,
        faces: source.faces.map((face) => (
          face.id === 0
            ? { ...face, smooth: "true" as unknown as boolean }
            : face
        )),
      }),
      detail: "face 0 smooth flag must be boolean",
    },
  ])("rejects invalid source authority attributes before extrusion allocation: $label", ({
    forge,
    detail,
  }) => {
    expect(extrudeStudioEditableMeshFacesWithReceipt(
      forge(createStudioUnitCubeMesh()),
      [0],
      0.25,
    )).toEqual({
      ok: false,
      code: "invalid-mesh",
      detail,
    });
  });

  it("rejects zero-distance extrusion instead of creating zero-area side faces", () => {
    expect(extrudeStudioEditableMeshFacesWithReceipt(createStudioUnitCubeMesh(), [0], 0)).toEqual({
      ok: false,
      code: "invalid-parameter",
      detail: "distance magnitude must exceed the geometry epsilon",
    });
  });

  it("rejects a result whose tiny distance would create a zero-area boundary side", () => {
    const source = createStudioEditableMeshFromPolygons(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0.1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      [[0, 1, 2]],
    );

    expect(extrudeStudioEditableMeshFacesWithReceipt(source, [0], 2e-12)).toMatchObject({
      ok: false,
      code: "topology-failed",
      detail: expect.stringContaining("zero-area-face"),
    });
  });

  it("fails before topology traversal when the selection exceeds its structure cap", () => {
    const source = createStudioUnitCubeMesh();
    const oversizedSelection = new Array<number>(
      STUDIO_EDITABLE_MESH_LIMITS.maxSelection + 1,
    ).fill(0);

    expect(extrudeStudioEditableMeshFacesWithReceipt(source, oversizedSelection, 0.25)).toEqual({
      ok: false,
      code: "budget-exceeded",
      detail: "selection too large",
    });
  });
});
