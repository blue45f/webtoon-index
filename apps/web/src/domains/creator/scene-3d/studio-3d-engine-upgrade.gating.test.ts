/**
 * Engine upgrade gates: real ThruSections loft, AABB pure solid CSG,
 * workspace OCCT revolve/sphere/fillet/loft + Manifold boolean.
 */
import { describe, expect, it } from "vitest";

import {
  createStudioHybridDccWorkspace,
  workspaceAddUnitCube,
  workspaceBooleanBetweenAssets,
  workspaceManifoldBooleanActive,
  workspaceOcctBox,
  workspaceOcctFillet,
  workspaceOcctLoft,
  workspaceOcctRevolve,
  workspaceOcctSphere,
  workspaceOcctCircularPattern,
  workspaceOcctDraftPrism,
  workspaceOcctFillet2dExtrude,
  workspaceOcctLinearPattern,
  workspaceOcctOffsetShape,
  workspaceOcctPipeShell,
  workspaceOcctSection,
  workspaceOcctStepRoundTrip,
  workspaceOcctThickShell,
  workspaceOcctWedge,
} from "../hybrid-dcc/studio-hybrid-dcc-workspace";
import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  studioEditableMeshToTriangleSoup,
} from "../studio-editable-half-edge-mesh";
import { orientStudioMeshOutward } from "../studio-mesh-ops-advanced";
import {
  occtCircularPatternBox,
  occtDraftPrismOnBox,
  occtFillet2dExtrudeSolid,
  occtLinearPatternBox,
  occtLoftedTower,
  occtMakePipeShellSolid,
  occtMakePipeSolid,
  occtMakeThickShellBox,
  occtMakeTorusSolid,
  occtMakeWedgeSolid,
  occtMirrorBox,
  occtOffsetShapeBox,
  occtSectionBoxByPlane,
  occtSolidWorksGradeSuite,
  occtStepRoundTripBox,
  STUDIO_OCCT_WASM_FACADE_REVISION,
} from "../studio-occt-wasm-facade";
import {
  createStudioPureConvexSolidBooleanBackend,
} from "../studio-solid-boolean-backend";

describe("3D engine upgrades", () => {
  it("OCCT loft uses real ThruSections (not fuse-stack rename)", async () => {
    expect(STUDIO_OCCT_WASM_FACADE_REVISION).toBeGreaterThanOrEqual(4);
    const loft = await occtLoftedTower([
      { dx: 2, dy: 2, z: 0 },
      { dx: 1.2, dy: 1.2, z: 1 },
      { dx: 0.6, dy: 0.6, z: 2 },
    ]);
    expect(loft.ok).toBe(true);
    if (!loft.ok) return;
    expect(loft.operation).toBe("BRepOffsetAPI_ThruSections");
    expect(loft.triangleCount).toBeGreaterThanOrEqual(12);
    expect(loft.faceCount).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it("SolidWorks suite reports realThruSections", async () => {
    const suite = await occtSolidWorksGradeSuite();
    expect(suite.ok).toBe(true);
    expect(suite.realThruSections).toBe(true);
    expect(suite.ops.some((o) => o === "BRepOffsetAPI_ThruSections")).toBe(true);
  }, 180_000);

  it("pure AABB cube difference yields non-degenerate solid (no Manifold)", async () => {
    const mesh = createStudioUnitCubeMesh();
    const soup = studioEditableMeshToTriangleSoup(mesh);
    const op = new Float32Array(soup.positions);
    for (let i = 0; i < op.length; i += 3) op[i]! += 0.4;
    for (let i = 0; i < op.length; i += 1) op[i]! *= 0.7;
    const pure = createStudioPureConvexSolidBooleanBackend();
    const out = await pure.boolean({
      left: { positions: soup.positions, indices: soup.indices },
      right: { positions: op, indices: soup.indices },
      operation: "difference",
    });
    expect(out.diagnostic).toMatch(/pure-convex-aabb/u);
    expect(out.indices.length / 3).toBeGreaterThanOrEqual(8);
    expect(out.positions.length / 3).toBeGreaterThanOrEqual(8);
  });

  it("workspace OCCT revolve/sphere/fillet/loft register non-empty assets", async () => {
    let ws = createStudioHybridDccWorkspace("upgrade-ws");
    ws = await workspaceOcctRevolve(ws, "r1", 0.4, 1.0);
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThan(20);
    expect(ws.session.state.geometry.records["r1"]).toBeTruthy();

    ws = await workspaceOcctSphere(ws, "s1", 0.5);
    expect(ws.lastOcct?.operation).toMatch(/Sphere/u);
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThan(50);

    ws = await workspaceOcctFillet(ws, "f1");
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThan(8);

    ws = await workspaceOcctLoft(ws, "l1");
    expect(ws.lastOcct?.operation).toBe("BRepOffsetAPI_ThruSections");
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThanOrEqual(12);
  }, 180_000);

  it("OCCT torus solid tessellates with many triangles", async () => {
    const torus = await occtMakeTorusSolid(0.9, 0.22);
    expect(torus.ok).toBe(true);
    if (!torus.ok) return;
    expect(torus.operation).toBe("BRepPrimAPI_MakeTorus");
    expect(torus.triangleCount).toBeGreaterThan(100);
  }, 60_000);

  it("OCCT pipe sweep and mirror transform produce solids", async () => {
    expect(STUDIO_OCCT_WASM_FACADE_REVISION).toBeGreaterThanOrEqual(5);
    const pipe = await occtMakePipeSolid(1.5, 0.12);
    expect(pipe.ok).toBe(true);
    if (!pipe.ok) return;
    expect(pipe.operation).toBe("BRepOffsetAPI_MakePipe");
    expect(pipe.triangleCount).toBeGreaterThan(20);

    const mirror = await occtMirrorBox(0.8, 0.5, 0.4);
    expect(mirror.ok).toBe(true);
    if (!mirror.ok) return;
    expect(mirror.operation).toMatch(/Transform|mirror/u);
    expect(mirror.triangleCount).toBeGreaterThanOrEqual(12);
    expect(mirror.bodyKind).toBe("solid");
    expect(mirror.topology.watertight).toBe(true);
    expect(mirror.topology.closedSolid).toBe(true);
    expect(mirror.topology.nonManifoldEdgeCount).toBe(0);
    expect(mirror.massProperties.volume).toBeGreaterThan(0);
  }, 120_000);

  it("SolidWorks suite reports realPipe and realMirror", async () => {
    const suite = await occtSolidWorksGradeSuite();
    expect(suite.realPipe).toBe(true);
    expect(suite.realMirror).toBe(true);
  }, 180_000);

  it("OCCT thick shell and STEP write/read produce body geometry", async () => {
    expect(STUDIO_OCCT_WASM_FACADE_REVISION).toBeGreaterThanOrEqual(6);
    const thick = await occtMakeThickShellBox(1, 1, 0.5, 0.05);
    expect(thick.ok).toBe(true);
    if (!thick.ok) return;
    expect(thick.operation).toBe("BRepOffsetAPI_MakeThickSolid");
    expect(thick.triangleCount).toBeGreaterThanOrEqual(12);
    expect(thick).toMatchObject({
      bodyKind: "solid",
      topology: { watertight: true, closedSolid: true },
    });

    const step = await occtStepRoundTripBox(1, 1, 1);
    expect(step.ok).toBe(true);
    if (!step.ok) return;
    expect(step.operation).toBe("STEPControl_Writer+Reader");
    expect(step.stepBytes).toBeGreaterThan(500);
    expect(step.stepText).toMatch(/ISO-10303-21/u);
    expect(step.triangleCount).toBeGreaterThanOrEqual(12);
    expect(step.volumeApprox).toBeCloseTo(1, 6);
    expect(step.massProperties.volumeSource).toBe("occt-brep");
    expect(step.bodyKind).toBe("solid");
    expect(step.topology.watertight).toBe(true);
    expect(step.topology.closedSolid).toBe(true);
  }, 120_000);

  it("SolidWorks suite reports realThickShell and realStepIo", async () => {
    const suite = await occtSolidWorksGradeSuite();
    expect(suite.realThickShell).toBe(true);
    expect(suite.realStepIo).toBe(true);
  }, 180_000);

  it("OCCT wedge and offset shape produce solids", async () => {
    expect(STUDIO_OCCT_WASM_FACADE_REVISION).toBeGreaterThanOrEqual(7);
    const wedge = await occtMakeWedgeSolid(1, 1, 1, 0.3);
    expect(wedge.ok).toBe(true);
    if (!wedge.ok) return;
    expect(wedge.operation).toBe("BRepPrimAPI_MakeWedge");
    expect(wedge.triangleCount).toBeGreaterThanOrEqual(12);

    const offset = await occtOffsetShapeBox(1, 1, 1, 0.08);
    expect(offset.ok).toBe(true);
    if (!offset.ok) return;
    expect(offset.operation).toBe("BRepOffsetAPI_MakeOffsetShape");
    expect(offset.triangleCount).toBeGreaterThan(100);
  }, 120_000);

  it("SolidWorks suite reports realWedge and realOffsetShape", async () => {
    const suite = await occtSolidWorksGradeSuite();
    expect(suite.realWedge).toBe(true);
    expect(suite.realOffsetShape).toBe(true);
  }, 180_000);

  it("workspace thick shell + STEP + multi-asset boolean register meshes", async () => {
    let ws = createStudioHybridDccWorkspace("thick-step-ws");
    ws = await workspaceOcctThickShell(ws, "thick1");
    expect(ws.lastOcct?.operation).toBe("BRepOffsetAPI_MakeThickSolid");
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThanOrEqual(12);

    ws = await workspaceOcctStepRoundTrip(ws, "step1");
    expect(ws.lastOcct?.operation).toMatch(/STEP/u);
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThanOrEqual(12);

    ws = workspaceAddUnitCube(ws);
    ws = await workspaceOcctBox(ws, "cutter", [0.55, 0.55, 0.55]);
    const leftId = Object.keys(ws.session.state.geometry.records).find((id) => id !== "cutter")!;
    ws = await workspaceBooleanBetweenAssets(ws, leftId, "cutter", "difference", "bool-out");
    expect(ws.activeAssetId).toBe("bool-out");
    const out = ws.session.state.geometry.records["bool-out"]!.mesh;
    expect(out.faces.length).toBeGreaterThanOrEqual(4);
  }, 180_000);

  it("workspace wedge + offset register non-empty assets", async () => {
    let ws = createStudioHybridDccWorkspace("wedge-offset-ws");
    ws = await workspaceOcctWedge(ws, "w1");
    expect(ws.lastOcct?.operation).toBe("BRepPrimAPI_MakeWedge");
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThanOrEqual(12);
    expect(ws.session.state.geometry.records["w1"]).toBeTruthy();

    ws = await workspaceOcctOffsetShape(ws, "o1");
    expect(ws.lastOcct?.operation).toBe("BRepOffsetAPI_MakeOffsetShape");
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThan(100);
    expect(ws.session.state.geometry.records["o1"]).toBeTruthy();
  }, 180_000);

  it("OCCT fillet2d extrude, pipe shell, and section produce geometry", async () => {
    expect(STUDIO_OCCT_WASM_FACADE_REVISION).toBeGreaterThanOrEqual(8);
    const f2d = await occtFillet2dExtrudeSolid(1, 1, 0.4, 0.12);
    expect(f2d.ok).toBe(true);
    if (!f2d.ok) return;
    expect(f2d.operation).toBe("BRepFilletAPI_MakeFillet2d+Prism");
    expect(f2d.triangleCount).toBeGreaterThan(20);
    expect(f2d).toMatchObject({
      bodyKind: "solid",
      topology: { watertight: true, closedSolid: true },
    });

    const shell = await occtMakePipeShellSolid(2, 0.15);
    expect(shell.ok).toBe(true);
    if (!shell.ok) return;
    expect(shell.operation).toBe("BRepOffsetAPI_MakePipeShell");
    expect(shell.triangleCount).toBeGreaterThan(20);
    expect(shell).toMatchObject({
      bodyKind: "solid",
      topology: { watertight: true, closedSolid: true },
    });

    const section = await occtSectionBoxByPlane(1, 1, 1);
    expect(section.ok).toBe(true);
    if (!section.ok) return;
    expect(section.operation).toBe("BRepAlgoAPI_Section");
    expect(section.triangleCount).toBeGreaterThanOrEqual(2);
    expect(section).toMatchObject({
      bodyKind: "surface",
      topology: { closedSolid: false },
      massProperties: { volume: 0 },
    });
  }, 120_000);

  it("SolidWorks suite reports realFillet2dExtrude realPipeShell realSection", async () => {
    const suite = await occtSolidWorksGradeSuite();
    expect(suite.realFillet2dExtrude).toBe(true);
    expect(suite.realPipeShell).toBe(true);
    expect(suite.realSection).toBe(true);
  }, 180_000);

  it("workspace fillet2d + pipe shell + section register assets", async () => {
    let ws = createStudioHybridDccWorkspace("f2d-shell-sec-ws");
    ws = await workspaceOcctFillet2dExtrude(ws, "f2d1");
    expect(ws.lastOcct?.operation).toBe("BRepFilletAPI_MakeFillet2d+Prism");
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThan(20);

    ws = await workspaceOcctPipeShell(ws, "ps1");
    expect(ws.lastOcct?.operation).toBe("BRepOffsetAPI_MakePipeShell");
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThan(20);

    ws = await workspaceOcctSection(ws, "sec1");
    expect(ws.lastOcct?.operation).toBe("BRepAlgoAPI_Section");
    expect(ws.lastOcct?.bodyKind).toBe("surface");
    expect(ws.lastOcct?.topology.closedSolid).toBe(false);
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it("OCCT draft prism and linear pattern produce solids", async () => {
    expect(STUDIO_OCCT_WASM_FACADE_REVISION).toBeGreaterThanOrEqual(9);
    const dprism = await occtDraftPrismOnBox(2, 0.5, 1.0, 0.1);
    expect(dprism.ok).toBe(true);
    if (!dprism.ok) return;
    expect(dprism.operation).toBe("BRepFeat_MakeDPrism");
    expect(dprism.triangleCount).toBeGreaterThanOrEqual(12);

    const pattern = await occtLinearPatternBox(0.8, 0.5, 0.4, 1.2, 2);
    expect(pattern.ok).toBe(true);
    if (!pattern.ok) return;
    expect(pattern.operation).toMatch(/linear-pattern/u);
    expect(pattern.triangleCount).toBeGreaterThanOrEqual(12);
  }, 120_000);

  it("SolidWorks suite reports realDraftPrism and realLinearPattern", async () => {
    const suite = await occtSolidWorksGradeSuite();
    expect(suite.realDraftPrism).toBe(true);
    expect(suite.realLinearPattern).toBe(true);
  }, 180_000);

  it("workspace draft prism + linear pattern register assets", async () => {
    let ws = createStudioHybridDccWorkspace("dprism-pattern-ws");
    ws = await workspaceOcctDraftPrism(ws, "dp1");
    expect(ws.lastOcct?.operation).toBe("BRepFeat_MakeDPrism");
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThanOrEqual(12);

    ws = await workspaceOcctLinearPattern(ws, "pat1");
    expect(ws.lastOcct?.operation).toMatch(/linear-pattern/u);
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThanOrEqual(12);
  }, 180_000);

  it("OCCT circular pattern produces multi-body solid", async () => {
    expect(STUDIO_OCCT_WASM_FACADE_REVISION).toBeGreaterThanOrEqual(10);
    const circ = await occtCircularPatternBox(0.4, 0.3, 0.2, 1.2, 4);
    expect(circ.ok).toBe(true);
    if (!circ.ok) return;
    expect(circ.operation).toMatch(/circular-pattern/u);
    expect(circ.triangleCount).toBeGreaterThanOrEqual(24);
  }, 120_000);

  it("SolidWorks suite reports realCircularPattern", async () => {
    const suite = await occtSolidWorksGradeSuite();
    expect(suite.realCircularPattern).toBe(true);
  }, 180_000);

  it("workspace circular pattern registers asset", async () => {
    let ws = createStudioHybridDccWorkspace("circular-ws");
    ws = await workspaceOcctCircularPattern(ws, "c1");
    expect(ws.lastOcct?.operation).toMatch(/circular-pattern/u);
    expect(ws.lastOcct?.triangleCount ?? 0).toBeGreaterThanOrEqual(24);
  }, 120_000);

  it("orientStudioMeshOutward flips inverted cube faces for CSG readiness", () => {
    // Build inverted winding cube via reverse quads
    const mesh = createStudioUnitCubeMesh();
    const soup = studioEditableMeshToTriangleSoup(mesh);
    // Invert all tris
    const inv = new Uint32Array(soup.indices);
    for (let t = 0; t < inv.length; t += 3) {
      const b = inv[t + 1]!;
      inv[t + 1] = inv[t + 2]!;
      inv[t + 2] = b;
    }
    const verts = [];
    for (let i = 0; i < soup.positions.length; i += 3) {
      verts.push({
        x: soup.positions[i]!,
        y: soup.positions[i + 1]!,
        z: soup.positions[i + 2]!,
      });
    }
    const faces: number[][] = [];
    for (let t = 0; t < inv.length; t += 3) {
      faces.push([inv[t]!, inv[t + 1]!, inv[t + 2]!]);
    }
    const inverted = createStudioEditableMeshFromPolygons(verts, faces);
    const oriented = orientStudioMeshOutward(inverted);
    expect(oriented.ok).toBe(true);
    if (!oriented.ok) return;
    expect(oriented.value.flippedFaces).toBeGreaterThan(0);
    expect(oriented.value.faceCount).toBe(12);
  });

  it("workspace Manifold boolean on unit cube is non-degenerate", async () => {
    let ws = createStudioHybridDccWorkspace("bool-ws");
    ws = workspaceAddUnitCube(ws);
    const before = Object.keys(ws.session.state.geometry.records).length;
    ws = await workspaceManifoldBooleanActive(ws);
    expect(Object.keys(ws.session.state.geometry.records).length).toBeGreaterThanOrEqual(before);
    const id = ws.activeAssetId!;
    const mesh = ws.session.state.geometry.records[id]!.mesh;
    expect(mesh.faces.length).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
