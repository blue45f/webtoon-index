/**
 * Real glTF binary (GLB) / VRM container → SceneIR parser (no Three.js).
 * Parses header + JSON/BIN chunks and materializes mesh/node/skin/animation counts
 * from the actual glTF document (not magic-string regex probes).
 */

import {
  createStudioEditableMeshFromPolygons,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "./studio-editable-half-edge-mesh";
import {
  buildStudioImportCompatibilityReport,
  commitStudioImportToDocument,
  type StudioImportCompatibilityReport,
  type StudioImportSceneIR,
  type StudioImportUnsupportedEntity,
} from "./studio-import-compatibility-report";

export const STUDIO_GLB_SCENE_IR_REVISION = 1 as const;

export type StudioGlbParseFailureCode =
  | "empty"
  | "invalid-header"
  | "invalid-chunk"
  | "invalid-json"
  | "unsupported-version";

export type StudioGlbParseResult =
  | {
      readonly ok: true;
      readonly scene: StudioImportSceneIR;
      readonly json: Record<string, unknown>;
      readonly binByteLength: number;
      readonly meshes: readonly StudioEditableMesh[];
    }
  | {
      readonly ok: false;
      readonly code: StudioGlbParseFailureCode;
      readonly detail: string;
    };

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function componentBytes(componentType: number): number {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      return 0;
  }
}

function typeComponents(type: string): number {
  switch (type) {
    case "SCALAR":
      return 1;
    case "VEC2":
      return 2;
    case "VEC3":
      return 3;
    case "VEC4":
    case "MAT2":
      return 4;
    case "MAT3":
      return 9;
    case "MAT4":
      return 16;
    default:
      return 0;
  }
}

function readAccessorFloats(
  json: Record<string, unknown>,
  bin: Uint8Array | null,
  accessorIndex: number,
): Float32Array | null {
  const accessors = asArray(json.accessors);
  const bufferViews = asArray(json.bufferViews);
  const accessor = asRecord(accessors[accessorIndex]);
  if (!accessor || !bin) return null;
  const bufferViewIndex = accessor.bufferView;
  if (typeof bufferViewIndex !== "number") return null;
  const bufferView = asRecord(bufferViews[bufferViewIndex]);
  if (!bufferView) return null;
  const byteOffset =
    (typeof bufferView.byteOffset === "number" ? bufferView.byteOffset : 0)
    + (typeof accessor.byteOffset === "number" ? accessor.byteOffset : 0);
  const count = typeof accessor.count === "number" ? accessor.count : 0;
  const type = typeof accessor.type === "string" ? accessor.type : "SCALAR";
  const componentType =
    typeof accessor.componentType === "number" ? accessor.componentType : 5126;
  const comps = typeComponents(type);
  const elemSize = componentBytes(componentType) * comps;
  if (elemSize <= 0 || count <= 0) return null;
  const stride =
    typeof bufferView.byteStride === "number" && bufferView.byteStride > 0
      ? bufferView.byteStride
      : elemSize;
  const out = new Float32Array(count * comps);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < count; i += 1) {
    const base = byteOffset + i * stride;
    for (let c = 0; c < comps; c += 1) {
      const o = base + c * componentBytes(componentType);
      if (o + componentBytes(componentType) > bin.byteLength) return null;
      let value = 0;
      if (componentType === 5126) value = view.getFloat32(o, true);
      else if (componentType === 5123) value = view.getUint16(o, true);
      else if (componentType === 5125) value = view.getUint32(o, true);
      else if (componentType === 5121) value = view.getUint8(o);
      else if (componentType === 5122) value = view.getInt16(o, true);
      else if (componentType === 5120) value = view.getInt8(o);
      out[i * comps + c] = value;
    }
  }
  return out;
}

function readAccessorIndices(
  json: Record<string, unknown>,
  bin: Uint8Array | null,
  accessorIndex: number,
): Uint32Array | null {
  const floats = readAccessorFloats(json, bin, accessorIndex);
  // Indices need integer read — re-read properly
  const accessors = asArray(json.accessors);
  const bufferViews = asArray(json.bufferViews);
  const accessor = asRecord(accessors[accessorIndex]);
  if (!accessor || !bin) return null;
  const bufferViewIndex = accessor.bufferView;
  if (typeof bufferViewIndex !== "number") return null;
  const bufferView = asRecord(bufferViews[bufferViewIndex]);
  if (!bufferView) return null;
  const byteOffset =
    (typeof bufferView.byteOffset === "number" ? bufferView.byteOffset : 0)
    + (typeof accessor.byteOffset === "number" ? accessor.byteOffset : 0);
  const count = typeof accessor.count === "number" ? accessor.count : 0;
  const componentType =
    typeof accessor.componentType === "number" ? accessor.componentType : 5123;
  const out = new Uint32Array(count);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < count; i += 1) {
    if (componentType === 5121) out[i] = view.getUint8(byteOffset + i);
    else if (componentType === 5123) out[i] = view.getUint16(byteOffset + i * 2, true);
    else if (componentType === 5125) out[i] = view.getUint32(byteOffset + i * 4, true);
    else if (floats) out[i] = Math.trunc(floats[i]!);
    else return null;
  }
  return out;
}

function humanoidFromVrmExtensions(
  json: Record<string, unknown>,
): { sourceVersion: "0.x" | "1.0" | "unknown"; bones: { name: string; humanoid?: string }[] } {
  const extensions = asRecord(json.extensions) ?? {};
  const nodes = asArray(json.nodes);
  const bones: { name: string; humanoid?: string }[] = [];
  if (extensions.VRMC_vrm) {
    const vrm = asRecord(extensions.VRMC_vrm) ?? {};
    const humanoid = asRecord(vrm.humanoid) ?? {};
    const humanBones = asRecord(humanoid.humanBones) ?? {};
    for (const [bone, binding] of Object.entries(humanBones)) {
      const rec = asRecord(binding);
      const node = typeof rec?.node === "number" ? rec.node : -1;
      const nodeRec = asRecord(nodes[node]);
      const name =
        typeof nodeRec?.name === "string" ? nodeRec.name : `node-${node}`;
      bones.push({ name, humanoid: bone });
    }
    return { sourceVersion: "1.0", bones };
  }
  if (extensions.VRM) {
    const vrm = asRecord(extensions.VRM) ?? {};
    const humanoid = asRecord(vrm.humanoid) ?? {};
    const boneList = asArray(humanoid.humanBones);
    for (const entry of boneList) {
      const rec = asRecord(entry);
      const bone = typeof rec?.bone === "string" ? rec.bone : undefined;
      const node = typeof rec?.node === "number" ? rec.node : -1;
      const nodeRec = asRecord(nodes[node]);
      const name =
        typeof nodeRec?.name === "string" ? nodeRec.name : `node-${node}`;
      bones.push({ name, humanoid: bone });
    }
    return { sourceVersion: "0.x", bones };
  }
  return { sourceVersion: "unknown", bones: [] };
}

/**
 * Parse a GLB/VRM ArrayBuffer into SceneIR + optional editable meshes.
 */
export function parseStudioGlbToSceneIR(
  bytes: Uint8Array,
  options: { readonly asVrm?: boolean } = {},
): StudioGlbParseResult {
  if (bytes.byteLength < 12) {
    return { ok: false, code: "empty", detail: "buffer too small for GLB header" };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(
    bytes[0]!,
    bytes[1]!,
    bytes[2]!,
    bytes[3]!,
  );
  if (magic !== "glTF") {
    return { ok: false, code: "invalid-header", detail: `magic=${magic}` };
  }
  const version = readU32(view, 4);
  if (version !== 2) {
    return {
      ok: false,
      code: "unsupported-version",
      detail: `glTF version ${version}`,
    };
  }
  const length = readU32(view, 8);
  if (length > bytes.byteLength) {
    return {
      ok: false,
      code: "invalid-header",
      detail: `declared length ${length} > buffer ${bytes.byteLength}`,
    };
  }

  let offset = 12;
  let jsonText: string | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = readU32(view, offset);
    const chunkType = readU32(view, offset + 4);
    offset += 8;
    if (offset + chunkLength > bytes.byteLength) {
      return { ok: false, code: "invalid-chunk", detail: "chunk overflows buffer" };
    }
    const chunk = bytes.subarray(offset, offset + chunkLength);
    offset += chunkLength;
    // pad to 4-byte boundary is already in chunkLength for GLB
    if (chunkType === 0x4e4f534a) {
      // JSON
      jsonText = new TextDecoder().decode(chunk);
    } else if (chunkType === 0x004e4942) {
      bin = chunk;
    }
  }
  if (!jsonText) {
    return { ok: false, code: "invalid-chunk", detail: "missing JSON chunk" };
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (error) {
    return {
      ok: false,
      code: "invalid-json",
      detail: error instanceof Error ? error.message : "JSON parse failed",
    };
  }

  const meshesJson = asArray(json.meshes);
  const materialsJson = asArray(json.materials);
  const texturesJson = asArray(json.textures);
  const nodesJson = asArray(json.nodes);
  const skinsJson = asArray(json.skins);
  const animationsJson = asArray(json.animations);
  const unsupported: StudioImportUnsupportedEntity[] = [];

  const meshRecords: {
    name: string;
    vertexCount: number;
    triangleCount: number;
  }[] = [];
  const editableMeshes: StudioEditableMesh[] = [];

  for (let mi = 0; mi < meshesJson.length; mi += 1) {
    const mesh = asRecord(meshesJson[mi]);
    if (!mesh) continue;
    const name = typeof mesh.name === "string" ? mesh.name : `mesh-${mi}`;
    const primitives = asArray(mesh.primitives);
    let vertexCount = 0;
    let triangleCount = 0;
    for (const prim of primitives) {
      const p = asRecord(prim);
      if (!p) continue;
      const attrs = asRecord(p.attributes) ?? {};
      const posAccessor =
        typeof attrs.POSITION === "number" ? attrs.POSITION : -1;
      if (posAccessor >= 0) {
        const positions = readAccessorFloats(json, bin, posAccessor);
        if (positions) {
          vertexCount += positions.length / 3;
          const verts: StudioMeshVec3[] = [];
          for (let i = 0; i < positions.length; i += 3) {
            verts.push({
              x: positions[i]!,
              y: positions[i + 1]!,
              z: positions[i + 2]!,
            });
          }
          const faces: number[][] = [];
          if (typeof p.indices === "number") {
            const indices = readAccessorIndices(json, bin, p.indices);
            if (indices) {
              triangleCount += indices.length / 3;
              for (let i = 0; i + 2 < indices.length; i += 3) {
                faces.push([indices[i]!, indices[i + 1]!, indices[i + 2]!]);
              }
            }
          } else {
            // non-indexed: consecutive triangles
            const triCount = Math.floor(verts.length / 3);
            triangleCount += triCount;
            for (let i = 0; i < triCount; i += 1) {
              faces.push([i * 3, i * 3 + 1, i * 3 + 2]);
            }
          }
          if (faces.length > 0 && verts.length > 0) {
            try {
              editableMeshes.push(
                createStudioEditableMeshFromPolygons(verts, faces),
              );
            } catch {
              unsupported.push({
                kind: "mesh-topology",
                name,
                reason: "failed to build editable mesh from primitive",
              });
            }
          }
        }
      }
      if (p.mode !== undefined && p.mode !== 4) {
        unsupported.push({
          kind: "primitive-mode",
          name,
          reason: `mode ${String(p.mode)} not triangles`,
        });
      }
    }
    meshRecords.push({ name, vertexCount, triangleCount });
  }

  const morphTargets: { name: string }[] = [];
  for (const mesh of meshesJson) {
    const m = asRecord(mesh);
    for (const prim of asArray(m?.primitives)) {
      const targets = asArray(asRecord(prim)?.targets);
      for (let ti = 0; ti < targets.length; ti += 1) {
        morphTargets.push({ name: `morph-${morphTargets.length}` });
      }
    }
  }

  const vrm = humanoidFromVrmExtensions(json);
  const isVrm =
    options.asVrm
    || Boolean(asRecord(json.extensions)?.VRMC_vrm)
    || Boolean(asRecord(json.extensions)?.VRM)
    || (typeof json.extensionsUsed === "object"
      && Array.isArray(json.extensionsUsed)
      && json.extensionsUsed.some(
        (e) => e === "VRMC_vrm" || e === "VRM",
      ));

  const skinBones: { name: string; humanoid?: string }[] = [];
  for (let si = 0; si < skinsJson.length; si += 1) {
    const skin = asRecord(skinsJson[si]);
    for (const joint of asArray(skin?.joints)) {
      if (typeof joint !== "number") continue;
      const node = asRecord(nodesJson[joint]);
      skinBones.push({
        name: typeof node?.name === "string" ? node.name : `joint-${joint}`,
      });
    }
  }

  const bones =
    vrm.bones.length > 0
      ? vrm.bones
      : skinBones;

  const scene: StudioImportSceneIR = {
    format: isVrm ? "vrm" : "glb",
    units: "meters",
    axis: "y-up",
    meshes: meshRecords,
    materials: materialsJson.map((m, i) => {
      const rec = asRecord(m);
      return {
        name: typeof rec?.name === "string" ? rec.name : `material-${i}`,
        kind: "pbr",
      };
    }),
    textures: texturesJson.map((_, i) => ({ name: `texture-${i}` })),
    nodes: nodesJson.map((n, i) => {
      const rec = asRecord(n);
      return {
        name: typeof rec?.name === "string" ? rec.name : `node-${i}`,
        parent: undefined,
      };
    }),
    bones,
    animations: animationsJson.map((a, i) => {
      const rec = asRecord(a);
      return {
        name: typeof rec?.name === "string" ? rec.name : `animation-${i}`,
      };
    }),
    morphTargets,
    unsupported,
    vrmMeta: isVrm ? { sourceVersion: vrm.sourceVersion } : undefined,
  };

  return {
    ok: true,
    scene,
    json,
    binByteLength: bin?.byteLength ?? 0,
    meshes: editableMeshes,
  };
}

/** Full import pipeline: parse bytes → report → document commit. */
export function importStudioGlbDocument(
  bytes: Uint8Array,
  options: {
    readonly parser?: string;
    readonly asVrm?: boolean;
    readonly sourceLabel?: string;
  } = {},
): {
  readonly report: StudioImportCompatibilityReport;
  readonly commit: ReturnType<typeof commitStudioImportToDocument>;
  readonly meshes: readonly StudioEditableMesh[];
  readonly scene: StudioImportSceneIR;
} {
  const parsed = parseStudioGlbToSceneIR(bytes, { asVrm: options.asVrm });
  if (!parsed.ok) {
    const emptyScene: StudioImportSceneIR = {
      format: options.asVrm ? "vrm" : "glb",
      meshes: [],
      materials: [],
      textures: [],
      nodes: [],
      unsupported: [{ kind: "parse", reason: parsed.detail }],
    };
    const report = buildStudioImportCompatibilityReport({
      parser: options.parser ?? "studio-glb-scene-ir",
      sourceBytes: bytes,
      scene: emptyScene,
      committed: false,
    });
    return {
      report,
      commit: commitStudioImportToDocument(report, emptyScene),
      meshes: [],
      scene: emptyScene,
    };
  }
  const report = buildStudioImportCompatibilityReport({
    parser: options.parser ?? "studio-glb-scene-ir",
    sourceBytes: bytes,
    scene: parsed.scene,
    committed: true,
  });
  return {
    report,
    commit: commitStudioImportToDocument(report, parsed.scene),
    meshes: parsed.meshes,
    scene: parsed.scene,
  };
}
