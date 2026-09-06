/**
 * Engine-neutral, persistence-safe document for Studio's 3D background editor.
 *
 * Runtime objects, engine classes, Blob/File values, object URLs, remote URLs, storage keys, and
 * credentials are deliberately outside this schema. Model binaries are resolved by attachment id
 * at the runtime boundary; this document stores only bounded GLB metadata and scene intent.
 */

import {
  attachStudioGeneric3dWorkflowMetadata,
  parseStudioGeneric3dWorkflowMetadata,
  type StudioGeneric3dWorkflowMetadataRecord,
} from "../studio-generic-3d-workflow-metadata";

import {
  STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
  STUDIO_BG3D_CAMERA_DEFAULT_UP,
  STUDIO_BG3D_CAMERA_MAX_NEAR_CLIP,
  STUDIO_BG3D_CAMERA_MIN_NEAR_CLIP,
  isStudioBg3dCameraUpVectorValid,
  normalizeStudioBg3dCameraUpVector,
  resolveStudioBg3dCameraUpVector,
} from "./studio-bg3d-camera-orientation";
import { normalizeStudioBg3dCaptureAspectRatio } from "./studio-bg3d-capture-frame-geometry";
import { normalizeStudioBg3dHierarchyParents } from "./studio-bg3d-hierarchy";

export const STUDIO_BG3D_SCENE_DOCUMENT_KIND = "toonspectrum.bg3d-scene" as const;
export const STUDIO_BG3D_SCENE_DOCUMENT_VERSION = 3 as const;
const STUDIO_BG3D_SCHEMA_V2_SCENE_DOCUMENT_VERSION = 2 as const;
const STUDIO_BG3D_LEGACY_SCENE_DOCUMENT_VERSION = 1 as const;
// Schema v3 adds an explicit `twoBoneIks` collection to every constrained model. Keeping the old
// 256 KiB ceiling would make an otherwise valid near-cap v2 document fail migration solely because
// each aim-only layer gains `twoBoneIks: []`. The bounded 320 KiB ceiling preserves all legacy
// payloads while retaining a small, deterministic metadata budget.
export const STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES = 320 * 1024;
export const STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES = 512;
/**
 * Attachment budget must cover Hybrid DCC editable room presets (classroom ≈ 66
 * parts) plus a few CAD/prop assets. Align with Hybrid layout/room authority
 * caps (256) so "교실 세트 → 3D 배경 편집기" handoff does not fail by default.
 */
export const STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS = 256;
export const STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS = 64;
export const STUDIO_BG3D_SHOT_ID_MAX_LENGTH = 80;
export const STUDIO_BG3D_SHOT_NAME_MAX_LENGTH = 80;
export const STUDIO_BG3D_SHOT_MAX_NODE_VISIBILITY_OVERRIDES =
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES;
export const STUDIO_BG3D_GLB_MIME = "model/gltf-binary" as const;
export const STUDIO_BG3D_GLB_MAX_BYTES = 100 * 1024 * 1024;

export type StudioBg3dSceneDocumentBudgetErrorCode =
  | "input-byte-budget-exceeded"
  | "attachment-count-budget-exceeded"
  | "model-byte-budget-exceeded"
  | "node-count-budget-exceeded"
  | "pose-joint-count-budget-exceeded"
  | "morph-target-count-budget-exceeded"
  | "aim-constraint-count-budget-exceeded"
  | "two-bone-ik-count-budget-exceeded"
  | "shot-count-budget-exceeded"
  | "shot-visibility-count-budget-exceeded"
  | "document-byte-budget-exceeded";

/**
 * Typed fail-closed signal for editor normalization. Strict parse/serialize APIs continue to return
 * `null`; the lenient editor API throws this error instead of returning a valid-looking prefix.
 */
export class StudioBg3dSceneDocumentBudgetError extends Error {
  readonly code: StudioBg3dSceneDocumentBudgetErrorCode;

  constructor(code: StudioBg3dSceneDocumentBudgetErrorCode) {
    super(`Studio BG3D scene document budget exceeded: ${code}.`);
    this.name = "StudioBg3dSceneDocumentBudgetError";
    this.code = code;
  }
}

type BudgetFailureMode = "null" | "throw";

function failBudget(code: StudioBg3dSceneDocumentBudgetErrorCode): never {
  throw new StudioBg3dSceneDocumentBudgetError(code);
}

export type StudioBg3dVec3 = readonly [number, number, number];
export type StudioBg3dQuaternion = readonly [number, number, number, number];

export const STUDIO_BG3D_PRIMITIVE_KINDS = [
  "box",
  "cylinder",
  "plane",
  "sphere",
  "hemisphere",
  "cone",
  "pyramid",
  "triangularPrism",
  "hexPrism",
  "torus",
  "tube",
  "ring",
  "capsule",
] as const;

export type StudioBg3dPrimitiveKind = (typeof STUDIO_BG3D_PRIMITIVE_KINDS)[number];
export type StudioBg3dBackgroundMode = "color" | "sky-preset" | "transparent";
export const STUDIO_BG3D_SKY_PRESET_IDS = ["blank", "clear_day", "sunset", "night"] as const;
export type StudioBg3dSkyPresetId = (typeof STUDIO_BG3D_SKY_PRESET_IDS)[number];
export type StudioBg3dToneMapping = "none" | "neutral" | "aces";
export type StudioBg3dToneMode = "none" | "flat" | "cel" | "screentone";
export type StudioBg3dLineLayerType = "raster" | "vector";
export type StudioBg3dToneOutputType = "color" | "grayscale" | "pattern";
export type StudioBg3dTonePattern = "dot" | "line" | "crosshatch" | "noise";
export type StudioBg3dMaterialColorMode = "original" | "multiply" | "replace";
export type StudioBg3dAnimationLoopMode = "once" | "repeat" | "ping-pong";
export type StudioBg3dAttachmentSource = "upload" | "local-library" | "bundled";
export type StudioBg3dRightsStatus = "owned" | "licensed" | "public-domain" | "unknown";

export interface StudioBg3dTransform {
  readonly position: StudioBg3dVec3;
  /** Euler XYZ radians, normalized to [-PI, PI]. */
  readonly rotation: StudioBg3dVec3;
  readonly scale: StudioBg3dVec3;
}

/** Engine-neutral per-instance material adjustments; source textures remain asset-owned. */
export interface StudioBg3dMaterialOverride {
  readonly colorMode: StudioBg3dMaterialColorMode;
  readonly color: string;
  readonly colorStrength: number;
  readonly opacityMultiplier: number;
  readonly roughness: number | null;
  readonly metalness: number | null;
  readonly emissiveColor: string;
  readonly emissiveIntensity: number | null;
  readonly wireframe: boolean;
  readonly doubleSided: boolean;
}

export const DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE: StudioBg3dMaterialOverride = Object.freeze({
  colorMode: "original",
  color: "#ffffff",
  colorStrength: 1,
  opacityMultiplier: 1,
  roughness: null,
  metalness: null,
  emissiveColor: "#000000",
  emissiveIntensity: null,
  wireframe: false,
  doubleSided: false,
});

export interface StudioBg3dAnimationPlayback {
  readonly clipIndex: number;
  readonly playing: boolean;
  readonly loop: StudioBg3dAnimationLoopMode;
  readonly timeSeconds: number;
  readonly timeScale: number;
  readonly weight: number;
}

export const DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK: StudioBg3dAnimationPlayback = Object.freeze({
  clipIndex: 0,
  playing: false,
  loop: "repeat",
  timeSeconds: 0,
  timeScale: 1,
  weight: 1,
});

export interface StudioBg3dJointPoseOverride {
  /** Engine-neutral canonical skin/joint ordinal, e.g. `skin-0:joint-12`. */
  readonly jointKey: string;
  /** Additive local-space rotation relative to the sampled animation/rest pose. */
  readonly rotationOffset: StudioBg3dQuaternion;
}

export interface StudioBg3dPoseLayer {
  readonly enabled: boolean;
  readonly weight: number;
  readonly joints: readonly StudioBg3dJointPoseOverride[];
}

export const DEFAULT_STUDIO_BG3D_POSE_LAYER: StudioBg3dPoseLayer = Object.freeze({
  enabled: true,
  weight: 1,
  joints: Object.freeze([]),
});

export interface StudioBg3dMorphWeightOverride {
  /** Engine-neutral canonical renderable/target ordinal, e.g. `mesh-2:target-0`. */
  readonly targetKey: string;
  /** Additive offset applied after animation sampling. */
  readonly weightOffset: number;
}

export interface StudioBg3dMorphLayer {
  readonly enabled: boolean;
  readonly weight: number;
  readonly targets: readonly StudioBg3dMorphWeightOverride[];
}

export const DEFAULT_STUDIO_BG3D_MORPH_LAYER: StudioBg3dMorphLayer = Object.freeze({
  enabled: true,
  weight: 1,
  targets: Object.freeze([]),
});

export const STUDIO_BG3D_AIM_AXES = [
  "+x", "-x", "+y", "-y", "+z", "-z",
] as const;
export const STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS = 32;
export type StudioBg3dAimAxis = (typeof STUDIO_BG3D_AIM_AXES)[number];

export interface StudioBg3dJointAimConstraint {
  readonly jointKey: string;
  /** Target point in the model instance's local coordinate system. */
  readonly target: StudioBg3dVec3;
  /** Joint-local axis that should point toward the target. */
  readonly axis: StudioBg3dAimAxis;
  readonly weight: number;
}

export interface StudioBg3dTwoBoneIkConstraint {
  readonly upperJointKey: string;
  readonly middleJointKey: string;
  readonly endJointKey: string;
  /** End-effector target in the model instance's local coordinate system. */
  readonly target: StudioBg3dVec3;
  /** Model-local point defining the elbow/knee bend plane. */
  readonly poleTarget: StudioBg3dVec3;
  readonly weight: number;
}

export interface StudioBg3dConstraintLayer {
  readonly enabled: boolean;
  readonly aims: readonly StudioBg3dJointAimConstraint[];
  readonly twoBoneIks: readonly StudioBg3dTwoBoneIkConstraint[];
}

export const DEFAULT_STUDIO_BG3D_CONSTRAINT_LAYER: StudioBg3dConstraintLayer = Object.freeze({
  enabled: true,
  aims: Object.freeze([]),
  twoBoneIks: Object.freeze([]),
});

export interface StudioBg3dCameraSettings {
  readonly position: StudioBg3dVec3;
  readonly target: StudioBg3dVec3;
  readonly fovDegrees: number;
  readonly projection?: "perspective" | "orthographic";
  readonly zoom?: number;
  readonly lensShift?: readonly [number, number];
  /** Positive scene-unit near plane. Absent only on canonical pre-Camera-vNext v3 documents. */
  readonly nearClip?: number;
  /** Unit look-at up reference. It represents Dutch roll without persisting engine quaternions. */
  readonly up?: StudioBg3dVec3;
}

export interface StudioBg3dRenderSettings {
  readonly antialias: boolean;
  readonly shadows: boolean;
  readonly exposure: number;
  readonly toneMapping: StudioBg3dToneMapping;
  readonly colorSpace: "srgb";
}

export interface StudioBg3dBackgroundSettings {
  readonly mode: StudioBg3dBackgroundMode;
  readonly color: string;
  readonly skyPresetId: StudioBg3dSkyPresetId;
  /** Horizontal rotation of the allowlisted procedural equirectangular sky, in degrees. */
  readonly panoramaRotation: number;
  readonly fogEnabled?: boolean;
  readonly fogColor?: string;
  readonly fogNear?: number;
  readonly fogFar?: number;
}

export interface StudioBg3dDirectionalLightSettings {
  readonly color: string;
  /** Unit vector from the lit subject toward the light. */
  readonly direction: StudioBg3dVec3;
  readonly intensity: number;
  readonly castsShadow: boolean;
}

export interface StudioBg3dLightingSettings {
  readonly ambientColor: string;
  readonly ambientIntensity: number;
  readonly key: StudioBg3dDirectionalLightSettings;
  readonly fill: StudioBg3dDirectionalLightSettings;
}

export interface StudioBg3dQualityProfile {
  readonly targetFps: number;
  readonly dprMin: number;
  readonly dprMax: number;
  readonly maxRenderPixels: number;
  readonly shadows: boolean;
  readonly shadowMapSize: 256 | 512 | 1024 | 2048 | 4096;
  readonly textureScale: number;
  readonly lodBias: number;
}

export interface StudioBg3dQualityProfiles {
  readonly desktop: StudioBg3dQualityProfile;
  readonly mobile: StudioBg3dQualityProfile;
}

export interface StudioBg3dLineOutputSettings {
  readonly enabled: boolean;
  readonly layerType: StudioBg3dLineLayerType;
  readonly color: string;
  readonly widthPx: number;
  readonly strength: number;
  readonly accuracy: number;
  readonly scaleAwareAccuracy: boolean;
  readonly exteriorOutlineStrength: number;
  readonly depthEnabled: boolean;
  readonly depthStrength: number;
  readonly depthOutlineOnly: boolean;
  readonly smoothing: number;
  readonly textureLineEnabled: boolean;
  readonly textureLineStrength: number;
  readonly creaseAngleDegrees: number;
  readonly hiddenLineRemoval: boolean;
}

export interface StudioBg3dToneOutputSettings {
  readonly mode: StudioBg3dToneMode;
  readonly type: StudioBg3dToneOutputType;
  readonly pattern: StudioBg3dTonePattern;
  readonly levels: number;
  readonly opacity: number;
  readonly frequency: number;
  readonly angleDegrees: number;
}

export interface StudioBg3dOutputSettings {
  readonly transparentBackground: boolean;
  readonly exportHeight: number;
  /**
   * 명시적 캡처 가로세로 비율(width / height).
   *
   * 이 키가 없는 문서는 예전과 똑같이 "라이브 뷰포트 비율"을 따른다(자동). 기본값을 넣어 버리면
   * 이미 저장된 장면의 삽입 결과가 조용히 바뀌므로, 사용자가 비율을 고정했을 때만 기록한다.
   */
  readonly exportAspectRatio?: number;
  readonly line: StudioBg3dLineOutputSettings;
  readonly tone: StudioBg3dToneOutputSettings;
}

export interface StudioBg3dComplexityBudget {
  readonly maxNodes: number;
  readonly maxTriangles: number;
  readonly maxDrawCalls: number;
  readonly maxMaterials: number;
  readonly maxLights: number;
  readonly maxAnimations: number;
  readonly maxAnimationChannels: number;
  /** Sum of timeline keys referenced by animation channels. */
  readonly maxAnimationKeyframes: number;
  /** Scalar components in animation sampler outputs after accessor type expansion. */
  readonly maxAnimationValues: number;
  readonly maxSkins: number;
  /** Sum of joint references across skins. */
  readonly maxJoints: number;
  /** Sum of morph target records across mesh primitives. */
  readonly maxMorphTargets: number;
  /** Sum of accessor element counts before component expansion. */
  readonly maxAccessorElements: number;
  /** Conservative decoded allocation estimate for all accessors. */
  readonly maxDecodedGeometryBytes: number;
  readonly maxModelBytes: number;
}

export interface StudioBg3dTextureBudget {
  readonly maxTextures: number;
  readonly maxTotalBytes: number;
  readonly maxDimension: number;
}

export interface StudioBg3dSceneBudgets {
  readonly complexity: StudioBg3dComplexityBudget;
  readonly textures: StudioBg3dTextureBudget;
}

export interface StudioBg3dAttachmentRights {
  readonly status: StudioBg3dRightsStatus;
  readonly commercialUse: boolean;
  readonly attributionRequired: boolean;
  readonly attribution?: string;
  readonly licenseName?: string;
}

export interface StudioBg3dModelAttachment {
  readonly id: string;
  readonly name: string;
  readonly mime: typeof STUDIO_BG3D_GLB_MIME;
  readonly byteSize: number;
  /** Lowercase `sha256:` followed by exactly 64 hexadecimal characters. */
  readonly hash: string;
  readonly rights: StudioBg3dAttachmentRights;
  readonly source: StudioBg3dAttachmentSource;
  /**
   * Optional generic (non-VRM) workflow classification / source-format block.
   * Sanitized via `studio-generic-3d-workflow-metadata` on parse; omitted when unknown.
   */
  readonly generic3dWorkflow?: StudioGeneric3dWorkflowMetadataRecord;
}

/**
 * Input contract for the runtime GLB trust boundary. The verifier implementation lives outside
 * this persistence module. It must immediately copy `bytes`, then verify the exact response MIME,
 * metadata byte length, SHA-256, GLB `glTF` magic, version 2, header-declared length, and the
 * cumulative byte limit before handing the owned copy to an engine parser.
 */
export interface StudioBg3dGlbVerificationRequest {
  readonly attachment: StudioBg3dModelAttachment;
  readonly bytes: Uint8Array;
  readonly responseMime: string;
  readonly cumulativeResolvedBytes: number;
  readonly maxCumulativeResolvedBytes: number;
}

/** A successful verifier result; `verifiedBytes` must be the verifier-owned defensive copy. */
export interface StudioBg3dGlbVerificationSuccess {
  readonly ok: true;
  readonly attachmentId: string;
  readonly verifiedBytes: Uint8Array;
  readonly byteSize: number;
  readonly computedHash: string;
  readonly glbVersion: 2;
  readonly nextCumulativeResolvedBytes: number;
}

export type StudioBg3dGlbVerificationFailureCode =
  | "invalid-request"
  | "mime-mismatch"
  | "byte-size-mismatch"
  | "cumulative-byte-budget-exceeded"
  | "invalid-glb-header"
  | "unsupported-glb-version"
  | "declared-length-mismatch"
  | "sha256-mismatch"
  | "digest-unavailable";

export interface StudioBg3dGlbVerificationFailure {
  readonly ok: false;
  readonly code: StudioBg3dGlbVerificationFailureCode;
}

export type StudioBg3dGlbVerificationResult =
  | StudioBg3dGlbVerificationSuccess
  | StudioBg3dGlbVerificationFailure;

/**
 * Engine-reported metrics that must be checked after GLB parsing and before scene admission.
 * Counts are totals for the resolved asset, including generated primitives and decoded textures.
 */
export interface StudioBg3dParsedGlbMetrics {
  readonly nodes: number;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly materials: number;
  readonly lights: number;
  readonly animations: number;
  readonly animationChannels: number;
  readonly animationKeyframes: number;
  readonly animationValues: number;
  readonly skins: number;
  readonly joints: number;
  readonly morphTargets: number;
  readonly accessorElements: number;
  readonly estimatedDecodedGeometryBytes: number;
  readonly textures: number;
  readonly textureBytes: number;
  readonly maxTextureDimension: number;
}

/**
 * Post-parse admission contract. The runtime validator must reject non-safe/non-negative metrics,
 * then compare nodes, triangles, draw calls, materials, and lights to `budgets.complexity`, plus
 * texture count, decoded texture bytes, and maximum dimension to `budgets.textures`. This check is
 * intentionally after engine parsing; file byte size is not a proxy for decoded scene complexity.
 */
export interface StudioBg3dPostParseBudgetRequest {
  readonly metrics: StudioBg3dParsedGlbMetrics;
  readonly budgets: StudioBg3dSceneBudgets;
}

export interface StudioBg3dLegacyMigrationOptions {
  /**
   * Explicit bridge from an old IndexedDB storage key to a newly issued logical attachment id.
   * A mapping whose value equals its key is rejected, and the mapped id must resolve to canonical
   * attachment metadata in the legacy payload. Storage keys never enter the persisted document.
   */
  readonly attachmentIdByLegacyStorageKey?: ReadonlyMap<string, string>;
}

interface StudioBg3dSceneNodeBase {
  readonly id: string;
  readonly name: string;
  readonly transform: StudioBg3dTransform;
  readonly visible: boolean;
  /** When true, transform gizmo and numeric edits are blocked in the editor. */
  readonly locked: boolean;
  readonly castsShadow: boolean;
  readonly receivesShadow: boolean;
  /** Parent node ID for hierarchy grouping. null/undefined means root. */
  readonly parentId?: string | null;
}

export interface StudioBg3dPrimitiveNode extends StudioBg3dSceneNodeBase {
  readonly kind: "primitive";
  readonly primitiveKind: StudioBg3dPrimitiveKind;
  readonly color: string;
  /** Optional to preserve byte-for-byte compatibility with pre-preset documents. */
  readonly materialOverride?: StudioBg3dMaterialOverride;
}

export interface StudioBg3dModelNode extends StudioBg3dSceneNodeBase {
  readonly kind: "model";
  readonly attachmentId: string;
  readonly materialOverride?: StudioBg3dMaterialOverride;
  readonly animation?: StudioBg3dAnimationPlayback;
  readonly pose?: StudioBg3dPoseLayer;
  readonly morph?: StudioBg3dMorphLayer;
  readonly constraints?: StudioBg3dConstraintLayer;
}

export type StudioBg3dSceneNode = StudioBg3dPrimitiveNode | StudioBg3dModelNode;

/**
 * A shot is a bounded, engine-neutral view of the same scene graph. It may override presentation
 * state, but it never owns geometry, model bytes, URLs, attachment metadata, or runtime handles.
 * Array order is the canonical storyboard order.
 */
export interface StudioBg3dShotCameraOverride {
  readonly position?: StudioBg3dVec3;
  readonly target?: StudioBg3dVec3;
  readonly fovDegrees?: number;
  readonly projection?: "perspective" | "orthographic";
  readonly zoom?: number;
  readonly lensShift?: readonly [number, number];
  readonly nearClip?: number;
  readonly up?: StudioBg3dVec3;
}

export interface StudioBg3dShotRenderOverride {
  readonly antialias?: boolean;
  readonly shadows?: boolean;
  readonly exposure?: number;
  readonly toneMapping?: StudioBg3dToneMapping;
  readonly colorSpace?: "srgb";
}

export interface StudioBg3dShotBackgroundOverride {
  readonly mode?: StudioBg3dBackgroundMode;
  readonly color?: string;
  readonly skyPresetId?: StudioBg3dSkyPresetId;
  readonly panoramaRotation?: number;
  readonly fogEnabled?: boolean;
  readonly fogColor?: string;
  readonly fogNear?: number;
  readonly fogFar?: number;
}

export interface StudioBg3dShotDirectionalLightOverride {
  readonly color?: string;
  readonly direction?: StudioBg3dVec3;
  readonly intensity?: number;
  readonly castsShadow?: boolean;
}

export interface StudioBg3dShotLightingOverride {
  readonly ambientColor?: string;
  readonly ambientIntensity?: number;
  readonly key?: StudioBg3dShotDirectionalLightOverride;
  readonly fill?: StudioBg3dShotDirectionalLightOverride;
}

export interface StudioBg3dShotLineOutputOverride {
  readonly enabled?: boolean;
  readonly layerType?: StudioBg3dLineLayerType;
  readonly color?: string;
  readonly widthPx?: number;
  readonly strength?: number;
  readonly accuracy?: number;
  readonly scaleAwareAccuracy?: boolean;
  readonly exteriorOutlineStrength?: number;
  readonly depthEnabled?: boolean;
  readonly depthStrength?: number;
  readonly depthOutlineOnly?: boolean;
  readonly smoothing?: number;
  readonly textureLineEnabled?: boolean;
  readonly textureLineStrength?: number;
  readonly creaseAngleDegrees?: number;
  readonly hiddenLineRemoval?: boolean;
}

export interface StudioBg3dShotToneOutputOverride {
  readonly mode?: StudioBg3dToneMode;
  readonly type?: StudioBg3dToneOutputType;
  readonly pattern?: StudioBg3dTonePattern;
  readonly levels?: number;
  readonly opacity?: number;
  readonly frequency?: number;
  readonly angleDegrees?: number;
}

/** Partial line/tone export state (LT) for one storyboard shot. */
export interface StudioBg3dShotOutputOverride {
  readonly transparentBackground?: boolean;
  readonly exportHeight?: number;
  readonly line?: StudioBg3dShotLineOutputOverride;
  readonly tone?: StudioBg3dShotToneOutputOverride;
}

export interface StudioBg3dShotNodeVisibilityOverride {
  readonly nodeId: string;
  readonly visible: boolean;
}

export interface StudioBg3dShot {
  readonly id: string;
  readonly name: string;
  readonly camera?: StudioBg3dShotCameraOverride;
  readonly nodeVisibility?: readonly StudioBg3dShotNodeVisibilityOverride[];
  readonly render?: StudioBg3dShotRenderOverride;
  readonly background?: StudioBg3dShotBackgroundOverride;
  readonly lighting?: StudioBg3dShotLightingOverride;
  readonly output?: StudioBg3dShotOutputOverride;
}

export interface StudioBg3dShotCreateRequest {
  readonly id: string;
  readonly name: string;
}

export interface StudioBg3dSceneDocument {
  readonly kind: typeof STUDIO_BG3D_SCENE_DOCUMENT_KIND;
  readonly version: typeof STUDIO_BG3D_SCENE_DOCUMENT_VERSION;
  readonly camera: StudioBg3dCameraSettings;
  readonly render: StudioBg3dRenderSettings;
  readonly background: StudioBg3dBackgroundSettings;
  readonly lighting: StudioBg3dLightingSettings;
  readonly quality: StudioBg3dQualityProfiles;
  readonly output: StudioBg3dOutputSettings;
  readonly budgets: StudioBg3dSceneBudgets;
  readonly attachments: readonly StudioBg3dModelAttachment[];
  readonly nodes: readonly StudioBg3dSceneNode[];
  /** Optional to preserve byte-for-byte compatibility with canonical v3 documents. */
  readonly shots?: readonly StudioBg3dShot[];
  /** Absent means no shot is currently applied; it must reference `shots` when present. */
  readonly activeShotId?: string;
}

const DEFAULT_CAMERA_POSITION: StudioBg3dVec3 = [4, 3, 6];
const DEFAULT_CAMERA_TARGET: StudioBg3dVec3 = [0, 0.6, 0];
const DEFAULT_ROTATION: StudioBg3dVec3 = [0, 0, 0];
const DEFAULT_SCALE: StudioBg3dVec3 = [1, 1, 1];
const MAX_WORLD_COORDINATE = 10_000;
const MIN_SCALE = 0.001;
const MAX_SCALE = 1_000;
const MAX_TEXT_LENGTH = 160;
const MAX_NODE_NAME_LENGTH = 80;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HEX_COLOR_PATTERN = /^#[a-f0-9]{6}$/iu;
const EXTERNAL_REFERENCE_PATTERN = /(?:\b(?:blob|data|file|https?):|:\/\/|\bwww\.)/iu;
const SENSITIVE_REFERENCE_PATTERN =
  /(?:\b(?:api[-_ ]?key|access[-_ ]?token|secret|password)\b|(?:^|\s)sk-[A-Za-z0-9_-]{8,})/iu;
const FORBIDDEN_ID_SET = new Set(["constructor", "prototype", "__proto__"]);
const PRIMITIVE_KIND_SET = new Set<string>(STUDIO_BG3D_PRIMITIVE_KINDS);
const BACKGROUND_MODE_SET = new Set<string>(["color", "sky-preset", "transparent"]);
const SKY_PRESET_SET = new Set<string>(STUDIO_BG3D_SKY_PRESET_IDS);
const TONE_MAPPING_SET = new Set<string>(["none", "neutral", "aces"]);
const TONE_MODE_SET = new Set<string>(["none", "flat", "cel", "screentone"]);
const LINE_LAYER_TYPE_SET = new Set<string>(["raster", "vector"]);
const TONE_OUTPUT_TYPE_SET = new Set<string>(["color", "grayscale", "pattern"]);
const TONE_PATTERN_SET = new Set<string>(["dot", "line", "crosshatch", "noise"]);
const MATERIAL_COLOR_MODE_SET = new Set<string>(["original", "multiply", "replace"]);
const ANIMATION_LOOP_MODE_SET = new Set<string>(["once", "repeat", "ping-pong"]);
const ATTACHMENT_SOURCE_SET = new Set<string>(["upload", "local-library", "bundled"]);
const RIGHTS_STATUS_SET = new Set<string>(["owned", "licensed", "public-domain", "unknown"]);
const SHADOW_MAP_SIZES = [256, 512, 1024, 2048, 4096] as const;
const UTF8_ENCODER = new TextEncoder();

const DEFAULT_RAW_DOCUMENT = {
  kind: STUDIO_BG3D_SCENE_DOCUMENT_KIND,
  version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
  camera: {
    position: DEFAULT_CAMERA_POSITION,
    target: DEFAULT_CAMERA_TARGET,
    fovDegrees: 50,
    projection: "perspective",
    zoom: 1,
    nearClip: STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
    up: STUDIO_BG3D_CAMERA_DEFAULT_UP,
  },
  render: {
    antialias: true,
    shadows: true,
    exposure: 1,
    toneMapping: "neutral",
    colorSpace: "srgb",
  },
  background: {
    mode: "sky-preset",
    color: "#ffffff",
    skyPresetId: "blank",
    panoramaRotation: 0,
    fogEnabled: false,
    fogColor: "#ffffff",
    fogNear: 10,
    fogFar: 50,
  },
  lighting: {
    ambientColor: "#ffffff",
    ambientIntensity: 0.75,
    key: {
      color: "#ffffff",
      direction: [4, 6, 4],
      intensity: 1.1,
      castsShadow: true,
    },
    fill: {
      color: "#ffffff",
      direction: [-4, 3, -3],
      intensity: 0.35,
      castsShadow: false,
    },
  },
  quality: {
    desktop: {
      targetFps: 60,
      dprMin: 1,
      dprMax: 2,
      maxRenderPixels: 12_582_912,
      shadows: true,
      shadowMapSize: 2048,
      textureScale: 1,
      lodBias: 0,
    },
    mobile: {
      targetFps: 30,
      dprMin: 0.9,
      dprMax: 1.5,
      maxRenderPixels: 4_194_304,
      shadows: true,
      shadowMapSize: 2048,
      textureScale: 1,
      lodBias: 0,
    },
  },
  output: {
    transparentBackground: false,
    exportHeight: 640,
    line: {
      enabled: true,
      layerType: "raster",
      color: "#000000",
      widthPx: 1,
      strength: 0.8,
      accuracy: 0.75,
      scaleAwareAccuracy: true,
      exteriorOutlineStrength: 1,
      depthEnabled: false,
      depthStrength: 0.5,
      depthOutlineOnly: true,
      smoothing: 0.5,
      textureLineEnabled: true,
      textureLineStrength: 0.5,
      creaseAngleDegrees: 20,
      hiddenLineRemoval: true,
    },
    tone: {
      // A 3D background should look like the shaded viewport when it is first inserted. Earlier
      // defaults disabled this layer, so the LT exporter truthfully emitted only edge rasters and
      // users saw an apparently broken wireframe. Dedicated line-art presets can still opt into
      // `none`; the general-purpose default preserves the rendered material colors.
      mode: "flat",
      type: "color",
      pattern: "dot",
      levels: 4,
      opacity: 1,
      frequency: 60,
      angleDegrees: 45,
    },
  },
  budgets: {
    complexity: {
      maxNodes: 256,
      maxTriangles: 2_000_000,
      maxDrawCalls: 512,
      maxMaterials: 256,
      maxLights: 4,
      maxAnimations: 64,
      maxAnimationChannels: 1_024,
      maxAnimationKeyframes: 1_000_000,
      maxAnimationValues: 8_000_000,
      maxSkins: 64,
      maxJoints: 2_048,
      maxMorphTargets: 256,
      maxAccessorElements: 40_000_000,
      maxDecodedGeometryBytes: 256 * 1024 * 1024,
      maxModelBytes: 256 * 1024 * 1024,
    },
    textures: {
      maxTextures: 128,
      maxTotalBytes: 256 * 1024 * 1024,
      maxDimension: 8192,
    },
  },
  attachments: [],
  nodes: [],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Persistence requires every root section even though the public normalizer is lenient. */
function hasCompleteRootShapeForVersion(
  value: unknown,
  version: number,
): value is Record<string, unknown> & { readonly nodes: readonly unknown[] } {
  return (
    isRecord(value) &&
    value.kind === STUDIO_BG3D_SCENE_DOCUMENT_KIND &&
    value.version === version &&
    isRecord(value.camera) &&
    isRecord(value.render) &&
    isRecord(value.background) &&
    isRecord(value.lighting) &&
    isRecord(value.quality) &&
    isRecord(value.output) &&
    isRecord(value.budgets) &&
    Array.isArray(value.attachments) &&
    Array.isArray(value.nodes)
  );
}

function hasCompleteCurrentRootShape(
  value: unknown,
): value is Record<string, unknown> & { readonly nodes: readonly unknown[] } {
  return hasCompleteRootShapeForVersion(value, STUDIO_BG3D_SCENE_DOCUMENT_VERSION);
}

function isExplicitUnversionedLegacyRoot(
  value: unknown
): value is Record<string, unknown> & { readonly primitives: readonly unknown[] } {
  return (
    isRecord(value) &&
    !hasOwn(value, "kind") &&
    !hasOwn(value, "version") &&
    value.tool === "bg3d" &&
    Array.isArray(value.primitives) &&
    (value.customModels === undefined || Array.isArray(value.customModels)) &&
    (value.attachments === undefined || Array.isArray(value.attachments))
  );
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function decodeBoundedJson(
  raw: unknown,
  budgetFailureMode: BudgetFailureMode = "null",
): unknown | null {
  try {
    if (typeof raw === "string") {
      if (utf8ByteLength(raw) > STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES) {
        if (budgetFailureMode === "throw") failBudget("input-byte-budget-exceeded");
        return null;
      }
      return JSON.parse(raw) as unknown;
    }
    const serialized = JSON.stringify(raw);
    if (
      typeof serialized !== "string" ||
      utf8ByteLength(serialized) > STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES
    ) {
      if (
        budgetFailureMode === "throw" &&
        typeof serialized === "string" &&
        utf8ByteLength(serialized) > STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES
      ) {
        failBudget("input-byte-budget-exceeded");
      }
      return null;
    }
    // Reparse to detach prototypes, accessors, symbols, functions, and non-JSON object identity.
    return JSON.parse(serialized) as unknown;
  } catch (cause) {
    if (cause instanceof StudioBg3dSceneDocumentBudgetError) throw cause;
    return null;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Compares detached JSON graphs without depending on object-key insertion order. Persistence uses
 * this after normalization so a current-version document is accepted only when normalization is
 * lossless: unknown keys, missing nested fields, invalid children, duplicate ids/hashes, clamped
 * values, and byte-budget truncation all fail closed instead of being silently rewritten.
 */
function jsonStructuresEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => jsonStructuresEqual(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key !== rightKeys[index] || !jsonStructuresEqual(left[key], right[key])) return false;
  }
  return true;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return Math.round(boundedNumber(value, fallback, minimum, maximum));
}

function normalizedBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizedEnum<Value extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback: Value
): Value {
  return typeof value === "string" && allowed.has(value) ? (value as Value) : fallback;
}

function normalizedColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value)
    ? value.toLowerCase()
    : fallback;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function normalizedText(
  value: unknown,
  maximumLength: number,
  rejectExternalReference = false
): string | null {
  if (typeof value !== "string" || containsControlCharacter(value)) return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    !normalized ||
    Array.from(normalized).length > maximumLength ||
    (rejectExternalReference &&
      (EXTERNAL_REFERENCE_PATTERN.test(normalized) ||
        SENSITIVE_REFERENCE_PATTERN.test(normalized)))
  ) {
    return null;
  }
  return normalized;
}

function normalizedId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !ID_PATTERN.test(value) ||
    FORBIDDEN_ID_SET.has(value.toLowerCase())
  ) {
    return null;
  }
  return value;
}

function normalizedVec3(
  value: unknown,
  fallback: StudioBg3dVec3,
  minimum: number,
  maximum: number
): StudioBg3dVec3 {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback] as StudioBg3dVec3;
  return [
    boundedNumber(value[0], fallback[0], minimum, maximum),
    boundedNumber(value[1], fallback[1], minimum, maximum),
    boundedNumber(value[2], fallback[2], minimum, maximum),
  ];
}

function normalizedRotation(value: unknown): StudioBg3dVec3 {
  const rotation = normalizedVec3(value, DEFAULT_ROTATION, -Number.MAX_VALUE, Number.MAX_VALUE);
  return rotation.map((angle) => {
    if (!Number.isFinite(angle)) return 0;
    const wrapped = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return wrapped - Math.PI;
  }) as unknown as StudioBg3dVec3;
}

function normalizedScale(value: unknown): StudioBg3dVec3 {
  return normalizedVec3(value, DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
}

function normalizedDirection(value: unknown, fallback: StudioBg3dVec3): StudioBg3dVec3 {
  const direction = normalizedVec3(value, fallback, -1_000, 1_000);
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length < 0.000_001) {
    const fallbackLength = Math.hypot(fallback[0], fallback[1], fallback[2]);
    return [fallback[0] / fallbackLength, fallback[1] / fallbackLength, fallback[2] / fallbackLength];
  }
  // Canonical documents already contain unit directions. Dividing a nearly-unit IEEE-754 vector
  // on every parse introduces last-bit drift, so preserve it once it is within a strict tolerance.
  if (Math.abs(length - 1) <= 1e-12) return direction;
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function normalizedShadowMapSize(
  value: unknown,
  fallback: StudioBg3dQualityProfile["shadowMapSize"]
): StudioBg3dQualityProfile["shadowMapSize"] {
  return typeof value === "number" && SHADOW_MAP_SIZES.includes(value as never)
    ? (value as StudioBg3dQualityProfile["shadowMapSize"])
    : fallback;
}

function normalizeCamera(value: unknown): StudioBg3dCameraSettings {
  const hasCameraRecord = isRecord(value);
  const candidate = hasCameraRecord ? value : {};
  let position = normalizedVec3(
    candidate.position,
    DEFAULT_CAMERA_POSITION,
    -MAX_WORLD_COORDINATE,
    MAX_WORLD_COORDINATE
  );
  const target = normalizedVec3(
    candidate.target,
    DEFAULT_CAMERA_TARGET,
    -MAX_WORLD_COORDINATE,
    MAX_WORLD_COORDINATE
  );
  if (Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) < 0.01) {
    position = [
      target[0],
      target[1],
      target[2] > MAX_WORLD_COORDINATE - 1 ? target[2] - 1 : target[2] + 1,
    ];
  }
  const result: Record<string, unknown> = {
    position,
    target,
    fovDegrees: boundedNumber(candidate.fovDegrees, 50, 10, 120),
    projection: candidate.projection === "orthographic" ? "orthographic" : "perspective",
    zoom: boundedNumber(candidate.zoom, 1, 0.1, 100),
  };
  if (Array.isArray(candidate.lensShift) && candidate.lensShift.length === 2 && typeof candidate.lensShift[0] === "number" && typeof candidate.lensShift[1] === "number") {
    result.lensShift = [boundedNumber(candidate.lensShift[0], 0, -2, 2), boundedNumber(candidate.lensShift[1], 0, -2, 2)] as readonly [number, number];
  }
  // Camera vNext is an additive v3 extension. Keep both fields absent when reading an older
  // canonical v3 graph so strict parse/serialize remains byte-compatible without weakening the
  // unknown-version guard. New defaults and every live viewport snapshot persist both fields.
  if (hasOwn(candidate, "nearClip") || !hasCameraRecord) {
    result.nearClip = boundedNumber(
      hasCameraRecord ? candidate.nearClip : STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
      STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
      STUDIO_BG3D_CAMERA_MIN_NEAR_CLIP,
      STUDIO_BG3D_CAMERA_MAX_NEAR_CLIP,
    );
  }
  if (hasOwn(candidate, "up") || !hasCameraRecord) {
    const normalizedUp = normalizeStudioBg3dCameraUpVector(
      hasCameraRecord ? candidate.up : STUDIO_BG3D_CAMERA_DEFAULT_UP,
    );
    const resolvedUp = isStudioBg3dCameraUpVectorValid(normalizedUp, { position, target })
      ? normalizedUp
      : resolveStudioBg3dCameraUpVector({ position, target, up: normalizedUp });
    result.up = [...resolvedUp] as StudioBg3dVec3;
  }
  return result as unknown as StudioBg3dCameraSettings;
}

function normalizeRender(value: unknown): StudioBg3dRenderSettings {
  const candidate = isRecord(value) ? value : {};
  return {
    antialias: normalizedBoolean(candidate.antialias, true),
    shadows: normalizedBoolean(candidate.shadows, true),
    exposure: boundedNumber(candidate.exposure, 1, 0.1, 8),
    toneMapping: normalizedEnum(candidate.toneMapping, TONE_MAPPING_SET, "neutral"),
    colorSpace: "srgb",
  };
}

function normalizeBackground(value: unknown): StudioBg3dBackgroundSettings {
  const candidate = isRecord(value) ? value : {};
  return {
    mode: normalizedEnum(candidate.mode, BACKGROUND_MODE_SET, "sky-preset"),
    color: normalizedColor(candidate.color, "#ffffff"),
    skyPresetId: normalizedEnum(candidate.skyPresetId, SKY_PRESET_SET, "blank"),
    panoramaRotation: boundedNumber(candidate.panoramaRotation, 0, -360, 360),
    fogEnabled: normalizedBoolean(candidate.fogEnabled, false),
    fogColor: normalizedColor(candidate.fogColor, "#ffffff"),
    // Keep each schema-v1 value independently canonical. Older v1 documents were allowed to
    // persist an inverted pair, so enforcing cross-field ordering here would make their strict
    // parser reject them. The render/UI boundary repairs ordering without breaking stored scenes.
    fogNear: boundedNumber(candidate.fogNear, 10, 0, MAX_WORLD_COORDINATE),
    fogFar: boundedNumber(candidate.fogFar, 50, 0, MAX_WORLD_COORDINATE * 2),
  };
}

function normalizeDirectionalLight(
  value: unknown,
  fallback: (typeof DEFAULT_RAW_DOCUMENT.lighting)["key" | "fill"]
): StudioBg3dDirectionalLightSettings {
  const candidate = isRecord(value) ? value : {};
  return {
    color: normalizedColor(candidate.color, fallback.color),
    direction: normalizedDirection(candidate.direction, fallback.direction),
    intensity: boundedNumber(candidate.intensity, fallback.intensity, 0, 20),
    castsShadow: normalizedBoolean(candidate.castsShadow, fallback.castsShadow),
  };
}

function normalizeLighting(value: unknown): StudioBg3dLightingSettings {
  const candidate = isRecord(value) ? value : {};
  return {
    ambientColor: normalizedColor(candidate.ambientColor, "#ffffff"),
    ambientIntensity: boundedNumber(candidate.ambientIntensity, 0.75, 0, 10),
    key: normalizeDirectionalLight(candidate.key, DEFAULT_RAW_DOCUMENT.lighting.key),
    fill: normalizeDirectionalLight(candidate.fill, DEFAULT_RAW_DOCUMENT.lighting.fill),
  };
}

function normalizeQualityProfile(
  value: unknown,
  fallback: (typeof DEFAULT_RAW_DOCUMENT.quality)["desktop" | "mobile"]
): StudioBg3dQualityProfile {
  const candidate = isRecord(value) ? value : {};
  const dprMin = boundedNumber(candidate.dprMin, fallback.dprMin, 0.5, 3);
  return {
    targetFps: boundedInteger(candidate.targetFps, fallback.targetFps, 15, 120),
    dprMin,
    dprMax: boundedNumber(candidate.dprMax, fallback.dprMax, dprMin, 3),
    maxRenderPixels: boundedInteger(
      candidate.maxRenderPixels,
      fallback.maxRenderPixels,
      320 * 240,
      16_777_216
    ),
    shadows: normalizedBoolean(candidate.shadows, fallback.shadows),
    shadowMapSize: normalizedShadowMapSize(candidate.shadowMapSize, fallback.shadowMapSize),
    textureScale: boundedNumber(candidate.textureScale, fallback.textureScale, 0.25, 1),
    lodBias: boundedNumber(candidate.lodBias, fallback.lodBias, -2, 4),
  };
}

function normalizeQuality(value: unknown): StudioBg3dQualityProfiles {
  const candidate = isRecord(value) ? value : {};
  return {
    desktop: normalizeQualityProfile(candidate.desktop, DEFAULT_RAW_DOCUMENT.quality.desktop),
    mobile: normalizeQualityProfile(candidate.mobile, DEFAULT_RAW_DOCUMENT.quality.mobile),
  };
}

function normalizeOutput(value: unknown): StudioBg3dOutputSettings {
  const candidate = isRecord(value) ? value : {};
  const line = isRecord(candidate.line) ? candidate.line : {};
  const tone = isRecord(candidate.tone) ? candidate.tone : {};
  // 렌즈 시프트와 같은 선택 필드 규약: 값이 있을 때만 기록한다. 없는 문서는 자동(뷰포트 추종)으로
  // 남아 예전 삽입 결과와 바이트 단위로 동일하고, strict 왕복도 그대로 통과한다.
  const exportAspectRatio = hasOwn(candidate, "exportAspectRatio")
    ? normalizeStudioBg3dCaptureAspectRatio(candidate.exportAspectRatio)
    : null;
  return {
    transparentBackground: normalizedBoolean(candidate.transparentBackground, false),
    exportHeight: boundedInteger(candidate.exportHeight, 640, 256, 4096),
    ...(exportAspectRatio === null ? {} : { exportAspectRatio }),
    line: {
      enabled: normalizedBoolean(line.enabled, true),
      layerType: normalizedEnum(line.layerType, LINE_LAYER_TYPE_SET, "raster"),
      color: normalizedColor(line.color, "#000000"),
      widthPx: boundedNumber(line.widthPx, 1, 0.25, 8),
      strength: boundedNumber(line.strength, 0.8, 0, 1),
      accuracy: boundedNumber(line.accuracy, 0.75, 0, 1),
      scaleAwareAccuracy: normalizedBoolean(line.scaleAwareAccuracy, true),
      exteriorOutlineStrength: boundedNumber(line.exteriorOutlineStrength, 1, 0, 2),
      depthEnabled: normalizedBoolean(line.depthEnabled, false),
      depthStrength: boundedNumber(line.depthStrength, 0.5, 0, 1),
      depthOutlineOnly: normalizedBoolean(line.depthOutlineOnly, true),
      smoothing: boundedNumber(line.smoothing, 0.5, 0, 1),
      textureLineEnabled: normalizedBoolean(line.textureLineEnabled, true),
      textureLineStrength: boundedNumber(line.textureLineStrength, 0.5, 0, 1),
      creaseAngleDegrees: boundedNumber(line.creaseAngleDegrees, 20, 0, 180),
      hiddenLineRemoval: normalizedBoolean(line.hiddenLineRemoval, true),
    },
    tone: {
      mode: normalizedEnum(tone.mode, TONE_MODE_SET, "flat"),
      type: normalizedEnum(tone.type, TONE_OUTPUT_TYPE_SET, "color"),
      pattern: normalizedEnum(tone.pattern, TONE_PATTERN_SET, "dot"),
      levels: boundedInteger(tone.levels, 4, 2, 8),
      opacity: boundedNumber(tone.opacity, 1, 0, 1),
      frequency: boundedNumber(tone.frequency, 60, 1, 200),
      angleDegrees: boundedNumber(tone.angleDegrees, 45, -180, 180),
    },
  };
}

function normalizeShotCameraOverride(value: unknown): StudioBg3dShotCameraOverride {
  const candidate = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  if (hasOwn(candidate, "position")) {
    result.position = normalizedVec3(
      candidate.position,
      DEFAULT_CAMERA_POSITION,
      -MAX_WORLD_COORDINATE,
      MAX_WORLD_COORDINATE,
    );
  }
  if (hasOwn(candidate, "target")) {
    result.target = normalizedVec3(
      candidate.target,
      DEFAULT_CAMERA_TARGET,
      -MAX_WORLD_COORDINATE,
      MAX_WORLD_COORDINATE,
    );
  }
  if (hasOwn(candidate, "fovDegrees")) {
    result.fovDegrees = boundedNumber(candidate.fovDegrees, 50, 10, 120);
  }
  if (hasOwn(candidate, "projection")) {
    result.projection = candidate.projection === "orthographic" ? "orthographic" : "perspective";
  }
  if (hasOwn(candidate, "zoom")) {
    result.zoom = boundedNumber(candidate.zoom, 1, 0.1, 100);
  }
  if (hasOwn(candidate, "lensShift")) {
    result.lensShift =
      Array.isArray(candidate.lensShift) && candidate.lensShift.length === 2
        ? [
            boundedNumber(candidate.lensShift[0], 0, -2, 2),
            boundedNumber(candidate.lensShift[1], 0, -2, 2),
          ]
        : [0, 0];
  }
  if (hasOwn(candidate, "nearClip")) {
    result.nearClip = boundedNumber(
      candidate.nearClip,
      STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
      STUDIO_BG3D_CAMERA_MIN_NEAR_CLIP,
      STUDIO_BG3D_CAMERA_MAX_NEAR_CLIP,
    );
  }
  if (hasOwn(candidate, "up")) {
    // A partial shot may override orientation without position/target; when it owns the complete
    // view ray, reject singular up intent now. Merge-time full-camera normalization covers the
    // inherited-ray case.
    const normalizedUp = normalizeStudioBg3dCameraUpVector(candidate.up);
    const position = result.position as StudioBg3dVec3 | undefined;
    const target = result.target as StudioBg3dVec3 | undefined;
    const resolvedUp = position && target &&
      !isStudioBg3dCameraUpVectorValid(normalizedUp, { position, target })
      ? resolveStudioBg3dCameraUpVector({ position, target, up: normalizedUp })
      : normalizedUp;
    result.up = [...resolvedUp] as StudioBg3dVec3;
  }
  return result as StudioBg3dShotCameraOverride;
}

function normalizeShotRenderOverride(value: unknown): StudioBg3dShotRenderOverride {
  const candidate = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  if (hasOwn(candidate, "antialias")) {
    result.antialias = normalizedBoolean(candidate.antialias, true);
  }
  if (hasOwn(candidate, "shadows")) {
    result.shadows = normalizedBoolean(candidate.shadows, true);
  }
  if (hasOwn(candidate, "exposure")) {
    result.exposure = boundedNumber(candidate.exposure, 1, 0.1, 8);
  }
  if (hasOwn(candidate, "toneMapping")) {
    result.toneMapping = normalizedEnum(candidate.toneMapping, TONE_MAPPING_SET, "neutral");
  }
  if (hasOwn(candidate, "colorSpace")) result.colorSpace = "srgb";
  return result as StudioBg3dShotRenderOverride;
}

function normalizeShotBackgroundOverride(value: unknown): StudioBg3dShotBackgroundOverride {
  const candidate = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  if (hasOwn(candidate, "mode")) {
    result.mode = normalizedEnum(candidate.mode, BACKGROUND_MODE_SET, "sky-preset");
  }
  if (hasOwn(candidate, "color")) result.color = normalizedColor(candidate.color, "#ffffff");
  if (hasOwn(candidate, "skyPresetId")) {
    result.skyPresetId = normalizedEnum(candidate.skyPresetId, SKY_PRESET_SET, "blank");
  }
  if (hasOwn(candidate, "panoramaRotation")) {
    result.panoramaRotation = boundedNumber(candidate.panoramaRotation, 0, -360, 360);
  }
  if (hasOwn(candidate, "fogEnabled")) {
    result.fogEnabled = normalizedBoolean(candidate.fogEnabled, false);
  }
  if (hasOwn(candidate, "fogColor")) {
    result.fogColor = normalizedColor(candidate.fogColor, "#ffffff");
  }
  if (hasOwn(candidate, "fogNear")) {
    result.fogNear = boundedNumber(candidate.fogNear, 10, 0, MAX_WORLD_COORDINATE);
  }
  if (hasOwn(candidate, "fogFar")) {
    result.fogFar = boundedNumber(candidate.fogFar, 50, 0, MAX_WORLD_COORDINATE * 2);
  }
  return result as StudioBg3dShotBackgroundOverride;
}

function normalizeShotDirectionalLightOverride(
  value: unknown,
  fallback: (typeof DEFAULT_RAW_DOCUMENT.lighting)["key" | "fill"],
): StudioBg3dShotDirectionalLightOverride {
  const candidate = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  if (hasOwn(candidate, "color")) result.color = normalizedColor(candidate.color, fallback.color);
  if (hasOwn(candidate, "direction")) {
    result.direction = normalizedDirection(candidate.direction, fallback.direction);
  }
  if (hasOwn(candidate, "intensity")) {
    result.intensity = boundedNumber(candidate.intensity, fallback.intensity, 0, 20);
  }
  if (hasOwn(candidate, "castsShadow")) {
    result.castsShadow = normalizedBoolean(candidate.castsShadow, fallback.castsShadow);
  }
  return result as StudioBg3dShotDirectionalLightOverride;
}

function normalizeShotLightingOverride(value: unknown): StudioBg3dShotLightingOverride {
  const candidate = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  if (hasOwn(candidate, "ambientColor")) {
    result.ambientColor = normalizedColor(candidate.ambientColor, "#ffffff");
  }
  if (hasOwn(candidate, "ambientIntensity")) {
    result.ambientIntensity = boundedNumber(candidate.ambientIntensity, 0.75, 0, 10);
  }
  if (hasOwn(candidate, "key")) {
    result.key = normalizeShotDirectionalLightOverride(
      candidate.key,
      DEFAULT_RAW_DOCUMENT.lighting.key,
    );
  }
  if (hasOwn(candidate, "fill")) {
    result.fill = normalizeShotDirectionalLightOverride(
      candidate.fill,
      DEFAULT_RAW_DOCUMENT.lighting.fill,
    );
  }
  return result as StudioBg3dShotLightingOverride;
}

function normalizeShotLineOutputOverride(value: unknown): StudioBg3dShotLineOutputOverride {
  const candidate = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  if (hasOwn(candidate, "enabled")) result.enabled = normalizedBoolean(candidate.enabled, true);
  if (hasOwn(candidate, "layerType")) {
    result.layerType = normalizedEnum(candidate.layerType, LINE_LAYER_TYPE_SET, "raster");
  }
  if (hasOwn(candidate, "color")) result.color = normalizedColor(candidate.color, "#000000");
  if (hasOwn(candidate, "widthPx")) {
    result.widthPx = boundedNumber(candidate.widthPx, 1, 0.25, 8);
  }
  if (hasOwn(candidate, "strength")) {
    result.strength = boundedNumber(candidate.strength, 0.8, 0, 1);
  }
  if (hasOwn(candidate, "accuracy")) {
    result.accuracy = boundedNumber(candidate.accuracy, 0.75, 0, 1);
  }
  if (hasOwn(candidate, "scaleAwareAccuracy")) {
    result.scaleAwareAccuracy = normalizedBoolean(candidate.scaleAwareAccuracy, true);
  }
  if (hasOwn(candidate, "exteriorOutlineStrength")) {
    result.exteriorOutlineStrength = boundedNumber(candidate.exteriorOutlineStrength, 1, 0, 2);
  }
  if (hasOwn(candidate, "depthEnabled")) {
    result.depthEnabled = normalizedBoolean(candidate.depthEnabled, false);
  }
  if (hasOwn(candidate, "depthStrength")) {
    result.depthStrength = boundedNumber(candidate.depthStrength, 0.5, 0, 1);
  }
  if (hasOwn(candidate, "depthOutlineOnly")) {
    result.depthOutlineOnly = normalizedBoolean(candidate.depthOutlineOnly, true);
  }
  if (hasOwn(candidate, "smoothing")) {
    result.smoothing = boundedNumber(candidate.smoothing, 0.5, 0, 1);
  }
  if (hasOwn(candidate, "textureLineEnabled")) {
    result.textureLineEnabled = normalizedBoolean(candidate.textureLineEnabled, true);
  }
  if (hasOwn(candidate, "textureLineStrength")) {
    result.textureLineStrength = boundedNumber(candidate.textureLineStrength, 0.5, 0, 1);
  }
  if (hasOwn(candidate, "creaseAngleDegrees")) {
    result.creaseAngleDegrees = boundedNumber(candidate.creaseAngleDegrees, 20, 0, 180);
  }
  if (hasOwn(candidate, "hiddenLineRemoval")) {
    result.hiddenLineRemoval = normalizedBoolean(candidate.hiddenLineRemoval, true);
  }
  return result as StudioBg3dShotLineOutputOverride;
}

function normalizeShotToneOutputOverride(value: unknown): StudioBg3dShotToneOutputOverride {
  const candidate = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  if (hasOwn(candidate, "mode")) {
    result.mode = normalizedEnum(candidate.mode, TONE_MODE_SET, "flat");
  }
  if (hasOwn(candidate, "type")) {
    result.type = normalizedEnum(candidate.type, TONE_OUTPUT_TYPE_SET, "color");
  }
  if (hasOwn(candidate, "pattern")) {
    result.pattern = normalizedEnum(candidate.pattern, TONE_PATTERN_SET, "dot");
  }
  if (hasOwn(candidate, "levels")) {
    result.levels = boundedInteger(candidate.levels, 4, 2, 8);
  }
  if (hasOwn(candidate, "opacity")) {
    result.opacity = boundedNumber(candidate.opacity, 1, 0, 1);
  }
  if (hasOwn(candidate, "frequency")) {
    result.frequency = boundedNumber(candidate.frequency, 60, 1, 200);
  }
  if (hasOwn(candidate, "angleDegrees")) {
    result.angleDegrees = boundedNumber(candidate.angleDegrees, 45, -180, 180);
  }
  return result as StudioBg3dShotToneOutputOverride;
}

function normalizeShotOutputOverride(value: unknown): StudioBg3dShotOutputOverride {
  const candidate = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  if (hasOwn(candidate, "transparentBackground")) {
    result.transparentBackground = normalizedBoolean(candidate.transparentBackground, false);
  }
  if (hasOwn(candidate, "exportHeight")) {
    result.exportHeight = boundedInteger(candidate.exportHeight, 640, 256, 4096);
  }
  if (hasOwn(candidate, "line")) {
    result.line = normalizeShotLineOutputOverride(candidate.line);
  }
  if (hasOwn(candidate, "tone")) {
    result.tone = normalizeShotToneOutputOverride(candidate.tone);
  }
  return result as StudioBg3dShotOutputOverride;
}

function normalizeBudgets(value: unknown): StudioBg3dSceneBudgets {
  const candidate = isRecord(value) ? value : {};
  const complexity = isRecord(candidate.complexity) ? candidate.complexity : {};
  const textures = isRecord(candidate.textures) ? candidate.textures : {};
  return {
    complexity: {
      maxNodes: boundedInteger(
        complexity.maxNodes,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxNodes,
        1,
        STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES
      ),
      maxTriangles: boundedInteger(
        complexity.maxTriangles,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxTriangles,
        1_000,
        10_000_000
      ),
      maxDrawCalls: boundedInteger(
        complexity.maxDrawCalls,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxDrawCalls,
        1,
        2_048
      ),
      maxMaterials: boundedInteger(
        complexity.maxMaterials,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxMaterials,
        1,
        1_024
      ),
      maxLights: boundedInteger(
        complexity.maxLights,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxLights,
        3,
        16
      ),
      maxAnimations: boundedInteger(
        complexity.maxAnimations,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAnimations,
        0,
        256
      ),
      maxAnimationChannels: boundedInteger(
        complexity.maxAnimationChannels,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAnimationChannels,
        0,
        4_096
      ),
      maxAnimationKeyframes: boundedInteger(
        complexity.maxAnimationKeyframes,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAnimationKeyframes,
        0,
        4_000_000
      ),
      maxAnimationValues: boundedInteger(
        complexity.maxAnimationValues,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAnimationValues,
        0,
        32_000_000
      ),
      maxSkins: boundedInteger(
        complexity.maxSkins,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxSkins,
        0,
        256
      ),
      maxJoints: boundedInteger(
        complexity.maxJoints,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxJoints,
        0,
        8_192
      ),
      maxMorphTargets: boundedInteger(
        complexity.maxMorphTargets,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxMorphTargets,
        0,
        1_024
      ),
      maxAccessorElements: boundedInteger(
        complexity.maxAccessorElements,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAccessorElements,
        0,
        160_000_000
      ),
      maxDecodedGeometryBytes: boundedInteger(
        complexity.maxDecodedGeometryBytes,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxDecodedGeometryBytes,
        0,
        1024 * 1024 * 1024
      ),
      maxModelBytes: boundedInteger(
        complexity.maxModelBytes,
        DEFAULT_RAW_DOCUMENT.budgets.complexity.maxModelBytes,
        1 * 1024 * 1024,
        512 * 1024 * 1024
      ),
    },
    textures: {
      maxTextures: boundedInteger(
        textures.maxTextures,
        DEFAULT_RAW_DOCUMENT.budgets.textures.maxTextures,
        0,
        256
      ),
      maxTotalBytes: boundedInteger(
        textures.maxTotalBytes,
        DEFAULT_RAW_DOCUMENT.budgets.textures.maxTotalBytes,
        0,
        512 * 1024 * 1024
      ),
      maxDimension: boundedInteger(
        textures.maxDimension,
        DEFAULT_RAW_DOCUMENT.budgets.textures.maxDimension,
        256,
        8_192
      ),
    },
  };
}

function normalizeRights(value: unknown): StudioBg3dAttachmentRights | null {
  if (!isRecord(value)) return null;
  const status = normalizedEnum<StudioBg3dRightsStatus>(
    value.status,
    RIGHTS_STATUS_SET,
    "unknown"
  );
  if (value.status !== status || typeof value.commercialUse !== "boolean") return null;
  if (typeof value.attributionRequired !== "boolean") return null;
  const attribution = normalizedText(value.attribution, MAX_TEXT_LENGTH, true);
  const licenseName = normalizedText(value.licenseName, MAX_TEXT_LENGTH, true);
  if (value.attributionRequired && !attribution) return null;
  if (status === "licensed" && !licenseName) return null;
  return {
    status,
    commercialUse: status === "unknown" ? false : value.commercialUse,
    attributionRequired: value.attributionRequired,
    ...(attribution ? { attribution } : {}),
    ...(licenseName ? { licenseName } : {}),
  };
}

function normalizeAttachment(value: unknown): StudioBg3dModelAttachment | null {
  if (!isRecord(value)) return null;
  const id = normalizedId(value.id);
  const rawName = normalizedText(value.name, 120, true);
  const rights = normalizeRights(value.rights);
  if (
    !id ||
    !rawName ||
    /[\\/]/u.test(rawName) ||
    !/\.glb$/iu.test(rawName) ||
    value.mime !== STUDIO_BG3D_GLB_MIME ||
    typeof value.byteSize !== "number" ||
    !Number.isSafeInteger(value.byteSize) ||
    value.byteSize < 1 ||
    value.byteSize > STUDIO_BG3D_GLB_MAX_BYTES ||
    typeof value.hash !== "string" ||
    !SHA256_PATTERN.test(value.hash.toLowerCase()) ||
    !rights ||
    typeof value.source !== "string" ||
    !ATTACHMENT_SOURCE_SET.has(value.source)
  ) {
    return null;
  }
  const base: StudioBg3dModelAttachment = {
    id,
    name: rawName.replace(/\.glb$/iu, ".glb"),
    mime: STUDIO_BG3D_GLB_MIME,
    byteSize: value.byteSize,
    hash: value.hash.toLowerCase(),
    rights,
    source: value.source as StudioBg3dAttachmentSource,
  };
  // Fail closed: corrupt/unknown workflow blocks are dropped; valid v1 fields re-attach sanitized.
  const workflow = parseStudioGeneric3dWorkflowMetadata(value);
  if (!workflow) return base;
  if (!workflow.classification && !workflow.sourceFormat) {
    return attachStudioGeneric3dWorkflowMetadata(base);
  }
  return attachStudioGeneric3dWorkflowMetadata(base, {
    ...(workflow.classification ? { classification: workflow.classification } : {}),
    ...(workflow.sourceFormat ? { sourceFormat: workflow.sourceFormat } : {}),
  });
}

function normalizeAttachments(
  value: unknown,
  maxModelBytes: number
): readonly StudioBg3dModelAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments: StudioBg3dModelAttachment[] = [];
  const ids = new Set<string>();
  const hashes = new Set<string>();
  let cumulativeBytes = 0;
  for (const candidate of value) {
    const attachment = normalizeAttachment(candidate);
    if (
      !attachment ||
      ids.has(attachment.id) ||
      hashes.has(attachment.hash)
    ) {
      continue;
    }
    if (attachments.length >= STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS) {
      failBudget("attachment-count-budget-exceeded");
    }
    if (cumulativeBytes + attachment.byteSize > maxModelBytes) {
      failBudget("model-byte-budget-exceeded");
    }
    attachments.push(attachment);
    ids.add(attachment.id);
    hashes.add(attachment.hash);
    cumulativeBytes += attachment.byteSize;
  }
  return attachments;
}

function normalizeTransform(value: unknown): StudioBg3dTransform {
  const candidate = isRecord(value) ? value : {};
  return {
    position: normalizedVec3(
      candidate.position,
      [0, 0, 0],
      -MAX_WORLD_COORDINATE,
      MAX_WORLD_COORDINATE
    ),
    rotation: normalizedRotation(candidate.rotation),
    scale: normalizedScale(candidate.scale),
  };
}

function normalizeMaterialOverride(value: unknown): StudioBg3dMaterialOverride | null {
  if (!isRecord(value)) return null;
  return {
    colorMode: normalizedEnum(
      value.colorMode,
      MATERIAL_COLOR_MODE_SET,
      DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE.colorMode,
    ),
    color: normalizedColor(value.color, DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE.color),
    colorStrength: boundedNumber(value.colorStrength, 1, 0, 1),
    opacityMultiplier: boundedNumber(value.opacityMultiplier, 1, 0, 1),
    roughness: value.roughness === null ? null : boundedNumber(value.roughness, 0.8, 0, 1),
    metalness: value.metalness === null ? null : boundedNumber(value.metalness, 0, 0, 1),
    emissiveColor: normalizedColor(value.emissiveColor, "#000000"),
    emissiveIntensity: value.emissiveIntensity === null
      ? null
      : boundedNumber(value.emissiveIntensity, 0, 0, 20),
    wireframe: normalizedBoolean(value.wireframe, false),
    doubleSided: normalizedBoolean(value.doubleSided, false),
  };
}

function normalizeAnimationPlayback(value: unknown): StudioBg3dAnimationPlayback | null {
  if (!isRecord(value)) return null;
  return {
    clipIndex: boundedInteger(value.clipIndex, 0, 0, 255),
    playing: normalizedBoolean(value.playing, false),
    loop: normalizedEnum(value.loop, ANIMATION_LOOP_MODE_SET, "repeat"),
    timeSeconds: boundedNumber(value.timeSeconds, 0, 0, 86_400),
    timeScale: boundedNumber(value.timeScale, 1, -4, 4),
    weight: boundedNumber(value.weight, 1, 0, 1),
  };
}

function normalizeQuaternion(value: unknown): StudioBg3dQuaternion | null {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((component) => typeof component !== "number" || !Number.isFinite(component))
  ) {
    return null;
  }
  const magnitude = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!Number.isFinite(magnitude) || magnitude < 1e-8) return null;
  // q and -q encode the same rotation. Canonicalizing to w >= 0 keeps strict persistence stable.
  const sign = value[3] < 0 ? -1 : 1;
  return [
    (value[0] / magnitude) * sign,
    (value[1] / magnitude) * sign,
    (value[2] / magnitude) * sign,
    (value[3] / magnitude) * sign,
  ];
}

function normalizePoseLayer(value: unknown): StudioBg3dPoseLayer | null {
  if (!isRecord(value) || !Array.isArray(value.joints)) return null;
  const joints: StudioBg3dJointPoseOverride[] = [];
  const keys = new Set<string>();
  for (const rawJoint of value.joints) {
    if (!isRecord(rawJoint)) continue;
    const jointKey = normalizedText(rawJoint.jointKey, 128);
    const rotationOffset = normalizeQuaternion(rawJoint.rotationOffset);
    if (!jointKey || !rotationOffset || keys.has(jointKey)) continue;
    if (joints.length >= 256) failBudget("pose-joint-count-budget-exceeded");
    keys.add(jointKey);
    joints.push({ jointKey, rotationOffset });
  }
  return {
    enabled: normalizedBoolean(value.enabled, true),
    weight: boundedNumber(value.weight, 1, 0, 1),
    joints,
  };
}

function normalizeMorphLayer(value: unknown): StudioBg3dMorphLayer | null {
  if (!isRecord(value) || !Array.isArray(value.targets)) return null;
  const targets: StudioBg3dMorphWeightOverride[] = [];
  const keys = new Set<string>();
  for (const rawTarget of value.targets) {
    if (!isRecord(rawTarget)) continue;
    const targetKey = normalizedText(rawTarget.targetKey, 128);
    if (!targetKey || keys.has(targetKey)) continue;
    if (targets.length >= 256) failBudget("morph-target-count-budget-exceeded");
    keys.add(targetKey);
    targets.push({
      targetKey,
      weightOffset: boundedNumber(rawTarget.weightOffset, 0, -1, 1),
    });
  }
  return {
    enabled: normalizedBoolean(value.enabled, true),
    weight: boundedNumber(value.weight, 1, 0, 1),
    targets,
  };
}

const AIM_AXIS_SET = new Set<string>(STUDIO_BG3D_AIM_AXES);

function normalizeConstraintLayer(value: unknown): StudioBg3dConstraintLayer | null {
  if (!isRecord(value) || !Array.isArray(value.aims)) return null;
  const aims: StudioBg3dJointAimConstraint[] = [];
  const keys = new Set<string>();
  for (const rawAim of value.aims) {
    if (!isRecord(rawAim)) continue;
    const jointKey = normalizedText(rawAim.jointKey, 128);
    const axis = typeof rawAim.axis === "string" && AIM_AXIS_SET.has(rawAim.axis)
      ? rawAim.axis as StudioBg3dAimAxis
      : null;
    if (!jointKey || !axis || keys.has(jointKey)) continue;
    if (aims.length >= 128) failBudget("aim-constraint-count-budget-exceeded");
    keys.add(jointKey);
    aims.push({
      jointKey,
      target: normalizedVec3(rawAim.target, [0, 1, 0], -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE),
      axis,
      weight: boundedNumber(rawAim.weight, 1, 0, 1),
    });
  }
  const rawTwoBoneIks = hasOwn(value, "twoBoneIks") ? value.twoBoneIks : [];
  if (!Array.isArray(rawTwoBoneIks)) return null;

  const twoBoneIks: StudioBg3dTwoBoneIkConstraint[] = [];
  const claimedJointKeys = new Set<string>();
  for (const rawIk of rawTwoBoneIks) {
    if (!isRecord(rawIk)) continue;
    const upperJointKey = normalizedText(rawIk.upperJointKey, 128);
    const middleJointKey = normalizedText(rawIk.middleJointKey, 128);
    const endJointKey = normalizedText(rawIk.endJointKey, 128);
    if (
      !upperJointKey || !middleJointKey || !endJointKey ||
      upperJointKey === middleJointKey || upperJointKey === endJointKey ||
      middleJointKey === endJointKey ||
      claimedJointKeys.has(upperJointKey) || claimedJointKeys.has(middleJointKey) ||
      claimedJointKeys.has(endJointKey)
    ) {
      continue;
    }
    if (twoBoneIks.length >= STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS) {
      failBudget("two-bone-ik-count-budget-exceeded");
    }
    claimedJointKeys.add(upperJointKey);
    claimedJointKeys.add(middleJointKey);
    claimedJointKeys.add(endJointKey);
    twoBoneIks.push({
      upperJointKey,
      middleJointKey,
      endJointKey,
      target: normalizedVec3(rawIk.target, [0, 1, 0], -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE),
      poleTarget: normalizedVec3(
        rawIk.poleTarget,
        [0, 0, 1],
        -MAX_WORLD_COORDINATE,
        MAX_WORLD_COORDINATE,
      ),
      weight: boundedNumber(rawIk.weight, 1, 0, 1),
    });
  }
  return {
    enabled: normalizedBoolean(value.enabled, true),
    aims,
    twoBoneIks,
  };
}

function normalizeNode(
  value: unknown,
  attachmentIds: ReadonlySet<string>
): StudioBg3dSceneNode | null {
  if (!isRecord(value)) return null;
  const id = normalizedId(value.id);
  if (!id) return null;
  const base = {
    id,
    name: normalizedText(value.name, MAX_NODE_NAME_LENGTH, true) ?? "3D 요소",
    transform: normalizeTransform(value.transform),
    visible: normalizedBoolean(value.visible, true),
    locked: normalizedBoolean(value.locked, false),
    castsShadow: normalizedBoolean(value.castsShadow, true),
    receivesShadow: normalizedBoolean(value.receivesShadow, true),
    parentId: normalizedId(value.parentId) ?? null,
  };
  if (value.kind === "primitive") {
    if (typeof value.primitiveKind !== "string" || !PRIMITIVE_KIND_SET.has(value.primitiveKind)) {
      return null;
    }
    const materialOverride = normalizeMaterialOverride(value.materialOverride);
    return {
      ...base,
      kind: "primitive",
      primitiveKind: value.primitiveKind as StudioBg3dPrimitiveKind,
      color: normalizedColor(value.color, "#b8b8c2"),
      ...(materialOverride ? { materialOverride } : {}),
    };
  }
  if (value.kind === "model") {
    const attachmentId = normalizedId(value.attachmentId);
    if (!attachmentId || !attachmentIds.has(attachmentId)) return null;
    const materialOverride = normalizeMaterialOverride(value.materialOverride);
    const animation = normalizeAnimationPlayback(value.animation);
    const pose = normalizePoseLayer(value.pose);
    const morph = normalizeMorphLayer(value.morph);
    const constraints = normalizeConstraintLayer(value.constraints);
    return {
      ...base,
      kind: "model",
      attachmentId,
      ...(materialOverride ? { materialOverride } : {}),
      ...(animation ? { animation } : {}),
      ...(pose ? { pose } : {}),
      ...(morph ? { morph } : {}),
      ...(constraints ? { constraints } : {}),
    };
  }
  return null;
}

function normalizeNodes(
  value: unknown,
  attachmentIds: ReadonlySet<string>,
  maxNodes: number
): readonly StudioBg3dSceneNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: StudioBg3dSceneNode[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const node = normalizeNode(candidate, attachmentIds);
    if (!node || ids.has(node.id)) continue;
    if (nodes.length >= maxNodes) failBudget("node-count-budget-exceeded");
    nodes.push(node);
    ids.add(node.id);
  }
  return normalizeStudioBg3dHierarchyParents(nodes);
}

function normalizeShotNodeVisibility(
  value: unknown,
  nodeIds: ReadonlySet<string>,
): readonly StudioBg3dShotNodeVisibilityOverride[] {
  if (!Array.isArray(value)) return [];
  const overrides: StudioBg3dShotNodeVisibilityOverride[] = [];
  const claimedNodeIds = new Set<string>();
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const nodeId = normalizedId(candidate.nodeId);
    if (
      !nodeId ||
      !nodeIds.has(nodeId) ||
      claimedNodeIds.has(nodeId) ||
      typeof candidate.visible !== "boolean"
    ) {
      continue;
    }
    if (overrides.length >= STUDIO_BG3D_SHOT_MAX_NODE_VISIBILITY_OVERRIDES) {
      failBudget("shot-visibility-count-budget-exceeded");
    }
    claimedNodeIds.add(nodeId);
    overrides.push({ nodeId, visible: candidate.visible });
  }
  return overrides;
}

function normalizeShot(
  value: unknown,
  nodeIds: ReadonlySet<string>,
): StudioBg3dShot | null {
  if (!isRecord(value)) return null;
  const id = normalizedId(value.id);
  const name = normalizedText(value.name, STUDIO_BG3D_SHOT_NAME_MAX_LENGTH, true);
  if (!id || id.length > STUDIO_BG3D_SHOT_ID_MAX_LENGTH || !name) return null;
  return {
    id,
    name,
    ...(hasOwn(value, "camera")
      ? { camera: normalizeShotCameraOverride(value.camera) }
      : {}),
    ...(hasOwn(value, "nodeVisibility")
      ? { nodeVisibility: normalizeShotNodeVisibility(value.nodeVisibility, nodeIds) }
      : {}),
    ...(hasOwn(value, "render")
      ? { render: normalizeShotRenderOverride(value.render) }
      : {}),
    ...(hasOwn(value, "background")
      ? { background: normalizeShotBackgroundOverride(value.background) }
      : {}),
    ...(hasOwn(value, "lighting")
      ? { lighting: normalizeShotLightingOverride(value.lighting) }
      : {}),
    ...(hasOwn(value, "output")
      ? { output: normalizeShotOutputOverride(value.output) }
      : {}),
  };
}

function normalizeShots(
  value: unknown,
  nodeIds: ReadonlySet<string>,
): readonly StudioBg3dShot[] {
  if (!Array.isArray(value)) return [];
  const shots: StudioBg3dShot[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const shot = normalizeShot(candidate, nodeIds);
    if (!shot || ids.has(shot.id)) continue;
    if (shots.length >= STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS) {
      failBudget("shot-count-budget-exceeded");
    }
    ids.add(shot.id);
    shots.push(shot);
  }
  return shots;
}

function withoutActiveShot(
  document: StudioBg3dSceneDocument,
): StudioBg3dSceneDocument {
  const { activeShotId: _discardedActiveShotId, ...rest } = document;
  return rest;
}

function canonicalDocumentByteLength(document: StudioBg3dSceneDocument): number {
  return utf8ByteLength(JSON.stringify(document));
}


function normalizeDecodedCurrentDocument(
  value: unknown,
  rootMode: "lenient" | "strict" = "lenient",
  budgetFailureMode: BudgetFailureMode = "null",
): StudioBg3dSceneDocument | null {
  try {
    if (
      !isRecord(value) ||
      value.kind !== STUDIO_BG3D_SCENE_DOCUMENT_KIND ||
      value.version !== STUDIO_BG3D_SCENE_DOCUMENT_VERSION ||
      (rootMode === "strict" && !hasCompleteCurrentRootShape(value))
    ) {
      return null;
    }
    const budgets = normalizeBudgets(value.budgets);
    const attachments = normalizeAttachments(
      value.attachments,
      budgets.complexity.maxModelBytes
    );
    const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
    const nodes = normalizeNodes(value.nodes, attachmentIds, budgets.complexity.maxNodes);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const includesShots = hasOwn(value, "shots");
    const shots = includesShots ? normalizeShots(value.shots, nodeIds) : undefined;
    const shotIds = new Set(shots?.map((shot) => shot.id) ?? []);
    const activeShotId = normalizedId(value.activeShotId);
    const normalized: StudioBg3dSceneDocument = {
      kind: STUDIO_BG3D_SCENE_DOCUMENT_KIND,
      version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
      camera: normalizeCamera(value.camera),
      render: normalizeRender(value.render),
      background: normalizeBackground(value.background),
      lighting: normalizeLighting(value.lighting),
      quality: normalizeQuality(value.quality),
      output: normalizeOutput(value.output),
      budgets,
      attachments,
      nodes,
      ...(shots ? { shots } : {}),
      ...(activeShotId && shotIds.has(activeShotId) ? { activeShotId } : {}),
    };
    if (canonicalDocumentByteLength(normalized) > STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES) {
      failBudget("document-byte-budget-exceeded");
    }
    if (rootMode === "strict" && !jsonStructuresEqual(value, normalized)) return null;
    return deepFreeze(normalized);
  } catch (cause) {
    if (cause instanceof StudioBg3dSceneDocumentBudgetError && budgetFailureMode === "null") {
      return null;
    }
    throw cause;
  }
}

function legacyPrimitiveNode(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return {
    id: value.id,
    name: value.kind,
    kind: "primitive",
    primitiveKind: value.kind,
    color: value.color,
    parentId: null,
    transform: {
      position: value.position,
      rotation: value.rotation,
      scale: value.scale,
    },
    visible: true,
    locked: false,
    castsShadow: true,
    receivesShadow: true,
  };
}

function legacyModelNode(
  value: unknown,
  options: StudioBg3dLegacyMigrationOptions
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const storageKey = value.modelId;
  if (
    typeof storageKey !== "string" ||
    !storageKey ||
    containsControlCharacter(storageKey) ||
    utf8ByteLength(storageKey) > 512
  ) {
    return null;
  }
  let mappedAttachmentId: unknown;
  try {
    mappedAttachmentId = options.attachmentIdByLegacyStorageKey?.get(storageKey);
  } catch {
    return null;
  }
  const attachmentId = normalizedId(mappedAttachmentId);
  if (!attachmentId || attachmentId === storageKey) return null;
  return {
    id: value.id,
    name: "GLB 모델",
    kind: "model",
    attachmentId,
    transform: {
      position: value.position,
      rotation: value.rotation,
      scale: value.scale,
    },
    parentId: null,
    visible: true,
    locked: false,
    castsShadow: true,
    receivesShadow: true,
  };
}

function migrateDecodedLegacyDocument(
  value: unknown,
  options: StudioBg3dLegacyMigrationOptions
): StudioBg3dSceneDocument | null {
  if (!isExplicitUnversionedLegacyRoot(value)) return null;
  const primitiveNodes = value.primitives.map(legacyPrimitiveNode).filter(isRecord);
  const modelNodes = Array.isArray(value.customModels)
    ? value.customModels.map((model) => legacyModelNode(model, options)).filter(isRecord)
    : [];
  return normalizeDecodedCurrentDocument({
    kind: STUDIO_BG3D_SCENE_DOCUMENT_KIND,
    version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
    camera: value.camera,
    render: value.render,
    background: isRecord(value.background)
      ? value.background
      : {
          mode: "sky-preset",
          skyPresetId: value.skyPresetId,
          color: value.backgroundColor,
        },
    lighting: value.lighting,
    quality: value.quality,
    output: isRecord(value.output)
      ? value.output
      : {
          transparentBackground: value.transparentInsert,
          line: { enabled: true },
        },
    budgets: value.budgets,
    attachments: value.attachments,
    nodes: [...primitiveNodes, ...modelNodes],
  });
}

/**
 * Early scene documents briefly persisted an optional `background.panoramaUrl`. The URL is no longer part of
 * the persistence contract, but rejecting the whole marked document would also discard its camera,
 * nodes, attachments, and LT settings. Migrate only that exact historical shape: remove the URL,
 * then require every remaining field to pass the current strict schema boundary without any other
 * lossy rewrite. This is intentionally separate from the unversioned legacy payload migration.
 */
const SCHEMA_V2_ONLY_COMPLEXITY_BUDGET_KEYS = Object.freeze([
  "maxAnimations",
  "maxAnimationChannels",
  "maxAnimationKeyframes",
  "maxAnimationValues",
  "maxSkins",
  "maxJoints",
  "maxMorphTargets",
  "maxAccessorElements",
  "maxDecodedGeometryBytes",
] as const);

/**
 * Schema v1 predates animation, rigging, morph, and decoded-accessor budgets. Add those defaults
 * before the strict current-version equality check, while rejecting payloads that claim v2-only fields under a
 * v1 version marker. Unknown or missing historical fields are still rejected by strict normalize.
 */
function migrateSchemaV1Budgets(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.complexity)) return null;
  const complexity = value.complexity;
  if (SCHEMA_V2_ONLY_COMPLEXITY_BUDGET_KEYS.some((key) => hasOwn(complexity, key))) {
    return null;
  }
  return {
    ...value,
    complexity: {
      ...complexity,
      maxAnimations: DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAnimations,
      maxAnimationChannels: DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAnimationChannels,
      maxAnimationKeyframes: DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAnimationKeyframes,
      maxAnimationValues: DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAnimationValues,
      maxSkins: DEFAULT_RAW_DOCUMENT.budgets.complexity.maxSkins,
      maxJoints: DEFAULT_RAW_DOCUMENT.budgets.complexity.maxJoints,
      maxMorphTargets: DEFAULT_RAW_DOCUMENT.budgets.complexity.maxMorphTargets,
      maxAccessorElements: DEFAULT_RAW_DOCUMENT.budgets.complexity.maxAccessorElements,
      maxDecodedGeometryBytes: DEFAULT_RAW_DOCUMENT.budgets.complexity.maxDecodedGeometryBytes,
    },
  };
}

/**
 * Schema v3 adds analytic two-bone IK to every persisted constraint layer. Preserve canonical v2
 * aim-only layers by adding the explicit empty collection, while rejecting documents that claim
 * the v3-only field under a v2 marker.
 */
function migrateSchemaV2Nodes(value: readonly unknown[]): readonly unknown[] | null {
  const nodes: unknown[] = [];
  for (const node of value) {
    if (!isRecord(node) || node.kind !== "model" || !hasOwn(node, "constraints")) {
      nodes.push(node);
      continue;
    }
    if (!isRecord(node.constraints) || hasOwn(node.constraints, "twoBoneIks")) return null;
    nodes.push({
      ...node,
      constraints: {
        ...node.constraints,
        twoBoneIks: [],
      },
    });
  }
  return nodes;
}

function migrateDecodedSchemaV2Document(value: unknown): StudioBg3dSceneDocument | null {
  if (
    !hasCompleteRootShapeForVersion(value, STUDIO_BG3D_SCHEMA_V2_SCENE_DOCUMENT_VERSION) ||
    (isRecord(value.camera) && (
      hasOwn(value.camera, "nearClip") ||
      hasOwn(value.camera, "up")
    )) ||
    hasOwn(value, "shots") ||
    hasOwn(value, "activeShotId")
  ) {
    return null;
  }
  const nodes = migrateSchemaV2Nodes(value.nodes);
  if (!nodes) return null;
  return normalizeDecodedCurrentDocument({
    ...value,
    version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
    nodes,
  }, "strict");
}

function migrateDecodedSchemaV1Document(value: unknown): StudioBg3dSceneDocument | null {
  if (
    !hasCompleteRootShapeForVersion(value, STUDIO_BG3D_LEGACY_SCENE_DOCUMENT_VERSION) ||
    (isRecord(value.camera) && (
      hasOwn(value.camera, "nearClip") ||
      hasOwn(value.camera, "up")
    )) ||
    hasOwn(value, "shots") ||
    hasOwn(value, "activeShotId")
  ) {
    return null;
  }
  if (
    value.nodes.some((node) =>
      isRecord(node) && (
        hasOwn(node, "materialOverride") || hasOwn(node, "animation") || hasOwn(node, "pose") || hasOwn(node, "morph") || hasOwn(node, "constraints")
      ))
  ) return null;
  const budgets = migrateSchemaV1Budgets(value.budgets);
  if (!budgets) return null;
  return normalizeDecodedCurrentDocument({
    ...value,
    version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
    budgets,
  }, "strict");
}

function migrateDecodedSchemaPanoramaDocument(
  value: unknown
): StudioBg3dSceneDocument | null {
  if (
    !isRecord(value) ||
    !(
      hasCompleteCurrentRootShape(value)
      || hasCompleteRootShapeForVersion(value, STUDIO_BG3D_SCHEMA_V2_SCENE_DOCUMENT_VERSION)
      || hasCompleteRootShapeForVersion(value, STUDIO_BG3D_LEGACY_SCENE_DOCUMENT_VERSION)
    ) ||
    !isRecord(value.background) ||
    !hasOwn(value.background, "panoramaUrl") ||
    typeof value.background.panoramaUrl !== "string"
  ) {
    return null;
  }
  if (
    value.version === STUDIO_BG3D_LEGACY_SCENE_DOCUMENT_VERSION
    && value.nodes.some((node) =>
      isRecord(node) && (
        hasOwn(node, "materialOverride") || hasOwn(node, "animation") || hasOwn(node, "pose") || hasOwn(node, "morph") || hasOwn(node, "constraints")
      ))
  ) {
    return null;
  }
  if (
    value.version !== STUDIO_BG3D_SCENE_DOCUMENT_VERSION &&
    isRecord(value.camera) &&
    (hasOwn(value.camera, "nearClip") || hasOwn(value.camera, "up"))
  ) {
    return null;
  }
  if (
    value.version !== STUDIO_BG3D_SCENE_DOCUMENT_VERSION &&
    (hasOwn(value, "shots") || hasOwn(value, "activeShotId"))
  ) {
    return null;
  }
  const budgets = value.version === STUDIO_BG3D_LEGACY_SCENE_DOCUMENT_VERSION
    ? migrateSchemaV1Budgets(value.budgets)
    : value.budgets;
  if (!budgets) return null;
  const nodes = value.version === STUDIO_BG3D_SCHEMA_V2_SCENE_DOCUMENT_VERSION
    ? migrateSchemaV2Nodes(value.nodes)
    : value.nodes;
  if (!nodes) return null;
  const { panoramaUrl: _discardedPanoramaUrl, ...background } = value.background;
  return normalizeDecodedCurrentDocument({
    ...value,
    version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
    background,
    budgets,
    nodes,
  }, "strict");
}

/** Returns a new, deeply frozen default document on every call. */
export function createDefaultStudioBg3dSceneDocument(): StudioBg3dSceneDocument {
  const document = normalizeDecodedCurrentDocument(DEFAULT_RAW_DOCUMENT);
  if (!document) throw new Error("Invalid internal Studio BG3D document defaults.");
  return document;
}

export const DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT = createDefaultStudioBg3dSceneDocument();

/**
 * Leniently sanitizes a current-version object for interactive editing. Missing or mistyped root
 * sections receive defaults; invalid roots, unknown versions, cyclic values, and oversized inputs
 * reset to a fresh default. Persistence must use the strict parse/serialize APIs below.
 */
export function normalizeStudioBg3dSceneDocument(raw: unknown): StudioBg3dSceneDocument {
  const decoded = decodeBoundedJson(raw, "throw");
  return normalizeDecodedCurrentDocument(decoded, "lenient", "throw")
    ?? createDefaultStudioBg3dSceneDocument();
}

/**
 * Parses only canonical, complete current-version graphs. Any lossy normalization (including
 * unknown or missing nested fields, invalid/duplicate children, value clamping, and truncation),
 * oversized input, legacy payload, or unknown schema marker is rejected.
 */
export function parseStudioBg3dSceneDocument(raw: string): StudioBg3dSceneDocument | null {
  return normalizeDecodedCurrentDocument(decodeBoundedJson(raw), "strict");
}

/**
 * Accepts the current document or the actual legacy `{tool:"bg3d", primitives, customModels}` hash
 * payload. Any legacy `modelId` is an IndexedDB key, never an attachment id. A model placement
 * survives only when `attachmentIdByLegacyStorageKey` explicitly maps that key to a different,
 * valid logical id backed by canonical GLB metadata; otherwise it is intentionally dropped.
 * Documents with any unsupported/current `kind` or any `version` marker never enter legacy logic.
 */
export function migrateStudioBg3dSceneDocument(
  raw: unknown,
  options: StudioBg3dLegacyMigrationOptions = {}
): StudioBg3dSceneDocument | null {
  let rawHasSchemaMarker: boolean;
  try {
    rawHasSchemaMarker =
      isRecord(raw) && (hasOwn(raw, "kind") || hasOwn(raw, "version"));
  } catch {
    return null;
  }
  const decoded = decodeBoundedJson(raw);
  const current = normalizeDecodedCurrentDocument(decoded, "strict");
  if (current) return current;
  const schemaV1Panorama = migrateDecodedSchemaPanoramaDocument(decoded);
  if (schemaV1Panorama) return schemaV1Panorama;
  const schemaV2 = migrateDecodedSchemaV2Document(decoded);
  if (schemaV2) return schemaV2;
  const schemaV1 = migrateDecodedSchemaV1Document(decoded);
  if (schemaV1) return schemaV1;
  if (
    rawHasSchemaMarker ||
    (isRecord(decoded) && (hasOwn(decoded, "kind") || hasOwn(decoded, "version")))
  ) {
    return null;
  }
  return migrateDecodedLegacyDocument(decoded, options);
}

/**
 * Canonical current-version JSON serialization. Only already-canonical current documents are
 * accepted; callers must use the lenient editor normalizer or explicit legacy migration before
 * reaching this persistence boundary. Every non-null result is UTF-8 bounded to 320 KiB.
 */
export function serializeStudioBg3dSceneDocument(raw: unknown): string | null {
  const document = normalizeDecodedCurrentDocument(decodeBoundedJson(raw), "strict");
  if (!document) return null;
  try {
    const serialized = JSON.stringify(document);
    return utf8ByteLength(serialized) <= STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES
      ? serialized
      : null;
  } catch {
    return null;
  }
}

function normalizeShotCreateRequest(value: unknown): StudioBg3dShotCreateRequest | null {
  const decoded = decodeBoundedJson(value);
  if (!isRecord(decoded)) return null;
  const id = normalizedId(decoded.id);
  const name = normalizedText(decoded.name, STUDIO_BG3D_SHOT_NAME_MAX_LENGTH, true);
  const normalized = id && id.length <= STUDIO_BG3D_SHOT_ID_MAX_LENGTH && name
    ? { id, name }
    : null;
  return normalized && jsonStructuresEqual(decoded, normalized) ? normalized : null;
}

function canonicalDocumentForShotHelper(raw: unknown): StudioBg3dSceneDocument | null {
  return normalizeDecodedCurrentDocument(decodeBoundedJson(raw), "strict");
}

/**
 * Captures the current camera, presentation, LT output, and every node's visibility as a new shot.
 * The source document is never mutated. A duplicate id, the 64-shot cap, or the document byte
 * ceiling returns null rather than discarding an existing shot or scene element.
 */
export function captureStudioBg3dShot(
  raw: unknown,
  request: StudioBg3dShotCreateRequest,
): StudioBg3dSceneDocument | null {
  const document = canonicalDocumentForShotHelper(raw);
  const normalizedRequest = normalizeShotCreateRequest(request);
  if (
    !document ||
    !normalizedRequest ||
    (document.shots?.length ?? 0) >= STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS ||
    document.shots?.some((shot) => shot.id === normalizedRequest.id)
  ) {
    return null;
  }

  const shot: StudioBg3dShot = {
    ...normalizedRequest,
    camera: { ...document.camera },
    nodeVisibility: document.nodes.map(({ id: nodeId, visible }) => ({ nodeId, visible })),
    render: { ...document.render },
    background: { ...document.background },
    lighting: {
      ...document.lighting,
      key: { ...document.lighting.key },
      fill: { ...document.lighting.fill },
    },
    output: {
      ...document.output,
      line: { ...document.output.line },
      tone: { ...document.output.tone },
    },
  };
  return canonicalDocumentForShotHelper({
    ...withoutActiveShot(document),
    shots: [...(document.shots ?? []), shot],
    activeShotId: shot.id,
  });
}

/** Creates an independent storyboard entry whose overrides initially match an existing shot. */
export function duplicateStudioBg3dShot(
  raw: unknown,
  sourceShotId: string,
  request: StudioBg3dShotCreateRequest,
): StudioBg3dSceneDocument | null {
  const document = canonicalDocumentForShotHelper(raw);
  const normalizedRequest = normalizeShotCreateRequest(request);
  const normalizedSourceShotId = normalizedId(sourceShotId);
  if (
    !document ||
    !normalizedRequest ||
    !normalizedSourceShotId ||
    normalizedSourceShotId !== sourceShotId ||
    (document.shots?.length ?? 0) >= STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS ||
    document.shots?.some((shot) => shot.id === normalizedRequest.id)
  ) {
    return null;
  }
  const source = document.shots?.find((shot) => shot.id === normalizedSourceShotId);
  if (!source) return null;
  const duplicate: StudioBg3dShot = {
    ...source,
    ...normalizedRequest,
  };
  return canonicalDocumentForShotHelper({
    ...withoutActiveShot(document),
    shots: [...(document.shots ?? []), duplicate],
    activeShotId: duplicate.id,
  });
}

/** Removes one storyboard entry; the immutable scene graph and every other shot stay untouched. */
export function removeStudioBg3dShot(
  raw: unknown,
  shotId: string,
): StudioBg3dSceneDocument | null {
  const document = canonicalDocumentForShotHelper(raw);
  const normalizedShotId = normalizedId(shotId);
  if (!document || !normalizedShotId || normalizedShotId !== shotId) return null;
  const shots = document.shots ?? [];
  if (!shots.some((shot) => shot.id === normalizedShotId)) return null;

  const remaining = shots.filter((shot) => shot.id !== normalizedShotId);
  const {
    shots: _discardedShots,
    activeShotId: _discardedActiveShotId,
    ...scene
  } = document;
  return canonicalDocumentForShotHelper({
    ...scene,
    ...(remaining.length > 0 ? { shots: remaining } : {}),
    ...(document.activeShotId && document.activeShotId !== normalizedShotId
      ? { activeShotId: document.activeShotId }
      : {}),
  });
}

/** Moves one shot to an exact bounded storyboard index without changing any shot payload. */
export function moveStudioBg3dShot(
  raw: unknown,
  shotId: string,
  targetIndex: number,
): StudioBg3dSceneDocument | null {
  const document = canonicalDocumentForShotHelper(raw);
  const normalizedShotId = normalizedId(shotId);
  if (
    !document ||
    !normalizedShotId ||
    normalizedShotId !== shotId ||
    !Number.isSafeInteger(targetIndex)
  ) {
    return null;
  }
  const shots = [...(document.shots ?? [])];
  const sourceIndex = shots.findIndex((shot) => shot.id === normalizedShotId);
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= shots.length) return null;
  if (sourceIndex === targetIndex) return document;
  const [shot] = shots.splice(sourceIndex, 1);
  if (!shot) return null;
  shots.splice(targetIndex, 0, shot);
  return canonicalDocumentForShotHelper({ ...document, shots });
}

/** Applies one shot's partial overrides and marks it active without changing asset or geometry data. */
export function applyStudioBg3dShot(
  raw: unknown,
  shotId: string,
): StudioBg3dSceneDocument | null {
  const document = canonicalDocumentForShotHelper(raw);
  const normalizedShotId = normalizedId(shotId);
  if (!document || !normalizedShotId || normalizedShotId !== shotId) return null;
  const shot = document.shots?.find((candidate) => candidate.id === normalizedShotId);
  if (!shot) return null;

  const visibleByNodeId = new Map(
    shot.nodeVisibility?.map(({ nodeId, visible }) => [nodeId, visible] as const) ?? [],
  );
  const lighting = shot.lighting
    ? normalizeLighting({
        ...document.lighting,
        ...shot.lighting,
        key: shot.lighting.key
          ? { ...document.lighting.key, ...shot.lighting.key }
          : document.lighting.key,
        fill: shot.lighting.fill
          ? { ...document.lighting.fill, ...shot.lighting.fill }
          : document.lighting.fill,
      })
    : document.lighting;
  const output = shot.output
    ? normalizeOutput({
        ...document.output,
        ...shot.output,
        line: shot.output.line
          ? { ...document.output.line, ...shot.output.line }
          : document.output.line,
        tone: shot.output.tone
          ? { ...document.output.tone, ...shot.output.tone }
          : document.output.tone,
      })
    : document.output;
  return canonicalDocumentForShotHelper({
    ...document,
    camera: shot.camera
      ? normalizeCamera({ ...document.camera, ...shot.camera })
      : document.camera,
    render: shot.render
      ? normalizeRender({ ...document.render, ...shot.render })
      : document.render,
    background: shot.background
      ? normalizeBackground({ ...document.background, ...shot.background })
      : document.background,
    lighting,
    output,
    nodes: document.nodes.map((node) => {
      const visible = visibleByNodeId.get(node.id);
      return visible === undefined ? node : { ...node, visible };
    }),
    activeShotId: shot.id,
  });
}

/** Runtime/UI helper for pre-validating one metadata record without retaining hostile fields. */
export function normalizeStudioBg3dGlbAttachment(
  raw: unknown
): StudioBg3dModelAttachment | null {
  const decoded = decodeBoundedJson(raw);
  return deepFreeze(normalizeAttachment(decoded));
}

/** Runtime adapter helper for accepting only the bounded canonical material payload. */
export function normalizeStudioBg3dMaterialOverride(
  raw: unknown,
): StudioBg3dMaterialOverride | null {
  return deepFreeze(normalizeMaterialOverride(decodeBoundedJson(raw)));
}

export function normalizeStudioBg3dAnimationPlayback(
  raw: unknown,
): StudioBg3dAnimationPlayback | null {
  return deepFreeze(normalizeAnimationPlayback(decodeBoundedJson(raw)));
}

export function normalizeStudioBg3dPoseLayer(raw: unknown): StudioBg3dPoseLayer | null {
  return deepFreeze(normalizePoseLayer(decodeBoundedJson(raw)));
}

export function normalizeStudioBg3dMorphLayer(raw: unknown): StudioBg3dMorphLayer | null {
  return deepFreeze(normalizeMorphLayer(decodeBoundedJson(raw)));
}

export function normalizeStudioBg3dConstraintLayer(raw: unknown): StudioBg3dConstraintLayer | null {
  return deepFreeze(normalizeConstraintLayer(decodeBoundedJson(raw)));
}
