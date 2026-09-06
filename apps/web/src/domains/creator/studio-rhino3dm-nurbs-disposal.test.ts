import { describe, expect, it, vi } from "vitest";

import {
  createStudioRhino3dmNurbsFixture,
  evaluateStudioNurbsCurve,
  evaluateStudioNurbsSurfaceSphere,
  evaluateStudioNurbsSurfaceSuite,
  evaluateStudioRationalNurbsCircle,
  observeStudioRhino3dmDisposalsForTests,
  parseStudioRhino3dmOpenNurbs,
} from "./studio-rhino3dm-nurbs";

type DeletedRhinoObject = {
  readonly isDeleted?: () => boolean;
};

describe("Studio rhino3dm deterministic disposal", () => {
  it("runs real Embind destructors for operation, document, table, and geometry wrappers", async () => {
    const disposedKinds: string[] = [];
    const deleteSpy = vi.fn((object: DeletedRhinoObject, constructorName: string) => {
      expect(object.isDeleted?.()).toBe(true);
      disposedKinds.push(constructorName);
    });
    const stopObserving = observeStudioRhino3dmDisposalsForTests(deleteSpy);

    try {
      const curve = await evaluateStudioNurbsCurve(
        [
          [0, 0, 0],
          [1, 1, 0],
          [2, 0, 0],
          [3, 1, 0],
        ],
        12,
        3,
      );
      const circle = await evaluateStudioRationalNurbsCircle(1, 16);
      const surface = await evaluateStudioNurbsSurfaceSphere(1, 8, 6);
      const suite = await evaluateStudioNurbsSurfaceSuite();
      const fixture = await createStudioRhino3dmNurbsFixture();
      const parsed = await parseStudioRhino3dmOpenNurbs(fixture);

      expect(curve.file3dmBytes).toBeGreaterThan(100);
      expect(circle.sampleCount).toBe(16);
      expect(surface.mesh.vertices.length).toBe(surface.vertexCount);
      expect(suite.totalFaces).toBeGreaterThan(20);
      expect(parsed.ok).toBe(true);
      expect(parsed.hasNurbsEval).toBe(true);
    } finally {
      stopObserving();
    }

    expect(deleteSpy.mock.calls.length).toBeGreaterThan(20);
    for (const expectedKind of [
      "Circle",
      "File3dm",
      "File3dmLayerTable",
      "File3dmObject",
      "File3dmObjectTable",
      "Mesh",
      "MeshFaceList",
      "MeshVertexList",
      "NurbsCurve",
      "NurbsCurveKnotList",
      "NurbsSurface",
      "Point3dList",
      "Sphere",
    ]) {
      expect(disposedKinds).toContain(expectedKind);
    }
  }, 120_000);

  it("releases objects already created when a later constructor returns null", async () => {
    const disposedKinds: string[] = [];
    const deleteSpy = vi.fn((object: DeletedRhinoObject, constructorName: string) => {
      expect(object.isDeleted?.()).toBe(true);
      disposedKinds.push(constructorName);
    });
    const stopObserving = observeStudioRhino3dmDisposalsForTests(deleteSpy);

    try {
      await expect(
        evaluateStudioNurbsCurve(
          [
            [0, 0, 0],
            [1, 0, 0],
          ],
          8,
          0,
        ),
      ).rejects.toThrow("NurbsCurve.create failed");
    } finally {
      stopObserving();
    }

    expect(disposedKinds).toEqual(["Point3dList"]);
    expect(deleteSpy).toHaveBeenCalledOnce();
  }, 120_000);
});
