/**
 * Industrial fidelity gates: OCCT WASM, 3DM/IFC body geometry, dynatopo/retopo quality.
 */
import { describe, expect, it } from "vitest";

import {
  createStudioHybridDccWorkspace,
  workspaceAddUnitCube,
  workspaceDynatopoActive,
  workspaceOcctBox,
  workspaceRetopoActive,
} from "./hybrid-dcc/studio-hybrid-dcc-workspace";
import {
  createStudioUnitCubeMesh,
} from "./studio-editable-half-edge-mesh";
import { importStudioIfcShell } from "./studio-mesh-format-adapters";
import {
  autoRetopoStudioMeshBasic,
  dynatopoStudioMeshBrushLocal,
} from "./studio-mesh-ops-advanced";
import { occtMakeBoxSolid } from "./studio-occt-wasm-facade";
import {
  createStudioRhino3dmBinaryFixture,
  parseStudioRhino3dmLite,
} from "./studio-rhino3dm-lite";

describe("industrial format body geometry", () => {
  it("3DM fixture yields body mesh buffers with non-zero verts/faces", () => {
    const binary = createStudioRhino3dmBinaryFixture();
    const parsed = parseStudioRhino3dmLite(binary);
    expect(parsed.ok).toBe(true);
    expect(parsed.format).toBe("3dm-binary");
    expect(parsed.doc?.bodyMeshes.length).toBeGreaterThan(0);
    const body = parsed.doc!.bodyMeshes[0]!;
    expect(body.vertexCount).toBeGreaterThanOrEqual(3);
    expect(body.faceCount).toBeGreaterThan(0);
    expect(body.positions.length).toBe(body.vertexCount * 3);
    expect(body.indices.length).toBe(body.faceCount * 3);
  });

  it("IFC polyloop body produces non-zero triangle mesh", () => {
    const text = [
      "ISO-10303-21;",
      "DATA;",
      "#1=IFCCARTESIANPOINT((0.,0.,0.));",
      "#2=IFCCARTESIANPOINT((1.,0.,0.));",
      "#3=IFCCARTESIANPOINT((1.,1.,0.));",
      "#4=IFCCARTESIANPOINT((0.,1.,0.));",
      "#10=IFCPOLYLOOP((#1,#2,#3,#4));",
      "#20=IFCFACETEDBREP($);",
      "#21=IFCCLOSEDSHELL($);",
      "#30=IFCWALL('0abcdefghij0123456789B',$,'W',$,$,$,$,$,$);",
      "ENDSEC;",
    ].join("\n");
    const result = importStudioIfcShell(text);
    expect(Number(result.extras?.polyloopCount ?? 0)).toBeGreaterThan(0);
    expect(
      Number(result.extras?.bodyTriangleCount ?? 0)
        + Number(result.extras?.meshTriangleCount ?? 0),
    ).toBeGreaterThan(0);
    expect(result.meshes.length).toBeGreaterThan(0);
    expect(result.meshes[0]!.faces.length).toBeGreaterThan(0);
  });
});

describe("industrial dynatopo / retopo", () => {
  it("partial refine on closed cube keeps boundaryEdges=0", () => {
    const cube = createStudioUnitCubeMesh();
    const refined = dynatopoStudioMeshBrushLocal(
      cube,
      { center: { x: 0.5, y: 0.5, z: 0.5 }, radius: 0.75 },
      "refine",
    );
    expect(refined.ok).toBe(true);
    if (!refined.ok) return;
    expect(refined.value.boundaryEdgesBefore).toBe(0);
    expect(refined.value.boundaryEdges).toBe(0);
    expect(refined.value.facesAfter).toBeGreaterThan(refined.value.facesBefore);
  });

  it("auto-retopo hits target face band with error metrics", () => {
    const cube = createStudioUnitCubeMesh();
    // densify first
    const refined = dynatopoStudioMeshBrushLocal(
      cube,
      { center: { x: 0, y: 0, z: 0 }, radius: 2 },
      "refine",
    );
    expect(refined.ok).toBe(true);
    if (!refined.ok) return;
    const retopo = autoRetopoStudioMeshBasic(refined.value.mesh, {
      targetFaces: 8,
      symmetryX: true,
    });
    expect(retopo.ok).toBe(true);
    if (!retopo.ok) return;
    expect(retopo.value.facesAfter).toBeLessThanOrEqual(retopo.value.facesBefore);
    expect(retopo.value.facesAfter).toBeGreaterThan(0);
    expect(retopo.value.targetFaces).toBe(8);
    expect(Number.isFinite(retopo.value.meanError)).toBe(true);
    expect(retopo.value.errorMap.length).toBeGreaterThan(0);
  });
});

describe("workspace industrial UI path", () => {
  it("OCCT box + dynatopo + retopo mutate workspace measurably", async () => {
    let ws = createStudioHybridDccWorkspace("industrial-ui");
    ws = await workspaceOcctBox(ws, "occt-a", [1, 1, 1]);
    expect(ws.lastOcct?.ok).toBe(true);
    expect(ws.lastOcct?.triangleCount).toBeGreaterThan(0);
    expect(ws.activeAssetId).toBe("occt-a");
    expect(Object.keys(ws.session.state.geometry.records).length).toBeGreaterThan(0);

    ws = workspaceAddUnitCube(ws);
    ws = workspaceDynatopoActive(ws, "refine", 0.75);
    expect(ws.lastDynatopo).not.toBeNull();
    expect(ws.lastDynatopo!.boundaryEdges).toBe(0);
    expect(ws.lastDynatopo!.facesAfter).toBeGreaterThan(ws.lastDynatopo!.facesBefore);

    ws = workspaceRetopoActive(ws, 6);
    expect(ws.lastRetopo).not.toBeNull();
    expect(ws.lastRetopo!.facesAfter).toBeGreaterThan(0);
    expect(ws.lastRetopo!.targetFaces).toBe(6);
  }, 120_000);

  it("OCCT WASM solid is not pure-TS CAD-lite stand-in", async () => {
    const box = await occtMakeBoxSolid(1, 1, 1);
    expect(box.ok).toBe(true);
    if (!box.ok) return;
    expect(box.backend).toBe("opencascade-wasm");
    expect(box.operation).toMatch(/BRepPrimAPI/);
  }, 120_000);
});
