/**
 * Industrial DCC grade: full openNURBS (rhino3dm), web-ifc city, SolidWorks-grade OCCT suite.
 */
import { describe, expect, it } from "vitest";

import {
  occtSolidWorksGradeSuite,
  STUDIO_OCCT_WASM_FACADE_REVISION,
} from "./studio-occt-wasm-facade";
import {
  createStudioRhino3dmNurbsFixture,
  evaluateStudioNurbsCurve,
  evaluateStudioNurbsSurfaceSphere,
  evaluateStudioNurbsSurfaceSuite,
  evaluateStudioRationalNurbsCircle,
  parseStudioRhino3dmOpenNurbs,
  STUDIO_RHINO3DM_NURBS_REVISION,
} from "./studio-rhino3dm-nurbs";
import {
  createStudioIfcCityFixture,
  importStudioIfcCity,
  STUDIO_WEB_IFC_CITY_REVISION,
} from "./studio-web-ifc-city";

describe("openNURBS full NURBS eval (rhino3dm WASM)", () => {
  it("evaluates NURBS curve with tangents, derivatives, domain, knots", async () => {
    expect(STUDIO_RHINO3DM_NURBS_REVISION).toBeGreaterThanOrEqual(2);
    const curve = await evaluateStudioNurbsCurve(
      [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0],
      ],
      24,
      3,
    );
    expect(curve.ok).toBe(true);
    expect(curve.backend).toBe("rhino3dm-opennurbs");
    expect(curve.evalKind).toBe("nurbs-curve-full");
    expect(curve.sampleCount).toBeGreaterThanOrEqual(20);
    expect(curve.arcLengthApprox).toBeGreaterThan(1);
    expect(curve.file3dmBytes).toBeGreaterThan(100);
    expect(curve.tangents.length).toBe(curve.sampleCount);
    expect(curve.derivatives.length).toBe(curve.sampleCount);
    expect(curve.domain[1]).toBeGreaterThan(curve.domain[0]);
    const nonZeroTangents = curve.tangents.filter(
      (t) => Math.hypot(t[0], t[1], t[2]) > 1e-9,
    );
    expect(nonZeroTangents.length).toBeGreaterThan(4);
  }, 120_000);

  it("evaluates rational NURBS circle (degree-2 closed)", async () => {
    const circ = await evaluateStudioRationalNurbsCircle(1, 36);
    expect(circ.ok).toBe(true);
    expect(circ.backend).toBe("rhino3dm-opennurbs");
    expect(circ.isRational).toBe(true);
    expect(circ.sampleCount).toBeGreaterThanOrEqual(32);
    expect(circ.arcLengthApprox).toBeGreaterThan(5); // ~2π
    expect(circ.degree).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("tessellates NURBS sphere surface with normals via openNURBS pointAt", async () => {
    const surf = await evaluateStudioNurbsSurfaceSphere(1, 12, 10);
    expect(surf.ok).toBe(true);
    expect(surf.backend).toBe("rhino3dm-opennurbs");
    expect(surf.vertexCount).toBeGreaterThan(50);
    expect(surf.faceCount).toBeGreaterThan(50);
    expect(surf.normalCount).toBe(surf.vertexCount);
    expect(surf.degreeU + surf.degreeV).toBeGreaterThan(0);
  }, 120_000);

  it("runs full openNURBS surface suite (sphere + cylinder/ruled + curve tangents)", async () => {
    const suite = await evaluateStudioNurbsSurfaceSuite();
    expect(suite.ok).toBe(true);
    expect(suite.backend).toBe("rhino3dm-opennurbs");
    expect(suite.surfaces.length).toBeGreaterThanOrEqual(1);
    expect(suite.totalFaces).toBeGreaterThan(20);
    expect(suite.totalNormals).toBeGreaterThan(20);
    expect(suite.rationalCircleSamples).toBeGreaterThan(16);
    expect(suite.curveTangents).toBeGreaterThan(4);
  }, 120_000);

  it("parses openNURBS File3dm fixture with curve samples", async () => {
    const bytes = await createStudioRhino3dmNurbsFixture();
    expect(bytes.byteLength).toBeGreaterThan(500);
    const parsed = await parseStudioRhino3dmOpenNurbs(bytes);
    expect(parsed.ok).toBe(true);
    expect(parsed.backend).toBe("rhino3dm-opennurbs");
    expect(parsed.objectCount + parsed.curveSamples + parsed.surfaceSamples).toBeGreaterThan(0);
    expect(parsed.hasNurbsEval).toBe(true);
  }, 120_000);
});

describe("web-ifc city model body geometry", () => {
  it("streams multi-building multi-storey city meshes with bbox + semantics", async () => {
    expect(STUDIO_WEB_IFC_CITY_REVISION).toBeGreaterThanOrEqual(2);
    const ifc = createStudioIfcCityFixture({ buildings: 2, storeysPerBuilding: 3 });
    expect(ifc).toMatch(/IFCWALL/u);
    expect(ifc).toMatch(/IFCBUILDINGSTOREY/u);
    expect(ifc).toMatch(/IFCCOLUMN/u);
    expect(ifc.match(/IFCBUILDING\(/gu)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const city = await importStudioIfcCity(ifc);
    expect(city.ok).toBe(true);
    if (!city.ok) return;
    expect(city.backend).toBe("web-ifc");
    expect(city.geometryGrade).toBe("A");
    expect(city.cityScale).toBe(true);
    expect(city.triangleCount).toBeGreaterThan(0);
    expect(city.vertexCount).toBeGreaterThan(0);
    expect(city.meshCount).toBeGreaterThan(0);
    expect(city.storeyCount).toBeGreaterThanOrEqual(2);
    expect(city.buildingCount).toBeGreaterThanOrEqual(2);
    expect(city.wallCount + city.slabCount).toBeGreaterThan(0);
    expect(city.meshes.length).toBeGreaterThan(0);
    expect(city.bbox.length).toBe(6);
    expect(city.footprintAreaApprox).toBeGreaterThan(0);
  }, 120_000);
});

describe("SolidWorks-grade OCCT suite", () => {
  it("runs prims + real revolve/prism + booleans + fillet/chamfer with non-zero triangles", async () => {
    expect(STUDIO_OCCT_WASM_FACADE_REVISION).toBeGreaterThanOrEqual(3);
    const suite = await occtSolidWorksGradeSuite();
    expect(suite.ok).toBe(true);
    expect(suite.backend).toBe("opencascade-wasm");
    expect(suite.solidWorksFeatureParity).toBe(true);
    expect(suite.ops.length).toBeGreaterThanOrEqual(8);
    expect(suite.totalTriangles).toBeGreaterThan(50);
    expect(suite.totalFaces).toBeGreaterThan(0);
    const okOps = suite.ops.filter((o) => !o.includes(":fail:"));
    expect(okOps.length).toBeGreaterThanOrEqual(6);
    // Real feature constructors (not rename stubs)
    expect(suite.ops.some((o) => o === "BRepPrimAPI_MakeRevol" || o.includes("MakeRevol"))).toBe(
      true,
    );
    expect(
      suite.ops.some(
        (o) =>
          o === "BRepPrimAPI_MakeSphere"
          || o === "BRepPrimAPI_MakeCone"
          || o === "BRepPrimAPI_MakePrism",
      ),
    ).toBe(true);
    expect(suite.ops.some((o) => o.includes("Common") || o.includes("Chamfer") || o.includes("Fillet"))).toBe(
      true,
    );
    expect(suite.realRevolve || suite.realPrism).toBe(true);
  }, 180_000);
});
