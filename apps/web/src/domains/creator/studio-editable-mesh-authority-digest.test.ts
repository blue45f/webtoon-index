import { describe, expect, it } from "vitest";

import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  deserializeStudioEditableMesh,
  hashStudioEditableMesh,
  serializeStudioEditableMesh,
} from "./studio-editable-half-edge-mesh";
import { hashStudioEditableMeshAuthority } from "./studio-editable-mesh-authority-digest";

import type {
  StudioEditableFace,
  StudioEditableHalfEdge,
  StudioEditableMesh,
  StudioEditableVertex,
} from "./studio-editable-half-edge-mesh";

function cloneMesh(mesh: StudioEditableMesh): StudioEditableMesh {
  return {
    ...mesh,
    vertices: mesh.vertices.map((vertex) => ({
      ...vertex,
      position: { ...vertex.position },
    })),
    halfEdges: mesh.halfEdges.map((halfEdge) => ({ ...halfEdge })),
    faces: mesh.faces.map((face) => ({ ...face })),
  };
}

function replaceVertex(
  mesh: StudioEditableMesh,
  index: number,
  replace: (vertex: StudioEditableVertex) => StudioEditableVertex,
): StudioEditableMesh {
  return {
    ...mesh,
    vertices: mesh.vertices.map((vertex, candidate) => (
      candidate === index ? replace(vertex) : vertex
    )),
  };
}

function replaceHalfEdge(
  mesh: StudioEditableMesh,
  index: number,
  replace: (halfEdge: StudioEditableHalfEdge) => StudioEditableHalfEdge,
): StudioEditableMesh {
  return {
    ...mesh,
    halfEdges: mesh.halfEdges.map((halfEdge, candidate) => (
      candidate === index ? replace(halfEdge) : halfEdge
    )),
  };
}

function replaceFace(
  mesh: StudioEditableMesh,
  index: number,
  replace: (face: StudioEditableFace) => StudioEditableFace,
): StudioEditableMesh {
  return {
    ...mesh,
    faces: mesh.faces.map((face, candidate) => (
      candidate === index ? replace(face) : face
    )),
  };
}

function reorderSingleFaceLoop(
  mesh: StudioEditableMesh,
  order: readonly number[],
): StudioEditableMesh {
  const halfEdges = mesh.halfEdges.map((halfEdge) => {
    const orderIndex = order.indexOf(halfEdge.id);
    if (orderIndex < 0) throw new Error("test loop order omits a half-edge");
    return {
      ...halfEdge,
      next: order[(orderIndex + 1) % order.length]!,
      prev: order[(orderIndex + order.length - 1) % order.length]!,
    };
  });
  return {
    ...mesh,
    halfEdges,
    vertices: mesh.vertices.map((vertex) => ({
      ...vertex,
      he: halfEdges.find((halfEdge) => (
        halfEdges[halfEdge.prev]!.vertex === vertex.id
      ))?.id ?? -1,
    })),
  };
}

describe("editable mesh authority streaming digest", () => {
  it("is deterministic for an exact clone and leaves the input untouched", () => {
    const mesh = createStudioUnitCubeMesh();
    const before = cloneMesh(mesh);
    const clone = cloneMesh(mesh);

    const digest = hashStudioEditableMeshAuthority(mesh);
    expect(digest).toMatch(/^mesh:sha256:[0-9a-f]{64}$/u);
    expect(digest).toBe(
      "mesh:sha256:1d6b16d24c853824e479934effcc4b07ddc4037002b9feb226ec367fce0dc7b9",
    );
    expect(hashStudioEditableMeshAuthority(mesh)).toBe(digest);
    expect(hashStudioEditableMeshAuthority(clone)).toBe(digest);
    expect(hashStudioEditableMesh(mesh)).toBe(digest);
    expect(mesh).toEqual(before);
  });

  it("round-trips canonical dense counters and rejects forged high counters", () => {
    const cube = createStudioUnitCubeMesh();
    const restored = deserializeStudioEditableMesh(
      JSON.parse(JSON.stringify(serializeStudioEditableMesh(cube))) as ReturnType<
        typeof serializeStudioEditableMesh
      >,
    );
    expect(restored).toMatchObject({
      nextVertexId: restored.vertices.length,
      nextHalfEdgeId: restored.halfEdges.length,
      nextFaceId: restored.faces.length,
    });
    expect(hashStudioEditableMesh(restored)).toBe(hashStudioEditableMesh(cube));

    const forged: StudioEditableMesh = {
      ...cube,
      nextVertexId: cube.nextVertexId + 101,
      nextHalfEdgeId: cube.nextHalfEdgeId + 203,
      nextFaceId: cube.nextFaceId + 307,
    };
    expect(() => serializeStudioEditableMesh(forged)).toThrow(
      "nextVertexId violates the canonical dense-ID authority invariant",
    );
  });

  it("rejects noncanonical anchors, loop order, revision and attributes before save", () => {
    const cube = createStudioUnitCubeMesh();
    const alternateOutgoing = cube.halfEdges.find((halfEdge) => (
      cube.halfEdges[halfEdge.prev]!.vertex === 0
      && halfEdge.id !== cube.vertices[0]!.he
    ));
    if (!alternateOutgoing) throw new Error("cube must provide an alternate incident half-edge");
    const quad = createStudioEditableMeshFromPolygons(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      [[0, 1, 2, 3]],
    );
    const variants: readonly (readonly [string, StudioEditableMesh, string])[] = [
      [
        "alternate incident vertex.he",
        replaceVertex(cube, 0, (vertex) => ({ ...vertex, he: alternateOutgoing.id })),
        "canonical first outgoing half-edge",
      ],
      [
        "rotated face.he",
        replaceFace(cube, 0, (face) => ({
          ...face,
          he: cube.halfEdges[face.he]!.next,
        })),
        "canonical first half-edge",
      ],
      [
        "noncanonical reciprocal loop order",
        reorderSingleFaceLoop(quad, [0, 2, 1, 3]),
        "canonical next/prev reciprocity",
      ],
      [
        "unsupported revision",
        { ...cube, revision: 2 } as unknown as StudioEditableMesh,
        "editable mesh revision is not supported",
      ],
      [
        "invalid vertex crease",
        replaceVertex(cube, 0, (vertex) => ({ ...vertex, crease: 1.01 })),
        "vertex 0 crease must be finite in [0,1]",
      ],
      [
        "invalid half-edge crease",
        replaceHalfEdge(cube, 0, (halfEdge) => ({ ...halfEdge, crease: Number.NaN })),
        "half-edge 0 crease must be finite in [0,1]",
      ],
      [
        "invalid face material",
        replaceFace(cube, 0, (face) => ({ ...face, materialSlot: -1 })),
        "face 0 material slot must be a non-negative safe integer",
      ],
      [
        "invalid face smooth flag",
        replaceFace(cube, 0, (face) => ({
          ...face,
          smooth: "true" as unknown as boolean,
        })),
        "face 0 smooth flag must be boolean",
      ],
    ];

    for (const [label, mesh, detail] of variants) {
      expect(() => serializeStudioEditableMesh(mesh), label).toThrow(detail);
    }
  });

  it("binds every scalar, ID, topology link, counter, and canonical array order", () => {
    const mesh = createStudioUnitCubeMesh();
    const digest = hashStudioEditableMeshAuthority(mesh);
    const revisionChanged = {
      ...mesh,
      revision: mesh.revision + 1,
    } as unknown as StudioEditableMesh;
    const verticesReordered: StudioEditableMesh = {
      ...mesh,
      vertices: [mesh.vertices[1]!, mesh.vertices[0]!, ...mesh.vertices.slice(2)],
    };
    const halfEdgesReordered: StudioEditableMesh = {
      ...mesh,
      halfEdges: [mesh.halfEdges[1]!, mesh.halfEdges[0]!, ...mesh.halfEdges.slice(2)],
    };
    const facesReordered: StudioEditableMesh = {
      ...mesh,
      faces: [mesh.faces[1]!, mesh.faces[0]!, ...mesh.faces.slice(2)],
    };
    const vertexCountChanged: StudioEditableMesh = {
      ...mesh,
      vertices: [
        ...mesh.vertices,
        {
          id: mesh.nextVertexId,
          position: { x: 0, y: 0, z: 0 },
          crease: 0,
          he: -1,
        },
      ],
    };

    const variants: readonly (readonly [string, StudioEditableMesh])[] = [
      ["schema revision", revisionChanged],
      ["vertex count", vertexCountChanged],
      ["half-edge count", { ...mesh, halfEdges: mesh.halfEdges.slice(0, -1) }],
      ["face count", { ...mesh, faces: mesh.faces.slice(0, -1) }],
      ["vertex array order", verticesReordered],
      ["half-edge array order", halfEdgesReordered],
      ["face array order", facesReordered],
      ["next vertex ID", { ...mesh, nextVertexId: mesh.nextVertexId + 1 }],
      ["next half-edge ID", { ...mesh, nextHalfEdgeId: mesh.nextHalfEdgeId + 1 }],
      ["next face ID", { ...mesh, nextFaceId: mesh.nextFaceId + 1 }],
      ["vertex ID", replaceVertex(mesh, 0, (vertex) => ({ ...vertex, id: vertex.id + 100 }))],
      ["vertex outgoing half-edge", replaceVertex(mesh, 0, (vertex) => ({
        ...vertex,
        he: vertex.he + 1,
      }))],
      ["position x 1e-8", replaceVertex(mesh, 0, (vertex) => ({
        ...vertex,
        position: { ...vertex.position, x: vertex.position.x + 1e-8 },
      }))],
      ["position y", replaceVertex(mesh, 0, (vertex) => ({
        ...vertex,
        position: { ...vertex.position, y: vertex.position.y + 1e-8 },
      }))],
      ["position z", replaceVertex(mesh, 0, (vertex) => ({
        ...vertex,
        position: { ...vertex.position, z: vertex.position.z + 1e-8 },
      }))],
      ["vertex crease 1e-12", replaceVertex(mesh, 0, (vertex) => ({
        ...vertex,
        crease: vertex.crease + 1e-12,
      }))],
      ["half-edge ID", replaceHalfEdge(mesh, 0, (halfEdge) => ({
        ...halfEdge,
        id: halfEdge.id + 100,
      }))],
      ["half-edge vertex", replaceHalfEdge(mesh, 0, (halfEdge) => ({
        ...halfEdge,
        vertex: halfEdge.vertex + 1,
      }))],
      ["half-edge face", replaceHalfEdge(mesh, 0, (halfEdge) => ({
        ...halfEdge,
        face: halfEdge.face + 1,
      }))],
      ["half-edge next", replaceHalfEdge(mesh, 0, (halfEdge) => ({
        ...halfEdge,
        next: halfEdge.next + 1,
      }))],
      ["half-edge previous", replaceHalfEdge(mesh, 0, (halfEdge) => ({
        ...halfEdge,
        prev: halfEdge.prev + 1,
      }))],
      ["half-edge twin", replaceHalfEdge(mesh, 0, (halfEdge) => ({
        ...halfEdge,
        twin: halfEdge.twin + 1,
      }))],
      ["half-edge crease 1e-12", replaceHalfEdge(mesh, 0, (halfEdge) => ({
        ...halfEdge,
        crease: halfEdge.crease + 1e-12,
      }))],
      ["face ID", replaceFace(mesh, 0, (face) => ({ ...face, id: face.id + 100 }))],
      ["face half-edge", replaceFace(mesh, 0, (face) => ({ ...face, he: face.he + 1 }))],
      ["face material", replaceFace(mesh, 0, (face) => ({
        ...face,
        materialSlot: face.materialSlot + 1,
      }))],
      ["face smooth", replaceFace(mesh, 0, (face) => ({ ...face, smooth: !face.smooth }))],
    ];

    for (const [label, variant] of variants) {
      expect(hashStudioEditableMeshAuthority(variant), label).not.toBe(digest);
    }
  });

  it("canonicalizes signed zero to the OPFS JSON snapshot representation", () => {
    const mesh = createStudioUnitCubeMesh();
    const positiveZero = replaceVertex(mesh, 0, (vertex) => ({ ...vertex, crease: 0 }));
    const negativeZero = replaceVertex(mesh, 0, (vertex) => ({ ...vertex, crease: -0 }));
    expect(Object.is(positiveZero.vertices[0]?.crease, negativeZero.vertices[0]?.crease)).toBe(false);
    expect(hashStudioEditableMeshAuthority(negativeZero)).toBe(
      hashStudioEditableMeshAuthority(positiveZero),
    );

    const snapshot = serializeStudioEditableMesh(negativeZero);
    const jsonSnapshot = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    const restored = deserializeStudioEditableMesh(jsonSnapshot);
    expect(Object.is(restored.vertices[0]?.crease, -0)).toBe(false);
    expect(hashStudioEditableMeshAuthority(restored)).toBe(
      hashStudioEditableMeshAuthority(negativeZero),
    );
  });

  it("streams meshes larger than one writer chunk with constant serialization memory", () => {
    const vertexCount = 10_000;
    const mesh: StudioEditableMesh = {
      revision: 1,
      vertices: Array.from({ length: vertexCount }, (_, id) => ({
        id,
        position: { x: id * 1e-4, y: -id * 1e-5, z: id % 17 },
        crease: (id % 13) * 1e-9,
        he: -1,
      })),
      halfEdges: [],
      faces: [],
      nextVertexId: vertexCount,
      nextHalfEdgeId: 0,
      nextFaceId: 0,
    };

    const digest = hashStudioEditableMeshAuthority(mesh);
    expect(digest).toMatch(/^mesh:sha256:[0-9a-f]{64}$/u);
    expect(hashStudioEditableMeshAuthority(cloneMesh(mesh))).toBe(digest);
  });

  it("rejects non-integer authority counters instead of lossy coercion", () => {
    const mesh = {
      ...createStudioUnitCubeMesh(),
      nextFaceId: 1.5,
    } as StudioEditableMesh;
    expect(() => hashStudioEditableMeshAuthority(mesh)).toThrow(/safe integer/u);
  });
});
