/**
 * Grade-A / §12.1 import pipeline: GLB, VRM, OBJ, FBX(ASCII lite), PNG, PSD path reports.
 * Each path returns CompatibilityLoss report with parser, source hash, units/axis, counts.
 */

import {
  createStudioAsciiFbxTriangleFixture,
  importStudioFbxAsciiDocument,
} from "./studio-fbx-ascii-import";
import { importStudioGlbDocument, parseStudioGlbToSceneIR } from "./studio-glb-scene-ir";
import {
  buildStudioImportCompatibilityReport,
  commitStudioImportToDocument,
  parseStudioObjToSceneIR,
  type StudioImportCompatibilityReport,
  type StudioImportSceneIR,
} from "./studio-import-compatibility-report";
import { importStudioMeshByExtension } from "./studio-mesh-format-adapters";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_GRADE_A_IMPORT_REVISION = 2 as const;

export type StudioGradeAFormat =
  | "glb"
  | "gltf"
  | "vrm"
  | "obj"
  | "fbx"
  | "png"
  | "psd"
  | "stl"
  | "ply"
  | "dae"
  | "dxf";

export interface StudioGradeAImportResult {
  readonly format: StudioGradeAFormat;
  readonly report: StudioImportCompatibilityReport;
  readonly scene: StudioImportSceneIR;
  readonly commitHash: string;
  readonly committed: boolean;
}

function detectFormat(
  name: string,
  bytes: Uint8Array,
): StudioGradeAFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".vrm")) return "vrm";
  if (lower.endsWith(".glb")) return "glb";
  if (lower.endsWith(".gltf")) return "gltf";
  if (lower.endsWith(".obj")) return "obj";
  if (lower.endsWith(".fbx")) return "fbx";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".psd") || lower.endsWith(".psb")) return "psd";
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".ply")) return "ply";
  if (lower.endsWith(".dae")) return "dae";
  if (lower.endsWith(".dxf")) return "dxf";
  // magic
  if (
    bytes.length >= 4
    && bytes[0] === 0x67
    && bytes[1] === 0x6c
    && bytes[2] === 0x54
    && bytes[3] === 0x46
  ) {
    return "glb";
  }
  if (bytes.length >= 8 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(64, bytes.length)));
  if (head.includes("FBX") || head.includes("Vertices:")) return "fbx";
  if (head.trimStart().startsWith("v ") || head.includes("\nv ")) return "obj";
  return null;
}

function pngScene(_bytes: Uint8Array): StudioImportSceneIR {
  return {
    format: "unknown",
    units: "px",
    axis: "unknown",
    meshes: [],
    materials: [],
    textures: [{ name: "png-image" }],
    nodes: [{ name: "image-layer" }],
    unsupported: [],
  };
}

function psdScene(_bytes: Uint8Array): StudioImportSceneIR {
  return {
    format: "unknown",
    units: "px",
    axis: "unknown",
    meshes: [],
    materials: [],
    textures: [],
    nodes: [{ name: "psd-document" }],
    unsupported: [
      {
        kind: "psd-layers",
        reason: "Use studio-psd-import for full layer graph; pipeline records shell only",
      },
    ],
  };
}

/**
 * Import any §12.1 grade-A (or FBX B) asset into SceneIR + compatibility report.
 */
export function importStudioGradeAAsset(input: {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly format?: StudioGradeAFormat;
}): StudioGradeAImportResult {
  const format = input.format ?? detectFormat(input.fileName, input.bytes);
  if (
    format === "stl"
    || format === "ply"
    || format === "dae"
    || format === "dxf"
  ) {
    const adapted = importStudioMeshByExtension(
      input.fileName.endsWith(`.${format}`)
        ? input.fileName
        : `${input.fileName}.${format}`,
      input.bytes,
    );
    if (adapted) {
      return {
        format,
        report: adapted.report,
        scene: adapted.scene,
        commitHash: adapted.commitHash,
        committed: adapted.meshes.length > 0,
      };
    }
  }
  if (!format) {
    const empty: StudioImportSceneIR = {
      format: "unknown",
      meshes: [],
      materials: [],
      textures: [],
      nodes: [],
      unsupported: [{ kind: "format", reason: `unsupported: ${input.fileName}` }],
    };
    const report = buildStudioImportCompatibilityReport({
      parser: "studio-grade-a-import-pipeline",
      sourceBytes: input.bytes,
      scene: empty,
      committed: false,
    });
    return {
      format: "obj",
      report,
      scene: empty,
      commitHash: report.sourceHash,
      committed: false,
    };
  }

  if (
    format === "stl"
    || format === "ply"
    || format === "dae"
    || format === "dxf"
  ) {
    const adapted = importStudioMeshByExtension(input.fileName, input.bytes);
    if (!adapted) {
      const empty: StudioImportSceneIR = {
        format: "unknown",
        meshes: [],
        materials: [],
        textures: [],
        nodes: [],
        unsupported: [{ kind: "format", reason: format }],
      };
      const report = buildStudioImportCompatibilityReport({
        parser: "studio-grade-a-import-pipeline/mesh-adapter",
        sourceBytes: input.bytes,
        scene: empty,
        committed: false,
      });
      return {
        format,
        report,
        scene: empty,
        commitHash: report.sourceHash,
        committed: false,
      };
    }
    return {
      format,
      report: adapted.report,
      scene: adapted.scene,
      commitHash: adapted.commitHash,
      committed: adapted.meshes.length > 0,
    };
  }

  if (format === "glb" || format === "gltf" || format === "vrm") {
    const imported = importStudioGlbDocument(input.bytes, {
      parser: "studio-grade-a-import-pipeline/glb",
      asVrm: format === "vrm",
    });
    return {
      format,
      report: { ...imported.report, format: format === "vrm" ? "vrm" : "glb" },
      scene: imported.scene,
      commitHash: imported.commit.commitHash,
      committed: imported.report.committed,
    };
  }

  if (format === "obj") {
    const text = new TextDecoder().decode(input.bytes);
    const scene = parseStudioObjToSceneIR(text);
    const report = buildStudioImportCompatibilityReport({
      parser: "studio-grade-a-import-pipeline/obj",
      sourceBytes: input.bytes,
      scene,
      committed: true,
    });
    const commit = commitStudioImportToDocument(report, scene);
    return {
      format: "obj",
      report,
      scene,
      commitHash: commit.commitHash,
      committed: true,
    };
  }

  if (format === "fbx") {
    const fbx = importStudioFbxAsciiDocument(input.bytes, {
      parser: "studio-grade-a-import-pipeline/fbx-ascii",
    });
    if (!fbx.ok) {
      const empty: StudioImportSceneIR = {
        format: "unknown",
        meshes: [],
        materials: [],
        textures: [],
        nodes: [],
        unsupported: [
          {
            kind: "fbx",
            reason: fbx.detail,
          },
          {
            kind: "binary-bridge",
            reason: "Try convertStudioBg3dModelFilesToGlb for binary FBX via Three FBXLoader",
          },
        ],
      };
      const report = buildStudioImportCompatibilityReport({
        parser: "studio-grade-a-import-pipeline/fbx",
        sourceBytes: input.bytes,
        scene: empty,
        committed: false,
      });
      return {
        format: "fbx",
        report: {
          ...report,
          fidelity: {
            geometry: "B",
            material: "P",
            rigAnimation: "X",
            semanticHistory: "P",
          },
        },
        scene: empty,
        commitHash: report.sourceHash,
        committed: false,
      };
    }
    return {
      format: "fbx",
      report: fbx.report,
      scene: fbx.scene,
      commitHash: fbx.commit.commitHash,
      committed: true,
    };
  }

  if (format === "png") {
    const scene = pngScene(input.bytes);
    const report = buildStudioImportCompatibilityReport({
      parser: "studio-grade-a-import-pipeline/png",
      sourceBytes: input.bytes,
      scene,
      committed: true,
    });
    return {
      format: "png",
      report: {
        ...report,
        fidelity: {
          geometry: "X",
          material: "A",
          rigAnimation: "X",
          semanticHistory: "P",
        },
      },
      scene,
      commitHash: `sha256:${sha256HexPortable(input.bytes)}`,
      committed: true,
    };
  }

  // psd
  const scene = psdScene(input.bytes);
  const report = buildStudioImportCompatibilityReport({
    parser: "studio-grade-a-import-pipeline/psd",
    sourceBytes: input.bytes,
    scene,
    committed: true,
  });
  return {
    format: "psd",
    report: {
      ...report,
      fidelity: {
        geometry: "X",
        material: "B",
        rigAnimation: "X",
        semanticHistory: "B",
      },
      warnings: [
        ...report.warnings,
        "Full PSD layer fidelity via studio-psd-import / ag-psd write path",
      ],
    },
    scene,
    commitHash: report.sourceHash,
    committed: true,
  };
}

export { createStudioAsciiFbxTriangleFixture, parseStudioGlbToSceneIR };
