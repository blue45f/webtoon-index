import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  STUDIO_BG3D_GLB_MAX_BYTES,
  validateStudioBg3dGlb,
} from "../bg3d/studio-bg3d-glb-validation";
import {
  createStudioEditableMeshFromPolygons,
  createStudioUnitCubeMesh,
  hashStudioEditableMesh,
  type StudioEditableMesh,
} from "../studio-editable-half-edge-mesh";
import {
  registerStudioGeometryAuthority,
  createStudioGeometryAuthorityRegistry,
  setStudioGeometryAuthorityModifierStack,
} from "../studio-geometry-authority";
import {
  createStudioMeshModifierStack,
  withStudioMeshModifier,
} from "../studio-mesh-modifier-stack";
import { sha256HexPortable } from "../studio-sha256";
import {
  readStudioVrmExportGlb,
  STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE,
  STUDIO_VRM_EXPORT_GLB_MAGIC,
  STUDIO_VRM_EXPORT_GLB_VERSION,
  STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE,
} from "../vrm/studio-vrm-export-glb-container";

import {
  exportStudioHybridDccAuthorityRecordGlb,
  exportStudioHybridDccMeshGlb,
  STUDIO_HYBRID_DCC_GLB_EXPORT_GENERATOR,
  STUDIO_HYBRID_DCC_GLB_MAX_FACE_CORNERS,
  STUDIO_HYBRID_DCC_GLB_MIME_TYPE,
  type StudioHybridDccMeshGlbExportResult,
} from "./studio-hybrid-dcc-glb-export";
import {
  STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS,
  STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES,
} from "./studio-hybrid-dcc-glb-export-diagnostic-limits";

interface GltfAccessor {
  readonly bufferView: number;
  readonly byteOffset?: number;
  readonly componentType: number;
  readonly count: number;
  readonly type: string;
  readonly min?: readonly number[];
  readonly max?: readonly number[];
}

interface GltfBufferView {
  readonly buffer: number;
  readonly byteOffset?: number;
  readonly byteLength: number;
  readonly target?: number;
}

interface TestGltfRoot {
  readonly asset: {
    readonly version: string;
    readonly generator: string;
    readonly extras: any;
  };
  readonly buffers: readonly { readonly byteLength: number; readonly uri?: string }[];
  readonly bufferViews: readonly GltfBufferView[];
  readonly accessors: readonly GltfAccessor[];
  readonly meshes: readonly any[];
  readonly nodes: readonly any[];
  readonly scenes: readonly any[];
  readonly scene: number;
  readonly extras: any;
}

function successful(
  result: StudioHybridDccMeshGlbExportResult,
): Extract<StudioHybridDccMeshGlbExportResult, { readonly ok: true }> {
  expect(result.ok, result.ok ? undefined : JSON.stringify(result.report)).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.report));
  return result;
}

function exportMesh(
  mesh: StudioEditableMesh,
  assetId = "stable-cube",
  sourceRevision = 7,
): StudioHybridDccMeshGlbExportResult {
  return exportStudioHybridDccMeshGlb({
    assetId,
    mesh,
    sourceRevision,
    sourceHash: hashStudioEditableMesh(mesh),
  });
}

function createDisconnectedFaceMesh(
  faceCount: number,
  collinearCorner: boolean,
): StudioEditableMesh {
  const positions: Array<{ readonly x: number; readonly y: number; readonly z: number }> = [];
  const faces: number[][] = [];
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const offset = positions.length;
    const x = faceIndex * 2;
    if (collinearCorner) {
      positions.push(
        { x, y: 0, z: 0 },
        { x: x + 0.5, y: 0, z: 0 },
        { x: x + 1, y: 0, z: 0 },
        { x, y: 1, z: 0 },
      );
      faces.push([offset, offset + 1, offset + 2, offset + 3]);
    } else {
      positions.push(
        { x, y: 0, z: 0 },
        { x: x + 1, y: 0, z: 0 },
        { x, y: 1, z: 0 },
      );
      faces.push([offset, offset + 1, offset + 2]);
    }
  }
  return createStudioEditableMeshFromPolygons(positions, faces);
}

function parsedRoot(result: Extract<StudioHybridDccMeshGlbExportResult, { readonly ok: true }>): {
  readonly root: TestGltfRoot;
  readonly binary: Uint8Array;
} {
  const parsed = readStudioVrmExportGlb(result.bytes);
  return { root: parsed.json as unknown as TestGltfRoot, binary: parsed.binary };
}

function accessorScalars(
  root: TestGltfRoot,
  binary: Uint8Array,
  accessorIndex: number,
): readonly number[] {
  const accessor = root.accessors[accessorIndex]!;
  const bufferView = root.bufferViews[accessor.bufferView]!;
  const components = accessor.type === "VEC3" ? 3 : 1;
  const componentBytes = 4;
  const offset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const values: number[] = [];
  for (let index = 0; index < accessor.count * components; index += 1) {
    const byteOffset = offset + index * componentBytes;
    values.push(
      accessor.componentType === 5126
        ? view.getFloat32(byteOffset, true)
        : view.getUint32(byteOffset, true),
    );
  }
  return values;
}

function issueCodes(result: StudioHybridDccMeshGlbExportResult): readonly string[] {
  return result.report.issues.map(({ code }) => code);
}

describe("Hybrid DCC editable-half-edge GLB exporter", () => {
  it("keeps Three, Babylon, React Three Fiber, and BufferGeometry out of the exporter import graph", () => {
    const source = readFileSync(
      new URL("./studio-hybrid-dcc-glb-export.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/(?:from|import\()\s*["'](?:three|@babylonjs|@react-three)(?:[/'"])/u);
  });

  it("exports the authoring cube as self-contained POSITION/NORMAL/indexed glTF with bounds and provenance", () => {
    const mesh = createStudioUnitCubeMesh();
    const result = successful(exportMesh(mesh, "authoring/cube", 3));
    const { root, binary } = parsedRoot(result);

    expect(result.fileName).toBe("authoring-cube.glb");
    expect(result.mimeType).toBe("model/gltf-binary");
    expect(result.report).toMatchObject({
      status: "exported",
      source: {
        authority: "editable-half-edge-mesh",
        assetId: "authoring/cube",
        sourceRevision: 3,
        sourceHash: hashStudioEditableMesh(mesh),
      },
      errors: [],
      losses: [],
    });
    expect(root.asset).toMatchObject({
      version: "2.0",
      generator: STUDIO_HYBRID_DCC_GLB_EXPORT_GENERATOR,
    });
    expect(root.scene).toBe(0);
    expect(root.scenes).toHaveLength(1);
    expect(root.nodes).toHaveLength(1);
    expect(root.meshes).toHaveLength(1);
    expect(root.buffers).toEqual([{ byteLength: binary.byteLength }]);
    expect(root.buffers[0]?.uri).toBeUndefined();

    const primitive = root.meshes[0].primitives[0];
    expect(primitive).toMatchObject({
      attributes: { POSITION: 0, NORMAL: 1 },
      indices: 2,
      mode: 4,
    });
    expect(root.accessors).toMatchObject([
      {
        componentType: 5126,
        count: 24,
        type: "VEC3",
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      { componentType: 5126, count: 24, type: "VEC3" },
      { componentType: 5125, count: 36, type: "SCALAR", min: [0], max: [23] },
    ]);
    expect(accessorScalars(root, binary, 0)).toHaveLength(72);
    expect(accessorScalars(root, binary, 2)).toHaveLength(36);
    const normals = accessorScalars(root, binary, 1);
    for (let index = 0; index < normals.length; index += 3) {
      expect(Math.hypot(normals[index]!, normals[index + 1]!, normals[index + 2]!)).toBeCloseTo(1, 6);
    }

    const provenance = root.asset.extras.toonSpectrum.provenance;
    expect(provenance).toEqual({
      authority: "editable-half-edge-mesh",
      assetId: "authoring/cube",
      meshSchemaRevision: 1,
      sourceHash: hashStudioEditableMesh(mesh),
      sourceRevision: 3,
    });
    const topology = root.meshes[0].extras.toonSpectrum.sourceFaceTopology;
    expect(topology.map(({ faceId }: { faceId: number }) => faceId)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(topology.every(({ halfEdgeIds }: { halfEdgeIds: number[] }) => halfEdgeIds.length === 4)).toBe(true);
    expect(primitive.extras.toonSpectrum.outputSourceVertexIds).toHaveLength(24);
    expect(primitive.extras.toonSpectrum.sourceFaceIdsByTriangle).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
    expect(result.metrics).toMatchObject({
      sourceVertexCount: 8,
      sourceHalfEdgeCount: 24,
      sourceFaceCount: 6,
      outputVertexCount: 24,
      vertices: 24,
      triangleCount: 12,
      triangles: 12,
    });
  });

  it("ear-clips a concave polygon deterministically instead of using an invalid fan", () => {
    const mesh = createStudioEditableMeshFromPolygons(
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      [[0, 1, 2, 3, 4]],
    );
    const result = successful(exportMesh(mesh, "concave"));
    const { root, binary } = parsedRoot(result);
    const positions = accessorScalars(root, binary, 0);
    const indices = accessorScalars(root, binary, 2);
    let area = 0;
    for (let index = 0; index < indices.length; index += 3) {
      const a = indices[index]! * 3;
      const b = indices[index + 1]! * 3;
      const c = indices[index + 2]! * 3;
      area += Math.abs(
        (positions[b]! - positions[a]!) * (positions[c + 1]! - positions[a + 1]!) -
        (positions[b + 1]! - positions[a + 1]!) * (positions[c]! - positions[a]!),
      ) / 2;
    }
    expect(result.metrics.triangleCount).toBe(3);
    expect(indices).toHaveLength(9);
    expect(area).toBeCloseTo(3, 8);
    expect(root.meshes[0].primitives[0].extras.toonSpectrum.sourceFaceIdsByTriangle).toEqual([0, 0, 0]);
  });

  it("fails before cubic ear clipping when one synchronous n-gon exceeds its corner budget", () => {
    const count = STUDIO_HYBRID_DCC_GLB_MAX_FACE_CORNERS + 1;
    const positions = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2;
      return { x: Math.cos(angle), y: Math.sin(angle), z: 0 };
    });
    const mesh = createStudioEditableMeshFromPolygons(
      positions,
      [Array.from({ length: count }, (_, index) => index)],
    );

    const result = exportMesh(mesh, "oversized-ngon");

    expect(result.ok).toBe(false);
    expect(issueCodes(result)).toContain("face-corner-budget-exceeded");
  });

  it("emits byte-identical GLBs for equal authoring inputs without timestamps or random IDs", () => {
    const firstMesh = createStudioUnitCubeMesh();
    const secondMesh = createStudioUnitCubeMesh();
    const first = successful(exportMesh(firstMesh, "deterministic", 11));
    const second = successful(exportMesh(secondMesh, "deterministic", 11));

    expect(hashStudioEditableMesh(secondMesh)).toBe(hashStudioEditableMesh(firstMesh));
    expect(second.bytes).toEqual(first.bytes);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.report).toEqual(first.report);
  });

  it("writes a GLB 2.0 header plus JSON/BIN chunks and buffer views on four-byte boundaries", () => {
    const result = successful(exportMesh(createStudioUnitCubeMesh(), "alignment"));
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    const jsonChunkLength = view.getUint32(12, true);
    const binChunkOffset = 20 + jsonChunkLength;
    const binChunkLength = view.getUint32(binChunkOffset, true);
    const { root, binary } = parsedRoot(result);

    expect(view.getUint32(0, true)).toBe(STUDIO_VRM_EXPORT_GLB_MAGIC);
    expect(view.getUint32(4, true)).toBe(STUDIO_VRM_EXPORT_GLB_VERSION);
    expect(view.getUint32(8, true)).toBe(result.bytes.byteLength);
    expect(view.getUint32(16, true)).toBe(STUDIO_VRM_EXPORT_JSON_CHUNK_TYPE);
    expect(view.getUint32(binChunkOffset + 4, true)).toBe(STUDIO_VRM_EXPORT_BIN_CHUNK_TYPE);
    expect(result.bytes.byteLength % 4).toBe(0);
    expect(jsonChunkLength % 4).toBe(0);
    expect(binChunkOffset % 4).toBe(0);
    expect(binChunkLength % 4).toBe(0);
    expect(binary.byteLength).toBe(root.buffers[0]?.byteLength);
    for (const bufferView of root.bufferViews) {
      expect((bufferView.byteOffset ?? 0) % 4).toBe(0);
      expect(bufferView.byteLength % 4).toBe(0);
      expect((bufferView.byteOffset ?? 0) + bufferView.byteLength).toBeLessThanOrEqual(binary.byteLength);
    }
  });

  it("round-trips through the existing self-contained BG3D security validator", async () => {
    const result = successful(exportMesh(createStudioUnitCubeMesh(), "validator"));
    const digest = sha256HexPortable(result.bytes);
    const validated = await validateStudioBg3dGlb(result.bytes, {
      declared: {
        byteSize: result.bytes.byteLength,
        sha256: `sha256:${digest}`,
        mimeType: STUDIO_HYBRID_DCC_GLB_MIME_TYPE,
      },
      cumulative: { usedBytes: 0, maximumBytes: STUDIO_BG3D_GLB_MAX_BYTES },
      profile: "desktop",
      budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
      digest: async () => digest,
      supportedRequiredExtensions: [],
    });

    expect(validated).toMatchObject({
      ok: true,
      code: "valid",
      metrics: { meshes: 1, meshPrimitives: 1, triangles: 12 },
    });
  });

  it("accepts the actual workspace geometry-authority record when its stack is empty", () => {
    const mesh = createStudioUnitCubeMesh();
    const registered = registerStudioGeometryAuthority(
      createStudioGeometryAuthorityRegistry(),
      "workspace-cube",
      mesh,
    );
    expect(registered.ok).toBe(true);
    if (!registered.ok) throw new Error(registered.detail);
    const record = registered.value.records["workspace-cube"]!;
    expect(record.renderCache).toBeNull();

    const result = successful(exportStudioHybridDccAuthorityRecordGlb(record));
    expect(result.report.source).toMatchObject({
      assetId: record.assetId,
      sourceRevision: record.revision,
      sourceHash: record.meshHash,
    });
  });

  it("fails closed instead of silently exporting the cage under a non-empty modifier stack", () => {
    const mesh = createStudioUnitCubeMesh();
    const registered = registerStudioGeometryAuthority(
      createStudioGeometryAuthorityRegistry(),
      "modified-cube",
      mesh,
    );
    if (!registered.ok) throw new Error(registered.detail);
    const stack = withStudioMeshModifier(createStudioMeshModifierStack(mesh), {
      kind: "array",
      id: "array-three",
      enabled: true,
      count: 3,
      offset: { x: 1.25, y: 0, z: 0 },
      mode: "linear",
      radialAngleRad: Math.PI * 2,
      realizeInstances: true,
    });
    const updated = setStudioGeometryAuthorityModifierStack(
      registered.value,
      "modified-cube",
      stack,
    );
    if (!updated.ok) throw new Error(updated.detail);

    const result = exportStudioHybridDccAuthorityRecordGlb(
      updated.value.records["modified-cube"]!,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("modifier export gate did not run");
    expect(result.report.errors).toContainEqual(expect.objectContaining({
      code: "modifier-stack-unapplied",
    }));
  });

  it("reports metadata-only material loss without hiding it", () => {
    const cube = createStudioUnitCubeMesh();
    const mesh: StudioEditableMesh = {
      ...cube,
      faces: cube.faces.map((face) => face.id === 2 ? { ...face, materialSlot: 4 } : face),
    };
    const result = successful(exportMesh(mesh, "material-loss"));
    const { root } = parsedRoot(result);

    expect(result.report.losses).toMatchObject([
      { severity: "loss", code: "material-slot-metadata-only", faceIds: [2] },
    ]);
    expect(root.meshes[0].extras.toonSpectrum.sourceFaceTopology[2]).toMatchObject({
      faceId: 2,
      materialSlot: 4,
    });
  });

  it("deterministically bounds large diagnostic ID lists while preserving exact totals", () => {
    const base = createDisconnectedFaceMesh(
      STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS + 1,
      false,
    );
    const mesh: StudioEditableMesh = {
      ...base,
      faces: base.faces.map((face) => ({ ...face, materialSlot: 1 })),
    };
    const first = successful(exportMesh(mesh, "material-id-bound"));
    const second = successful(exportMesh(mesh, "material-id-bound"));
    const loss = first.report.losses[0];

    expect(loss).toMatchObject({
      severity: "loss",
      code: "material-slot-metadata-only",
    });
    expect(loss?.faceIds).toHaveLength(STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS);
    expect(loss?.faceIds?.[0]).toBe(0);
    expect(loss?.faceIds?.at(-1)).toBe(STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS - 1);
    expect(loss?.detail).toContain(
      `faceIds total=${STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS + 1} `
        + `retained=${STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_ISSUE_IDS} omitted=1`,
    );
    expect(second.report).toEqual(first.report);
  });

  it("bounds exporter-wide warning counts with one deterministic overflow receipt", () => {
    const warningCount = STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES + 1;
    const mesh = createDisconnectedFaceMesh(warningCount, true);
    const result = successful(exportMesh(mesh, "warning-count-bound"));
    const overflow = result.report.warnings.at(-1);

    expect(result.report.issues).toHaveLength(STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES);
    expect(result.report.warnings).toHaveLength(STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES);
    expect(result.report.warnings[0]).toMatchObject({
      code: "face-collinear-corner-omitted",
      faceIds: [0],
    });
    expect(result.report.warnings.at(-2)).toMatchObject({
      code: "face-collinear-corner-omitted",
      faceIds: [STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES - 2],
    });
    expect(overflow).toMatchObject({ severity: "warning", code: "diagnostic-overflow" });
    expect(overflow?.detail).toContain(
      `total=${warningCount} retained=${STUDIO_HYBRID_DCC_GLB_EXPORT_MAX_REPORT_ISSUES - 1} omitted=2`,
    );
  });

  it("fails closed with an explicit report for broken links, non-planar faces, and unsupported crease data", () => {
    const cube = createStudioUnitCubeMesh();
    const broken: StudioEditableMesh = {
      ...cube,
      halfEdges: cube.halfEdges.map((halfEdge) =>
        halfEdge.id === 0 ? { ...halfEdge, next: 999_999 } : halfEdge,
      ),
    };
    const brokenResult = exportStudioHybridDccMeshGlb({
      assetId: "broken",
      mesh: broken,
      sourceRevision: 1,
      sourceHash: hashStudioEditableMesh(cube),
    });
    expect(brokenResult.ok).toBe(false);
    expect(issueCodes(brokenResult)).toContain("half-edge-reference-invalid");
    expect("bytes" in brokenResult).toBe(false);

    const nonPlanar = createStudioEditableMeshFromPolygons(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0.25 },
        { x: 0, y: 1, z: 0 },
      ],
      [[0, 1, 2, 3]],
    );
    const nonPlanarResult = exportMesh(nonPlanar, "non-planar");
    expect(nonPlanarResult.ok).toBe(false);
    expect(issueCodes(nonPlanarResult)).toContain("face-non-planar");

    const creased: StudioEditableMesh = {
      ...cube,
      halfEdges: cube.halfEdges.map((halfEdge) =>
        halfEdge.id === 0 ? { ...halfEdge, crease: 0.5 } : halfEdge,
      ),
    };
    const creaseResult = exportStudioHybridDccMeshGlb({
      assetId: "creased",
      mesh: creased,
      sourceRevision: 1,
      sourceHash: hashStudioEditableMesh(creased),
    });
    expect(creaseResult.ok).toBe(false);
    expect(issueCodes(creaseResult)).toContain("crease-unsupported");
  });

  it("blocks non-manifold edge topology and a stale provenance hash", () => {
    const nonManifold = createStudioEditableMeshFromPolygons(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      [
        [0, 1, 2],
        [1, 0, 3],
        [0, 1, 4],
      ],
    );
    const topologyResult = exportMesh(nonManifold, "non-manifold");
    expect(topologyResult.ok).toBe(false);
    expect(issueCodes(topologyResult)).toContain("non-manifold-edge");

    const cube = createStudioUnitCubeMesh();
    const staleResult = exportStudioHybridDccMeshGlb({
      assetId: "stale",
      mesh: cube,
      sourceRevision: 2,
      sourceHash: "mesh:00000000",
    });
    expect(staleResult.ok).toBe(false);
    expect(issueCodes(staleResult)).toContain("source-hash-mismatch");
  });
});
