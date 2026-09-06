import { describe, expect, it } from "vitest";

import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
} from "./studio-editable-half-edge-mesh";
import {
  inspectStudioOcctMeshTopology,
  studioOcctTopologyReceiptMatchesMesh,
  validateStudioOcctBodyReceipt,
  type StudioOcctMassProperties,
} from "./studio-occt-wasm-facade";

function massProperties(
  volume: number,
  surfaceArea: number,
): StudioOcctMassProperties {
  return {
    source: "mixed-fallback",
    density: 1,
    densityUnit: "mass/model-unit^3",
    mass: volume,
    volume,
    volumeSource: "tessellated-mesh",
    surfaceArea,
    surfaceAreaSource: "tessellated-mesh",
    centroid: null,
    centroidSource: "unavailable",
    inertia: null,
    inertiaSource: "unavailable",
    approximate: true,
  };
}

describe("Studio OCCT topology receipts", () => {
  it("certifies a consistently oriented closed cube", () => {
    const mesh = createStudioUnitCubeMesh();
    const receipt = inspectStudioOcctMeshTopology(mesh);
    expect(receipt).toMatchObject({
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      orientationConflictEdgeCount: 0,
      degenerateTriangleCount: 0,
      consistentOrientation: true,
      watertight: true,
      closedSolid: true,
    });
    expect(receipt.signedVolume).toBeCloseTo(1, 10);
    expect(studioOcctTopologyReceiptMatchesMesh(mesh, receipt)).toBe(true);
  });

  it("rejects a forged closed-solid receipt for an open canonical mesh", () => {
    const cube = createStudioUnitCubeMesh();
    const closed = inspectStudioOcctMeshTopology(cube);
    const open = { ...cube, faces: cube.faces.slice(0, -1) };

    expect(studioOcctTopologyReceiptMatchesMesh(open, closed)).toBe(false);
  });

  it("distinguishes open, winding-conflicted, and non-manifold meshes", () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: -1, z: 0 },
    ];
    const open = inspectStudioOcctMeshTopology(
      createStudioEditableMeshFromPolygons(points, [[0, 1, 2]]),
    );
    expect(open).toMatchObject({
      boundaryEdgeCount: 3,
      watertight: false,
      closedSolid: false,
    });

    const windingConflict = inspectStudioOcctMeshTopology(
      createStudioEditableMeshFromPolygons(points, [[0, 1, 2], [0, 1, 3]]),
    );
    expect(windingConflict.orientationConflictEdgeCount).toBe(1);
    expect(windingConflict.consistentOrientation).toBe(false);
    expect(windingConflict.closedSolid).toBe(false);

    const nonManifold = inspectStudioOcctMeshTopology(
      createStudioEditableMeshFromPolygons(
        points,
        [[0, 1, 2], [1, 0, 3], [0, 1, 4]],
      ),
    );
    expect(nonManifold.nonManifoldEdgeCount).toBe(1);
    expect(nonManifold.watertight).toBe(false);
    expect(nonManifold.closedSolid).toBe(false);
  });

  it("fails closed for open solids while allowing only open zero-volume surfaces", () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    ];
    const open = inspectStudioOcctMeshTopology(
      createStudioEditableMeshFromPolygons(points, [[0, 1, 2]]),
    );
    const closed = inspectStudioOcctMeshTopology(createStudioUnitCubeMesh());

    expect(
      validateStudioOcctBodyReceipt("solid", open, massProperties(1, 0.5)),
    ).toMatchObject({ code: "invalid-solid-topology" });
    expect(
      validateStudioOcctBodyReceipt("surface", open, massProperties(0, 0.5)),
    ).toBeNull();
    expect(
      validateStudioOcctBodyReceipt("surface", closed, massProperties(0, 6)),
    ).toMatchObject({ code: "invalid-surface-topology" });
    expect(
      validateStudioOcctBodyReceipt("surface", open, massProperties(0.1, 0.5)),
    ).toMatchObject({ code: "invalid-surface-topology" });
    expect(
      validateStudioOcctBodyReceipt(
        "surface",
        { ...open, signedVolume: Number.NaN },
        massProperties(0, 0.5),
      ),
    ).toMatchObject({ code: "invalid-body-receipt" });
    expect(
      validateStudioOcctBodyReceipt("surface", open, massProperties(0, Number.NaN)),
    ).toMatchObject({ code: "invalid-body-receipt" });
  });
});
