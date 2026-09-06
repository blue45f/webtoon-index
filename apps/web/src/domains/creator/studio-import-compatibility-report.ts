/**
 * Import compatibility / loss report (doc §7.9 fields + CHR-001, glTF/OBJ/VRM).
 * Pure report builder over parsed scene IR — does not ship proprietary native parsers.
 */

import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_IMPORT_COMPAT_REPORT_REVISION = 1 as const;

export type StudioImportFormat =
  | "gltf"
  | "glb"
  | "vrm"
  | "obj"
  | "unknown";

export type StudioImportFidelityGrade =
  | "N"
  | "A"
  | "B"
  | "C"
  | "D"
  | "P"
  | "X";

export interface StudioImportEntityCounts {
  readonly meshes: number;
  readonly materials: number;
  readonly textures: number;
  readonly nodes: number;
  readonly bones: number;
  readonly animations: number;
  readonly morphTargets: number;
}

export interface StudioImportUnsupportedEntity {
  readonly kind: string;
  readonly name?: string;
  readonly reason: string;
}

export interface StudioImportCompatibilityReport {
  readonly revision: typeof STUDIO_IMPORT_COMPAT_REPORT_REVISION;
  /** Parser / pipeline id (e.g. three-gltf-loader, obj-worker, three-vrm). */
  readonly parser: string;
  readonly format: StudioImportFormat;
  readonly sourceHash: `sha256:${string}`;
  readonly units: string;
  readonly axis: "y-up" | "z-up" | "unknown";
  readonly counts: StudioImportEntityCounts;
  readonly unsupportedEntities: readonly StudioImportUnsupportedEntity[];
  readonly fidelity: {
    readonly geometry: StudioImportFidelityGrade;
    readonly material: StudioImportFidelityGrade;
    readonly rigAnimation: StudioImportFidelityGrade;
    readonly semanticHistory: StudioImportFidelityGrade;
  };
  readonly vrm?: {
    readonly sourceVersion: "0.x" | "1.0" | "unknown";
    readonly normalizedTo: "1.0-semantic-ir";
    readonly humanoidMapped: boolean;
    readonly missingBones: readonly string[];
    readonly extraBones: readonly string[];
  };
  readonly warnings: readonly string[];
  readonly committed: boolean;
  readonly sceneIrNodeCount: number;
}

export interface StudioImportSceneIR {
  readonly format: StudioImportFormat;
  readonly units?: string;
  readonly axis?: "y-up" | "z-up" | "unknown";
  readonly meshes: readonly { readonly name: string; readonly vertexCount: number; readonly triangleCount: number }[];
  readonly materials: readonly { readonly name: string; readonly kind: string }[];
  readonly textures: readonly { readonly name: string }[];
  readonly nodes: readonly { readonly name: string; readonly parent?: string }[];
  readonly bones?: readonly { readonly name: string; readonly humanoid?: string }[];
  readonly animations?: readonly { readonly name: string }[];
  readonly morphTargets?: readonly { readonly name: string }[];
  readonly unsupported?: readonly StudioImportUnsupportedEntity[];
  readonly vrmMeta?: {
    readonly sourceVersion: "0.x" | "1.0" | "unknown";
  };
}

export interface BuildStudioImportReportInput {
  readonly parser: string;
  readonly sourceBytes: Uint8Array | ArrayBuffer | string;
  readonly scene: StudioImportSceneIR;
  readonly committed?: boolean;
  readonly requiredHumanoidBones?: readonly string[];
}

function hashSource(source: Uint8Array | ArrayBuffer | string): `sha256:${string}` {
  if (typeof source === "string") {
    return `sha256:${sha256HexPortable(new TextEncoder().encode(source))}`;
  }
  const bytes =
    source instanceof ArrayBuffer ? new Uint8Array(source) : source;
  return `sha256:${sha256HexPortable(bytes)}`;
}

const DEFAULT_HUMANOID = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
] as const;

export function buildStudioImportCompatibilityReport(
  input: BuildStudioImportReportInput,
): StudioImportCompatibilityReport {
  const scene = input.scene;
  const unsupported = scene.unsupported ?? [];
  const bones = scene.bones ?? [];
  const animations = scene.animations ?? [];
  const morphTargets = scene.morphTargets ?? [];
  const counts: StudioImportEntityCounts = {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    textures: scene.textures.length,
    nodes: scene.nodes.length,
    bones: bones.length,
    animations: animations.length,
    morphTargets: morphTargets.length,
  };

  const warnings: string[] = [];
  if (counts.meshes === 0) warnings.push("No meshes in import.");
  if (unsupported.length > 0) {
    warnings.push(`${unsupported.length} unsupported entities`);
  }

  let geometryGrade: StudioImportFidelityGrade = counts.meshes > 0 ? "A" : "X";
  let materialGrade: StudioImportFidelityGrade = counts.materials > 0 ? "A" : "B";
  let rigGrade: StudioImportFidelityGrade = "B";
  let semanticGrade: StudioImportFidelityGrade = "B";

  if (scene.format === "obj") {
    rigGrade = "X";
    semanticGrade = "P";
    materialGrade = counts.materials > 0 ? "B" : "P";
  }

  let vrm: StudioImportCompatibilityReport["vrm"];
  if (scene.format === "vrm" || scene.vrmMeta) {
    const required = input.requiredHumanoidBones ?? DEFAULT_HUMANOID;
    const mapped = new Set(
      bones.map((b) => b.humanoid).filter((h): h is string => Boolean(h)),
    );
    const missingBones = required.filter((b) => !mapped.has(b));
    const extraBones = bones
      .filter((b) => b.humanoid && !required.includes(b.humanoid as (typeof required)[number]))
      .map((b) => b.name);
    const humanoidMapped = missingBones.length < required.length;
    rigGrade = humanoidMapped ? "A" : "B";
    semanticGrade = "A";
    vrm = {
      sourceVersion: scene.vrmMeta?.sourceVersion ?? "unknown",
      normalizedTo: "1.0-semantic-ir",
      humanoidMapped,
      missingBones,
      extraBones,
    };
    if (missingBones.length > 0) {
      warnings.push(`Missing humanoid bones: ${missingBones.join(", ")}`);
    }
  }

  if (unsupported.length > 0) {
    if (geometryGrade === "A") geometryGrade = "B";
    if (materialGrade === "A") materialGrade = "B";
  }

  return {
    revision: STUDIO_IMPORT_COMPAT_REPORT_REVISION,
    parser: input.parser,
    format: scene.format,
    sourceHash: hashSource(input.sourceBytes),
    units: scene.units ?? "meters",
    axis: scene.axis ?? "y-up",
    counts,
    unsupportedEntities: unsupported,
    fidelity: {
      geometry: geometryGrade,
      material: materialGrade,
      rigAnimation: rigGrade,
      semanticHistory: semanticGrade,
    },
    vrm,
    warnings,
    committed: input.committed ?? true,
    sceneIrNodeCount: scene.nodes.length,
  };
}

/** Minimal OBJ text → SceneIR (subset parser for fixtures / tests). */
export function parseStudioObjToSceneIR(objText: string): StudioImportSceneIR {
  const vertices: number[] = [];
  const faces: number[][] = [];
  const materials = new Set<string>();
  for (const raw of objText.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/u);
    const tag = parts[0];
    if (tag === "v") {
      vertices.push(
        Number(parts[1] ?? 0),
        Number(parts[2] ?? 0),
        Number(parts[3] ?? 0),
      );
    } else if (tag === "usemtl") {
      materials.add(parts[1] ?? "default");
    } else if (tag === "f") {
      const idxs = parts.slice(1).map((p) => {
        const i = Number(p.split("/")[0]);
        return i < 0 ? vertices.length / 3 + i : i - 1;
      });
      if (idxs.length >= 3) faces.push(idxs);
    }
  }
  return {
    format: "obj",
    units: "meters",
    axis: "y-up",
    meshes: [
      {
        name: "obj-mesh",
        vertexCount: vertices.length / 3,
        triangleCount: faces.reduce((n, f) => n + Math.max(0, f.length - 2), 0),
      },
    ],
    materials: [...materials].map((name) => ({ name, kind: "basic" })),
    textures: [],
    nodes: [{ name: "root" }, { name: "obj-mesh", parent: "root" }],
    unsupported: [],
  };
}

/** Minimal GLB container probe: validates magic + extracts JSON chunk names for report (not full glTF graph). */
export function probeStudioGlbSceneIR(
  bytes: Uint8Array,
  options: { readonly format?: "glb" | "vrm"; readonly vrmVersion?: "0.x" | "1.0" } = {},
): StudioImportSceneIR {
  const unsupported: StudioImportUnsupportedEntity[] = [];
  if (bytes.byteLength < 12) {
    return {
      format: options.format ?? "glb",
      meshes: [],
      materials: [],
      textures: [],
      nodes: [],
      unsupported: [{ kind: "file", reason: "too small for GLB header" }],
    };
  }
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== "glTF") {
    unsupported.push({ kind: "header", reason: `magic ${magic} is not glTF` });
  }
  // Best-effort JSON chunk scan for mesh/material counts
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 1_000_000)));
  const meshMatches = text.match(/"meshes"\s*:/u);
  const matMatches = text.match(/"materials"\s*:/u);
  const nodeMatches = text.match(/"nodes"\s*:/u);
  const skinMatches = text.match(/"skins"\s*:/u);
  const animMatches = text.match(/"animations"\s*:/u);
  const meshes = meshMatches ? [{ name: "mesh-0", vertexCount: 0, triangleCount: 0 }] : [];
  const materials = matMatches ? [{ name: "mat-0", kind: "pbr" }] : [];
  const nodes = nodeMatches ? [{ name: "node-0" }] : [{ name: "root" }];
  const bones = skinMatches ? [{ name: "bone-0", humanoid: "hips" }] : [];
  const animations = animMatches ? [{ name: "anim-0" }] : [];
  const format = options.format ?? "glb";
  return {
    format,
    units: "meters",
    axis: "y-up",
    meshes,
    materials,
    textures: [],
    nodes,
    bones,
    animations,
    morphTargets: [],
    unsupported,
    vrmMeta:
      format === "vrm"
        ? { sourceVersion: options.vrmVersion ?? "1.0" }
        : undefined,
  };
}

/** Commit import into a lightweight SceneIR document record for tests / pipeline. */
export function commitStudioImportToDocument(
  report: StudioImportCompatibilityReport,
  scene: StudioImportSceneIR,
): {
  readonly documentKind: "toonspectrum.scene-ir";
  readonly version: 1;
  readonly report: StudioImportCompatibilityReport;
  readonly scene: StudioImportSceneIR;
  readonly commitHash: string;
} {
  const commitHash = stableHash([
    report.sourceHash,
    report.parser,
    String(scene.nodes.length),
    String(scene.meshes.length),
  ]);
  return {
    documentKind: "toonspectrum.scene-ir",
    version: 1,
    report: { ...report, committed: true },
    scene,
    commitHash,
  };
}

function stableHash(parts: readonly string[]): string {
  return `sha256:${sha256HexPortable(new TextEncoder().encode(parts.join("|")))}`;
}
