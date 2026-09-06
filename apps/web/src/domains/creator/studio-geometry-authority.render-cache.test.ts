import { describe, expect, it } from "vitest";

import {
  createStudioUnitCubeMesh,
  type StudioEditableMesh,
} from "./studio-editable-half-edge-mesh";
import {
  applyStudioGeometryAuthorityModifierStack,
  assertRenderCacheIsNotAuthority,
  commitStudioGeometryAuthorityMesh,
  createStudioGeometryAuthorityRegistry,
  materializeStudioGeometryRenderCache,
  registerStudioGeometryAuthority,
  setStudioGeometryAuthorityModifierStack,
  type StudioGeometryAuthorityRegistry,
} from "./studio-geometry-authority";
import {
  createStudioMeshModifierStack,
  withStudioMeshModifier,
} from "./studio-mesh-modifier-stack";

function registeredCube(): StudioGeometryAuthorityRegistry {
  const result = registerStudioGeometryAuthority(
    createStudioGeometryAuthorityRegistry(),
    "cube",
    createStudioUnitCubeMesh(),
  );
  if (!result.ok) throw new Error(result.detail);
  return result.value;
}

function withArrayModifier(registry: StudioGeometryAuthorityRegistry) {
  const record = registry.records.cube!;
  const stack = withStudioMeshModifier(createStudioMeshModifierStack(record.mesh), {
    kind: "array",
    id: "array-three",
    enabled: true,
    count: 3,
    offset: { x: 1.25, y: 0, z: 0 },
    mode: "linear",
    radialAngleRad: Math.PI * 2,
    realizeInstances: true,
  });
  const result = setStudioGeometryAuthorityModifierStack(registry, "cube", stack);
  if (!result.ok) throw new Error(result.detail);
  return result.value;
}

describe("Geometry Authority disposable render-cache integrity", () => {
  it("rejects source coordinates outside the renderer budget at every authority boundary", () => {
    const cube = createStudioUnitCubeMesh();
    const oversized = {
      ...cube,
      vertices: cube.vertices.map((vertex, index) => index === 0
        ? { ...vertex, position: { ...vertex.position, x: 1e100 } }
        : vertex),
    };

    expect(registerStudioGeometryAuthority(
      createStudioGeometryAuthorityRegistry(),
      "oversized",
      oversized,
    )).toMatchObject({ ok: false, code: "coordinate-out-of-range" });

    const registered = registeredCube();
    expect(commitStudioGeometryAuthorityMesh(registered, "cube", oversized)).toMatchObject({
      ok: false,
      code: "coordinate-out-of-range",
    });

    const modified = withArrayModifier(registered);
    expect(applyStudioGeometryAuthorityModifierStack(modified, "cube", oversized)).toMatchObject({
      ok: false,
      code: "coordinate-out-of-range",
    });
  });

  it("rejects noncanonical or unserializable meshes at register and commit boundaries", () => {
    const cube = createStudioUnitCubeMesh();
    const alternateOutgoing = cube.halfEdges.find((halfEdge) => (
      cube.halfEdges[halfEdge.prev]!.vertex === 0
      && halfEdge.id !== cube.vertices[0]!.he
    ));
    if (!alternateOutgoing) throw new Error("cube must provide an alternate incident half-edge");
    const variants: readonly (readonly [string, StudioEditableMesh, string])[] = [
      [
        "alternate vertex anchor",
        {
          ...cube,
          vertices: cube.vertices.map((vertex) => (
            vertex.id === 0 ? { ...vertex, he: alternateOutgoing.id } : vertex
          )),
        },
        "canonical first outgoing half-edge",
      ],
      [
        "rotated face anchor",
        {
          ...cube,
          faces: cube.faces.map((face) => (
            face.id === 0 ? { ...face, he: cube.halfEdges[face.he]!.next } : face
          )),
        },
        "canonical first half-edge",
      ],
      [
        "high counters",
        { ...cube, nextHalfEdgeId: cube.nextHalfEdgeId + 1 },
        "canonical dense-ID authority invariant",
      ],
      [
        "invalid vertex crease",
        {
          ...cube,
          vertices: cube.vertices.map((vertex) => (
            vertex.id === 0 ? { ...vertex, crease: -0.01 } : vertex
          )),
        },
        "vertex 0 crease must be finite in [0,1]",
      ],
      [
        "invalid half-edge crease",
        {
          ...cube,
          halfEdges: cube.halfEdges.map((halfEdge) => (
            halfEdge.id === 0 ? { ...halfEdge, crease: Number.POSITIVE_INFINITY } : halfEdge
          )),
        },
        "half-edge 0 crease must be finite in [0,1]",
      ],
      [
        "invalid material slot",
        {
          ...cube,
          faces: cube.faces.map((face) => (
            face.id === 0 ? { ...face, materialSlot: 0.5 } : face
          )),
        },
        "face 0 material slot must be a non-negative safe integer",
      ],
      [
        "invalid smooth flag",
        {
          ...cube,
          faces: cube.faces.map((face) => (
            face.id === 0
              ? { ...face, smooth: "false" as unknown as boolean }
              : face
          )),
        },
        "face 0 smooth flag must be boolean",
      ],
    ];

    const registered = registeredCube();
    for (const [index, [label, mesh, detail]] of variants.entries()) {
      expect(registerStudioGeometryAuthority(
        createStudioGeometryAuthorityRegistry(),
        `invalid-${index}`,
        mesh,
      ), `register: ${label}`).toMatchObject({
        ok: false,
        code: "invalid-mesh",
        detail: expect.stringContaining(detail),
      });
      expect(
        commitStudioGeometryAuthorityMesh(registered, "cube", mesh),
        `commit: ${label}`,
      ).toMatchObject({
        ok: false,
        code: "invalid-mesh",
        detail: expect.stringContaining(detail),
      });
    }
  });

  it("materializes a deterministic projection without advancing authority revision", async () => {
    const registry = withArrayModifier(registeredCube());
    const before = registry.records.cube!;
    const first = await materializeStudioGeometryRenderCache(registry, "cube", { now: 42 });
    if (!first.ok) throw new Error(first.detail);
    const after = first.value.registry.records.cube!;

    expect(after.revision).toBe(before.revision);
    expect(after.mesh).toBe(before.mesh);
    expect(after.meshHash).toBe(before.meshHash);
    expect(first.value.cache.sourceMeshHash).toBe(before.meshHash);
    expect(first.value.cache.sourceModifierStackHash).toMatch(/^modifier-stack:sha256:/u);
    expect(first.value.cache.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.value.cache.derivedFromHash).not.toBe(before.meshHash);
    expect(assertRenderCacheIsNotAuthority(after)).toBe(true);

    const repeated = await materializeStudioGeometryRenderCache(registry, "cube", { now: 99 });
    if (!repeated.ok) throw new Error(repeated.detail);
    expect(repeated.value.registry.records.cube!.revision).toBe(before.revision);
    expect(repeated.value.cache.derivedFromHash).toBe(first.value.cache.derivedFromHash);
    expect(repeated.value.cache.positions).toEqual(first.value.cache.positions);
    expect(repeated.value.cache.indices).toEqual(first.value.cache.indices);
  });

  it("rejects caches detached from authority, stack provenance, or valid triangle data", async () => {
    const registry = withArrayModifier(registeredCube());
    const materialized = await materializeStudioGeometryRenderCache(registry, "cube");
    if (!materialized.ok) throw new Error(materialized.detail);
    const record = materialized.value.registry.records.cube!;
    const cache = record.renderCache!;

    expect(assertRenderCacheIsNotAuthority({
      ...record,
      renderCache: { ...cache, sourceMeshHash: "mesh:deadbeef" },
    })).toBe(false);
    expect(assertRenderCacheIsNotAuthority({
      ...record,
      renderCache: { ...cache, sourceModifierStackHash: "modifier-stack:sha256:stale" },
    })).toBe(false);
    const indices = new Uint32Array(cache.indices);
    indices[0] = cache.positions.length / 3;
    expect(assertRenderCacheIsNotAuthority({
      ...record,
      renderCache: { ...cache, indices },
    })).toBe(false);
    const positions = new Float32Array(cache.positions);
    positions[0] = Number.NaN;
    expect(assertRenderCacheIsNotAuthority({
      ...record,
      renderCache: { ...cache, positions },
    })).toBe(false);
    const oversizedPositions = new Float32Array(cache.positions);
    oversizedPositions[0] = 1_000_001;
    expect(assertRenderCacheIsNotAuthority({
      ...record,
      renderCache: { ...cache, positions: oversizedPositions },
    })).toBe(false);
  });
});
