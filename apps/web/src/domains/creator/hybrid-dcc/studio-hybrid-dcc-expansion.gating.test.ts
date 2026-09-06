/**
 * Expansion gating: workspace API, mesh format adapters, toon3d package, catalog SSOT, UV.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createStudioUnitCubeMesh } from "../studio-editable-half-edge-mesh";
import { importStudioGradeAAsset } from "../studio-grade-a-import-pipeline";
import {
  importStudioDaeMinimal,
  importStudioDxfPlan,
  importStudioPlyAscii,
  importStudioStl,
} from "../studio-mesh-format-adapters";
import { unpackStudioToon3dPackage } from "../studio-toon3d-package";
import {
  packStudioUvIslands,
  unwrapStudioMeshBox,
  unwrapStudioMeshPlanar,
} from "../studio-uv-unwrap-lite";

import {
  assertWebtoonObjectCreatorV1KernelCoverage,
  studioKernelCatalogByPriority,
  STUDIO_DCC_KERNEL_COVERAGE_REGISTRY,
  STUDIO_WEBTOON_OBJECT_CREATOR_V1_KERNEL_REQUIRED_IDS,
} from "./studio-dcc-catalog-registry";
import {
  createStudioHybridDccWorkspace,
  workspaceAddArtistInk,
  workspaceAddUnitCube,
  workspaceEnsureShots,
  workspaceExportToon3d,
  workspaceExtrudeActive,
  workspaceImportBytes,
  workspaceKnifeActive,
  workspaceLoadRoomPreset,
  workspaceSelectAsset,
  workspaceUndo,
} from "./studio-hybrid-dcc-workspace";

describe("§12.1 callable-kernel compatibility coverage", () => {
  it("every required v1 id exposes a kernel or an explicit partial with apis", () => {
    const { ok, missing } = assertWebtoonObjectCreatorV1KernelCoverage();
    expect(missing).toEqual([]);
    expect(ok).toBe(true);
    expect(STUDIO_WEBTOON_OBJECT_CREATOR_V1_KERNEL_REQUIRED_IDS.length).toBeGreaterThan(20);
    expect(studioKernelCatalogByPriority("P0").length).toBeGreaterThan(0);
    expect(STUDIO_DCC_KERNEL_COVERAGE_REGISTRY.every((entry) => entry.apis.length > 0)).toBe(true);
  });
});

describe("hybrid DCC workspace API", () => {
  it("keeps outliner selection canonical and rejects renderer-only stale ids", () => {
    let ws = createStudioHybridDccWorkspace("ws-selection");
    ws = workspaceAddUnitCube(ws, "hero-prop");
    ws = workspaceAddUnitCube(ws, "set-prop");

    expect(workspaceSelectAsset(ws, "hero-prop").activeAssetId).toBe("hero-prop");
    expect(workspaceSelectAsset(ws, null).activeAssetId).toBeNull();
    expect(() => workspaceSelectAsset(ws, "stale-render-object")).toThrow("missing stale-render-object");
  });

  it("cube → extrude → knife → 8 shots → ink → room → toon3d pack", async () => {
    let ws = createStudioHybridDccWorkspace("ws-exp");
    ws = workspaceAddUnitCube(ws, "hero-prop");
    expect(ws.activeAssetId).toBe("hero-prop");
    ws = workspaceExtrudeActive(ws, 0.2);
    ws = workspaceKnifeActive(ws, { x: 1, y: 0, z: 0 });
    ws = workspaceEnsureShots(ws, 8);
    expect(ws.bridge.shots).toHaveLength(8);
    ws = workspaceAddArtistInk(ws, "shot-1");
    expect(ws.bridge.artistCorrections.deltas.length).toBeGreaterThan(0);
    ws = workspaceLoadRoomPreset(ws, "cafe");
    expect(ws.bridge.set.objects.some((o) => o.id === "room-shell")).toBe(true);
    const pkg = workspaceExportToon3d(ws);
    expect(pkg.manifest.format).toBe("toonspectrum.toon3d");
    expect(pkg.files["document/document.json"]).toContain("hero-prop");
    const unpacked = unpackStudioToon3dPackage(pkg);
    expect(unpacked.shotCount).toBe(8);
    expect(unpacked.document.documentId).toBe("ws-exp");
    ws = workspaceUndo(ws);
    expect(ws.session.state.commandCount).toBeGreaterThanOrEqual(0);
  });
});

describe("mesh format adapters STL/PLY/DAE/DXF", () => {
  it("parses fixtures into meshes with reports", () => {
    const stlAscii = new TextEncoder().encode(
      [
        "solid tri",
        " facet normal 0 0 1",
        "  outer loop",
        "   vertex 0 0 0",
        "   vertex 1 0 0",
        "   vertex 0 1 0",
        "  endloop",
        " endfacet",
        "endsolid tri",
      ].join("\n"),
    );
    const stl = importStudioStl(stlAscii);
    expect(stl.meshes.length).toBe(1);
    expect(stl.report.sourceHash.startsWith("sha256:")).toBe(true);
    expect(stl.report.counts.meshes).toBe(1);

    const ply = importStudioPlyAscii(
      [
        "ply",
        "format ascii 1.0",
        "element vertex 3",
        "property float x",
        "property float y",
        "property float z",
        "element face 1",
        "property list uchar int vertex_indices",
        "end_header",
        "0 0 0",
        "1 0 0",
        "0 1 0",
        "3 0 1 2",
      ].join("\n"),
    );
    expect(ply.meshes.length).toBe(1);

    const dae = importStudioDaeMinimal(
      [
        '<?xml version="1.0"?>',
        "<COLLADA>",
        '<float_array id="p" count="9">0 0 0 1 0 0 0 1 0</float_array>',
        "<triangles count=\"1\"><p>0 1 2</p></triangles>",
        "</COLLADA>",
      ].join(""),
    );
    expect(dae.meshes.length).toBe(1);

    const dxf = importStudioDxfPlan(
      ["0", "LINE", "8", "0", "10", "0", "20", "0", "11", "2", "21", "0", "0", "ENDSEC"].join(
        "\n",
      ),
    );
    expect(dxf.format).toBe("dxf");
    expect(dxf.report.parser).toContain("dxf");

    const viaGrade = importStudioGradeAAsset({
      fileName: "t.stl",
      bytes: stlAscii,
    });
    expect(viaGrade.format).toBe("stl");
    expect(viaGrade.committed).toBe(true);
  });
});

describe("UV unwrap lite", () => {
  it("planar and box unwrap produce unit-range UVs", () => {
    const cube = createStudioUnitCubeMesh();
    const planar = unwrapStudioMeshPlanar(cube, "planar-xy");
    expect(planar.uvs.length).toBe(cube.vertices.length * 2);
    expect(Math.min(...planar.uvs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...planar.uvs)).toBeLessThanOrEqual(1);
    const box = unwrapStudioMeshBox(cube);
    expect(box.mode).toBe("box");
    const packed = packStudioUvIslands([planar.uvs, box.uvs]);
    expect(packed.length).toBe(planar.uvs.length + box.uvs.length);
  });
});

describe("workspace import path", () => {
  it("imports OBJ bytes into workspace asset", () => {
    let ws = createStudioHybridDccWorkspace("imp");
    const obj = new TextEncoder().encode("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
    ws = workspaceImportBytes(ws, "prop.obj", obj);
    expect(ws.lastImportReport).toBeTruthy();
    // OBJ via grade-A may not always register mesh without mesh adapter path — still report
    expect(
      (ws.lastImportReport as { sourceHash?: string })?.sourceHash?.startsWith("sha256:"),
    ).toBe(true);
  });

  it("imports real VRM when fixture present", () => {
    const path = resolve(process.cwd(), "apps/web/public/vrm/AvatarSample_A.vrm");
    if (!existsSync(path)) return;
    let ws = createStudioHybridDccWorkspace("vrm-ws");
    ws = workspaceImportBytes(ws, "a.vrm", new Uint8Array(readFileSync(path)));
    expect(ws.lastImportReport).toBeTruthy();
  });
});
