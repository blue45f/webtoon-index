import { describe, expect, it } from "vitest";

import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  extrudeStudioEditableMeshFacesWithReceipt,
  hashStudioEditableMesh,
  type StudioEditableMesh,
} from "../studio-editable-half-edge-mesh";

import {
  createStudioHybridDccComponentSelection,
  decodeStudioHybridDccComponentSelectionSnapshot,
  encodeStudioHybridDccComponentSelectionSnapshot,
  mapStudioHybridDccRayFaceIndex,
  mutateStudioHybridDccComponentSelection,
  reconcileStudioHybridDccComponentSelection,
  reconcileStudioHybridDccSelectionAfterExtrudeRegion,
  resolveStudioHybridDccSelectedOrDefaultFaceIds,
  resolveStudioHybridDccSelectedOrDefaultUndirectedEdgeIds,
  resolveStudioHybridDccUndirectedEdgeId,
  snapshotStudioHybridDccComponentSelection,
  STUDIO_HYBRID_DCC_COMPONENT_SELECTION_FORMAT,
  STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS,
  validateStudioHybridDccComponentSelection,
  type StudioHybridDccComponentSelection,
  type StudioHybridDccMeshSelectionSource,
} from "./studio-hybrid-dcc-component-selection";

function source(
  mesh: StudioEditableMesh = createStudioUnitCubeMesh(),
  meshRevision = 1,
  assetId = "asset-cube",
): StudioHybridDccMeshSelectionSource {
  return {
    assetId,
    mesh,
    meshRevision,
    sourceHash: hashStudioEditableMesh(mesh),
  };
}

function expectValue<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected successful selection result");
  return result.value;
}

function vertexSelection(
  meshSource: StudioHybridDccMeshSelectionSource,
  ids: readonly number[],
): StudioHybridDccComponentSelection {
  return expectValue(mutateStudioHybridDccComponentSelection(
    createStudioHybridDccComponentSelection(),
    { mode: "vertex", operation: "replace", ids, source: meshSource },
  ));
}

function faceSelection(
  meshSource: StudioHybridDccMeshSelectionSource,
  ids: readonly number[],
): StudioHybridDccComponentSelection {
  return expectValue(mutateStudioHybridDccComponentSelection(
    createStudioHybridDccComponentSelection(),
    { mode: "face", operation: "replace", ids, source: meshSource },
  ));
}

describe("studio hybrid DCC component selection authority", () => {
  it("applies deterministic object replace/add/toggle/subtract semantics with an active object", () => {
    let selection = createStudioHybridDccComponentSelection();
    selection = expectValue(mutateStudioHybridDccComponentSelection(selection, {
      mode: "object",
      operation: "replace",
      ids: ["z", "a", "z", "m"],
    }));
    expect(selection).toMatchObject({
      mode: "object",
      objectIds: ["a", "m", "z"],
      activeObjectId: "z",
      elementIds: [],
      provenance: null,
    });

    selection = expectValue(mutateStudioHybridDccComponentSelection(selection, {
      mode: "object",
      operation: "subtract",
      ids: ["z"],
    }));
    expect(selection.objectIds).toEqual(["a", "m"]);
    expect(selection.activeObjectId).toBe("m");

    selection = expectValue(mutateStudioHybridDccComponentSelection(selection, {
      mode: "object",
      operation: "toggle",
      ids: ["a", "b"],
    }));
    expect(selection.objectIds).toEqual(["b", "m"]);
    expect(selection.activeObjectId).toBe("b");

    selection = expectValue(mutateStudioHybridDccComponentSelection(selection, {
      mode: "object",
      operation: "add",
      ids: ["c"],
      activeId: "m",
    }));
    expect(selection.objectIds).toEqual(["b", "c", "m"]);
    expect(selection.activeObjectId).toBe("m");
  });

  it("supports vertex mode operations while keeping sorted stable IDs and exact provenance", () => {
    const meshSource = source();
    let selection = vertexSelection(meshSource, [7, 2, 7, 1]);
    expect(selection).toMatchObject({
      mode: "vertex",
      objectIds: ["asset-cube"],
      activeObjectId: "asset-cube",
      elementIds: [1, 2, 7],
      activeElementId: 7,
      provenance: {
        assetId: "asset-cube",
        meshRevision: 1,
        sourceHash: meshSource.sourceHash,
      },
    });

    selection = expectValue(mutateStudioHybridDccComponentSelection(selection, {
      mode: "vertex",
      operation: "toggle",
      ids: [7, 3],
      source: meshSource,
    }));
    expect(selection.elementIds).toEqual([1, 2, 3]);
    expect(selection.activeElementId).toBe(3);

    selection = expectValue(mutateStudioHybridDccComponentSelection(selection, {
      mode: "vertex",
      operation: "subtract",
      ids: [3],
      source: meshSource,
    }));
    expect(selection.elementIds).toEqual([1, 2]);
    expect(selection.activeElementId).toBe(2);
  });

  it("canonicalizes directed half-edge twins into one undirected edge selection", () => {
    const meshSource = source();
    const halfEdge = meshSource.mesh.halfEdges.find((candidate) => candidate.twin >= 0)!;
    const expectedEdgeId = Math.min(halfEdge.id, halfEdge.twin);
    const resolved = expectValue(resolveStudioHybridDccUndirectedEdgeId(meshSource, halfEdge.twin));
    expect(resolved).toBe(expectedEdgeId);

    const selection = expectValue(mutateStudioHybridDccComponentSelection(
      createStudioHybridDccComponentSelection(),
      {
        mode: "edge",
        operation: "replace",
        ids: [halfEdge.id, halfEdge.twin],
        activeId: halfEdge.twin,
        source: meshSource,
      },
    ));
    expect(selection.elementIds).toEqual([expectedEdgeId]);
    expect(selection.activeElementId).toBe(expectedEdgeId);
  });

  it("changes component modes without carrying incompatible element IDs", () => {
    const meshSource = source();
    const vertices = vertexSelection(meshSource, [0, 1]);
    const faces = expectValue(mutateStudioHybridDccComponentSelection(vertices, {
      mode: "face",
      operation: "add",
      ids: [4],
      source: meshSource,
    }));
    expect(faces.mode).toBe("face");
    expect(faces.elementIds).toEqual([4]);
    expect(faces.activeElementId).toBe(4);
  });

  it("fails closed on forged mesh sources and stale selection provenance", () => {
    const meshSource = source();
    const selection = vertexSelection(meshSource, [0]);
    const forged = { ...meshSource, sourceHash: "mesh:forged" };
    const forgedValidation = validateStudioHybridDccComponentSelection(selection, forged);
    expect(forgedValidation.ok).toBe(false);
    if (!forgedValidation.ok) {
      expect(forgedValidation.diagnostics.map((item) => item.code)).toContain("source-hash-mismatch");
    }

    const staleRevision = { ...meshSource, meshRevision: 2 };
    const staleValidation = validateStudioHybridDccComponentSelection(selection, staleRevision);
    expect(staleValidation.ok).toBe(false);
    if (!staleValidation.ok) {
      expect(staleValidation.diagnostics.map((item) => item.code)).toContain("stale-mesh-revision");
    }
  });

  it("preserves live IDs and prunes deleted IDs at an explicit topology boundary", () => {
    const before = source();
    const selection = vertexSelection(before, [0, 7]);
    const triangle = createStudioEditableMeshFromPolygons(
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
      [[0, 1, 2]],
    );
    const after = source(triangle, 2);
    const reconciledResult = reconcileStudioHybridDccComponentSelection(selection, after);
    const reconciled = expectValue(reconciledResult);
    expect(reconciled.elementIds).toEqual([0]);
    expect(reconciled.activeElementId).toBe(0);
    expect(reconciled.provenance).toMatchObject({
      meshRevision: 2,
      sourceHash: after.sourceHash,
    });
    expect(reconciledResult.diagnostics.map((item) => item.code)).toEqual([
      "topology-provenance-refreshed",
      "topology-selection-pruned",
    ]);
  });

  it("uses explicit topology receipts to remap replaced stable IDs", () => {
    const before = source();
    const selection = vertexSelection(before, [0, 7]);
    const triangle = createStudioEditableMeshFromPolygons(
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
      [[0, 1, 2]],
    );
    const after = source(triangle, 2);
    const reconciledResult = reconcileStudioHybridDccComponentSelection(selection, after, {
      vertex: { entries: [[7, 2]] },
    });
    const reconciled = expectValue(reconciledResult);
    expect(reconciled.elementIds).toEqual([0, 2]);
    expect(reconciled.activeElementId).toBe(2);
    expect(reconciledResult.diagnostics.map((item) => item.code)).toEqual([
      "topology-provenance-refreshed",
      "topology-selection-remapped",
    ]);
  });

  it("binds an extrude receipt to the exact selected source faces", () => {
    const before = source();
    const selection = faceSelection(before, [0]);
    const otherFaceExtrude = extrudeStudioEditableMeshFacesWithReceipt(before.mesh, [1], 0.25);
    expect(otherFaceExtrude.ok).toBe(true);
    if (!otherFaceExtrude.ok) throw new Error(otherFaceExtrude.detail);
    const after = source(otherFaceExtrude.value.mesh, 2);

    const reconciled = reconcileStudioHybridDccSelectionAfterExtrudeRegion(
      selection,
      before,
      after,
      otherFaceExtrude.value.receipt,
    );
    expect(reconciled.ok).toBe(false);
    if (!reconciled.ok) {
      expect(reconciled.diagnostics.map(({ code }) => code)).toContain(
        "invalid-topology-receipt",
      );
    }
  });

  it("rejects incomplete and non-live full topology face maps", () => {
    const before = source();
    const selection = faceSelection(before, [0]);
    const extruded = extrudeStudioEditableMeshFacesWithReceipt(before.mesh, [0], 0.25);
    expect(extruded.ok).toBe(true);
    if (!extruded.ok) throw new Error(extruded.detail);
    const after = source(extruded.value.mesh, 2);

    const incomplete = reconcileStudioHybridDccSelectionAfterExtrudeRegion(
      selection,
      before,
      after,
      {
        ...extruded.value.receipt,
        faceRemap: {
          entries: extruded.value.receipt.faceRemap.entries.slice(1),
        },
      },
    );
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) {
      expect(incomplete.diagnostics[0]?.code).toBe("invalid-topology-receipt");
    }

    const [firstEntry, ...remainingEntries] = extruded.value.receipt.faceRemap.entries;
    if (!firstEntry) throw new Error("expected a full face remap");
    const nonLive = reconcileStudioHybridDccSelectionAfterExtrudeRegion(
      selection,
      before,
      after,
      {
        ...extruded.value.receipt,
        faceRemap: {
          entries: [[firstEntry[0], Number.MAX_SAFE_INTEGER], ...remainingEntries],
        },
      },
    );
    expect(nonLive.ok).toBe(false);
    if (!nonLive.ok) {
      expect(nonLive.diagnostics[0]?.code).toBe("invalid-topology-receipt");
    }
  });

  it("round-trips a versioned JSON-safe snapshot with deterministic arrays", () => {
    const meshSource = source();
    const selection = vertexSelection(meshSource, [4, 1, 3]);
    const snapshot = snapshotStudioHybridDccComponentSelection(selection);
    const encoded = encodeStudioHybridDccComponentSelectionSnapshot(selection);
    expect(snapshot.format).toBe(STUDIO_HYBRID_DCC_COMPONENT_SELECTION_FORMAT);
    expect(JSON.parse(encoded)).toEqual(snapshot);

    const decoded = expectValue(decodeStudioHybridDccComponentSelectionSnapshot(encoded, meshSource));
    expect(decoded).toEqual(selection);
    expect(decoded).not.toBe(selection);
    expect(decoded.elementIds).toEqual([1, 3, 4]);
  });

  it("rejects malformed, unsorted, duplicate, and stale snapshots rather than normalizing them", () => {
    const meshSource = source();
    const selection = vertexSelection(meshSource, [1, 3]);
    const snapshot = snapshotStudioHybridDccComponentSelection(selection);

    const unsorted = decodeStudioHybridDccComponentSelectionSnapshot({
      ...snapshot,
      elementIds: [3, 1],
    });
    expect(unsorted.ok).toBe(false);
    if (!unsorted.ok) expect(unsorted.diagnostics[0]?.code).toBe("unsorted-stable-ids");

    const duplicate = decodeStudioHybridDccComponentSelectionSnapshot({
      ...snapshot,
      elementIds: [1, 1],
      activeElementId: 1,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics[0]?.code).toBe("duplicate-stable-id");

    const extraKey = decodeStudioHybridDccComponentSelectionSnapshot({ ...snapshot, extra: true });
    expect(extraKey.ok).toBe(false);
    if (!extraKey.ok) expect(extraKey.diagnostics[0]?.code).toBe("malformed-snapshot");

    const stale = decodeStudioHybridDccComponentSelectionSnapshot(snapshot, {
      ...meshSource,
      meshRevision: 2,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.diagnostics.map((item) => item.code)).toContain("stale-mesh-revision");
  });

  it("rejects oversized snapshots and selection mutations before iterating topology", () => {
    const tooLargeSnapshot = " ".repeat(
      STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSnapshotCharacters + 1,
    );
    const decoded = decodeStudioHybridDccComponentSelectionSnapshot(tooLargeSnapshot);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.diagnostics[0]?.code).toBe("snapshot-too-large");

    const tooMany = new Array(
      STUDIO_HYBRID_DCC_COMPONENT_SELECTION_LIMITS.maxSelectedElements + 1,
    ).fill(0) as number[];
    const mutated = mutateStudioHybridDccComponentSelection(
      createStudioHybridDccComponentSelection(),
      { mode: "vertex", operation: "replace", ids: tooMany, source: source() },
    );
    expect(mutated.ok).toBe(false);
    if (!mutated.ok) expect(mutated.diagnostics[0]?.code).toBe("selection-budget-exceeded");
  });

  it("resolves selected faces and canonical edges before falling back to lowest stable IDs", () => {
    const meshSource = source();
    const objectSelection = expectValue(mutateStudioHybridDccComponentSelection(
      createStudioHybridDccComponentSelection(),
      { mode: "object", operation: "replace", ids: [meshSource.assetId] },
    ));
    expect(expectValue(resolveStudioHybridDccSelectedOrDefaultFaceIds(
      objectSelection,
      meshSource,
    ))).toEqual({ ids: [0], activeId: 0, usedDefault: true });
    expect(expectValue(resolveStudioHybridDccSelectedOrDefaultUndirectedEdgeIds(
      objectSelection,
      meshSource,
    ))).toEqual({ ids: [0], activeId: 0, usedDefault: true });
    const wrongObject = resolveStudioHybridDccSelectedOrDefaultFaceIds(
      objectSelection,
      { ...meshSource, assetId: "another-asset" },
    );
    expect(wrongObject.ok).toBe(false);
    if (!wrongObject.ok) expect(wrongObject.diagnostics[0]?.code).toBe("asset-mismatch");

    const faces = expectValue(mutateStudioHybridDccComponentSelection(objectSelection, {
      mode: "face",
      operation: "replace",
      ids: [4, 1],
      source: meshSource,
    }));
    expect(expectValue(resolveStudioHybridDccSelectedOrDefaultFaceIds(faces, meshSource))).toEqual({
      ids: [1, 4],
      activeId: 4,
      usedDefault: false,
    });
  });

  it("maps renderer fan-triangle faceIndex to stable face, vertices, and edge candidates", () => {
    const meshSource = source();
    const first = expectValue(mapStudioHybridDccRayFaceIndex(meshSource, 0));
    const second = expectValue(mapStudioHybridDccRayFaceIndex(meshSource, 1));
    const nextFace = expectValue(mapStudioHybridDccRayFaceIndex(meshSource, 2));

    expect(first).toMatchObject({
      faceIndex: 0,
      faceId: 0,
      triangleIndexWithinFace: 0,
      faceVertexIds: [0, 3, 2, 1],
      triangleVertexIds: [0, 3, 2],
      vertexCandidateIds: [0, 2, 3],
    });
    expect(first.edgeCandidates).toHaveLength(4);
    expect(first.edgeCandidates.map((edge) => edge.id)).toEqual(
      first.edgeCandidates.map((edge) => edge.id).toSorted((left, right) => left - right),
    );
    expect(second).toMatchObject({
      faceId: 0,
      triangleIndexWithinFace: 1,
      triangleVertexIds: [0, 2, 1],
    });
    expect(nextFace).toMatchObject({
      faceId: 1,
      faceVertexIds: [4, 5, 6, 7],
      triangleVertexIds: [4, 5, 6],
    });

    const outside = mapStudioHybridDccRayFaceIndex(meshSource, 12);
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.diagnostics[0]?.code).toBe("element-not-found");
  });

  it("rejects malformed half-edge topology with a bounded fail-closed diagnostic", () => {
    const cube = createStudioUnitCubeMesh();
    const first = cube.halfEdges[0]!;
    const malformed: StudioEditableMesh = {
      ...cube,
      halfEdges: cube.halfEdges.map((halfEdge) => (
        halfEdge.id === first.id ? { ...halfEdge, twin: -1 } : halfEdge
      )),
    };
    const invalid = validateStudioHybridDccComponentSelection(
      createStudioHybridDccComponentSelection(),
      { ...source(cube), mesh: malformed, sourceHash: hashStudioEditableMesh(malformed) },
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.diagnostics[0]?.code).toBe("invalid-mesh");
  });
});
