/**
 * `planStudioVrmExport(snapshot)` — pure, headless VRM 1.0 authoring.
 *
 * Takes a plain-data scene snapshot (node tree, meshes, materials, humanoid map, spring config) and
 * produces the glTF JSON root plus a packed BIN payload. No Three.js, no canvas, no GPU: the whole
 * pipeline is unit-testable in the `node` Vitest environment this repo already uses.
 *
 * Everything emitted here is shaped to survive the app's own import gates unchanged:
 * - `studio-bg3d-glb-validation.ts` (`validateStudioBg3dGlb`) — buffer/accessor/mesh/skin topology,
 *   `extensionsUsed ⊇ extensionsRequired`, no `uri` anywhere, one BIN chunk with ≤3 padding bytes.
 * - `vrm-library.ts` (`validateVrmGlbBytes`) — GLB envelope plus exactly one of `VRM`/`VRMC_vrm`.
 */

import { studioVrmExportError } from "./studio-vrm-export-error";
import {
  canonicalStudioVrmExportJsonText,
  planStudioVrmExportGlbLayout,
  writeStudioVrmExportGlb,
  type StudioVrmExportGlbLayout,
} from "./studio-vrm-export-glb-container";
import {
  buildStudioVrmcMToonExtension,
  buildStudioVrmcSpringBoneExtension,
  buildStudioVrmcVrmExtension,
  STUDIO_VRM_EXPORT_MTOON_EXTENSION,
  STUDIO_VRM_EXPORT_SPRING_BONE_EXTENSION,
  STUDIO_VRM_EXPORT_VRM_EXTENSION,
  type StudioVrmExportExpressions,
  type StudioVrmExportFirstPersonAnnotation,
  type StudioVrmExportHumanoidBones,
  type StudioVrmExportMeta,
  type StudioVrmExportMToonParams,
  type StudioVrmExportSpringBoneConfig,
  type StudioVrmExtensionContext,
} from "./studio-vrm-export-vrm-extension";

/** Stable, version-free generator string. A timestamp here would break byte determinism. */
export const STUDIO_VRM_EXPORT_GENERATOR = "ToonSpectrum Studio VRM Exporter";

export const STUDIO_VRM_EXPORT_MAX_NODES = 4_096;
export const STUDIO_VRM_EXPORT_MAX_MESH_PRIMITIVES = 2_048;
export const STUDIO_VRM_EXPORT_MAX_VERTICES_PER_PRIMITIVE = 1_000_000;
export const STUDIO_VRM_EXPORT_MAX_MORPH_TARGETS_PER_MESH = 512;

const GLTF_ARRAY_BUFFER = 34962;
const GLTF_ELEMENT_ARRAY_BUFFER = 34963;
const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;
const UNSIGNED_SHORT_LIMIT = 65_536;

export type StudioVrmExportImageMimeType = "image/png" | "image/jpeg" | "image/webp";
export type StudioVrmExportAlphaMode = "OPAQUE" | "MASK" | "BLEND";

type NumberSource = readonly number[] | Float32Array | Float64Array;
type IndexSource = readonly number[] | Uint8Array | Uint16Array | Uint32Array;

export interface StudioVrmExportNode {
  readonly name?: string;
  readonly translation?: readonly [number, number, number];
  /** XYZW quaternion, matching glTF node rotation order. */
  readonly rotation?: readonly [number, number, number, number];
  readonly scale?: readonly [number, number, number];
  readonly children?: readonly number[];
  readonly mesh?: number;
  readonly skin?: number;
}

export interface StudioVrmExportMorphTarget {
  readonly name?: string;
  readonly positions: NumberSource;
  readonly normals?: NumberSource;
}

export interface StudioVrmExportPrimitive {
  /** VEC3, three floats per vertex. Required — a primitive without POSITION is not exportable. */
  readonly positions: NumberSource;
  readonly normals?: NumberSource;
  /** VEC2 texture coordinates for TEXCOORD_0. */
  readonly uvs?: NumberSource;
  /** VEC4 unsigned-short joint indices for JOINTS_0. */
  readonly joints?: readonly number[] | Uint16Array;
  /** VEC4 float skin weights for WEIGHTS_0. */
  readonly weights?: NumberSource;
  readonly indices?: IndexSource;
  readonly material?: number;
  readonly targets?: readonly StudioVrmExportMorphTarget[];
}

export interface StudioVrmExportMesh {
  readonly name?: string;
  readonly primitives: readonly StudioVrmExportPrimitive[];
}

export interface StudioVrmExportSkin {
  readonly joints: readonly number[];
  readonly skeleton?: number;
  /** Column-major 4x4 matrices, 16 floats per joint. */
  readonly inverseBindMatrices?: NumberSource;
}

export interface StudioVrmExportImage {
  readonly name?: string;
  readonly mimeType: StudioVrmExportImageMimeType;
  readonly bytes: Uint8Array;
}

export interface StudioVrmExportSampler {
  readonly magFilter?: number;
  readonly minFilter?: number;
  readonly wrapS?: number;
  readonly wrapT?: number;
}

export interface StudioVrmExportTexture {
  readonly source: number;
  readonly sampler?: number;
}

export interface StudioVrmExportMaterial {
  readonly name?: string;
  readonly baseColorFactor?: readonly [number, number, number, number];
  readonly baseColorTexture?: number;
  readonly metallicFactor?: number;
  readonly roughnessFactor?: number;
  readonly emissiveFactor?: readonly [number, number, number];
  readonly alphaMode?: StudioVrmExportAlphaMode;
  readonly alphaCutoff?: number;
  readonly doubleSided?: boolean;
  readonly mtoon?: StudioVrmExportMToonParams;
}

export interface StudioVrmExportSceneSnapshot {
  readonly meta: StudioVrmExportMeta;
  readonly humanoidBones: StudioVrmExportHumanoidBones;
  readonly nodes: readonly StudioVrmExportNode[];
  /** Explicit scene roots. Defaults to every node that no other node lists as a child. */
  readonly roots?: readonly number[];
  readonly meshes?: readonly StudioVrmExportMesh[];
  readonly skins?: readonly StudioVrmExportSkin[];
  readonly materials?: readonly StudioVrmExportMaterial[];
  readonly textures?: readonly StudioVrmExportTexture[];
  readonly samplers?: readonly StudioVrmExportSampler[];
  readonly images?: readonly StudioVrmExportImage[];
  readonly expressions?: StudioVrmExportExpressions;
  readonly firstPerson?: readonly StudioVrmExportFirstPersonAnnotation[];
  readonly springBone?: StudioVrmExportSpringBoneConfig;
}

export interface StudioVrmExportStats {
  readonly nodes: number;
  readonly meshes: number;
  readonly primitives: number;
  readonly accessors: number;
  readonly bufferViews: number;
  readonly materials: number;
  readonly textures: number;
  readonly images: number;
  readonly skins: number;
  readonly morphTargets: number;
  readonly springs: number;
  readonly binByteLength: number;
  readonly extensionsUsed: readonly string[];
}

export interface StudioVrmExportPlan {
  readonly json: Record<string, unknown>;
  readonly binary: Uint8Array<ArrayBuffer>;
  readonly layout: StudioVrmExportGlbLayout;
  readonly stats: StudioVrmExportStats;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime "this really is an object" guard that deliberately does **not** narrow the argument:
 * narrowing a typed snapshot field to `Record<string, unknown>` would erase the declared member
 * types the rest of the planner depends on.
 */
type ShapeFailureCode =
  | "invalid-snapshot"
  | "mesh-invalid"
  | "material-invalid"
  | "texture-invalid"
  | "image-invalid"
  | "skin-invalid"
  | "node-tree-invalid";

function assertRecord(value: unknown, code: ShapeFailureCode): void {
  if (!isRecord(value)) throw studioVrmExportError(code);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIndex(value: unknown, exclusiveMax: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < exclusiveMax
  );
}

function optionalName(value: unknown, code: "invalid-snapshot" | "material-invalid"): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw studioVrmExportError(code);
  const normalized = value.normalize("NFC").trim();
  return normalized.length > 0 ? normalized.slice(0, 256) : undefined;
}

function readNumbers(source: unknown, code: "mesh-invalid" | "skin-invalid"): Float32Array {
  if (source instanceof Float32Array) return Float32Array.from(source);
  if (source instanceof Float64Array) return Float32Array.from(source);
  if (!Array.isArray(source)) throw studioVrmExportError(code);
  const result = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index];
    if (!isFiniteNumber(value)) throw studioVrmExportError(code);
    result[index] = value;
  }
  return result;
}

function readIndices(source: unknown, vertexCount: number): Uint32Array {
  const typed =
    source instanceof Uint8Array || source instanceof Uint16Array || source instanceof Uint32Array
      ? source
      : Array.isArray(source)
        ? (source as readonly number[])
        : null;
  if (!typed) throw studioVrmExportError("mesh-invalid");
  const length = typed.length;
  const result = new Uint32Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = typed[index];
    if (!isIndex(value, vertexCount)) throw studioVrmExportError("mesh-invalid");
    result[index] = value;
  }
  return result;
}

function readJoints(source: unknown, jointCount: number): Uint16Array {
  const typed =
    source instanceof Uint16Array ? source : Array.isArray(source) ? (source as readonly number[]) : null;
  if (!typed) throw studioVrmExportError("mesh-invalid");
  const result = new Uint16Array(typed.length);
  for (let index = 0; index < typed.length; index += 1) {
    const value = typed[index];
    if (!isIndex(value, Math.max(jointCount, 1))) throw studioVrmExportError("mesh-invalid");
    result[index] = value;
  }
  return result;
}

function float32Bytes(values: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(values.byteLength);
  const view = new DataView(bytes.buffer);
  // Explicit little-endian writes: glTF mandates LE and the host may be big-endian.
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(index * 4, values[index] as number, true);
  }
  return bytes;
}

function uint16Bytes(values: Uint16Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(values.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setUint16(index * 2, values[index] as number, true);
  }
  return bytes;
}

function uint32Bytes(values: Uint32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(values.byteLength);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setUint32(index * 4, values[index] as number, true);
  }
  return bytes;
}

function componentMinMax(values: Float32Array, components: number): {
  readonly min: number[];
  readonly max: number[];
} {
  const min = new Array<number>(components).fill(Number.POSITIVE_INFINITY);
  const max = new Array<number>(components).fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < values.length; index += 1) {
    const slot = index % components;
    const value = values[index] as number;
    if (value < (min[slot] as number)) min[slot] = value;
    if (value > (max[slot] as number)) max[slot] = value;
  }
  return { min, max };
}

class GltfBufferPacker {
  private readonly chunks: Uint8Array[] = [];
  private cursor = 0;
  readonly bufferViews: Record<string, unknown>[] = [];
  readonly accessors: Record<string, unknown>[] = [];

  pushView(data: Uint8Array, target?: number): number {
    if (data.byteLength === 0) throw studioVrmExportError("accessor-empty");
    // Every view starts 4-byte aligned, which satisfies the alignment rule for every component
    // type glTF allows (1, 2 and 4 byte components) without per-accessor arithmetic.
    const padding = (4 - (this.cursor % 4)) % 4;
    if (padding > 0) {
      this.chunks.push(new Uint8Array(padding));
      this.cursor += padding;
    }
    const byteOffset = this.cursor;
    this.chunks.push(data);
    this.cursor += data.byteLength;
    const view: Record<string, unknown> = { buffer: 0, byteLength: data.byteLength };
    if (byteOffset > 0) view.byteOffset = byteOffset;
    if (target !== undefined) view.target = target;
    this.bufferViews.push(view);
    return this.bufferViews.length - 1;
  }

  pushAccessor(accessor: Record<string, unknown>): number {
    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }

  get byteLength(): number {
    return this.cursor;
  }

  concat(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.cursor);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}

function pushFloatAccessor(
  packer: GltfBufferPacker,
  values: Float32Array,
  components: number,
  type: "VEC2" | "VEC3" | "VEC4" | "MAT4",
  options: { readonly target?: number; readonly withBounds?: boolean },
  code: "mesh-invalid" | "skin-invalid",
): number {
  if (values.length === 0 || values.length % components !== 0) {
    throw studioVrmExportError(values.length === 0 ? "accessor-empty" : code);
  }
  const count = values.length / components;
  const bufferView = packer.pushView(float32Bytes(values), options.target);
  const accessor: Record<string, unknown> = {
    bufferView,
    componentType: COMPONENT_FLOAT,
    count,
    type,
  };
  if (options.withBounds) {
    const bounds = componentMinMax(values, components);
    accessor.min = bounds.min;
    accessor.max = bounds.max;
  }
  return packer.pushAccessor(accessor);
}

interface PlannedMesh {
  readonly def: Record<string, unknown>;
  readonly morphTargetCount: number;
  readonly primitiveCount: number;
}

function planPrimitive(
  packer: GltfBufferPacker,
  primitive: StudioVrmExportPrimitive,
  materialCount: number,
  skinJointCount: number,
): { readonly def: Record<string, unknown>; readonly targetCount: number } {
  assertRecord(primitive, "mesh-invalid");
  const positions = readNumbers(primitive.positions, "mesh-invalid");
  if (positions.length === 0) throw studioVrmExportError("accessor-empty");
  if (positions.length % 3 !== 0) throw studioVrmExportError("accessor-length-mismatch");
  const vertexCount = positions.length / 3;
  if (vertexCount > STUDIO_VRM_EXPORT_MAX_VERTICES_PER_PRIMITIVE) {
    throw studioVrmExportError("mesh-invalid", { vertexCount });
  }

  const attributes: Record<string, number> = {
    POSITION: pushFloatAccessor(
      packer,
      positions,
      3,
      "VEC3",
      { target: GLTF_ARRAY_BUFFER, withBounds: true },
      "mesh-invalid",
    ),
  };

  if (primitive.normals !== undefined) {
    const normals = readNumbers(primitive.normals, "mesh-invalid");
    if (normals.length !== positions.length) throw studioVrmExportError("accessor-length-mismatch");
    attributes.NORMAL = pushFloatAccessor(
      packer,
      normals,
      3,
      "VEC3",
      { target: GLTF_ARRAY_BUFFER },
      "mesh-invalid",
    );
  }
  if (primitive.uvs !== undefined) {
    const uvs = readNumbers(primitive.uvs, "mesh-invalid");
    if (uvs.length !== vertexCount * 2) throw studioVrmExportError("accessor-length-mismatch");
    attributes.TEXCOORD_0 = pushFloatAccessor(
      packer,
      uvs,
      2,
      "VEC2",
      { target: GLTF_ARRAY_BUFFER },
      "mesh-invalid",
    );
  }
  if (primitive.joints !== undefined || primitive.weights !== undefined) {
    if (primitive.joints === undefined || primitive.weights === undefined) {
      throw studioVrmExportError("mesh-invalid");
    }
    const joints = readJoints(primitive.joints, skinJointCount);
    const weights = readNumbers(primitive.weights, "mesh-invalid");
    if (joints.length !== vertexCount * 4 || weights.length !== vertexCount * 4) {
      throw studioVrmExportError("accessor-length-mismatch");
    }
    const jointsView = packer.pushView(uint16Bytes(joints), GLTF_ARRAY_BUFFER);
    attributes.JOINTS_0 = packer.pushAccessor({
      bufferView: jointsView,
      componentType: COMPONENT_UNSIGNED_SHORT,
      count: vertexCount,
      type: "VEC4",
    });
    attributes.WEIGHTS_0 = pushFloatAccessor(
      packer,
      weights,
      4,
      "VEC4",
      { target: GLTF_ARRAY_BUFFER },
      "mesh-invalid",
    );
  }

  const def: Record<string, unknown> = { attributes };

  if (primitive.indices !== undefined) {
    const indices = readIndices(primitive.indices, vertexCount);
    if (indices.length === 0) throw studioVrmExportError("accessor-empty");
    if (indices.length % 3 !== 0) throw studioVrmExportError("accessor-length-mismatch");
    const useShort = vertexCount < UNSIGNED_SHORT_LIMIT;
    const bufferView = packer.pushView(
      useShort ? uint16Bytes(Uint16Array.from(indices)) : uint32Bytes(indices),
      GLTF_ELEMENT_ARRAY_BUFFER,
    );
    def.indices = packer.pushAccessor({
      bufferView,
      componentType: useShort ? COMPONENT_UNSIGNED_SHORT : COMPONENT_UNSIGNED_INT,
      count: indices.length,
      type: "SCALAR",
    });
  }

  if (primitive.material !== undefined) {
    if (!isIndex(primitive.material, materialCount)) throw studioVrmExportError("material-invalid");
    def.material = primitive.material;
  }

  let targetCount = 0;
  if (primitive.targets !== undefined) {
    if (!Array.isArray(primitive.targets)) throw studioVrmExportError("mesh-invalid");
    if (primitive.targets.length > STUDIO_VRM_EXPORT_MAX_MORPH_TARGETS_PER_MESH) {
      throw studioVrmExportError("mesh-invalid");
    }
    const targets = primitive.targets.map((target) => {
      assertRecord(target, "mesh-invalid");
      const targetPositions = readNumbers(target.positions, "mesh-invalid");
      if (targetPositions.length !== positions.length) {
        throw studioVrmExportError("accessor-length-mismatch");
      }
      const entry: Record<string, number> = {
        POSITION: pushFloatAccessor(
          packer,
          targetPositions,
          3,
          "VEC3",
          { target: GLTF_ARRAY_BUFFER, withBounds: true },
          "mesh-invalid",
        ),
      };
      if (target.normals !== undefined) {
        const targetNormals = readNumbers(target.normals, "mesh-invalid");
        if (targetNormals.length !== positions.length) {
          throw studioVrmExportError("accessor-length-mismatch");
        }
        entry.NORMAL = pushFloatAccessor(
          packer,
          targetNormals,
          3,
          "VEC3",
          { target: GLTF_ARRAY_BUFFER },
          "mesh-invalid",
        );
      }
      return entry;
    });
    if (targets.length > 0) {
      def.targets = targets;
      targetCount = targets.length;
    }
  }

  return { def, targetCount };
}

function planMesh(
  packer: GltfBufferPacker,
  mesh: StudioVrmExportMesh,
  materialCount: number,
  skinJointCount: number,
): PlannedMesh {
  assertRecord(mesh, "mesh-invalid");
  if (!Array.isArray(mesh.primitives) || mesh.primitives.length === 0) {
    throw studioVrmExportError("mesh-invalid");
  }
  if (mesh.primitives.length > STUDIO_VRM_EXPORT_MAX_MESH_PRIMITIVES) {
    throw studioVrmExportError("mesh-invalid");
  }
  const primitives: Record<string, unknown>[] = [];
  let morphTargetCount: number | null = null;
  for (const primitive of mesh.primitives) {
    const planned = planPrimitive(packer, primitive, materialCount, skinJointCount);
    // glTF requires every primitive of one mesh to expose the same morph-target count; the studio's
    // own GLB validator enforces it too, so reject here rather than shipping an unloadable file.
    if (morphTargetCount === null) morphTargetCount = planned.targetCount;
    else if (morphTargetCount !== planned.targetCount) throw studioVrmExportError("mesh-invalid");
    primitives.push(planned.def);
  }
  const targetCount = morphTargetCount ?? 0;
  const def: Record<string, unknown> = { primitives };
  const name = optionalName(mesh.name, "invalid-snapshot");
  if (name !== undefined) def.name = name;
  if (targetCount > 0) def.weights = new Array<number>(targetCount).fill(0);
  const targetNames = collectTargetNames(mesh, targetCount);
  if (targetNames) def.extras = { targetNames };
  return { def, morphTargetCount: targetCount, primitiveCount: primitives.length };
}

function collectTargetNames(mesh: StudioVrmExportMesh, targetCount: number): string[] | null {
  if (targetCount === 0) return null;
  const first = mesh.primitives[0];
  const targets = first?.targets;
  if (!targets || targets.length !== targetCount) return null;
  const names = targets.map((target, index) => optionalName(target.name, "invalid-snapshot") ?? `target_${index}`);
  return names.some((name, index) => name !== `target_${index}`) ? names : null;
}

interface ValidatedNodes {
  readonly defs: Record<string, unknown>[];
  readonly roots: number[];
}

function validateNodeTree(
  snapshot: StudioVrmExportSceneSnapshot,
  meshCount: number,
  skinCount: number,
  skinHasMesh: (nodeIndex: number) => boolean,
): ValidatedNodes {
  const nodes = snapshot.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) throw studioVrmExportError("node-tree-invalid");
  if (nodes.length > STUDIO_VRM_EXPORT_MAX_NODES) {
    throw studioVrmExportError("node-tree-invalid", { nodeCount: nodes.length });
  }

  const parentOf = new Array<number>(nodes.length).fill(-1);
  const defs: Record<string, unknown>[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    assertRecord(node, "node-tree-invalid");
    const def: Record<string, unknown> = {};
    const name = optionalName(node.name, "invalid-snapshot");
    if (name !== undefined) def.name = name;
    if (node.translation !== undefined) def.translation = readVector(node.translation, 3);
    if (node.rotation !== undefined) def.rotation = readVector(node.rotation, 4);
    if (node.scale !== undefined) def.scale = readVector(node.scale, 3);
    if (node.mesh !== undefined) {
      if (!isIndex(node.mesh, meshCount)) throw studioVrmExportError("node-tree-invalid", { node: index });
      def.mesh = node.mesh;
    }
    if (node.skin !== undefined) {
      // The studio's GLB validator rejects `node.skin` without `node.mesh`; so does glTF 2.0.
      if (!isIndex(node.skin, skinCount) || !skinHasMesh(index)) {
        throw studioVrmExportError("skin-invalid", { node: index });
      }
      def.skin = node.skin;
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw studioVrmExportError("node-tree-invalid", { node: index });
      const seen = new Set<number>();
      for (const child of node.children) {
        if (!isIndex(child, nodes.length) || child === index || seen.has(child)) {
          throw studioVrmExportError("node-tree-invalid", { node: index });
        }
        // A glTF node graph is a forest: a node may appear as a child exactly once.
        if (parentOf[child] !== -1) throw studioVrmExportError("node-tree-invalid", { node: child });
        parentOf[child] = index;
        seen.add(child);
      }
      if (node.children.length > 0) def.children = [...node.children];
    }
    defs.push(def);
  }

  assertNoNodeCycle(parentOf);

  const roots =
    snapshot.roots === undefined
      ? parentOf.reduce<number[]>((accumulator, parent, index) => {
          if (parent === -1) accumulator.push(index);
          return accumulator;
        }, [])
      : readRoots(snapshot.roots, nodes.length, parentOf);
  if (roots.length === 0) throw studioVrmExportError("scene-root-invalid");
  return { defs, roots };
}

function readRoots(
  roots: readonly number[],
  nodeCount: number,
  parentOf: readonly number[],
): number[] {
  if (!Array.isArray(roots) || roots.length === 0) throw studioVrmExportError("scene-root-invalid");
  const seen = new Set<number>();
  for (const root of roots) {
    if (!isIndex(root, nodeCount) || seen.has(root) || parentOf[root] !== -1) {
      throw studioVrmExportError("scene-root-invalid", { root });
    }
    seen.add(root);
  }
  return [...roots];
}

function assertNoNodeCycle(parentOf: readonly number[]): void {
  // Every node has at most one parent, so a cycle is a closed parent chain. Walking upward with a
  // step budget detects it in O(n) total without recursion.
  const state = new Int8Array(parentOf.length);
  for (let index = 0; index < parentOf.length; index += 1) {
    if (state[index] !== 0) continue;
    const path: number[] = [];
    let cursor = index;
    while (cursor !== -1 && state[cursor] === 0) {
      state[cursor] = 1;
      path.push(cursor);
      cursor = parentOf[cursor] as number;
    }
    if (cursor !== -1 && state[cursor] === 1) throw studioVrmExportError("node-cycle", { node: cursor });
    for (const visited of path) state[visited] = 2;
  }
}

function readVector(value: unknown, length: 3 | 4): number[] {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => !isFiniteNumber(entry))) {
    throw studioVrmExportError("node-tree-invalid");
  }
  return value.map((entry) => entry as number);
}

function planMaterials(
  materials: readonly StudioVrmExportMaterial[],
  textureCount: number,
): { readonly defs: Record<string, unknown>[]; readonly usesMToon: boolean } {
  let usesMToon = false;
  const defs = materials.map((material) => {
    assertRecord(material, "material-invalid");
    const pbr: Record<string, unknown> = {};
    if (material.baseColorFactor !== undefined) {
      pbr.baseColorFactor = readFactor(material.baseColorFactor, 4);
    }
    if (material.baseColorTexture !== undefined) {
      if (!isIndex(material.baseColorTexture, textureCount)) {
        throw studioVrmExportError("texture-invalid");
      }
      pbr.baseColorTexture = { index: material.baseColorTexture };
    }
    if (material.metallicFactor !== undefined) {
      pbr.metallicFactor = readUnit(material.metallicFactor);
    }
    if (material.roughnessFactor !== undefined) {
      pbr.roughnessFactor = readUnit(material.roughnessFactor);
    }

    const def: Record<string, unknown> = {};
    const name = optionalName(material.name, "material-invalid");
    if (name !== undefined) def.name = name;
    if (Object.keys(pbr).length > 0) def.pbrMetallicRoughness = pbr;
    if (material.emissiveFactor !== undefined) {
      def.emissiveFactor = readFactor(material.emissiveFactor, 3);
    }
    if (material.alphaMode !== undefined) {
      if (
        material.alphaMode !== "OPAQUE" &&
        material.alphaMode !== "MASK" &&
        material.alphaMode !== "BLEND"
      ) {
        throw studioVrmExportError("material-invalid");
      }
      def.alphaMode = material.alphaMode;
    }
    if (material.alphaCutoff !== undefined) def.alphaCutoff = readUnit(material.alphaCutoff);
    if (material.doubleSided !== undefined) {
      if (typeof material.doubleSided !== "boolean") throw studioVrmExportError("material-invalid");
      def.doubleSided = material.doubleSided;
    }
    if (material.mtoon !== undefined) {
      def.extensions = {
        [STUDIO_VRM_EXPORT_MTOON_EXTENSION]: buildStudioVrmcMToonExtension(material.mtoon),
      };
      usesMToon = true;
    }
    return def;
  });
  return { defs, usesMToon };
}

function readFactor(value: unknown, length: 3 | 4): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some((entry) => !isFiniteNumber(entry) || entry < 0 || entry > 1)
  ) {
    throw studioVrmExportError("material-invalid");
  }
  return value.map((entry) => entry as number);
}

function readUnit(value: unknown): number {
  if (!isFiniteNumber(value) || value < 0 || value > 1) throw studioVrmExportError("material-invalid");
  return value;
}

const IMAGE_MIME_TYPES = new Set<string>(["image/png", "image/jpeg", "image/webp"]);

function planImages(
  packer: GltfBufferPacker,
  images: readonly StudioVrmExportImage[],
): Record<string, unknown>[] {
  return images.map((image) => {
    assertRecord(image, "image-invalid");
    if (
      typeof image.mimeType !== "string" ||
      !IMAGE_MIME_TYPES.has(image.mimeType) ||
      !(image.bytes instanceof Uint8Array) ||
      image.bytes.byteLength === 0
    ) {
      throw studioVrmExportError("image-invalid");
    }
    const bufferView = packer.pushView(Uint8Array.from(image.bytes));
    const def: Record<string, unknown> = { bufferView, mimeType: image.mimeType };
    const name = optionalName(image.name, "invalid-snapshot");
    if (name !== undefined) def.name = name;
    return def;
  });
}

function planSkins(
  packer: GltfBufferPacker,
  skins: readonly StudioVrmExportSkin[],
  nodeCount: number,
): Record<string, unknown>[] {
  return skins.map((skin) => {
    assertRecord(skin, "skin-invalid");
    if (!Array.isArray(skin.joints) || skin.joints.length === 0) {
      throw studioVrmExportError("skin-invalid");
    }
    const seen = new Set<number>();
    for (const joint of skin.joints) {
      if (!isIndex(joint, nodeCount) || seen.has(joint)) throw studioVrmExportError("skin-invalid");
      seen.add(joint);
    }
    const def: Record<string, unknown> = { joints: [...skin.joints] };
    if (skin.skeleton !== undefined) {
      if (!isIndex(skin.skeleton, nodeCount)) throw studioVrmExportError("skin-invalid");
      def.skeleton = skin.skeleton;
    }
    if (skin.inverseBindMatrices !== undefined) {
      const matrices = readNumbers(skin.inverseBindMatrices, "skin-invalid");
      if (matrices.length !== skin.joints.length * 16) throw studioVrmExportError("skin-invalid");
      def.inverseBindMatrices = pushFloatAccessor(
        packer,
        matrices,
        16,
        "MAT4",
        {},
        "skin-invalid",
      );
    }
    return def;
  });
}

/**
 * Produces the glTF JSON root and packed BIN payload for a snapshot. Deterministic: the same input
 * always yields the same JSON object graph and the same bytes.
 */
export function planStudioVrmExport(snapshot: StudioVrmExportSceneSnapshot): StudioVrmExportPlan {
  assertRecord(snapshot, "invalid-snapshot");

  const materials = snapshot.materials ?? [];
  const textures = snapshot.textures ?? [];
  const samplers = snapshot.samplers ?? [];
  const images = snapshot.images ?? [];
  const meshes = snapshot.meshes ?? [];
  const skins = snapshot.skins ?? [];
  if (
    !Array.isArray(materials) ||
    !Array.isArray(textures) ||
    !Array.isArray(samplers) ||
    !Array.isArray(images) ||
    !Array.isArray(meshes) ||
    !Array.isArray(skins)
  ) {
    throw studioVrmExportError("invalid-snapshot");
  }

  const packer = new GltfBufferPacker();
  // Images are packed first so texture-heavy documents keep a stable prefix even when geometry
  // changes; the ordering is arbitrary but must be fixed for byte determinism.
  const imageDefs = planImages(packer, images);

  const samplerDefs = samplers.map((sampler) => {
    assertRecord(sampler, "texture-invalid");
    const def: Record<string, unknown> = {};
    for (const key of ["magFilter", "minFilter", "wrapS", "wrapT"] as const) {
      const value = sampler[key];
      if (value === undefined) continue;
      if (!Number.isSafeInteger(value) || value < 0) {
        throw studioVrmExportError("texture-invalid");
      }
      def[key] = value;
    }
    return def;
  });

  const textureDefs = textures.map((texture) => {
    assertRecord(texture, "texture-invalid");
    if (!isIndex(texture.source, imageDefs.length)) {
      throw studioVrmExportError("texture-invalid");
    }
    const def: Record<string, unknown> = { source: texture.source };
    if (texture.sampler !== undefined) {
      if (!isIndex(texture.sampler, samplerDefs.length)) throw studioVrmExportError("texture-invalid");
      def.sampler = texture.sampler;
    }
    return def;
  });

  const { defs: materialDefs, usesMToon } = planMaterials(materials, textureDefs.length);

  const totalSkinJoints = skins.reduce(
    (total, skin) => Math.max(total, Array.isArray(skin?.joints) ? skin.joints.length : 0),
    0,
  );
  const plannedMeshes = meshes.map((mesh) => planMesh(packer, mesh, materialDefs.length, totalSkinJoints));
  const meshDefs = plannedMeshes.map((planned) => planned.def);

  const nodeSkinTargets = new Set<number>();
  if (Array.isArray(snapshot.nodes)) {
    snapshot.nodes.forEach((node, index) => {
      if (isRecord(node) && node.mesh !== undefined) nodeSkinTargets.add(index);
    });
  }
  const { defs: nodeDefs, roots } = validateNodeTree(
    snapshot,
    meshDefs.length,
    skins.length,
    (nodeIndex) => nodeSkinTargets.has(nodeIndex),
  );
  const skinDefs = planSkins(packer, skins, nodeDefs.length);

  const morphTargetCountByNode = nodeDefs.map((node) => {
    const meshIndex = node.mesh;
    return typeof meshIndex === "number" ? (plannedMeshes[meshIndex]?.morphTargetCount ?? 0) : null;
  });
  const context: StudioVrmExtensionContext = {
    nodeCount: nodeDefs.length,
    imageCount: imageDefs.length,
    morphTargetCountByNode,
  };

  const vrmExtension = buildStudioVrmcVrmExtension({
    meta: snapshot.meta,
    humanoidBones: snapshot.humanoidBones,
    expressions: snapshot.expressions,
    firstPerson: snapshot.firstPerson,
    context,
  });
  const springBoneExtension = buildStudioVrmcSpringBoneExtension(snapshot.springBone, context);

  const extensionsUsed = new Set<string>([STUDIO_VRM_EXPORT_VRM_EXTENSION]);
  if (springBoneExtension) extensionsUsed.add(STUDIO_VRM_EXPORT_SPRING_BONE_EXTENSION);
  if (usesMToon) extensionsUsed.add(STUDIO_VRM_EXPORT_MTOON_EXTENSION);

  const binary = packer.concat();
  const rootExtensions: Record<string, unknown> = {
    [STUDIO_VRM_EXPORT_VRM_EXTENSION]: vrmExtension,
  };
  if (springBoneExtension) {
    rootExtensions[STUDIO_VRM_EXPORT_SPRING_BONE_EXTENSION] = springBoneExtension;
  }

  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: STUDIO_VRM_EXPORT_GENERATOR },
    // Sorted, de-duplicated: `validateStudioBg3dGlb` fails a document whose `extensionsUsed`
    // repeats a name. `extensionsRequired` is deliberately never emitted — a VRM must stay
    // loadable by a plain glTF viewer, and a required extension outside the studio's allowlist
    // would be rejected by the app's own importer.
    extensionsUsed: [...extensionsUsed].sort(),
    extensions: rootExtensions,
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes: nodeDefs,
  };
  if (meshDefs.length > 0) json.meshes = meshDefs;
  if (skinDefs.length > 0) json.skins = skinDefs;
  if (materialDefs.length > 0) json.materials = materialDefs;
  if (textureDefs.length > 0) json.textures = textureDefs;
  if (samplerDefs.length > 0) json.samplers = samplerDefs;
  if (imageDefs.length > 0) json.images = imageDefs;
  if (packer.accessors.length > 0) json.accessors = packer.accessors;
  if (packer.bufferViews.length > 0) json.bufferViews = packer.bufferViews;
  // `buffers: []` is mandatory when nothing is embedded: the studio validator rejects a document
  // with buffer views or a BIN chunk but no buffer, and equally rejects a declared buffer with no
  // BIN chunk behind it.
  if (binary.byteLength > 0) json.buffers = [{ byteLength: binary.byteLength }];

  const morphTargets = plannedMeshes.reduce(
    (total, planned) => total + planned.morphTargetCount * planned.primitiveCount,
    0,
  );
  const springs = Array.isArray(
    (springBoneExtension as { springs?: readonly unknown[] } | undefined)?.springs,
  )
    ? ((springBoneExtension as { springs: readonly unknown[] }).springs.length)
    : 0;

  return Object.freeze({
    json,
    binary,
    layout: planStudioVrmExportGlbLayout(
      measureJsonByteLength(json),
      binary.byteLength,
    ),
    stats: Object.freeze({
      nodes: nodeDefs.length,
      meshes: meshDefs.length,
      primitives: plannedMeshes.reduce((total, planned) => total + planned.primitiveCount, 0),
      accessors: packer.accessors.length,
      bufferViews: packer.bufferViews.length,
      materials: materialDefs.length,
      textures: textureDefs.length,
      images: imageDefs.length,
      skins: skinDefs.length,
      morphTargets,
      springs,
      binByteLength: binary.byteLength,
      extensionsUsed: Object.freeze([...extensionsUsed].sort()),
    }),
  });
}

function measureJsonByteLength(json: Record<string, unknown>): number {
  // Reuses the writer's canonical serializer so the planned layout matches the emitted file byte
  // for byte; a second, looser stringify here would silently drift.
  return new TextEncoder().encode(canonicalStudioVrmExportJsonText(json)).byteLength;
}

/** Serializes a snapshot straight to VRM (GLB) bytes. */
export function serializeStudioVrmExport(
  snapshot: StudioVrmExportSceneSnapshot,
): Uint8Array<ArrayBuffer> {
  const plan = planStudioVrmExport(snapshot);
  return writeStudioVrmExportGlb({ json: plan.json, binary: plan.binary });
}
