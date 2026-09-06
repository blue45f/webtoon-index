/**
 * Babylon implementation of the renderer-neutral Studio BG3D capture boundary.
 *
 * This module is reachable only from `studio-bg3d-babylon-specialist-entry.ts`, which is itself
 * loaded by one explicit dynamic import. Keep every Babylon import inside that static closure.
 */

import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import {
  ImportMeshAsync,
  RegisterSceneLoaderPlugin,
  type ISceneLoaderAsyncResult,
  type ImportMeshOptions,
} from "@babylonjs/core/Loading/sceneLoader";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { Material } from "@babylonjs/core/Materials/material";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/instancedMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import { registerBuiltInGLTFExtensions } from "@babylonjs/loaders/glTF/2.0/Extensions/dynamic";
import { RegisterGLTF2Loader } from "@babylonjs/loaders/glTF/2.0/glTFLoader.pure";
import {
  GLTFFileLoader,
  GLTFLoaderAnimationStartMode,
} from "@babylonjs/loaders/glTF/glTFFileLoader.pure";

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
  STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
  STUDIO_BG3D_NORMAL_PACKING,
  STUDIO_BG3D_NORMAL_PROFILE,
  STUDIO_BG3D_STABLE_ID_PROFILE,
  type StudioBg3dArtifactCaptureResultV2,
  type StudioBg3dStableIdLegendEntry,
} from "./studio-bg3d-artifact-capture-v2";
import {
  captureStudioBg3dBabylonNormals,
  StudioBg3dBabylonNormalCaptureError,
} from "./studio-bg3d-babylon-normal-capture";
import {
  StudioBg3dBabylonSpecialistError,
  type StudioBg3dBabylonSpecialistExecutionContext,
  type StudioBg3dBabylonSpecialistExecutor,
} from "./studio-bg3d-babylon-specialist-runtime";
import {
  captureStudioBg3dBabylonStableIds,
  StudioBg3dBabylonStableIdCaptureError,
  type StudioBg3dBabylonStableIdRenderable,
} from "./studio-bg3d-babylon-stable-id-capture";
import { resolveStudioBg3dCameraNearClip, resolveStudioBg3dCameraUpVector } from "./studio-bg3d-camera-orientation";
import { parseStudioBg3dSceneDocument } from "./studio-bg3d-scene-document";

import type { StudioBg3dStableIdDescriptor } from "./studio-bg3d-babylon-stable-id-packing";
import type {
  StudioBg3dRuntimeAdapterJob,
  StudioBg3dSpecialistResult,
} from "./studio-bg3d-runtime-adapter";
import type {
  StudioBg3dMaterialOverride,
  StudioBg3dModelNode,
  StudioBg3dPrimitiveKind,
  StudioBg3dSceneBudgets,
  StudioBg3dSceneDocument,
  StudioBg3dSceneNode,
} from "./studio-bg3d-scene-document";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Light } from "@babylonjs/core/Lights/light";
import type { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Geometry } from "@babylonjs/core/Meshes/geometry";
import type { MorphTargetManager } from "@babylonjs/core/Morph/morphTargetManager";
import type { Node } from "@babylonjs/core/node";
import type { IParticleSystem } from "@babylonjs/core/Particles/IParticleSystem";
import type { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import type { Scene } from "@babylonjs/core/scene";
import type { ISpriteManager } from "@babylonjs/core/Sprites/spriteManager";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const MAX_GLB_JSON_BYTES = 4 * 1024 * 1024;
const MAX_CAPTURE_WAIT_MS = 60_000;
const MAX_POST_PARSE_DECODE_AMPLIFICATION = 4;
const MAX_BABYLON_VERTEX_KINDS = 64;
const MAX_BABYLON_TEXTURE_MIP_LEVELS = 32;
const GLTF_NODE_POINTER_PATTERN = /^\/nodes\/(0|[1-9]\d*)$/;
const GLTF_PRIMITIVE_POINTER_PATTERN =
  /^\/meshes\/(0|[1-9]\d*)\/primitives\/(0|[1-9]\d*)$/;
const GLTF_MATERIAL_POINTER_PATTERN = /^\/materials\/(0|[1-9]\d*)$/;
const CAMERA_FAR_CLIP = 200;
const MODEL_AUTO_FIT_SIZE = 2;
const FLOAT_TOLERANCE = 1e-5;
const STABLE_ID_LEGEND_LABEL_MAX_LENGTH = 160;

const UNSUPPORTED_DECODER_EXTENSIONS = new Set([
  "EXT_meshopt_compression",
  "KHR_draco_mesh_compression",
  "KHR_texture_basisu",
]);
const BUDGET_STABLE_CAPTURE_EXTENSIONS = new Set([
  "KHR_lights_punctual",
  "KHR_materials_clearcoat",
  "KHR_materials_emissive_strength",
  "KHR_materials_ior",
  "KHR_materials_sheen",
  "KHR_materials_specular",
  "KHR_materials_transmission",
  "KHR_materials_unlit",
  "KHR_materials_volume",
]);

/**
 * Registration is intentionally explicit. The specialist accepts only GLB and never installs the
 * OBJ/STL/SPLAT loaders or Babylon's catch-all loader bundle.
 */
RegisterSceneLoaderPlugin(new GLTFFileLoader({
  animationStartMode: GLTFLoaderAnimationStartMode.NONE,
  compileMaterials: true,
  compileShadowGenerators: false,
}));
RegisterGLTF2Loader();
registerBuiltInGLTFExtensions();

export type StudioBg3dBabylonCaptureErrorCode =
  | "aborted"
  | "asset-mismatch"
  | "capture-failed"
  | "invalid-snapshot"
  | "renderer-unavailable"
  | "resource-budget-exceeded"
  | "timeout"
  | "unsafe-glb"
  | "unsupported-artifact"
  | "unsupported-scene-feature";

export type StudioBg3dBabylonReadbackStage = "beauty" | "depth";

export class StudioBg3dBabylonCaptureError extends Error {
  constructor(
    readonly code: StudioBg3dBabylonCaptureErrorCode,
    cause?: unknown,
    readonly stage?: StudioBg3dBabylonReadbackStage,
  ) {
    super(
      `Studio Babylon capture failed: ${code}${stage ? ` (${stage} readback)` : ""}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "StudioBg3dBabylonCaptureError";
  }
}

export interface StudioBg3dBabylonSerializedReadbackOptions<TBeauty, TDepth> {
  readonly beauty?: () => Promise<TBeauty>;
  readonly deadlineMs?: number;
  readonly depth?: () => Promise<TDepth>;
  readonly release: () => void;
  readonly signal: AbortSignal;
}

export interface StudioBg3dBabylonSerializedReadbackResult<TBeauty, TDepth> {
  readonly beauty?: TBeauty;
  readonly depth?: TDepth;
}

interface StudioBg3dBabylonCaptureAsset {
  readonly attachmentId: string;
  readonly bytes: Uint8Array;
  readonly footprint: GlbBudgetFootprint;
  readonly glbJson: Record<string, unknown>;
}

export type StudioBg3dBabylonMeshImporter = (
  source: Uint8Array,
  scene: Scene,
  options: ImportMeshOptions,
) => Promise<ISceneLoaderAsyncResult>;

export interface StudioBg3dBabylonPostParseReceipt {
  readonly accessorElements: number;
  readonly animationChannels: number;
  readonly animationKeyframes: number;
  readonly animationValues: number;
  readonly animations: number;
  readonly cameras: number;
  readonly decodedGeometryBytes: number;
  readonly drawCalls: number;
  readonly geometries: number;
  readonly joints: number;
  readonly lights: number;
  readonly materials: number;
  readonly meshes: number;
  readonly morphTargets: number;
  /** Logical glTF nodes after removing Babylon's one synthetic loader root. */
  readonly nodes: number;
  readonly particleSystems: number;
  readonly runtimeNodes: number;
  readonly skeletons: number;
  readonly spriteManagers: number;
  readonly textureBytes: number;
  readonly textureMipLevels: number;
  readonly textures: number;
  readonly maxTextureDimension: number;
  readonly triangles: number;
}

export interface StudioBg3dBabylonBoundedImportResult {
  readonly imported: ISceneLoaderAsyncResult;
  readonly receipt: StudioBg3dBabylonPostParseReceipt;
}

export interface StudioBg3dBabylonCapturePlan {
  readonly assets: readonly StudioBg3dBabylonCaptureAsset[];
  readonly backend: StudioBg3dBabylonSpecialistExecutionContext["backend"];
  readonly document: StudioBg3dSceneDocument;
  readonly height: number;
  readonly includeBeauty: boolean;
  readonly includeDepth: boolean;
  readonly includeMaterialId: boolean;
  readonly includeNormal: boolean;
  readonly includeObjectId: boolean;
  readonly width: number;
}

export interface StudioBg3dBabylonStableIdFrame {
  readonly data: Uint32Array;
  readonly legend: readonly StudioBg3dStableIdLegendEntry[];
}

export interface StudioBg3dBabylonCaptureFrame {
  /** Straight-alpha sRGB RGBA8 in top-down row order. */
  readonly rgba?: Uint8Array;
  /** Linear normalized view depth in top-down row order. */
  readonly depth?: Float32Array;
  /** Stable logical material IDs in top-down row order; zero is background. */
  readonly materialId?: StudioBg3dBabylonStableIdFrame;
  /** View-space right-handed octahedral RG8 in top-down row order. */
  readonly normal?: Uint8Array;
  /** Stable logical object IDs in top-down row order; zero is background. */
  readonly objectId?: StudioBg3dBabylonStableIdFrame;
}

export type StudioBg3dBabylonCaptureRenderer = (
  context: StudioBg3dBabylonSpecialistExecutionContext,
  plan: StudioBg3dBabylonCapturePlan,
) => Promise<StudioBg3dBabylonCaptureFrame>;

interface RequestedCapture {
  readonly format: "artifact-v2" | "capture";
  readonly height: number;
  readonly includeBeauty: boolean;
  readonly includeDepth: boolean;
  readonly includeMaterialId: boolean;
  readonly includeNormal: boolean;
  readonly includeObjectId: boolean;
  readonly width: number;
}

function captureError(
  code: StudioBg3dBabylonCaptureErrorCode,
  cause?: unknown,
): StudioBg3dBabylonCaptureError {
  return new StudioBg3dBabylonCaptureError(code, cause);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw captureError("aborted");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readGlbJson(bytes: Uint8Array): Record<string, unknown> {
  if (
    bytes.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES ||
    bytes.byteOffset !== 0 ||
    bytes.buffer.byteLength !== bytes.byteLength
  ) {
    throw captureError("unsafe-glb");
  }
  const view = new DataView(bytes.buffer);
  if (
    view.getUint32(0, true) !== GLB_MAGIC ||
    view.getUint32(4, true) !== GLB_VERSION ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    throw captureError("unsafe-glb");
  }
  const jsonByteLength = view.getUint32(GLB_HEADER_BYTES, true);
  const chunkType = view.getUint32(GLB_HEADER_BYTES + 4, true);
  if (
    chunkType !== GLB_JSON_CHUNK ||
    jsonByteLength < 2 ||
    jsonByteLength > MAX_GLB_JSON_BYTES ||
    GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + jsonByteLength > bytes.byteLength
  ) {
    throw captureError("unsafe-glb");
  }
  let decoded: unknown;
  try {
    const decodedJson = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes.subarray(
        GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES,
        GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES + jsonByteLength,
      ));
    let jsonEnd = decodedJson.length;
    while (jsonEnd > 0 && decodedJson.charCodeAt(jsonEnd - 1) === 0) jsonEnd -= 1;
    const json = decodedJson.slice(0, jsonEnd).trimEnd();
    decoded = JSON.parse(json) as unknown;
  } catch (error) {
    throw captureError("unsafe-glb", error);
  }
  if (!isPlainRecord(decoded)) throw captureError("unsafe-glb");
  return decoded;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function containsNestedUri(value: unknown): boolean {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    visited += 1;
    if (visited > 200_000) throw captureError("resource-budget-exceeded");
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isPlainRecord(current)) continue;
    for (const [key, nested] of Object.entries(current)) {
      if (key === "uri") return true;
      if (typeof nested === "object" && nested !== null) pending.push(nested);
    }
  }
  return false;
}

function assertOfflineCoreGlb(bytes: Uint8Array): Record<string, unknown> {
  const root = readGlbJson(bytes);
  const extensions = new Set([
    ...stringArray(root.extensionsUsed),
    ...stringArray(root.extensionsRequired),
  ]);
  if ([...extensions].some((extension) => UNSUPPORTED_DECODER_EXTENSIONS.has(extension))) {
    // Babylon decoder URLs/configuration are deliberately not allowed to escape the verified
    // snapshot boundary. Decoder-backed assets will be enabled only with locally attested bytes.
    throw captureError("unsupported-scene-feature");
  }
  if ([...extensions].some((extension) => !BUDGET_STABLE_CAPTURE_EXTENSIONS.has(extension))) {
    // Expansion/instancing/vendor extensions can make core-JSON budgets undercount the decoded
    // scene. Admit them only after Babylon post-parse metrics are part of the trusted receipt.
    throw captureError("unsupported-scene-feature");
  }
  if (containsNestedUri(root)) {
    // A verified GLB capture must be self-contained. This prevents an imported document from
    // initiating network/blob/file/data fetches from core fields or an extension payload.
    throw captureError("unsafe-glb");
  }
  if (recordArray(root.images).length > 0 || recordArray(root.textures).length > 0) {
    // Texture dimensions and decoded mip allocation are not represented in the current runtime
    // snapshot. Fail closed until those post-parse metrics are carried across the trust boundary.
    throw captureError("unsupported-scene-feature");
  }
  return root;
}

export interface GlbBudgetFootprint {
  readonly accessorElements: number;
  readonly animationChannels: number;
  readonly animationKeyframes: number;
  readonly animationValues: number;
  readonly animations: number;
  readonly decodedGeometryBytes: number;
  readonly drawCalls: number;
  readonly joints: number;
  readonly lights: number;
  /** Babylon material instances keyed by the glTF material/default slot and primitive draw mode. */
  readonly materialSlots: number;
  readonly materials: number;
  readonly morphTargets: number;
  readonly nodes: number;
  readonly skins: number;
  readonly textures: number;
  readonly triangles: number;
}

const GLTF_COMPONENT_BYTES: Readonly<Record<number, number>> = Object.freeze({
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
});

const GLTF_TYPE_COMPONENTS: Readonly<Record<string, number>> = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
});

function recordArray(value: unknown): readonly Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isPlainRecord)) {
    throw captureError("unsafe-glb");
  }
  return value;
}

function safeNonNegativeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw captureError("unsafe-glb");
  }
  return value;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw captureError("resource-budget-exceeded");
  }
  return result;
}

function safeMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw captureError("resource-budget-exceeded");
  }
  return result;
}

function accessorAt(
  accessors: readonly Record<string, unknown>[],
  index: unknown,
): Record<string, unknown> | null {
  return typeof index === "number" && Number.isSafeInteger(index) && index >= 0
    ? accessors[index] ?? null
    : null;
}

function accessorElementCount(
  accessors: readonly Record<string, unknown>[],
  index: unknown,
): number {
  const accessor = accessorAt(accessors, index);
  return accessor ? safeNonNegativeCount(accessor.count) : 0;
}

function primitiveTriangleCount(
  primitive: Record<string, unknown>,
  accessors: readonly Record<string, unknown>[],
): number {
  const attributes = isPlainRecord(primitive.attributes) ? primitive.attributes : {};
  const elementCount = "indices" in primitive
    ? accessorElementCount(accessors, primitive.indices)
    : accessorElementCount(accessors, attributes.POSITION);
  const mode = gltfPrimitiveMode(primitive);
  if (mode === 4) return Math.floor(elementCount / 3);
  if (mode === 5 || mode === 6) return Math.max(0, elementCount - 2);
  return 0;
}

function gltfPrimitiveMode(primitive: Record<string, unknown>): number {
  const mode = primitive.mode === undefined ? 4 : safeNonNegativeCount(primitive.mode);
  if (mode > 6) throw captureError("unsafe-glb");
  return mode;
}

function glbBudgetFootprint(root: Record<string, unknown>): GlbBudgetFootprint {
  const accessors = recordArray(root.accessors);
  const materials = recordArray(root.materials);
  const meshes = recordArray(root.meshes);
  const nodes = recordArray(root.nodes);
  let accessorElements = 0;
  let decodedGeometryBytes = 0;
  for (const accessor of accessors) {
    const count = safeNonNegativeCount(accessor.count);
    const componentBytes = typeof accessor.componentType === "number"
      ? GLTF_COMPONENT_BYTES[accessor.componentType]
      : undefined;
    const typeComponents = typeof accessor.type === "string"
      ? GLTF_TYPE_COMPONENTS[accessor.type]
      : undefined;
    if (!componentBytes || !typeComponents) throw captureError("unsafe-glb");
    accessorElements = safeAdd(accessorElements, count);
    decodedGeometryBytes = safeAdd(
      decodedGeometryBytes,
      safeMultiply(count, safeMultiply(componentBytes, typeComponents)),
    );
  }

  let triangles = 0;
  let drawCalls = 0;
  let morphTargets = 0;
  const materialSlots = new Set<string>();
  const meshDrawCalls: number[] = [];
  const meshMorphTargets: number[] = [];
  const meshTriangles: number[] = [];
  for (const mesh of meshes) {
    let currentDrawCalls = 0;
    let currentMorphTargets = 0;
    let currentTriangles = 0;
    for (const primitive of recordArray(mesh.primitives)) {
      const mode = gltfPrimitiveMode(primitive);
      const materialIndex = primitive.material === undefined
        ? "default"
        : safeNonNegativeCount(primitive.material);
      if (typeof materialIndex === "number" && materialIndex >= materials.length) {
        throw captureError("unsafe-glb");
      }
      materialSlots.add(`${materialIndex}:${mode}`);
      currentTriangles = safeAdd(
        currentTriangles,
        primitiveTriangleCount(primitive, accessors),
      );
      currentDrawCalls = safeAdd(currentDrawCalls, 1);
      currentMorphTargets = safeAdd(
        currentMorphTargets,
        recordArray(primitive.targets).length,
      );
    }
    meshTriangles.push(currentTriangles);
    meshDrawCalls.push(currentDrawCalls);
    meshMorphTargets.push(currentMorphTargets);
    triangles = safeAdd(triangles, currentTriangles);
    drawCalls = safeAdd(drawCalls, currentDrawCalls);
    morphTargets = safeAdd(morphTargets, currentMorphTargets);
  }

  // A core glTF mesh may be referenced by several nodes. Babylon renders each reference, while
  // sharing geometry through InstancedMesh where it is safe to do so. Keep the old all-mesh
  // definition total as a conservative floor, but also bound the actual node-expanded workload.
  let referencedTriangles = 0;
  let referencedDrawCalls = 0;
  let referencedMorphTargets = 0;
  for (const node of nodes) {
    if (node.mesh === undefined) continue;
    const meshIndex = safeNonNegativeCount(node.mesh);
    if (meshIndex >= meshes.length) throw captureError("unsafe-glb");
    referencedTriangles = safeAdd(referencedTriangles, meshTriangles[meshIndex] ?? 0);
    referencedDrawCalls = safeAdd(referencedDrawCalls, meshDrawCalls[meshIndex] ?? 0);
    referencedMorphTargets = safeAdd(
      referencedMorphTargets,
      meshMorphTargets[meshIndex] ?? 0,
    );
  }
  triangles = Math.max(triangles, referencedTriangles);
  drawCalls = Math.max(drawCalls, referencedDrawCalls);
  morphTargets = Math.max(morphTargets, referencedMorphTargets);

  let animationChannels = 0;
  let animationKeyframes = 0;
  let animationValues = 0;
  const animations = recordArray(root.animations);
  for (const animation of animations) {
    const samplers = recordArray(animation.samplers);
    animationChannels = safeAdd(animationChannels, recordArray(animation.channels).length);
    for (const sampler of samplers) {
      animationKeyframes = safeAdd(
        animationKeyframes,
        accessorElementCount(accessors, sampler.input),
      );
      const output = accessorAt(accessors, sampler.output);
      if (!output) continue;
      const outputCount = safeNonNegativeCount(output.count);
      const components = typeof output.type === "string"
        ? GLTF_TYPE_COMPONENTS[output.type]
        : undefined;
      if (!components) throw captureError("unsafe-glb");
      animationValues = safeAdd(animationValues, safeMultiply(outputCount, components));
    }
  }

  let joints = 0;
  const skins = recordArray(root.skins);
  for (const skin of skins) {
    if (!Array.isArray(skin.joints)) throw captureError("unsafe-glb");
    joints = safeAdd(joints, skin.joints.length);
  }
  const punctualLights = isPlainRecord(root.extensions) &&
    isPlainRecord(root.extensions.KHR_lights_punctual)
    ? recordArray(root.extensions.KHR_lights_punctual.lights).length
    : 0;

  return Object.freeze({
    accessorElements,
    animationChannels,
    animationKeyframes,
    animationValues,
    animations: animations.length,
    decodedGeometryBytes,
    drawCalls,
    joints,
    lights: punctualLights,
    materialSlots: materialSlots.size,
    materials: materials.length,
    morphTargets,
    nodes: nodes.length,
    skins: skins.length,
    textures: recordArray(root.textures).length,
    triangles,
  });
}

function assertPreParseBudgets(
  document: StudioBg3dSceneDocument,
  assets: readonly StudioBg3dBabylonCaptureAsset[],
): void {
  const assetById = new Map(assets.map((asset) => [asset.attachmentId, asset]));
  const totals: Record<keyof GlbBudgetFootprint, number> = {
    accessorElements: 0,
    animationChannels: 0,
    animationKeyframes: 0,
    animationValues: 0,
    animations: 0,
    decodedGeometryBytes: 0,
    drawCalls: 0,
    joints: 0,
    lights: 0,
    materialSlots: 0,
    materials: 0,
    morphTargets: 0,
    nodes: 0,
    skins: 0,
    textures: 0,
    triangles: 0,
  };
  for (const node of document.nodes) {
    if (node.kind !== "model") continue;
    const asset = assetById.get(node.attachmentId);
    if (!asset) throw captureError("asset-mismatch");
    for (const key of Object.keys(totals) as (keyof GlbBudgetFootprint)[]) {
      totals[key] = safeAdd(totals[key], asset.footprint[key]);
    }
  }
  const complexity = document.budgets.complexity;
  const textures = document.budgets.textures;
  if (
    totals.nodes > complexity.maxNodes ||
    totals.triangles > complexity.maxTriangles ||
    totals.drawCalls > complexity.maxDrawCalls ||
    Math.max(totals.materials, totals.materialSlots) > complexity.maxMaterials ||
    totals.lights > complexity.maxLights ||
    totals.animations > complexity.maxAnimations ||
    totals.animationChannels > complexity.maxAnimationChannels ||
    totals.animationKeyframes > complexity.maxAnimationKeyframes ||
    totals.animationValues > complexity.maxAnimationValues ||
    totals.skins > complexity.maxSkins ||
    totals.joints > complexity.maxJoints ||
    totals.morphTargets > complexity.maxMorphTargets ||
    totals.accessorElements > complexity.maxAccessorElements ||
    totals.decodedGeometryBytes > complexity.maxDecodedGeometryBytes ||
    totals.textures > textures.maxTextures
  ) {
    throw captureError("resource-budget-exceeded");
  }
}

function hasUnsupportedRigState(node: StudioBg3dModelNode): boolean {
  const animation = node.animation;
  if (
    animation &&
    (
      animation.playing ||
      animation.timeSeconds !== 0 ||
      animation.timeScale !== 1 ||
      animation.weight !== 1 ||
      animation.loop !== "repeat" ||
      animation.clipIndex !== 0
    )
  ) {
    return true;
  }
  return Boolean(
    (node.pose?.enabled && node.pose.weight > 0 && node.pose.joints.length > 0) ||
    (node.morph?.enabled && node.morph.weight > 0 && node.morph.targets.length > 0) ||
    (
      node.constraints?.enabled &&
      (node.constraints.aims.length > 0 || node.constraints.twoBoneIks.length > 0)
    ),
  );
}

function assertSupportedDocument(document: StudioBg3dSceneDocument): void {
  const lensShift = document.camera.lensShift;
  if (
    document.camera.projection === "orthographic" ||
    (lensShift && (lensShift[0] !== 0 || lensShift[1] !== 0)) ||
    (document.background.mode === "sky-preset" && document.background.skyPresetId !== "blank") ||
    document.nodes.some((node) => node.kind === "model" && hasUnsupportedRigState(node))
  ) {
    // Fail closed instead of emitting a plausible-looking raster that disagrees with Three's
    // canonical camera, procedural panorama, animation, morph, or rig result.
    throw captureError("unsupported-scene-feature");
  }
}

function admitCaptureAssets(
  job: StudioBg3dRuntimeAdapterJob,
  document: StudioBg3dSceneDocument,
): readonly StudioBg3dBabylonCaptureAsset[] {
  if (job.snapshot.assets.length !== document.attachments.length) {
    throw captureError("asset-mismatch");
  }
  const attachmentById = new Map(document.attachments.map((attachment) => [
    attachment.id,
    attachment,
  ]));
  const admitted = new Map<string, StudioBg3dBabylonCaptureAsset>();
  for (const asset of job.snapshot.assets) {
    const attachment = attachmentById.get(asset.attachmentId);
    if (
      !attachment ||
      admitted.has(asset.attachmentId) ||
      asset.hash !== attachment.hash ||
      asset.byteSize !== attachment.byteSize
    ) {
      throw captureError("asset-mismatch");
    }
    const bytes = asset.readVerifiedBytes();
    if (
      !(bytes instanceof Uint8Array) ||
      Object.getPrototypeOf(bytes) !== Uint8Array.prototype ||
      bytes.byteLength !== asset.byteSize
    ) {
      throw captureError("asset-mismatch");
    }
    const ownedBytes = Uint8Array.from(bytes);
    const glbJson = assertOfflineCoreGlb(ownedBytes);
    const footprint = glbBudgetFootprint(glbJson);
    admitted.set(asset.attachmentId, Object.freeze({
      attachmentId: asset.attachmentId,
      bytes: ownedBytes,
      footprint,
      glbJson,
    }));
  }
  if (
    admitted.size !== attachmentById.size ||
    document.nodes.some((node) =>
      node.kind === "model" && !admitted.has(node.attachmentId)
    )
  ) {
    throw captureError("asset-mismatch");
  }

  const repeatedModelBytes = document.nodes.reduce((total, node) => {
    if (node.kind !== "model") return total;
    return total + (attachmentById.get(node.attachmentId)?.byteSize ?? Number.POSITIVE_INFINITY);
  }, 0);
  if (
    !Number.isSafeInteger(repeatedModelBytes) ||
    repeatedModelBytes > document.budgets.complexity.maxModelBytes
  ) {
    // This first production path imports one isolated model graph per placed instance to keep
    // skins/materials deterministic. Bound the decoded pressure conservatively before parsing.
    throw captureError("resource-budget-exceeded");
  }
  return Object.freeze([...admitted.values()]);
}

function resolveCaptureRequest(
  job: StudioBg3dRuntimeAdapterJob,
): RequestedCapture | null {
  const request = job.request;
  if (request.kind === "capture") {
    return {
      format: "capture",
      width: request.width,
      height: request.height,
      includeBeauty: true,
      includeDepth: true,
      includeMaterialId: false,
      includeNormal: false,
      includeObjectId: false,
    };
  }
  if (request.kind === "webtoon-fx-capture") {
    if (request.effects.length > 0) throw captureError("unsupported-scene-feature");
    return {
      format: "capture",
      width: request.width,
      height: request.height,
      includeBeauty: true,
      includeDepth: request.includeDepth,
      includeMaterialId: false,
      includeNormal: false,
      includeObjectId: false,
    };
  }
  if (request.kind !== "artifact-capture-v2") return null;
  const kinds = request.artifacts.map((artifact) => artifact.kind);
  if (
    kinds.some((kind) =>
      kind !== "beauty" &&
      kind !== "depth" &&
      kind !== "normal" &&
      kind !== "object-id" &&
      kind !== "material-id"
    )
  ) {
    throw captureError("unsupported-artifact");
  }
  return {
    format: "artifact-v2",
    width: request.width,
    height: request.height,
    includeBeauty: kinds.includes("beauty"),
    includeDepth: kinds.includes("depth"),
    includeMaterialId: kinds.includes("material-id"),
    includeNormal: kinds.includes("normal"),
    includeObjectId: kinds.includes("object-id"),
  };
}

function validateFrame(
  frame: StudioBg3dBabylonCaptureFrame,
  request: RequestedCapture,
): StudioBg3dBabylonCaptureFrame {
  const pixels = request.width * request.height;
  if (
    !frame ||
    (request.includeBeauty && !(frame.rgba instanceof Uint8Array)) ||
    (frame.rgba !== undefined &&
      (!(frame.rgba instanceof Uint8Array) || frame.rgba.byteLength !== pixels * 4)) ||
    (request.includeDepth &&
      (!(frame.depth instanceof Float32Array) || frame.depth.length !== pixels)) ||
    (request.includeNormal &&
      (!(frame.normal instanceof Uint8Array) || frame.normal.length !== pixels * 2)) ||
    (request.includeObjectId &&
      (
        !(frame.objectId?.data instanceof Uint32Array) ||
        frame.objectId.data.length !== pixels ||
        !Array.isArray(frame.objectId.legend)
      )) ||
    (request.includeMaterialId &&
      (
        !(frame.materialId?.data instanceof Uint32Array) ||
        frame.materialId.data.length !== pixels ||
        !Array.isArray(frame.materialId.legend)
      )) ||
    frame.depth?.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  ) {
    throw captureError("capture-failed");
  }
  return {
    ...(frame.rgba ? { rgba: Uint8Array.from(frame.rgba) } : {}),
    ...(frame.depth ? { depth: Float32Array.from(frame.depth) } : {}),
    ...(frame.materialId
      ? {
        materialId: {
          data: Uint32Array.from(frame.materialId.data),
          legend: Object.freeze(frame.materialId.legend.map((entry) =>
            Object.freeze({ ...entry })
          )),
        },
      }
      : {}),
    ...(frame.normal ? { normal: Uint8Array.from(frame.normal) } : {}),
    ...(frame.objectId
      ? {
        objectId: {
          data: Uint32Array.from(frame.objectId.data),
          legend: Object.freeze(frame.objectId.legend.map((entry) =>
            Object.freeze({ ...entry })
          )),
        },
      }
      : {}),
  };
}

function toArtifactResult(
  job: StudioBg3dRuntimeAdapterJob,
  request: RequestedCapture,
  frame: StudioBg3dBabylonCaptureFrame,
): StudioBg3dArtifactCaptureResultV2 {
  if (job.request.kind !== "artifact-capture-v2") {
    throw captureError("capture-failed");
  }
  const artifacts = job.request.artifacts.map((artifact) => {
    if (artifact.kind === "beauty") {
      if (!frame.rgba) throw captureError("capture-failed");
      return Object.freeze({
        kind: "beauty" as const,
        width: request.width,
        height: request.height,
        profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
        data: Uint8Array.from(frame.rgba),
      });
    }
    if (artifact.kind === "depth") {
      if (!frame.depth) throw captureError("capture-failed");
      return Object.freeze({
        kind: "depth" as const,
        width: request.width,
        height: request.height,
        profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
        data: Float32Array.from(frame.depth),
      });
    }
    if (artifact.kind === "normal") {
      if (!frame.normal) throw captureError("capture-failed");
      return Object.freeze({
        kind: "normal" as const,
        width: request.width,
        height: request.height,
        profile: STUDIO_BG3D_NORMAL_PROFILE,
        coordinateSpace: STUDIO_BG3D_NORMAL_COORDINATE_SPACE,
        packing: STUDIO_BG3D_NORMAL_PACKING,
        data: Uint8Array.from(frame.normal),
      });
    }
    if (artifact.kind === "object-id") {
      if (!frame.objectId) throw captureError("capture-failed");
      return Object.freeze({
        kind: "object-id" as const,
        width: request.width,
        height: request.height,
        profile: STUDIO_BG3D_STABLE_ID_PROFILE,
        legend: Object.freeze(frame.objectId.legend.map((entry) =>
          Object.freeze({ ...entry })
        )),
        data: Uint32Array.from(frame.objectId.data),
      });
    }
    if (artifact.kind === "material-id") {
      if (!frame.materialId) throw captureError("capture-failed");
      return Object.freeze({
        kind: "material-id" as const,
        width: request.width,
        height: request.height,
        profile: STUDIO_BG3D_STABLE_ID_PROFILE,
        legend: Object.freeze(frame.materialId.legend.map((entry) =>
          Object.freeze({ ...entry })
        )),
        data: Uint32Array.from(frame.materialId.data),
      });
    }
    throw captureError("unsupported-artifact");
  });
  return Object.freeze({
    kind: STUDIO_BG3D_ARTIFACT_CAPTURE_KIND,
    version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    profile: STUDIO_BG3D_ARTIFACT_CAPTURE_PROFILE,
    width: request.width,
    height: request.height,
    artifacts: Object.freeze(artifacts),
  });
}

function metricsResult(
  context: StudioBg3dBabylonSpecialistExecutionContext,
): StudioBg3dSpecialistResult {
  return {
    kind: "metrics",
    values: {
      backend: context.backend,
      engine: "babylon",
      epoch: context.epoch,
      initialized: true,
      capture: "beauty-depth-normal-stable-id-v2",
    },
  };
}

function createCapturePlan(
  context: StudioBg3dBabylonSpecialistExecutionContext,
  request: RequestedCapture,
): StudioBg3dBabylonCapturePlan {
  const document = parseStudioBg3dSceneDocument(context.job.snapshot.canonicalDocumentJson);
  if (!document) throw captureError("invalid-snapshot");
  assertSupportedDocument(document);
  const assets = admitCaptureAssets(context.job, document);
  assertPreParseBudgets(document, assets);
  return Object.freeze({
    assets,
    backend: context.backend,
    document,
    height: request.height,
    includeBeauty: request.includeBeauty,
    includeDepth: request.includeDepth,
    includeMaterialId: request.includeMaterialId,
    includeNormal: request.includeNormal,
    includeObjectId: request.includeObjectId,
    width: request.width,
  });
}

function withAbortAndDeadline<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  deadlineMs = MAX_CAPTURE_WAIT_MS,
): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
      callback();
    };
    const onAbort = () => finish(() => reject(captureError("aborted")));
    const timeout = setTimeout(
      () => finish(() => reject(captureError("timeout"))),
      deadlineMs,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function readbackStageError(
  stage: StudioBg3dBabylonReadbackStage,
  error: unknown,
): StudioBg3dBabylonCaptureError {
  return new StudioBg3dBabylonCaptureError(
    error instanceof StudioBg3dBabylonCaptureError
      ? error.code
      : "capture-failed",
    error,
    stage,
  );
}

/**
 * Babylon WebGPU readbacks share one device queue. Starting swap-chain beauty and depth RTT
 * mappings together can invalidate Dawn's external instance on headless SwiftShader. Keep the
 * mappings strictly serial and retain a lease on renderer-owned resources until every operation
 * actually settles, even when the public abort/deadline wins the race first.
 */
export async function runStudioBg3dBabylonSerializedReadbacks<TBeauty, TDepth>(
  options: StudioBg3dBabylonSerializedReadbackOptions<TBeauty, TDepth>,
): Promise<StudioBg3dBabylonSerializedReadbackResult<TBeauty, TDepth>> {
  const pending = new Set<Promise<void>>();

  const runStage = async <T>(
    stage: StudioBg3dBabylonReadbackStage,
    start: () => Promise<T>,
  ): Promise<T> => {
    try {
      throwIfAborted(options.signal);
      const operation = start();
      const drained = operation.then(
        () => undefined,
        () => undefined,
      );
      pending.add(drained);
      void drained.then(() => pending.delete(drained));
      return await withAbortAndDeadline(
        operation,
        options.signal,
        options.deadlineMs,
      );
    } catch (error) {
      throw readbackStageError(stage, error);
    }
  };

  try {
    const beauty = options.beauty
      ? await runStage("beauty", options.beauty)
      : undefined;
    const depth = options.depth
      ? await runStage("depth", options.depth)
      : undefined;
    return {
      ...(beauty === undefined ? {} : { beauty }),
      ...(depth === undefined ? {} : { depth }),
    };
  } finally {
    const inFlight = [...pending];
    if (inFlight.length === 0) {
      options.release();
    } else {
      // The public call remains cancellable/bounded, while the GPU-owned resource stays alive
      // until mapAsync settles. Late disposal errors cannot be reported to an already-settled job.
      void Promise.all(inFlight).then(() => {
        try {
          options.release();
        } catch {
          // Best-effort late cleanup. Synchronous cleanup still preserves existing error behavior.
        }
      });
    }
  }
}

interface StudioBg3dBabylonSceneResourceSnapshot {
  readonly animationGroups: ReadonlySet<AnimationGroup>;
  readonly cameras: ReadonlySet<Camera>;
  readonly geometries: ReadonlySet<Geometry>;
  readonly lights: ReadonlySet<Light>;
  readonly materials: ReadonlySet<Material>;
  readonly meshes: ReadonlySet<AbstractMesh>;
  readonly morphTargetManagers: ReadonlySet<MorphTargetManager>;
  readonly multiMaterials: ReadonlySet<MultiMaterial>;
  readonly particleSystems: ReadonlySet<IParticleSystem>;
  readonly skeletons: ReadonlySet<Skeleton>;
  readonly spriteManagers: ReadonlySet<ISpriteManager>;
  readonly textures: ReadonlySet<BaseTexture>;
  readonly transformNodes: ReadonlySet<TransformNode>;
}

interface StudioBg3dBabylonSceneResourceDelta {
  readonly animationGroups: Set<AnimationGroup>;
  readonly cameras: Set<Camera>;
  readonly geometries: Set<Geometry>;
  readonly lights: Set<Light>;
  readonly materials: Set<Material>;
  readonly meshes: Set<AbstractMesh>;
  readonly morphTargetManagers: Set<MorphTargetManager>;
  readonly multiMaterials: Set<MultiMaterial>;
  readonly particleSystems: Set<IParticleSystem>;
  readonly skeletons: Set<Skeleton>;
  readonly spriteManagers: Set<ISpriteManager>;
  readonly textures: Set<BaseTexture>;
  readonly transformNodes: Set<TransformNode>;
}

export interface RunStudioBg3dBabylonBoundedImportInput {
  readonly bytes: Uint8Array;
  readonly budgets: StudioBg3dSceneBudgets;
  readonly importMesh?: StudioBg3dBabylonMeshImporter;
  readonly name: string;
  readonly preflight: GlbBudgetFootprint;
  readonly scene: Scene;
  readonly signal: AbortSignal;
}

function sceneArray<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function snapshotStudioBg3dBabylonSceneResources(
  scene: Scene,
): StudioBg3dBabylonSceneResourceSnapshot {
  return {
    animationGroups: new Set(sceneArray(scene.animationGroups)),
    cameras: new Set(sceneArray(scene.cameras)),
    geometries: new Set(sceneArray(scene.geometries)),
    lights: new Set(sceneArray(scene.lights)),
    materials: new Set(sceneArray(scene.materials)),
    meshes: new Set(sceneArray(scene.meshes)),
    morphTargetManagers: new Set(sceneArray(scene.morphTargetManagers)),
    multiMaterials: new Set(sceneArray(scene.multiMaterials)),
    particleSystems: new Set(sceneArray(scene.particleSystems)),
    skeletons: new Set(sceneArray(scene.skeletons)),
    spriteManagers: new Set(sceneArray(scene.spriteManagers)),
    textures: new Set(sceneArray(scene.textures)),
    transformNodes: new Set(sceneArray(scene.transformNodes)),
  };
}

function setDelta<T>(
  current: readonly T[] | null | undefined,
  previous: ReadonlySet<T>,
): Set<T> {
  const result = new Set<T>();
  for (const resource of sceneArray(current)) {
    if (!previous.has(resource)) result.add(resource);
  }
  return result;
}

function addImportedResources(
  resources: StudioBg3dBabylonSceneResourceDelta,
  previous: StudioBg3dBabylonSceneResourceSnapshot,
  imported: ISceneLoaderAsyncResult | null,
): void {
  if (!imported) return;
  for (const resource of sceneArray(imported.meshes)) {
    if (!previous.meshes.has(resource)) resources.meshes.add(resource);
  }
  for (const resource of sceneArray(imported.transformNodes)) {
    if (!previous.transformNodes.has(resource)) resources.transformNodes.add(resource);
  }
  for (const resource of sceneArray(imported.geometries)) {
    if (!previous.geometries.has(resource)) resources.geometries.add(resource);
  }
  for (const resource of sceneArray(imported.animationGroups)) {
    if (!previous.animationGroups.has(resource)) resources.animationGroups.add(resource);
  }
  for (const resource of sceneArray(imported.skeletons)) {
    if (!previous.skeletons.has(resource)) resources.skeletons.add(resource);
  }
  for (const resource of sceneArray(imported.lights)) {
    if (!previous.lights.has(resource)) resources.lights.add(resource);
  }
  for (const resource of sceneArray(imported.particleSystems)) {
    if (!previous.particleSystems.has(resource)) resources.particleSystems.add(resource);
  }
  for (const resource of sceneArray(imported.spriteManagers)) {
    if (!previous.spriteManagers.has(resource)) resources.spriteManagers.add(resource);
  }
}

function materialClassName(material: Material): string {
  try {
    return material.getClassName();
  } catch {
    return "";
  }
}

function collectStudioBg3dBabylonSceneResourceDelta(
  scene: Scene,
  previous: StudioBg3dBabylonSceneResourceSnapshot,
  imported: ISceneLoaderAsyncResult | null = null,
  strictTextureEnumeration = false,
): StudioBg3dBabylonSceneResourceDelta {
  const resources: StudioBg3dBabylonSceneResourceDelta = {
    animationGroups: setDelta(scene.animationGroups, previous.animationGroups),
    cameras: setDelta(scene.cameras, previous.cameras),
    geometries: setDelta(scene.geometries, previous.geometries),
    lights: setDelta(scene.lights, previous.lights),
    materials: setDelta(scene.materials, previous.materials),
    meshes: setDelta(scene.meshes, previous.meshes),
    morphTargetManagers: setDelta(
      scene.morphTargetManagers,
      previous.morphTargetManagers,
    ),
    multiMaterials: setDelta(scene.multiMaterials, previous.multiMaterials),
    particleSystems: setDelta(scene.particleSystems, previous.particleSystems),
    skeletons: setDelta(scene.skeletons, previous.skeletons),
    spriteManagers: setDelta(scene.spriteManagers, previous.spriteManagers),
    textures: setDelta(scene.textures, previous.textures),
    transformNodes: setDelta(scene.transformNodes, previous.transformNodes),
  };
  addImportedResources(resources, previous, imported);

  // ImportMeshAsync does not return materials or textures. Recover those ownership edges from
  // imported meshes so a late result remains disposable even after Scene.dispose() cleared arrays.
  for (const mesh of resources.meshes) {
    const material = mesh.material;
    if (!material) continue;
    if (
      !previous.multiMaterials.has(material as MultiMaterial) &&
      materialClassName(material) === "MultiMaterial"
    ) {
      resources.multiMaterials.add(material as MultiMaterial);
    } else if (!previous.materials.has(material)) {
      resources.materials.add(material);
    }
    try {
      for (const texture of material.getActiveTextures()) {
        if (!previous.textures.has(texture)) resources.textures.add(texture);
      }
    } catch {
      if (strictTextureEnumeration) {
        throw captureError("resource-budget-exceeded");
      }
    }
    const geometry = mesh.geometry;
    if (geometry && !previous.geometries.has(geometry)) resources.geometries.add(geometry);
    const skeleton = mesh.skeleton;
    if (skeleton && !previous.skeletons.has(skeleton)) resources.skeletons.add(skeleton);
    const morphTargetManager = mesh.morphTargetManager;
    if (
      morphTargetManager &&
      !previous.morphTargetManagers.has(morphTargetManager)
    ) {
      resources.morphTargetManagers.add(morphTargetManager);
    }
  }
  return resources;
}

function safeDisposeBabylonResource(
  resource: unknown,
  disposed: Set<object>,
  args: readonly unknown[] = [],
): void {
  if (
    (typeof resource !== "object" && typeof resource !== "function") ||
    resource === null ||
    disposed.has(resource)
  ) {
    return;
  }
  disposed.add(resource);
  try {
    const dispose = Reflect.get(resource, "dispose");
    if (typeof dispose === "function") Reflect.apply(dispose, resource, args);
  } catch {
    // A hostile or already-lost GPU resource must not stop disposal of the remaining import delta.
  }
}

function disposeStudioBg3dBabylonImportDelta(
  scene: Scene,
  previous: StudioBg3dBabylonSceneResourceSnapshot,
  imported: ISceneLoaderAsyncResult | null,
  disposed: Set<object>,
): void {
  const resources = collectStudioBg3dBabylonSceneResourceDelta(scene, previous, imported);
  for (const resource of resources.animationGroups) {
    safeDisposeBabylonResource(resource, disposed);
  }
  for (const resource of resources.particleSystems) {
    safeDisposeBabylonResource(resource, disposed, [false, false, false]);
  }
  for (const resource of resources.spriteManagers) {
    safeDisposeBabylonResource(resource, disposed);
  }
  // Geometry.dispose() detaches itself from every mesh. Disposing it first prevents Mesh.dispose()
  // from implicitly disposing the same geometry before our exactly-once guard can observe it.
  for (const resource of resources.geometries) {
    safeDisposeBabylonResource(resource, disposed);
  }
  for (const resource of resources.meshes) {
    safeDisposeBabylonResource(resource, disposed, [true, false]);
  }
  for (const resource of resources.transformNodes) {
    safeDisposeBabylonResource(resource, disposed, [true, false]);
  }
  for (const resource of resources.lights) {
    safeDisposeBabylonResource(resource, disposed, [true, false]);
  }
  for (const resource of resources.cameras) {
    safeDisposeBabylonResource(resource, disposed, [true, false]);
  }
  for (const resource of resources.skeletons) {
    safeDisposeBabylonResource(resource, disposed);
  }
  for (const resource of resources.morphTargetManagers) {
    safeDisposeBabylonResource(resource, disposed);
  }
  for (const resource of resources.multiMaterials) {
    safeDisposeBabylonResource(resource, disposed, [false, false, false]);
  }
  for (const resource of resources.materials) {
    safeDisposeBabylonResource(resource, disposed, [false, false, true]);
  }
  for (const resource of resources.textures) {
    safeDisposeBabylonResource(resource, disposed);
  }
}

function safePostParseCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw captureError("resource-budget-exceeded");
  }
  return value;
}

function numericDataFootprint(value: unknown): {
  readonly byteLength: number;
  readonly length: number;
} {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const length = Reflect.get(value, "length");
    return {
      byteLength: safePostParseCount(value.byteLength),
      length: safePostParseCount(length),
    };
  }
  if (Array.isArray(value)) {
    return {
      byteLength: safeMultiply(value.length, Float64Array.BYTES_PER_ELEMENT),
      length: safePostParseCount(value.length),
    };
  }
  throw captureError("resource-budget-exceeded");
}

function animationComponentCount(dataType: number): number {
  switch (dataType) {
    case 0:
      return 1;
    case 1:
    case 4:
      return 3;
    case 2:
    case 7:
      return 4;
    case 3:
      return 16;
    case 5:
    case 6:
      return 2;
    default:
      throw captureError("resource-budget-exceeded");
  }
}

function loaderOwnedGltfPointers(resource: unknown): readonly string[] {
  if (
    (typeof resource !== "object" && typeof resource !== "function") ||
    resource === null
  ) {
    return [];
  }
  try {
    const internalMetadata = Reflect.get(resource, "_internalMetadata");
    if (!isPlainRecord(internalMetadata)) return [];
    const gltf = internalMetadata.gltf;
    if (!isPlainRecord(gltf) || !Array.isArray(gltf.pointers)) return [];
    if (!gltf.pointers.every((pointer) => typeof pointer === "string")) {
      throw captureError("resource-budget-exceeded");
    }
    return gltf.pointers;
  } catch (error) {
    if (error instanceof StudioBg3dBabylonCaptureError) throw error;
    throw captureError("resource-budget-exceeded", error);
  }
}

function boundedStableIdLabel(
  base: string,
  suffix: string,
  fallback: string,
): string {
  const normalizedBase = base
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  const normalizedSuffix = suffix
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  const safeBase = normalizedBase || fallback;
  const separator = normalizedSuffix ? " · " : "";
  const reservedLength = separator.length + normalizedSuffix.length;
  const maximumBaseLength = Math.max(
    1,
    STABLE_ID_LEGEND_LABEL_MAX_LENGTH - reservedLength,
  );
  let boundedBase = "";
  for (const character of safeBase) {
    if (boundedBase.length + character.length > maximumBaseLength) break;
    boundedBase += character;
  }
  const result = `${boundedBase || fallback}${separator}${normalizedSuffix}`;
  if (result.length <= STABLE_ID_LEGEND_LABEL_MAX_LENGTH) return result;
  let bounded = "";
  for (const character of result) {
    if (bounded.length + character.length > STABLE_ID_LEGEND_LABEL_MAX_LENGTH) break;
    bounded += character;
  }
  return bounded || fallback;
}

function stableObjectDescriptor(
  node: StudioBg3dSceneNode,
): StudioBg3dStableIdDescriptor {
  return {
    stableId: `obj/${node.id}`,
    label: boundedStableIdLabel(node.name, "", "3D object"),
  };
}

function primitiveMaterialDescriptor(
  node: StudioBg3dSceneNode,
): StudioBg3dStableIdDescriptor {
  return {
    stableId: `mat/${node.id}/primitive`,
    label: boundedStableIdLabel(node.name, "기본 재질", "3D material"),
  };
}

function uniqueGltfIndexPointer(
  resource: unknown,
  pattern: RegExp,
): readonly number[] | null {
  const matches = new Map<string, readonly number[]>();
  for (const pointer of loaderOwnedGltfPointers(resource)) {
    const match = pattern.exec(pointer);
    if (!match) continue;
    const indices = match.slice(1).map(Number);
    if (indices.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      throw captureError("unsupported-artifact");
    }
    matches.set(pointer, Object.freeze(indices));
  }
  if (matches.size !== 1) return null;
  return matches.values().next().value ?? null;
}

/**
 * Adapter boundary for Babylon's loader-owned glTF source pointers.
 *
 * Babylon does not expose primitive/material source indices through a public runtime property.
 * This exact pointer is therefore validated against the already-admitted canonical GLB JSON,
 * never supplemented with runtime names, unique IDs, or scene array order.
 */
function modelMaterialDescriptor(
  asset: StudioBg3dBabylonCaptureAsset,
  mesh: AbstractMesh,
  node: StudioBg3dModelNode,
): StudioBg3dStableIdDescriptor {
  const indices = uniqueGltfIndexPointer(mesh, GLTF_PRIMITIVE_POINTER_PATTERN);
  if (!indices || indices.length !== 2) {
    throw captureError("unsupported-artifact");
  }
  const [meshIndex, primitiveIndex] = indices;
  const gltfMeshes = recordArray(asset.glbJson.meshes);
  const sourceMesh = gltfMeshes[meshIndex!];
  const primitive = sourceMesh
    ? recordArray(sourceMesh.primitives)[primitiveIndex!]
    : undefined;
  if (!primitive) throw captureError("unsupported-artifact");

  const materials = recordArray(asset.glbJson.materials);
  const materialIndex = primitive.material === undefined
    ? null
    : safeNonNegativeCount(primitive.material);
  if (materialIndex !== null && materialIndex >= materials.length) {
    throw captureError("unsupported-artifact");
  }

  const runtimeMaterialIndex = mesh.material
    ? uniqueGltfIndexPointer(mesh.material, GLTF_MATERIAL_POINTER_PATTERN)
    : null;
  if (
    runtimeMaterialIndex &&
    (
      runtimeMaterialIndex.length !== 1 ||
      materialIndex === null ||
      runtimeMaterialIndex[0] !== materialIndex
    )
  ) {
    throw captureError("unsupported-artifact");
  }

  return materialIndex === null
    ? {
      stableId: `mat/${node.id}/gltf-default`,
      label: boundedStableIdLabel(node.name, "기본 재질", "3D material"),
    }
    : {
      stableId: `mat/${node.id}/gltf-material/${materialIndex}`,
      label: boundedStableIdLabel(
        node.name,
        `재질 ${materialIndex + 1}`,
        "3D material",
      ),
    };
}

function logicalGltfNodeCount(
  resources: StudioBg3dBabylonSceneResourceDelta,
  preflight: GlbBudgetFootprint,
): number {
  const nodeIndices = new Set<number>();
  for (const resource of [...resources.meshes, ...resources.transformNodes]) {
    for (const pointer of loaderOwnedGltfPointers(resource)) {
      const match = GLTF_NODE_POINTER_PATTERN.exec(pointer);
      if (!match) continue;
      const index = Number(match[1]);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= preflight.nodes
      ) {
        throw captureError("resource-budget-exceeded");
      }
      nodeIndices.add(index);
    }
  }
  if (preflight.nodes > 0 && nodeIndices.size < 1) {
    throw captureError("resource-budget-exceeded");
  }
  return nodeIndices.size;
}

function triangleCountForBabylonDrawMode(
  elementCount: number,
  drawMode: number,
): number {
  switch (drawMode) {
    case Material.PointListDrawMode:
    case Material.LineListDrawMode:
    case Material.LineLoopDrawMode:
    case Material.LineStripDrawMode:
      return 0;
    case Material.TriangleFillMode:
      return Math.floor(elementCount / 3);
    case Material.TriangleStripDrawMode:
    case Material.TriangleFanDrawMode:
      return Math.max(0, elementCount - 2);
    default:
      throw captureError("resource-budget-exceeded");
  }
}

function textureMipReceipt(texture: BaseTexture): {
  readonly bytes: number;
  readonly maxDimension: number;
  readonly mipLevels: number;
} {
  const size = texture.getSize();
  const internal = texture.getInternalTexture();
  if (!internal) throw captureError("resource-budget-exceeded");
  let width = safePostParseCount(size.width);
  let height = safePostParseCount(size.height);
  let depth = safePostParseCount(internal.depth || 1);
  if (width < 1 || height < 1 || depth < 1) {
    throw captureError("resource-budget-exceeded");
  }
  const maxDimension = Math.max(width, height, depth);
  const computedMipLevels = internal.generateMipMaps
    ? Math.floor(Math.log2(maxDimension)) + 1
    : 1;
  const mipLevels = internal.mipLevelCount > 0
    ? safePostParseCount(internal.mipLevelCount)
    : computedMipLevels;
  if (mipLevels < 1 || mipLevels > MAX_BABYLON_TEXTURE_MIP_LEVELS) {
    throw captureError("resource-budget-exceeded");
  }

  const faces = texture.isCube ? 6 : 1;
  let texels = 0;
  for (let level = 0; level < mipLevels; level += 1) {
    texels = safeAdd(texels, safeMultiply(safeMultiply(width, height), depth));
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    if (internal.is3D) depth = Math.max(1, Math.floor(depth / 2));
  }
  // A conservative RGBA32F ceiling makes this receipt independent of backend texture packing.
  return {
    bytes: safeMultiply(safeMultiply(texels, faces), 16),
    maxDimension,
    mipLevels,
  };
}

function measureStudioBg3dBabylonPostParseReceipt(
  resources: StudioBg3dBabylonSceneResourceDelta,
  imported: ISceneLoaderAsyncResult,
  preflight: GlbBudgetFootprint,
): StudioBg3dBabylonPostParseReceipt {
  const runtimeNodes = safeAdd(resources.meshes.size, resources.transformNodes.size);
  const logicalNodes = logicalGltfNodeCount(resources, preflight);
  const hasSyntheticLoaderRoot = sceneArray(imported.meshes).some((mesh) => {
    try {
      return resources.meshes.has(mesh) && mesh.parent === null && mesh.getTotalVertices() === 0;
    } catch {
      return false;
    }
  });
  if (!hasSyntheticLoaderRoot || runtimeNodes < 1) {
    throw captureError("resource-budget-exceeded");
  }

  let accessorElements = 0;
  let decodedGeometryBytes = 0;
  let drawCalls = 0;
  let meshes = 0;
  let triangles = 0;
  const measuredBuffers = new Set<object>();
  const measuredData = new Set<object>();

  const addData = (value: unknown, components: number): void => {
    const footprint = numericDataFootprint(value);
    if (components < 1 || footprint.length % components !== 0) {
      throw captureError("resource-budget-exceeded");
    }
    if (
      (typeof value === "object" || typeof value === "function") &&
      value !== null &&
      !measuredData.has(value)
    ) {
      measuredData.add(value);
      decodedGeometryBytes = safeAdd(decodedGeometryBytes, footprint.byteLength);
    }
    accessorElements = safeAdd(accessorElements, footprint.length / components);
  };
  const addBufferOrData = (buffer: unknown, data: unknown, components: number): void => {
    if (
      (typeof buffer === "object" || typeof buffer === "function") &&
      buffer !== null
    ) {
      if (!measuredBuffers.has(buffer)) {
        measuredBuffers.add(buffer);
        const capacity = safePostParseCount(Reflect.get(buffer, "capacity"));
        if (capacity > 0) {
          decodedGeometryBytes = safeAdd(decodedGeometryBytes, capacity);
        } else {
          addData(data, components);
          return;
        }
      }
      const footprint = numericDataFootprint(data);
      if (components < 1 || footprint.length % components !== 0) {
        throw captureError("resource-budget-exceeded");
      }
      accessorElements = safeAdd(accessorElements, footprint.length / components);
      return;
    }
    addData(data, components);
  };

  for (const geometry of resources.geometries) {
    const kinds = geometry.getVerticesDataKinds();
    if (
      !Array.isArray(kinds) ||
      kinds.length > MAX_BABYLON_VERTEX_KINDS ||
      new Set(kinds).size !== kinds.length
    ) {
      throw captureError("resource-budget-exceeded");
    }
    const totalVertices = safePostParseCount(geometry.getTotalVertices());
    for (const kind of kinds) {
      const vertexBuffer = geometry.getVertexBuffer(kind);
      if (!vertexBuffer) throw captureError("resource-budget-exceeded");
      const components = safePostParseCount(vertexBuffer.getSize());
      // getData() exposes the whole underlying buffer and therefore cannot identify the exact
      // accessor length for interleaved attributes. Geometry's public accessor view is exact.
      const data = geometry.getVerticesData(kind);
      if (!data) throw captureError("resource-budget-exceeded");
      addBufferOrData(vertexBuffer.getBuffer(), data, components);
      if (numericDataFootprint(data).length / components !== totalVertices) {
        throw captureError("resource-budget-exceeded");
      }
    }
    const totalIndices = safePostParseCount(geometry.getTotalIndices());
    if (totalIndices > 0) {
      const indices = geometry.getIndices();
      if (!indices) throw captureError("resource-budget-exceeded");
      addBufferOrData(geometry.getIndexBuffer(), indices, 1);
      if (numericDataFootprint(indices).length !== totalIndices) {
        throw captureError("resource-budget-exceeded");
      }
    }
  }

  for (const mesh of resources.meshes) {
    const vertices = safePostParseCount(mesh.getTotalVertices());
    const indices = safePostParseCount(mesh.getTotalIndices());
    if (vertices < 1 && indices < 1) continue;
    meshes = safeAdd(meshes, 1);
    const subMeshes = sceneArray(mesh.subMeshes);
    drawCalls = safeAdd(drawCalls, Math.max(1, subMeshes.length));
    const drawMode = mesh.material?.fillMode;
    if (typeof drawMode !== "number" || !Number.isSafeInteger(drawMode)) {
      throw captureError("resource-budget-exceeded");
    }
    const elementCount = indices > 0 ? indices : vertices;
    triangles = safeAdd(
      triangles,
      triangleCountForBabylonDrawMode(elementCount, drawMode),
    );
  }

  let morphTargets = 0;
  for (const manager of resources.morphTargetManagers) {
    const targets = safePostParseCount(manager.numTargets);
    morphTargets = safeAdd(morphTargets, targets);
    for (let index = 0; index < targets; index += 1) {
      const target = manager.getTarget(index);
      if (!target) throw captureError("resource-budget-exceeded");
      for (const [value, components] of [
        [target.getPositions(), 3],
        [target.getNormals(), 3],
        [target.getTangents(), 3],
        [target.getUVs(), 2],
        [target.getUV2s(), 2],
        [target.getColors(), 4],
      ] as const) {
        if (value) addData(value, components);
      }
    }
  }

  let animations = 0;
  let animationChannels = 0;
  let animationKeyframes = 0;
  let animationValues = 0;
  for (const group of resources.animationGroups) {
    animations = safeAdd(animations, 1);
    const targetedAnimations = group.targetedAnimations;
    if (!Array.isArray(targetedAnimations)) {
      throw captureError("resource-budget-exceeded");
    }
    animationChannels = safeAdd(animationChannels, targetedAnimations.length);
    for (const targeted of targetedAnimations) {
      const keys = targeted.animation.getKeys();
      if (!Array.isArray(keys)) throw captureError("resource-budget-exceeded");
      animationKeyframes = safeAdd(animationKeyframes, keys.length);
      accessorElements = safeAdd(accessorElements, keys.length);
      decodedGeometryBytes = safeAdd(
        decodedGeometryBytes,
        safeMultiply(keys.length, Float64Array.BYTES_PER_ELEMENT),
      );
      const components = animationComponentCount(targeted.animation.dataType);
      let outputElements = 0;
      for (const key of keys) {
        const tangentElements =
          (key.inTangent === undefined ? 0 : 1) +
          (key.outTangent === undefined ? 0 : 1);
        outputElements = safeAdd(outputElements, 1 + tangentElements);
      }
      const scalarValues = safeMultiply(outputElements, components);
      animationValues = safeAdd(animationValues, scalarValues);
      accessorElements = safeAdd(accessorElements, outputElements);
      decodedGeometryBytes = safeAdd(
        decodedGeometryBytes,
        safeMultiply(scalarValues, Float64Array.BYTES_PER_ELEMENT),
      );
    }
  }

  let joints = 0;
  for (const skeleton of resources.skeletons) {
    if (!Array.isArray(skeleton.bones)) throw captureError("resource-budget-exceeded");
    joints = safeAdd(joints, skeleton.bones.length);
  }

  let textureBytes = 0;
  let textureMipLevels = 0;
  let maxTextureDimension = 0;
  for (const texture of resources.textures) {
    const receipt = textureMipReceipt(texture);
    textureBytes = safeAdd(textureBytes, receipt.bytes);
    textureMipLevels = safeAdd(textureMipLevels, receipt.mipLevels);
    maxTextureDimension = Math.max(maxTextureDimension, receipt.maxDimension);
  }

  return Object.freeze({
    accessorElements,
    animationChannels,
    animationKeyframes,
    animationValues,
    animations,
    cameras: resources.cameras.size,
    decodedGeometryBytes,
    drawCalls,
    geometries: resources.geometries.size,
    joints,
    lights: resources.lights.size,
    materials: resources.materials.size,
    meshes,
    morphTargets,
    nodes: logicalNodes,
    particleSystems: resources.particleSystems.size,
    runtimeNodes,
    skeletons: resources.skeletons.size,
    spriteManagers: resources.spriteManagers.size,
    textureBytes,
    textureMipLevels,
    textures: resources.textures.size,
    maxTextureDimension,
    triangles,
  });
}

function assertStudioBg3dBabylonPostParseReceipt(
  receipt: StudioBg3dBabylonPostParseReceipt,
  preflight: GlbBudgetFootprint,
  budgets: StudioBg3dSceneBudgets,
): void {
  const complexity = budgets.complexity;
  const textures = budgets.textures;
  if (
    receipt.nodes > complexity.maxNodes ||
    receipt.triangles > complexity.maxTriangles ||
    receipt.drawCalls > complexity.maxDrawCalls ||
    receipt.materials > complexity.maxMaterials ||
    receipt.lights > complexity.maxLights ||
    receipt.animations > complexity.maxAnimations ||
    receipt.animationChannels > complexity.maxAnimationChannels ||
    receipt.animationKeyframes > complexity.maxAnimationKeyframes ||
    receipt.animationValues > complexity.maxAnimationValues ||
    receipt.skeletons > complexity.maxSkins ||
    receipt.joints > complexity.maxJoints ||
    receipt.morphTargets > complexity.maxMorphTargets ||
    receipt.accessorElements > complexity.maxAccessorElements ||
    receipt.decodedGeometryBytes > complexity.maxDecodedGeometryBytes ||
    receipt.textures > textures.maxTextures ||
    receipt.textureBytes > textures.maxTotalBytes ||
    receipt.maxTextureDimension > textures.maxDimension
  ) {
    throw captureError("resource-budget-exceeded");
  }
  if (
    receipt.cameras > 0 ||
    receipt.particleSystems > 0 ||
    receipt.spriteManagers > 0
  ) {
    throw captureError("unsupported-scene-feature");
  }

  const runtimeNodeEnvelope = safeAdd(
    1,
    safeAdd(safeMultiply(preflight.nodes, 2), preflight.drawCalls),
  );
  const decodedByteEnvelope = safeMultiply(
    preflight.decodedGeometryBytes,
    MAX_POST_PARSE_DECODE_AMPLIFICATION,
  );
  if (
    receipt.runtimeNodes > runtimeNodeEnvelope ||
    receipt.nodes > preflight.nodes ||
    receipt.triangles > preflight.triangles ||
    receipt.drawCalls > preflight.drawCalls ||
    receipt.geometries > preflight.drawCalls ||
    receipt.materials > preflight.materialSlots ||
    receipt.lights > preflight.lights ||
    receipt.animations > preflight.animations ||
    receipt.animationChannels > preflight.animationChannels ||
    receipt.animationKeyframes > preflight.animationKeyframes ||
    receipt.animationValues > preflight.animationValues ||
    receipt.skeletons > preflight.skins ||
    receipt.joints > preflight.joints ||
    receipt.morphTargets > preflight.morphTargets ||
    receipt.accessorElements > preflight.accessorElements ||
    receipt.decodedGeometryBytes > decodedByteEnvelope ||
    receipt.textures > preflight.textures
  ) {
    throw captureError("resource-budget-exceeded");
  }
}

/**
 * Imports one verified GLB into an isolated Babylon scene.
 *
 * The scene delta is the ownership boundary. If cancellation/deadline wins, the parser may still
 * settle later; that late result and every newly attached scene resource are disposed exactly once.
 * A timely result is admitted only after its public Babylon resources produce a bounded receipt
 * that cannot exceed either the canonical document budgets or the GLB preflight envelope.
 */
export async function runStudioBg3dBabylonBoundedImport(
  input: RunStudioBg3dBabylonBoundedImportInput,
): Promise<StudioBg3dBabylonBoundedImportResult> {
  throwIfAborted(input.signal);
  // PBR materials lazily create Babylon's fixed, scene-owned BRDF LUT. Establish that public
  // engine baseline before taking the asset ownership snapshot so a texture-free GLB cannot be
  // rejected as if it had smuggled in one decoded texture.
  if (typeof input.scene.getClassName === "function") {
    GetEnvironmentBRDFTexture(input.scene);
  }
  const previous = snapshotStudioBg3dBabylonSceneResources(input.scene);
  const disposed = new Set<object>();
  let cleanupLateResult = false;
  const importMesh = input.importMesh ?? ImportMeshAsync;
  const operation = Promise.resolve().then(() =>
    importMesh(input.bytes, input.scene, {
      meshNames: null,
      name: input.name,
      pluginExtension: ".glb",
      rootUrl: "",
    })
  );
  const observed = operation.then(
    (imported) => {
      if (cleanupLateResult) {
        disposeStudioBg3dBabylonImportDelta(
          input.scene,
          previous,
          imported,
          disposed,
        );
      }
      return imported;
    },
    (error: unknown) => {
      if (cleanupLateResult) {
        disposeStudioBg3dBabylonImportDelta(
          input.scene,
          previous,
          null,
          disposed,
        );
      }
      throw error;
    },
  );

  let imported: ISceneLoaderAsyncResult | null = null;
  try {
    imported = await withAbortAndDeadline(observed, input.signal);
    throwIfAborted(input.signal);
    const resources = collectStudioBg3dBabylonSceneResourceDelta(
      input.scene,
      previous,
      imported,
      true,
    );
    const receipt = measureStudioBg3dBabylonPostParseReceipt(
      resources,
      imported,
      input.preflight,
    );
    assertStudioBg3dBabylonPostParseReceipt(
      receipt,
      input.preflight,
      input.budgets,
    );
    throwIfAborted(input.signal);
    return Object.freeze({ imported, receipt });
  } catch (error) {
    cleanupLateResult = true;
    disposeStudioBg3dBabylonImportDelta(
      input.scene,
      previous,
      imported,
      disposed,
    );
    throw error;
  }
}

function rgbaRowsTopDown(
  source: ArrayBufferView,
  width: number,
  height: number,
  flipY: boolean,
  swapRedBlue: boolean,
  unpremultiplyAlpha: boolean,
): Uint8Array {
  if (!(source instanceof Uint8Array) || source.byteLength !== width * height * 4) {
    throw captureError("capture-failed");
  }
  const output = new Uint8Array(source.byteLength);
  for (let y = 0; y < height; y += 1) {
    const sourceY = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceY * width + x) * 4;
      const targetOffset = (y * width + x) * 4;
      let red = source[sourceOffset + (swapRedBlue ? 2 : 0)];
      const green = source[sourceOffset + 1];
      let blue = source[sourceOffset + (swapRedBlue ? 0 : 2)];
      const alpha = source[sourceOffset + 3];
      if (unpremultiplyAlpha) {
        if (alpha === 0) {
          red = 0;
          blue = 0;
          output[targetOffset + 1] = 0;
        } else if (alpha < 255) {
          red = Math.min(255, Math.round((red * 255) / alpha));
          blue = Math.min(255, Math.round((blue * 255) / alpha));
          output[targetOffset + 1] = Math.min(255, Math.round((green * 255) / alpha));
        } else {
          output[targetOffset + 1] = green;
        }
      } else {
        output[targetOffset + 1] = green;
      }
      output[targetOffset] = red;
      output[targetOffset + 2] = blue;
      output[targetOffset + 3] = alpha;
    }
  }
  return output;
}

function depthRowsTopDown(
  source: ArrayBufferView,
  width: number,
  height: number,
  flipY: boolean,
): Float32Array {
  const pixels = width * height;
  if (
    !(source instanceof Float32Array) ||
    (source.length !== pixels && source.length !== pixels * 4)
  ) {
    throw captureError("capture-failed");
  }
  const channels = source.length === pixels ? 1 : 4;
  const output = new Float32Array(pixels);
  for (let y = 0; y < height; y += 1) {
    const sourceY = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x += 1) {
      const sample = source[(sourceY * width + x) * channels];
      if (
        typeof sample !== "number" ||
        !Number.isFinite(sample) ||
        sample < -FLOAT_TOLERANCE ||
        sample > 1 + FLOAT_TOLERANCE
      ) {
        throw captureError("capture-failed");
      }
      output[y * width + x] = Math.min(1, Math.max(0, sample));
    }
  }
  return output;
}

function webGpuReadbackUsesBgra(
  engine: AbstractEngine,
  backend: StudioBg3dBabylonCapturePlan["backend"],
): boolean {
  const inspected = engine as AbstractEngine & {
    readonly _colorFormat?: unknown;
    readonly isWebGPU?: unknown;
    readonly webGLVersion?: unknown;
  };
  if (backend === "webgl2") {
    if (inspected.isWebGPU === true || inspected.webGLVersion !== 2) {
      throw captureError("renderer-unavailable");
    }
    return false;
  }
  if (inspected.isWebGPU !== true || typeof inspected._colorFormat !== "string") {
    throw captureError("renderer-unavailable");
  }
  if (inspected._colorFormat.startsWith("bgra8")) return true;
  if (inspected._colorFormat.startsWith("rgba8")) return false;
  throw captureError("renderer-unavailable");
}

function quaternionFromEulerXyz(rotation: readonly [number, number, number]): Quaternion {
  const [x, y, z] = rotation;
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return new Quaternion(
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  );
}

function createFlatRing(name: string, scene: Scene): Mesh {
  const segments = 32;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let segment = 0; segment <= segments; segment += 1) {
    const angle = (segment / segments) * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (const radius of [0.2, 0.5]) {
      positions.push(cosine * radius, sine * radius, 0);
      normals.push(0, 0, 1);
      uvs.push(0.5 + cosine * radius, 0.5 + sine * radius);
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const inner = segment * 2;
    const outer = inner + 1;
    indices.push(inner, outer, inner + 2, outer, outer + 2, inner + 2);
  }
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh, false);
  return mesh;
}

function createPrimitiveMesh(
  kind: StudioBg3dPrimitiveKind,
  name: string,
  scene: Scene,
): Mesh {
  switch (kind) {
    case "box":
      return MeshBuilder.CreateBox(name, { size: 1 }, scene);
    case "cylinder":
      return MeshBuilder.CreateCylinder(name, {
        diameter: 0.6,
        height: 1,
        tessellation: 16,
      }, scene);
    case "plane":
      return MeshBuilder.CreatePlane(name, { size: 1 }, scene);
    case "sphere":
      return MeshBuilder.CreateSphere(name, { diameter: 1, segments: 24 }, scene);
    case "hemisphere":
      return MeshBuilder.CreateSphere(name, {
        diameter: 1,
        segments: 24,
        slice: 0.5,
      }, scene);
    case "cone":
      return MeshBuilder.CreateCylinder(name, {
        diameterTop: 0,
        diameterBottom: 0.8,
        height: 1,
        tessellation: 24,
      }, scene);
    case "pyramid":
      return MeshBuilder.CreateCylinder(name, {
        diameterTop: 0,
        diameterBottom: 1,
        height: 1,
        tessellation: 4,
      }, scene);
    case "triangularPrism":
      return MeshBuilder.CreateCylinder(name, {
        diameter: 1,
        height: 1,
        tessellation: 3,
      }, scene);
    case "hexPrism":
      return MeshBuilder.CreateCylinder(name, {
        diameter: 1,
        height: 1,
        tessellation: 6,
      }, scene);
    case "torus":
      return MeshBuilder.CreateTorus(name, {
        diameter: 0.8,
        thickness: 0.3,
        tessellation: 24,
      }, scene);
    case "tube":
      return MeshBuilder.CreateCylinder(name, {
        diameter: 0.8,
        height: 1,
        tessellation: 24,
        cap: Mesh.NO_CAP,
      }, scene);
    case "ring":
      return createFlatRing(name, scene);
    case "capsule":
      return MeshBuilder.CreateCapsule(name, {
        radius: 0.3,
        height: 1.3,
        tessellation: 16,
        capSubdivisions: 8,
      }, scene);
  }
}

function applyNodeTransform(root: TransformNode, node: StudioBg3dSceneNode): void {
  root.position.copyFromFloats(...node.transform.position);
  root.rotationQuaternion = quaternionFromEulerXyz(node.transform.rotation);
  root.scaling.copyFromFloats(...node.transform.scale);
  root.setEnabled(node.visible);
}

function applyMaterialOverride(
  material: Material,
  override: StudioBg3dMaterialOverride,
): void {
  const target = Color3.FromHexString(override.color);
  const emissive = Color3.FromHexString(override.emissiveColor);
  if (material instanceof PBRMaterial) {
    if (override.colorMode === "replace") {
      material.albedoColor = Color3.Lerp(
        material.albedoColor,
        target,
        override.colorStrength,
      );
    } else if (override.colorMode === "multiply") {
      const multiplied = material.albedoColor.multiply(target);
      material.albedoColor = Color3.Lerp(
        material.albedoColor,
        multiplied,
        override.colorStrength,
      );
    }
    if (override.roughness !== null) material.roughness = override.roughness;
    if (override.metalness !== null) material.metallic = override.metalness;
    material.emissiveColor = emissive;
    if (override.emissiveIntensity !== null) {
      material.emissiveIntensity = override.emissiveIntensity;
    }
  } else if (material instanceof StandardMaterial) {
    if (override.colorMode === "replace") {
      material.diffuseColor = Color3.Lerp(
        material.diffuseColor,
        target,
        override.colorStrength,
      );
    } else if (override.colorMode === "multiply") {
      const multiplied = material.diffuseColor.multiply(target);
      material.diffuseColor = Color3.Lerp(
        material.diffuseColor,
        multiplied,
        override.colorStrength,
      );
    }
    material.emissiveColor = emissive.scale(override.emissiveIntensity ?? 1);
  }
  material.alpha *= override.opacityMultiplier;
  material.wireframe = override.wireframe;
  material.backFaceCulling = !override.doubleSided;
}

function createNodeRoots(
  document: StudioBg3dSceneDocument,
  scene: Scene,
): ReadonlyMap<string, TransformNode> {
  const roots = new Map<string, TransformNode>();
  for (const node of document.nodes) {
    const root = new TransformNode(`studio-node:${node.id}`, scene);
    applyNodeTransform(root, node);
    roots.set(node.id, root);
  }
  for (const node of document.nodes) {
    if (!node.parentId) continue;
    const root = roots.get(node.id);
    const parent = roots.get(node.parentId);
    if (!root || !parent) throw captureError("invalid-snapshot");
    root.parent = parent;
  }
  return roots;
}

function meshBounds(meshes: readonly AbstractMesh[]): {
  readonly maximum: Vector3;
  readonly minimum: Vector3;
} | null {
  const minimum = new Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  const maximum = new Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  );
  let found = false;
  for (const mesh of meshes) {
    if (mesh.getTotalVertices() < 1) continue;
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    minimum.minimizeInPlace(bounds.minimumWorld);
    maximum.maximizeInPlace(bounds.maximumWorld);
    found = true;
  }
  return found ? { minimum, maximum } : null;
}

function modelAutoFitScale(meshes: readonly AbstractMesh[]): number {
  const bounds = meshBounds(meshes);
  if (!bounds) return 1;
  const size = bounds.maximum.subtract(bounds.minimum);
  const maximumDimension = Math.max(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z));
  return Number.isFinite(maximumDimension) && maximumDimension > 0
    ? MODEL_AUTO_FIT_SIZE / maximumDimension
    : 1;
}

async function populateScene(
  context: StudioBg3dBabylonSpecialistExecutionContext,
  plan: StudioBg3dBabylonCapturePlan,
  scene: Scene,
): Promise<{
  readonly materialIdRenderables: readonly StudioBg3dBabylonStableIdRenderable[];
  readonly meshes: readonly AbstractMesh[];
  readonly objectIdRenderables: readonly StudioBg3dBabylonStableIdRenderable[];
  readonly shadowCasters: readonly AbstractMesh[];
}> {
  const rootById = createNodeRoots(plan.document, scene);
  const assetByAttachmentId = new Map(
    plan.assets.map((asset) => [asset.attachmentId, asset]),
  );
  const renderMeshes: AbstractMesh[] = [];
  const objectIdRenderables: StudioBg3dBabylonStableIdRenderable[] = [];
  const materialIdRenderables: StudioBg3dBabylonStableIdRenderable[] = [];
  const shadowCasters: AbstractMesh[] = [];

  for (const node of plan.document.nodes) {
    throwIfAborted(context.signal);
    const root = rootById.get(node.id);
    if (!root) throw captureError("invalid-snapshot");
    if (node.kind === "primitive") {
      const mesh = createPrimitiveMesh(node.primitiveKind, `studio-primitive:${node.id}`, scene);
      mesh.parent = root;
      const material = new StandardMaterial(`studio-primitive-material:${node.id}`, scene);
      material.diffuseColor = Color3.FromHexString(node.color);
      mesh.material = material;
      mesh.receiveShadows = node.receivesShadow;
      renderMeshes.push(mesh);
      if (plan.includeObjectId) {
        objectIdRenderables.push({
          descriptor: stableObjectDescriptor(node),
          mesh,
        });
      }
      if (plan.includeMaterialId) {
        materialIdRenderables.push({
          descriptor: primitiveMaterialDescriptor(node),
          mesh,
        });
      }
      if (node.castsShadow) shadowCasters.push(mesh);
      continue;
    }

    const asset = assetByAttachmentId.get(node.attachmentId);
    if (!asset) throw captureError("asset-mismatch");
    const { imported } = await runStudioBg3dBabylonBoundedImport({
      bytes: asset.bytes,
      budgets: plan.document.budgets,
      name: `${asset.attachmentId}.glb`,
      preflight: asset.footprint,
      scene,
      signal: context.signal,
    });
    throwIfAborted(context.signal);
    for (const group of imported.animationGroups) {
      group.stop();
      group.reset();
    }
    const importedNodes = new Set<Node>([
      ...imported.meshes,
      ...imported.transformNodes,
    ]);
    const contentRoot = new TransformNode(`studio-model-content:${node.id}`, scene);
    for (const importedNode of importedNodes) {
      if (!importedNode.parent || !importedNodes.has(importedNode.parent)) {
        importedNode.parent = contentRoot;
      }
    }
    // Measure the decoded asset before the persisted node hierarchy contributes translation,
    // rotation, or user scale. This matches the Three viewport's source-root auto-fit step.
    contentRoot.scaling.setAll(modelAutoFitScale(imported.meshes));
    contentRoot.parent = root;
    const overriddenMaterials = new Set<Material>();
    for (const mesh of imported.meshes) {
      if (mesh.getTotalVertices() < 1) continue;
      mesh.receiveShadows = node.receivesShadow;
      if (
        mesh.material &&
        node.materialOverride &&
        !overriddenMaterials.has(mesh.material)
      ) {
        applyMaterialOverride(mesh.material, node.materialOverride);
        overriddenMaterials.add(mesh.material);
      }
      renderMeshes.push(mesh);
      if (plan.includeObjectId) {
        objectIdRenderables.push({
          descriptor: stableObjectDescriptor(node),
          mesh,
        });
      }
      if (plan.includeMaterialId) {
        materialIdRenderables.push({
          descriptor: modelMaterialDescriptor(asset, mesh, node),
          mesh,
        });
      }
      if (node.castsShadow) shadowCasters.push(mesh);
    }
  }
  return Object.freeze({
    materialIdRenderables: Object.freeze(materialIdRenderables),
    meshes: Object.freeze(renderMeshes),
    objectIdRenderables: Object.freeze(objectIdRenderables),
    shadowCasters: Object.freeze(shadowCasters),
  });
}

function setupCamera(
  document: StudioBg3dSceneDocument,
  width: number,
  height: number,
  scene: Scene,
): FreeCamera {
  const cameraSettings = document.camera;
  const camera = new FreeCamera(
    "studio-capture-camera",
    new Vector3(...cameraSettings.position),
    scene,
  );
  camera.minZ = resolveStudioBg3dCameraNearClip(cameraSettings.nearClip);
  camera.maxZ = CAMERA_FAR_CLIP;
  const zoom = cameraSettings.zoom ?? 1;
  camera.fov = 2 * Math.atan(Math.tan((cameraSettings.fovDegrees * Math.PI) / 360) / zoom);
  camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
  const up = resolveStudioBg3dCameraUpVector(cameraSettings);
  camera.upVector.copyFromFloats(...up);
  camera.setTarget(new Vector3(...cameraSettings.target));
  camera.viewport.width = 1;
  camera.viewport.height = 1;
  camera.viewport.x = 0;
  camera.viewport.y = 0;
  // Force projection creation at the requested aspect before shader compilation/readback.
  void width;
  void height;
  scene.activeCamera = camera;
  return camera;
}

function setupScenePresentation(
  document: StudioBg3dSceneDocument,
  scene: Scene,
): void {
  scene.useRightHandedSystem = true;
  scene.autoClear = true;
  scene.autoClearDepthAndStencil = true;
  const transparent =
    document.output.transparentBackground || document.background.mode === "transparent";
  const clearColor = document.background.mode === "color"
    ? document.background.color
    : document.background.skyPresetId === "blank"
      ? "#ffffff"
      : document.background.color;
  const parsedClearColor = transparent
    ? Color3.Black()
    : Color3.FromHexString(clearColor);
  scene.clearColor = new Color4(
    parsedClearColor.r,
    parsedClearColor.g,
    parsedClearColor.b,
    transparent ? 0 : 1,
  );

  const image = scene.imageProcessingConfiguration;
  image.exposure = document.render.exposure;
  image.toneMappingEnabled = document.render.toneMapping !== "none";
  image.toneMappingType = document.render.toneMapping === "aces"
    ? ImageProcessingConfiguration.TONEMAPPING_ACES
    : ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  image.applyByPostProcess = false;

  if (document.background.fogEnabled) {
    // Babylon's stable public FOGMODE_LINEAR enum value.
    scene.fogMode = 3;
    scene.fogStart = document.background.fogNear ?? 10;
    scene.fogEnd = document.background.fogFar ?? 50;
    scene.fogColor = Color3.FromHexString(document.background.fogColor ?? clearColor);
  }
}

function setupLightingAndShadows(
  document: StudioBg3dSceneDocument,
  scene: Scene,
  shadowCasters: readonly AbstractMesh[],
): void {
  const ambient = new HemisphericLight(
    "studio-ambient",
    Vector3.Up(),
    scene,
  );
  ambient.diffuse = Color3.FromHexString(document.lighting.ambientColor);
  // Equal sky/ground colors make the hemispheric term a uniform ambient contribution.
  ambient.groundColor = ambient.diffuse.clone();
  ambient.specular = Color3.Black();
  ambient.intensity = document.lighting.ambientIntensity;

  for (const [name, settings] of [
    ["key", document.lighting.key],
    ["fill", document.lighting.fill],
  ] as const) {
    // Document direction points from subject toward the light; Babylon stores light-ray direction.
    const light = new DirectionalLight(
      `studio-${name}`,
      new Vector3(
        -settings.direction[0],
        -settings.direction[1],
        -settings.direction[2],
      ),
      scene,
    );
    light.diffuse = Color3.FromHexString(settings.color);
    light.intensity = settings.intensity;
    if (
      document.render.shadows &&
      settings.castsShadow &&
      shadowCasters.length > 0
    ) {
      const generator = new ShadowGenerator(
        Math.min(2048, document.quality.desktop.shadowMapSize),
        light,
        true,
      );
      generator.usePercentageCloserFiltering = true;
      generator.bias = 0.0005;
      generator.normalBias = 0.02;
      for (const mesh of shadowCasters) generator.addShadowCaster(mesh, false);
    }
  }
}

async function captureStudioBg3dBabylonNormalsWithDeadline(
  context: StudioBg3dBabylonSpecialistExecutionContext,
  plan: StudioBg3dBabylonCapturePlan,
  scene: Scene,
  meshes: readonly AbstractMesh[],
  depth: Float32Array,
): Promise<Uint8Array> {
  throwIfAborted(context.signal);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromJob = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MAX_CAPTURE_WAIT_MS);
  context.signal.addEventListener("abort", abortFromJob, { once: true });
  try {
    return await captureStudioBg3dBabylonNormals({
      backend: plan.backend,
      depth,
      height: plan.height,
      meshes,
      scene,
      signal: controller.signal,
      width: plan.width,
    });
  } catch (error) {
    if (context.signal.aborted) throw captureError("aborted", error);
    if (timedOut) throw captureError("timeout", error);
    if (error instanceof StudioBg3dBabylonNormalCaptureError) {
      if (error.code === "aborted") throw captureError("aborted", error);
      if (error.code === "unsupported") {
        throw captureError("unsupported-artifact", error);
      }
      throw captureError("capture-failed", error);
    }
    throw captureError("capture-failed", error);
  } finally {
    clearTimeout(timeout);
    context.signal.removeEventListener("abort", abortFromJob);
  }
}

async function captureStudioBg3dBabylonStableIdsWithDeadline(
  context: StudioBg3dBabylonSpecialistExecutionContext,
  plan: StudioBg3dBabylonCapturePlan,
  scene: Scene,
  renderables: readonly StudioBg3dBabylonStableIdRenderable[],
): Promise<StudioBg3dBabylonStableIdFrame> {
  throwIfAborted(context.signal);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromJob = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MAX_CAPTURE_WAIT_MS);
  context.signal.addEventListener("abort", abortFromJob, { once: true });
  try {
    return await captureStudioBg3dBabylonStableIds({
      backend: plan.backend,
      height: plan.height,
      renderables,
      scene,
      signal: controller.signal,
      width: plan.width,
    });
  } catch (error) {
    if (context.signal.aborted) throw captureError("aborted", error);
    if (timedOut) throw captureError("timeout", error);
    if (error instanceof StudioBg3dBabylonStableIdCaptureError) {
      if (error.code === "aborted") throw captureError("aborted", error);
      if (error.code === "unsupported") {
        throw captureError("unsupported-artifact", error);
      }
      throw captureError("capture-failed", error);
    }
    throw captureError("capture-failed", error);
  } finally {
    clearTimeout(timeout);
    context.signal.removeEventListener("abort", abortFromJob);
  }
}

async function renderStudioBg3dBabylonCapture(
  context: StudioBg3dBabylonSpecialistExecutionContext,
  plan: StudioBg3dBabylonCapturePlan,
): Promise<StudioBg3dBabylonCaptureFrame> {
  const engine = context.engine as AbstractEngine;
  const scene = context.scene as Scene;
  if (
    typeof engine.setSize !== "function" ||
    (plan.includeBeauty && typeof engine.readPixels !== "function") ||
    typeof scene.render !== "function" ||
    typeof scene.whenReadyAsync !== "function"
  ) {
    throw captureError("renderer-unavailable");
  }
  const transparent =
    plan.document.output.transparentBackground ||
    plan.document.background.mode === "transparent";
  if (plan.includeBeauty && transparent && plan.backend === "webgpu") {
    // Babylon configures a non-premultiplied WebGPU canvas as `alphaMode: opaque`; until capture
    // uses a dedicated RGBA render target, returning alpha from the swap chain would be misleading.
    throw captureError("unsupported-scene-feature");
  }
  const swapRedBlue = plan.includeBeauty && webGpuReadbackUsesBgra(engine, plan.backend);
  throwIfAborted(context.signal);
  engine.setHardwareScalingLevel(1);
  engine.setSize(plan.width, plan.height, true);
  if (
    engine.getRenderWidth(true) !== plan.width ||
    engine.getRenderHeight(true) !== plan.height
  ) {
    throw captureError("renderer-unavailable");
  }
  setupScenePresentation(plan.document, scene);
  const camera = setupCamera(plan.document, plan.width, plan.height, scene);
  const populated = await populateScene(context, plan, scene);
  setupLightingAndShadows(
    plan.document,
    scene,
    populated.shadowCasters,
  );

  const hasDepthGeometry = populated.meshes.some((mesh) =>
    mesh.getTotalVertices() > 0 && mesh.isEnabled() && mesh.isVisible
  );
  const requiresDepth = plan.includeDepth || plan.includeNormal;
  let depthRenderer: DepthRenderer | null = null;
  let readbacksOwnDepthRenderer = false;
  let readbacksDrained = false;
  let depthRendererDisposeRequested = false;
  let depthRendererDisposed = false;
  const disposeDepthRendererIfReady = () => {
    if (
      depthRendererDisposed ||
      !depthRendererDisposeRequested ||
      !readbacksDrained
    ) {
      return;
    }
    depthRendererDisposed = true;
    depthRenderer?.dispose();
  };
  try {
    if (requiresDepth && hasDepthGeometry) {
      depthRenderer = scene.enableDepthRenderer(
        camera,
        false,
        true,
        Constants.TEXTURE_NEAREST_SAMPLINGMODE,
        false,
      );
      if (depthRenderer.isPacked) throw captureError("renderer-unavailable");
      depthRenderer.clearColor = new Color4(1, 1, 1, 1);
      depthRenderer.forceDepthWriteTransparentMeshes = true;
      depthRenderer.useOnlyInActiveCamera = true;
      depthRenderer.getDepthMap().renderList = [...populated.meshes];
    }

    await withAbortAndDeadline(scene.whenReadyAsync(true), context.signal);
    throwIfAborted(context.signal);
    // One warm-up resolves material/RTT compilation; the second frame is the canonical readback.
    scene.render(true, true);
    scene.render(true, true);
    const flipY = plan.backend === "webgl2";
    const activeDepthRenderer = depthRenderer;
    readbacksOwnDepthRenderer = true;
    const readbacks = await runStudioBg3dBabylonSerializedReadbacks<
      Uint8Array,
      Float32Array
    >({
      ...(plan.includeBeauty
        ? {
          beauty: async () => rgbaRowsTopDown(
            await engine.readPixels(0, 0, plan.width, plan.height, true, true),
            plan.width,
            plan.height,
            flipY,
            swapRedBlue,
            transparent,
          ),
        }
        : {}),
      ...(activeDepthRenderer
        ? {
          depth: async () => depthRowsTopDown(
            await (
              activeDepthRenderer.getDepthMap().readPixels(
                0,
                0,
                null,
                true,
                false,
                0,
                0,
                plan.width,
                plan.height,
              ) ?? Promise.reject(captureError("renderer-unavailable"))
            ),
            plan.width,
            plan.height,
            flipY,
          ),
        }
        : {}),
      release: () => {
        readbacksDrained = true;
        disposeDepthRendererIfReady();
      },
      signal: context.signal,
    });
    const rgba = readbacks.beauty;
    const depth = readbacks.depth ?? (
      requiresDepth
        ? new Float32Array(plan.width * plan.height).fill(1)
        : undefined
    );
    const normal = plan.includeNormal && depth
      ? await captureStudioBg3dBabylonNormalsWithDeadline(
        context,
        plan,
        scene,
        populated.meshes,
        depth,
      )
      : undefined;
    const objectId = plan.includeObjectId
      ? await captureStudioBg3dBabylonStableIdsWithDeadline(
        context,
        plan,
        scene,
        populated.objectIdRenderables,
      )
      : undefined;
    const materialId = plan.includeMaterialId
      ? await captureStudioBg3dBabylonStableIdsWithDeadline(
        context,
        plan,
        scene,
        populated.materialIdRenderables,
      )
      : undefined;
    return {
      ...(rgba ? { rgba } : {}),
      ...(depth ? { depth } : {}),
      ...(materialId ? { materialId } : {}),
      ...(normal ? { normal } : {}),
      ...(objectId ? { objectId } : {}),
    };
  } catch (error) {
    if (
      error instanceof StudioBg3dBabylonCaptureError ||
      error instanceof StudioBg3dBabylonSpecialistError
    ) {
      throw error;
    }
    throw captureError("capture-failed", error);
  } finally {
    if (!readbacksOwnDepthRenderer) {
      depthRenderer?.dispose();
    } else {
      depthRendererDisposeRequested = true;
      disposeDepthRendererIfReady();
    }
  }
}

export function createStudioBg3dBabylonCaptureExecutor(
  render: StudioBg3dBabylonCaptureRenderer = renderStudioBg3dBabylonCapture,
): StudioBg3dBabylonSpecialistExecutor {
  return async (context): Promise<StudioBg3dSpecialistResult> => {
    throwIfAborted(context.signal);
    if (context.job.request.kind === "runtime-metrics") {
      return metricsResult(context);
    }
    const requested = resolveCaptureRequest(context.job);
    if (!requested) {
      throw new StudioBg3dBabylonSpecialistError("unsupported-request");
    }
    const plan = createCapturePlan(context, requested);
    const frame = validateFrame(await render(context, plan), requested);
    throwIfAborted(context.signal);
    if (requested.format === "artifact-v2") {
      return toArtifactResult(context.job, requested, frame);
    }
    if (!frame.rgba) throw captureError("capture-failed");
    return {
      kind: "capture",
      width: requested.width,
      height: requested.height,
      rgba: frame.rgba,
      ...(requested.includeDepth && frame.depth
        ? { depthFloat32: frame.depth }
        : {}),
    };
  };
}

export const executeStudioBg3dBabylonCapture =
  createStudioBg3dBabylonCaptureExecutor();
