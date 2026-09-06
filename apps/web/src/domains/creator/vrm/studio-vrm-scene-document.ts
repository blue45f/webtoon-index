import {
  STUDIO_VRM_RIG_PROFILE_PURPOSE,
  STUDIO_VRM_RIG_PROFILE_VERSION,
  createStudioVrmRigProfileSelection,
  type StudioVrmRigProfileSelection,
} from "./studio-vrm-rig-profile";

/**
 * Engine-neutral, persistence-safe scene document for the Studio VRM poser.
 *
 * Three.js/React objects, VRM binary bytes, Blob/File values, object URLs, remote URLs, and
 * IndexedDB keys deliberately stay outside this contract. Uploaded models are addressed only by
 * immutable attachment metadata; the runtime must resolve and verify their bytes separately.
 */

export const STUDIO_VRM_SCENE_DOCUMENT_KIND = "studio-vrm-scene" as const;
export const STUDIO_VRM_SCENE_DOCUMENT_VERSION = 6 as const;
export const STUDIO_VRM_SCENE_DOCUMENT_LEGACY_VERSION = 1 as const;
export const STUDIO_VRM_SCENE_DOCUMENT_VERSION_TWO = 2 as const;
export const STUDIO_VRM_SCENE_DOCUMENT_VERSION_THREE = 3 as const;
export const STUDIO_VRM_SCENE_DOCUMENT_VERSION_FOUR = 4 as const;
export const STUDIO_VRM_SCENE_DOCUMENT_PREVIOUS_VERSION = 5 as const;
export const STUDIO_VRM_SCENE_DOCUMENT_V1_MAX_BYTES = 128 * 1024;
export const STUDIO_VRM_SCENE_DOCUMENT_V2_MAX_BYTES =
  STUDIO_VRM_SCENE_DOCUMENT_V1_MAX_BYTES + 512;
/**
 * v3 reserves bounded headroom for the required translation block so every historically valid v2
 * scene can be promoted without dropping authoring data at the former ceiling.
 */
export const STUDIO_VRM_SCENE_DOCUMENT_V3_MAX_BYTES =
  STUDIO_VRM_SCENE_DOCUMENT_V2_MAX_BYTES + 512;
/** v4 reserves bounded headroom for four persistent IK target/pole constraints. */
export const STUDIO_VRM_SCENE_DOCUMENT_V4_MAX_BYTES =
  STUDIO_VRM_SCENE_DOCUMENT_V3_MAX_BYTES + 2 * 1024;
/** v5 reserves bounded metadata headroom for deterministic surface-paint texture bindings. */
export const STUDIO_VRM_SCENE_DOCUMENT_V5_MAX_BYTES =
  STUDIO_VRM_SCENE_DOCUMENT_V4_MAX_BYTES + 128 * 1024;
/** v6 reserves bounded headroom so every maximum-size v5 scene can add `lightingTone` losslessly. */
export const STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES =
  STUDIO_VRM_SCENE_DOCUMENT_V5_MAX_BYTES + 512;
/** Matches the default project-archive per-attachment ceiling so every accepted scene is portable. */
export const STUDIO_VRM_MODEL_MAX_BYTES = 96 * 1024 * 1024;
export const STUDIO_VRM_MAX_POSE_BONES = 64;
export const STUDIO_VRM_MAX_FINGER_BONES = 32;
export const STUDIO_VRM_MAX_EXPRESSIONS = 64;
export const STUDIO_VRM_MAX_IK_CONSTRAINTS = 4;
export const STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES = 128;
export const STUDIO_VRM_SURFACE_PAINT_BASE_COLOR_SLOT = "baseColor" as const;
/** Mirrors the project archive's 96 MB per-attachment ceiling. */
export const STUDIO_VRM_SURFACE_PAINT_TEXTURE_MAX_BYTES = 96_000_000;
/** Content-addressed PNG bytes are counted once even when multiple bindings share a hash. */
export const STUDIO_VRM_SURFACE_PAINT_TOTAL_MAX_BYTES = 96_000_000;
export const STUDIO_VRM_SURFACE_PAINT_MAX_DIMENSION = 4_096;
export const STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURE_PIXELS =
  STUDIO_VRM_SURFACE_PAINT_MAX_DIMENSION * STUDIO_VRM_SURFACE_PAINT_MAX_DIMENSION;
/** At most two full-resolution unique decoded textures may be admitted into one scene document. */
export const STUDIO_VRM_SURFACE_PAINT_MAX_DECODED_PIXELS =
  STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURE_PIXELS * 2;

export type StudioVrmSceneDocumentBudgetErrorCode =
  | "surface-paint-count-budget-exceeded"
  | "surface-paint-byte-budget-exceeded"
  | "surface-paint-decoded-pixel-budget-exceeded";

/** Lenient normalization must never disguise a surface-paint budget failure as a valid subset. */
export class StudioVrmSceneDocumentBudgetError extends Error {
  readonly code: StudioVrmSceneDocumentBudgetErrorCode;

  constructor(code: StudioVrmSceneDocumentBudgetErrorCode) {
    super(`Studio VRM scene document budget exceeded: ${code}.`);
    this.name = "StudioVrmSceneDocumentBudgetError";
    this.code = code;
  }
}

function failSceneBudget(code: StudioVrmSceneDocumentBudgetErrorCode): never {
  throw new StudioVrmSceneDocumentBudgetError(code);
}

const MAX_WORLD_COORDINATE = 10_000;
const MAX_DATA_DEPTH = 8;
const MAX_DATA_NODES = 1_024;
const MAX_DATA_ARRAY_ITEMS = 128;
const MAX_DATA_OBJECT_KEYS = 128;
const MAX_DATA_KEY_LENGTH = 64;
const MAX_DATA_STRING_LENGTH = 1_024;
const MAX_SAFE_GRAPH_DEPTH = 16;
const MAX_SAFE_GRAPH_NODES = 8_192;
const MAX_SAFE_GRAPH_ARRAY_ITEMS = 1_024;
const MAX_SAFE_GRAPH_OBJECT_KEYS = 1_024;
const MAX_RENDER_PIXELS = 33_554_432;
const UTF8_ENCODER = new TextEncoder();
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const GLTF_MATERIAL_LOCATOR_PATTERN = /^gltf-material:(?:0|[1-9][0-9]{0,5})$/;
const SCENE_PATH_MATERIAL_LOCATOR_PATTERN =
  /^scene-path:[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,7}$/;
const SAFE_DATA_KEY_PATTERN = /^[\p{L}\p{N}_. -]{1,64}$/u;
const CSS_HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const UNSAFE_REFERENCE_PATTERN = /^(?:data|blob|https?|file|javascript|vbscript):|^\/\//i;
// `curl` is an Avatar Forge numeric hair control, not a URL reference. Keep the broad
// suffix guard for keys such as `runtimeUrl` while exempting that exact canonical field.
const UNSAFE_REFERENCE_KEY_PATTERN =
  /(?:^|_)(?:url|uri|href|src)$|^(?!curl$).*(?:url|uri)$/i;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export type StudioVrmVec3 = readonly [number, number, number];

export const STUDIO_VRM_IK_EFFECTORS = [
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
] as const;

export type StudioVrmIkEffector = (typeof STUDIO_VRM_IK_EFFECTORS)[number];

/**
 * A persistent IK pin expressed in VRM scene-local coordinates.
 *
 * `enabled` controls participation and visibility. `locked` means other authoritative pose edits
 * must preserve the target; it never prevents the user from explicitly moving or deleting it.
 */
export interface StudioVrmIkConstraint {
  readonly effector: StudioVrmIkEffector;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly target: StudioVrmVec3;
  readonly pole: StudioVrmVec3 | null;
}

export const STUDIO_VRM_HUMANOID_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "jaw",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
] as const;

export const STUDIO_VRM_FINGER_BONES = [
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
] as const;

export type StudioVrmHumanoidBoneName = (typeof STUDIO_VRM_HUMANOID_BONES)[number];
export type StudioVrmFingerBoneName = (typeof STUDIO_VRM_FINGER_BONES)[number];

export interface StudioVrmBundledModel {
  readonly source: "bundled";
  readonly id: string;
  readonly name: string;
}

export interface StudioVrmAttachmentModel {
  readonly source: "attachment";
  /** Lowercase `sha256:` followed by exactly 64 hexadecimal characters. */
  readonly hash: string;
  readonly byteSize: number;
  readonly mime: "model/vrm" | "model/gltf-binary";
  readonly name: string;
}

export type StudioVrmSceneModel = StudioVrmBundledModel | StudioVrmAttachmentModel;

/** Rotation-only subset of `PoseBoneMap`; direction targets are resolved at the runtime boundary. */
export interface StudioVrmPoseBone {
  readonly rotation: StudioVrmVec3;
}

/**
 * Persistable additive translations used by deterministic full-body IK.
 *
 * `root` is expressed in the scene parent's horizontal coordinate system and owns X/Z placement
 * only; its Y component is canonically zero because the historical `yOffset` field remains the
 * sole vertical scene-root coordinate. `hips` and `spine` are expressed in the avatar scene-root
 * coordinate system before body scale. `hips` moves the whole humanoid below the scene root, while
 * `spine` moves the upper-body subtree without translating either leg.
 */
export interface StudioVrmPoseTranslations {
  readonly version: 1;
  readonly root: StudioVrmVec3;
  readonly hips: StudioVrmVec3;
  readonly spine: StudioVrmVec3;
}

export type StudioVrmPoseBoneMap = Partial<
  Record<StudioVrmHumanoidBoneName, StudioVrmPoseBone>
>;
export type StudioVrmFingerRotationMap = Partial<
  Record<StudioVrmFingerBoneName, StudioVrmVec3>
>;

export interface StudioVrmPoseState {
  readonly bones: StudioVrmPoseBoneMap;
  readonly yOffset: number;
  readonly translations: StudioVrmPoseTranslations;
  /** Character-root yaw, in canonical radians `[-PI, PI)`. */
  readonly bodyRotationY: number;
  readonly fingerOverrides: StudioVrmFingerRotationMap;
  readonly ikConstraints: readonly StudioVrmIkConstraint[];
}

export interface StudioVrmCameraSettings {
  readonly projection: "perspective";
  readonly position: StudioVrmVec3;
  readonly target: StudioVrmVec3;
  readonly up: StudioVrmVec3;
  readonly fovDegrees: number;
  readonly near: number;
  readonly far: number;
}

export interface StudioVrmBodyScale {
  readonly height: number;
  readonly width: number;
}

export interface StudioVrmMaterialFx {
  readonly shadeColor: string | null;
  readonly outlineColor: string | null;
  readonly rimColor: string | null;
  readonly rimIntensity: number;
  readonly emissiveColor: string | null;
  readonly emissiveIntensity: number;
}

export type StudioVrmCanonicalData =
  | null
  | boolean
  | number
  | string
  | readonly StudioVrmCanonicalData[]
  | { readonly [key: string]: StudioVrmCanonicalData };

export interface StudioVrmAppearanceSettings {
  readonly bodyScale: StudioVrmBodyScale;
  readonly customColors: Readonly<Record<string, string>>;
  readonly materialFx: StudioVrmMaterialFx;
  readonly mannequin: boolean;
  readonly avatarForge: StudioVrmCanonicalData;
  readonly costume: StudioVrmCanonicalData;
  readonly wardrobe: StudioVrmCanonicalData;
}

export interface StudioVrmLightingSettings {
  readonly intensity: number;
  readonly colorTemp: number;
  readonly directionDeg: number;
}

export const STUDIO_VRM_LIGHTING_TONES = [
  "morning",
  "sunset",
  "night",
  "studio",
] as const;

export type StudioVrmLightingTone = (typeof STUDIO_VRM_LIGHTING_TONES)[number];

export const DEFAULT_STUDIO_VRM_LIGHTING_TONE: StudioVrmLightingTone = "morning";

export interface StudioVrmPhysicsSettings {
  readonly version: 1;
  readonly stiffnessScale: number;
  readonly gravityScale: number;
  readonly windDirectionDeg: number;
  readonly windStrength: number;
}

export type StudioVrmEnvironment = "none" | "floor" | "wall" | "room" | "outdoor";

export interface StudioVrmRenderSettings {
  readonly width: number;
  readonly height: number;
  readonly transparentBackground: boolean;
  readonly backgroundColor: string;
}

/** Versioned, engine-neutral drawing-assist settings persisted with a VRM scene. */
export interface StudioVrmRigSettings {
  readonly version: 1;
  readonly jointProfile: StudioVrmRigProfileSelection;
  readonly fullBodyIk: boolean;
  readonly footPlant: boolean;
  readonly floorHeight: number;
}

/**
 * One portable PNG texture and its engine-neutral VRM material binding.
 *
 * The PNG bytes live in the project archive's content-addressed attachment store. Runtime object
 * identities, object URLs, Blob/File values, raw pixels, and library-specific UUIDs are never
 * persisted here. `materialLocator + textureSlot` is the authoritative binding identity.
 */
export interface StudioVrmSurfacePaintTexture {
  readonly bindingKey: string;
  readonly materialLocator: string;
  readonly textureSlot: typeof STUDIO_VRM_SURFACE_PAINT_BASE_COLOR_SLOT;
  readonly hash: string;
  readonly mime: "image/png";
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioVrmSurfacePaintSettings {
  readonly version: 1;
  readonly textures: readonly StudioVrmSurfacePaintTexture[];
}

export interface StudioVrmSceneDocument {
  readonly kind: typeof STUDIO_VRM_SCENE_DOCUMENT_KIND;
  readonly version: typeof STUDIO_VRM_SCENE_DOCUMENT_VERSION;
  readonly model: StudioVrmSceneModel;
  readonly pose: StudioVrmPoseState;
  readonly expressions: Readonly<Record<string, number>>;
  readonly camera: StudioVrmCameraSettings;
  readonly appearance: StudioVrmAppearanceSettings;
  readonly rig: StudioVrmRigSettings;
  readonly props: StudioVrmCanonicalData;
  readonly sceneProps: StudioVrmCanonicalData;
  readonly lighting: StudioVrmLightingSettings;
  readonly lightingTone: StudioVrmLightingTone;
  readonly physics: StudioVrmPhysicsSettings;
  readonly env: StudioVrmEnvironment;
  readonly render: StudioVrmRenderSettings;
  readonly surfacePaint: StudioVrmSurfacePaintSettings;
}

export interface StudioVrmBundledModelDescriptor {
  readonly id: string;
  readonly name: string;
}

export interface StudioVrmLegacyMigrationOptions {
  /** Authoritative bundled registry. IndexedDB ids must never be placed in this list. */
  readonly bundledModels?: readonly StudioVrmBundledModelDescriptor[];
}

export type StudioVrmLegacyMetadataMigration =
  | { readonly status: "resolved"; readonly document: StudioVrmSceneDocument }
  | {
      readonly status: "unresolved-model";
      readonly modelId: string | null;
      readonly modelName: string | null;
    };

export type StudioVrmLegacyFragmentMigration =
  | {
      readonly status: "resolved";
      /** The original PNG data URL with its metadata fragment removed. */
      readonly rasterSrc: string;
      readonly document: StudioVrmSceneDocument;
    }
  | {
      readonly status: "unresolved-model";
      readonly rasterSrc: string;
      readonly modelId: string | null;
      readonly modelName: string | null;
    };

const HUMANOID_BONE_SET = new Set<string>(STUDIO_VRM_HUMANOID_BONES);
const FINGER_BONE_SET = new Set<string>(STUDIO_VRM_FINGER_BONES);
const IK_EFFECTOR_SET = new Set<string>(STUDIO_VRM_IK_EFFECTORS);
const ENVIRONMENT_SET = new Set<string>(["none", "floor", "wall", "room", "outdoor"]);
const LIGHTING_TONE_SET = new Set<string>(STUDIO_VRM_LIGHTING_TONES);

function isStudioVrmHumanoidBoneName(value: string): value is StudioVrmHumanoidBoneName {
  return HUMANOID_BONE_SET.has(value);
}

function isStudioVrmFingerBoneName(value: string): value is StudioVrmFingerBoneName {
  return FINGER_BONE_SET.has(value);
}

function isStudioVrmIkEffector(value: unknown): value is StudioVrmIkEffector {
  return typeof value === "string" && IK_EFFECTOR_SET.has(value);
}

function isStudioVrmEnvironment(value: unknown): value is StudioVrmEnvironment {
  return typeof value === "string" && ENVIRONMENT_SET.has(value);
}

function isStudioVrmLightingTone(value: unknown): value is StudioVrmLightingTone {
  return typeof value === "string" && LIGHTING_TONE_SET.has(value);
}

const DEFAULT_RAW_DOCUMENT: StudioVrmSceneDocument = {
  kind: STUDIO_VRM_SCENE_DOCUMENT_KIND,
  version: STUDIO_VRM_SCENE_DOCUMENT_VERSION,
  model: { source: "bundled", id: "sample-vrm", name: "루미" },
  pose: {
    bones: {},
    yOffset: 0,
    translations: {
      version: 1,
      root: [0, 0, 0],
      hips: [0, 0, 0],
      spine: [0, 0, 0],
    },
    bodyRotationY: 0,
    fingerOverrides: {},
    ikConstraints: [],
  },
  expressions: {},
  camera: {
    projection: "perspective",
    position: [0, 1.42, 3.15],
    target: [0, 1.22, 0],
    up: [0, 1, 0],
    fovDegrees: 30,
    near: 0.1,
    far: 100,
  },
  appearance: {
    bodyScale: { height: 1, width: 1 },
    customColors: {},
    materialFx: {
      shadeColor: null,
      outlineColor: null,
      rimColor: null,
      rimIntensity: 0,
      emissiveColor: null,
      emissiveIntensity: 0,
    },
    mannequin: false,
    avatarForge: null,
    costume: null,
    wardrobe: null,
  },
  rig: {
    version: 1,
    jointProfile: {
      version: STUDIO_VRM_RIG_PROFILE_VERSION,
      purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE,
      id: "neutral",
    },
    fullBodyIk: false,
    footPlant: false,
    floorHeight: 0,
  },
  props: null,
  sceneProps: null,
  lighting: { intensity: 1, colorTemp: 0.5, directionDeg: 45 },
  lightingTone: DEFAULT_STUDIO_VRM_LIGHTING_TONE,
  physics: {
    version: 1,
    stiffnessScale: 1,
    gravityScale: 1,
    windDirectionDeg: 0,
    windStrength: 0,
  },
  env: "none",
  render: {
    width: 1024,
    height: 1024,
    transparentBackground: true,
    backgroundColor: "#ffffff",
  },
  surfacePaint: {
    version: 1,
    textures: [],
  },
};

const VERSION_ONE_ROOT_KEYS = new Set([
  "kind",
  "version",
  "model",
  "pose",
  "expressions",
  "camera",
  "appearance",
  "props",
  "sceneProps",
  "lighting",
  "physics",
  "env",
  "render",
]);

const VERSION_TWO_TO_FOUR_ROOT_KEYS = new Set([
  ...VERSION_ONE_ROOT_KEYS,
  "rig",
]);
const VERSION_FIVE_ROOT_KEYS = new Set([
  ...VERSION_TWO_TO_FOUR_ROOT_KEYS,
  "surfacePaint",
]);
const CURRENT_ROOT_KEYS = new Set([
  ...VERSION_FIVE_ROOT_KEYS,
  "lightingTone",
]);

const VERSION_ONE_POSE_KEYS = new Set([
  "bones",
  "yOffset",
  "bodyRotationY",
  "fingerOverrides",
]);
const VERSION_THREE_POSE_KEYS = new Set([
  ...VERSION_ONE_POSE_KEYS,
  "translations",
]);
const CURRENT_POSE_KEYS = new Set([
  ...VERSION_THREE_POSE_KEYS,
  "ikConstraints",
]);
const POSE_TRANSLATION_KEYS = new Set(["version", "root", "hips", "spine"]);
const IK_CONSTRAINT_KEYS = new Set(["effector", "enabled", "locked", "target", "pole"]);

const RIG_KEYS = new Set([
  "version",
  "jointProfile",
  "fullBodyIk",
  "footPlant",
  "floorHeight",
]);
const SURFACE_PAINT_KEYS = new Set(["version", "textures"]);
const SURFACE_PAINT_TEXTURE_KEYS = new Set([
  "bindingKey",
  "materialLocator",
  "textureSlot",
  "hash",
  "mime",
  "byteSize",
  "width",
  "height",
]);

const LEGACY_ROOT_KEYS = new Set([
  "tool",
  "poseId",
  "expressionId",
  "yOffset",
  "bodyRotationY",
  "bones",
  "expressionWeights",
  "customColors",
  "materialFx",
  "modelName",
  "modelId",
  "bodyScale",
  "fingerOverrides",
  "lighting",
  "lightingTone",
  "env",
  "avatarForge",
  "vrmProps",
  "props",
  "sceneProps",
  "costume",
  "wardrobe",
  "physics",
  "mannequin",
  "transparentBackground",
  "renderWidth",
  "renderHeight",
]);

/** Exact key vocabulary emitted by buildVrmPoseDataUrlMetadata for FullVrmState v2. */
const FULL_STATE_V2_FRAGMENT_KEYS = new Set([
  "tool",
  "version",
  "modelId",
  "poseId",
  "bones",
  "yOffset",
  "poseTranslations",
  "bodyRotation",
  "expressionId",
  "expressionWeights",
  "costume",
  "wardrobe",
  "sceneProps",
  "physics",
  "bodyScale",
  "lighting",
  "lightingTone",
  "env",
  "fingerOverrides",
  "materialFx",
  "avatarForge",
  "customColors",
  "modelName",
  "vrmProps",
]);
const FULL_STATE_V3_FRAGMENT_KEYS = new Set([
  ...FULL_STATE_V2_FRAGMENT_KEYS,
  "ikConstraints",
]);

interface SafeCloneState {
  readonly seen: WeakSet<object>;
  nodes: number;
}

interface CanonicalDataState {
  nodes: number;
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function safeCloneDataGraph(
  value: unknown,
  state: SafeCloneState,
  depth = 0
): unknown | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : undefined;
  if (typeof value !== "object" || depth > MAX_SAFE_GRAPH_DEPTH) return undefined;
  if (state.seen.has(value) || state.nodes >= MAX_SAFE_GRAPH_NODES) return undefined;
  state.seen.add(value);
  state.nodes += 1;

  try {
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length > 0) return undefined;
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) return undefined;
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !("value" in lengthDescriptor)) return undefined;
      const length = lengthDescriptor.value;
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_SAFE_GRAPH_ARRAY_ITEMS
      ) return undefined;
      const keys = Object.keys(descriptors).filter((key) => key !== "length");
      if (keys.length !== length) return undefined;
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
        const child = safeCloneDataGraph(descriptor.value, state, depth + 1);
        if (child === undefined) return undefined;
        result.push(child);
      }
      return result;
    }

    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Object.keys(descriptors);
    if (keys.length > MAX_SAFE_GRAPH_OBJECT_KEYS) return undefined;
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      const child = safeCloneDataGraph(descriptor.value, state, depth + 1);
      if (child === undefined) return undefined;
      Object.defineProperty(result, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  } catch {
    return undefined;
  }
}

function decodeBoundedDataGraph(raw: unknown): unknown | null {
  let decoded: unknown;
  try {
    if (typeof raw === "string") {
      if (utf8ByteLength(raw) > STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES) return null;
      decoded = JSON.parse(raw);
    } else {
      decoded = raw;
    }
  } catch {
    return null;
  }
  const detached = safeCloneDataGraph(decoded, { seen: new WeakSet(), nodes: 0 });
  if (detached === undefined) return null;
  try {
    const serialized = JSON.stringify(detached);
    return utf8ByteLength(serialized) <= STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES ? detached : null;
  } catch {
    return null;
  }
}

function exceedsHistoricalSourceLimit(raw: unknown, decoded: unknown): boolean {
  if (typeof raw !== "string" || !isRecord(decoded)) return false;
  if (decoded.version === STUDIO_VRM_SCENE_DOCUMENT_LEGACY_VERSION) {
    return utf8ByteLength(raw) > STUDIO_VRM_SCENE_DOCUMENT_V1_MAX_BYTES;
  }
  if (decoded.version === STUDIO_VRM_SCENE_DOCUMENT_VERSION_TWO) {
    return utf8ByteLength(raw) > STUDIO_VRM_SCENE_DOCUMENT_V2_MAX_BYTES;
  }
  if (decoded.version === STUDIO_VRM_SCENE_DOCUMENT_VERSION_THREE) {
    return utf8ByteLength(raw) > STUDIO_VRM_SCENE_DOCUMENT_V3_MAX_BYTES;
  }
  if (decoded.version === STUDIO_VRM_SCENE_DOCUMENT_VERSION_FOUR) {
    return utf8ByteLength(raw) > STUDIO_VRM_SCENE_DOCUMENT_V4_MAX_BYTES;
  }
  return decoded.version === STUDIO_VRM_SCENE_DOCUMENT_PREVIOUS_VERSION
    && utf8ByteLength(raw) > STUDIO_VRM_SCENE_DOCUMENT_V5_MAX_BYTES;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  const children = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : [];
  for (const child of children) deepFreeze(child);
  return Object.freeze(value);
}

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
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && jsonStructuresEqual(left[key], right[key])
  );
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const bounded = Math.min(maximum, Math.max(minimum, value));
  return Object.is(bounded, -0) ? 0 : bounded;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.round(boundedNumber(value, fallback, minimum, maximum));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeSafeText(value: unknown, fallback: string, maximumLength = 128): string {
  if (typeof value !== "string" || containsControlCharacter(value)) return fallback;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    !normalized ||
    Array.from(normalized).length > maximumLength ||
    UNSAFE_REFERENCE_PATTERN.test(normalized)
  ) return fallback;
  return normalized;
}

function normalizeSafeId(value: unknown, fallback: string): string {
  if (
    typeof value !== "string" ||
    !SAFE_ID_PATTERN.test(value) ||
    FORBIDDEN_KEYS.has(value.toLowerCase()) ||
    UNSAFE_REFERENCE_PATTERN.test(value)
  ) return fallback;
  return value;
}

function normalizeCssHex(value: unknown, fallback: string): string {
  return typeof value === "string" && CSS_HEX_PATTERN.test(value) ? value.toLowerCase() : fallback;
}

function normalizeNullableCssHex(value: unknown): string | null {
  return typeof value === "string" && CSS_HEX_PATTERN.test(value) ? value.toLowerCase() : null;
}

function normalizeVec3(
  value: unknown,
  fallback: StudioVrmVec3,
  minimum = -MAX_WORLD_COORDINATE,
  maximum = MAX_WORLD_COORDINATE
): StudioVrmVec3 {
  if (!Array.isArray(value) || value.length !== 3) return [fallback[0], fallback[1], fallback[2]];
  return [
    boundedNumber(value[0], fallback[0], minimum, maximum),
    boundedNumber(value[1], fallback[1], minimum, maximum),
    boundedNumber(value[2], fallback[2], minimum, maximum),
  ];
}

function normalizeRotationAngle(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value >= -Math.PI && value < Math.PI) return Object.is(value, -0) ? 0 : value;
  const wrapped = ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function normalizeRotation(value: unknown): StudioVrmVec3 {
  if (!Array.isArray(value) || value.length !== 3) return [0, 0, 0];
  return [
    normalizeRotationAngle(value[0]),
    normalizeRotationAngle(value[1]),
    normalizeRotationAngle(value[2]),
  ];
}

function normalizeUnitVec3(value: unknown, fallback: StudioVrmVec3): StudioVrmVec3 {
  const vector = normalizeVec3(value, fallback, -1_000, 1_000);
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 0.000_001) return [fallback[0], fallback[1], fallback[2]];
  if (Math.abs(length - 1) <= 1e-12) return vector;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function normalizeModel(value: unknown): StudioVrmSceneModel {
  if (!isRecord(value)) return { ...DEFAULT_RAW_DOCUMENT.model };
  if (value.source === "attachment") {
    const hash = typeof value.hash === "string" && HASH_PATTERN.test(value.hash)
      ? value.hash
      : "";
    if (!hash) return { ...DEFAULT_RAW_DOCUMENT.model };
    return {
      source: "attachment",
      hash,
      byteSize: boundedInteger(value.byteSize, 1, 1, STUDIO_VRM_MODEL_MAX_BYTES),
      mime: value.mime === "model/vrm" ? "model/vrm" : "model/gltf-binary",
      name: normalizeSafeText(value.name, "VRM 모델"),
    };
  }
  if (value.source === "bundled") {
    return {
      source: "bundled",
      id: normalizeSafeId(value.id, DEFAULT_RAW_DOCUMENT.model.source === "bundled"
        ? DEFAULT_RAW_DOCUMENT.model.id
        : "sample-vrm"),
      name: normalizeSafeText(value.name, "루미"),
    };
  }
  return { ...DEFAULT_RAW_DOCUMENT.model };
}

function normalizePoseBones(value: unknown): StudioVrmPoseBoneMap {
  if (!isRecord(value)) return {};
  const result: StudioVrmPoseBoneMap = {};
  for (const key of Object.keys(value).sort()) {
    if (Object.keys(result).length >= STUDIO_VRM_MAX_POSE_BONES || !isStudioVrmHumanoidBoneName(key)) continue;
    const bone = value[key];
    if (!isRecord(bone) || !hasOwn(bone, "rotation")) continue;
    result[key] = { rotation: normalizeRotation(bone.rotation) };
  }
  return result;
}

function normalizeFingerOverrides(value: unknown): StudioVrmFingerRotationMap {
  if (!isRecord(value)) return {};
  const result: StudioVrmFingerRotationMap = {};
  for (const key of Object.keys(value).sort()) {
    if (Object.keys(result).length >= STUDIO_VRM_MAX_FINGER_BONES || !isStudioVrmFingerBoneName(key)) continue;
    result[key] = normalizeRotation(value[key]);
  }
  return result;
}

function normalizePoseTranslations(value: unknown): StudioVrmPoseTranslations {
  const candidate = isRecord(value) ? value : {};
  const root = normalizeVec3(candidate.root, [0, 0, 0], -10, 10);
  return {
    version: 1,
    root: [root[0], 0, root[2]],
    hips: normalizeVec3(candidate.hips, [0, 0, 0], -2, 2),
    spine: normalizeVec3(candidate.spine, [0, 0, 0], -0.75, 0.75),
  };
}

function normalizeIkConstraints(value: unknown): readonly StudioVrmIkConstraint[] {
  if (!Array.isArray(value)) return [];
  const byEffector = new Map<StudioVrmIkEffector, StudioVrmIkConstraint>();
  for (const rawConstraint of value) {
    if (byEffector.size >= STUDIO_VRM_MAX_IK_CONSTRAINTS || !isRecord(rawConstraint)) continue;
    if (!isStudioVrmIkEffector(rawConstraint.effector) || byEffector.has(rawConstraint.effector)) {
      continue;
    }
    byEffector.set(rawConstraint.effector, {
      effector: rawConstraint.effector,
      enabled: normalizeBoolean(rawConstraint.enabled, false),
      locked: normalizeBoolean(rawConstraint.locked, false),
      target: normalizeVec3(rawConstraint.target, [0, 0, 0]),
      pole: rawConstraint.pole === null
        ? null
        : normalizeVec3(rawConstraint.pole, [0, 0, 0]),
    });
  }
  return STUDIO_VRM_IK_EFFECTORS.flatMap((effector) => {
    const constraint = byEffector.get(effector);
    return constraint ? [constraint] : [];
  });
}

function normalizePose(value: unknown): StudioVrmPoseState {
  const candidate = isRecord(value) ? value : {};
  return {
    bones: normalizePoseBones(candidate.bones),
    yOffset: boundedNumber(candidate.yOffset, 0, -10, 10),
    translations: normalizePoseTranslations(candidate.translations),
    bodyRotationY: normalizeRotationAngle(candidate.bodyRotationY),
    fingerOverrides: normalizeFingerOverrides(candidate.fingerOverrides),
    ikConstraints: normalizeIkConstraints(candidate.ikConstraints),
  };
}

function normalizeExpressions(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const key of Object.keys(value).sort()) {
    if (Object.keys(result).length >= STUDIO_VRM_MAX_EXPRESSIONS) break;
    if (
      !SAFE_DATA_KEY_PATTERN.test(key) ||
      FORBIDDEN_KEYS.has(key.toLowerCase()) ||
      UNSAFE_REFERENCE_KEY_PATTERN.test(key) ||
      typeof value[key] !== "number" ||
      !Number.isFinite(value[key])
    ) continue;
    result[key] = boundedNumber(value[key], 0, 0, 1);
  }
  return result;
}

function normalizeCamera(value: unknown): StudioVrmCameraSettings {
  const candidate = isRecord(value) ? value : {};
  const fallback = DEFAULT_RAW_DOCUMENT.camera;
  let position = normalizeVec3(candidate.position, fallback.position);
  const target = normalizeVec3(candidate.target, fallback.target);
  if (Math.hypot(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2]
  ) < 0.001) position = [...fallback.position];
  let up = normalizeUnitVec3(candidate.up, fallback.up);
  const viewX = target[0] - position[0];
  const viewY = target[1] - position[1];
  const viewZ = target[2] - position[2];
  const crossLength = Math.hypot(
    viewY * up[2] - viewZ * up[1],
    viewZ * up[0] - viewX * up[2],
    viewX * up[1] - viewY * up[0]
  );
  if (crossLength < 0.000_001) up = [...fallback.up];
  const near = boundedNumber(candidate.near, fallback.near, 0.001, 10);
  let far = boundedNumber(candidate.far, fallback.far, 0.01, 100_000);
  if (far <= near) far = Math.min(100_000, Math.max(fallback.far, near + 0.01));
  return {
    projection: "perspective",
    position,
    target,
    up,
    fovDegrees: boundedNumber(candidate.fovDegrees, fallback.fovDegrees, 5, 150),
    near,
    far,
  };
}

function normalizeCanonicalData(
  value: unknown,
  state: CanonicalDataState,
  depth = 0
): StudioVrmCanonicalData | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    if (
      Array.from(value).length > MAX_DATA_STRING_LENGTH ||
      containsControlCharacter(value) ||
      UNSAFE_REFERENCE_PATTERN.test(value.trim())
    ) return undefined;
    return value;
  }
  if (depth >= MAX_DATA_DEPTH || state.nodes >= MAX_DATA_NODES) return undefined;
  state.nodes += 1;
  if (Array.isArray(value)) {
    if (value.length > MAX_DATA_ARRAY_ITEMS) return undefined;
    const result: StudioVrmCanonicalData[] = [];
    for (const item of value) {
      const normalized = normalizeCanonicalData(item, state, depth + 1);
      if (normalized === undefined) return undefined;
      result.push(normalized);
    }
    return result;
  }
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (keys.length > MAX_DATA_OBJECT_KEYS) return undefined;
  const result: Record<string, StudioVrmCanonicalData> = {};
  for (const key of keys) {
    if (
      !SAFE_DATA_KEY_PATTERN.test(key) ||
      Array.from(key).length > MAX_DATA_KEY_LENGTH ||
      FORBIDDEN_KEYS.has(key.toLowerCase()) ||
      UNSAFE_REFERENCE_KEY_PATTERN.test(key)
    ) return undefined;
    const normalized = normalizeCanonicalData(value[key], state, depth + 1);
    if (normalized === undefined) return undefined;
    result[key] = normalized;
  }
  return result;
}

function normalizedDataOrNull(value: unknown): StudioVrmCanonicalData {
  return normalizeCanonicalData(value, { nodes: 0 }) ?? null;
}

function normalizeCustomColors(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) {
    if (Object.keys(result).length >= 32) break;
    if (
      !SAFE_DATA_KEY_PATTERN.test(key) ||
      FORBIDDEN_KEYS.has(key.toLowerCase()) ||
      UNSAFE_REFERENCE_KEY_PATTERN.test(key) ||
      typeof value[key] !== "string" ||
      !CSS_HEX_PATTERN.test(value[key])
    ) continue;
    result[key] = value[key].toLowerCase();
  }
  return result;
}

function normalizeMaterialFx(value: unknown): StudioVrmMaterialFx {
  const candidate = isRecord(value) ? value : {};
  return {
    shadeColor: normalizeNullableCssHex(candidate.shadeColor),
    outlineColor: normalizeNullableCssHex(candidate.outlineColor),
    rimColor: normalizeNullableCssHex(candidate.rimColor),
    rimIntensity: boundedNumber(candidate.rimIntensity, 0, 0, 1),
    emissiveColor: normalizeNullableCssHex(candidate.emissiveColor),
    emissiveIntensity: boundedNumber(candidate.emissiveIntensity, 0, 0, 1),
  };
}

function normalizeAppearance(value: unknown): StudioVrmAppearanceSettings {
  const candidate = isRecord(value) ? value : {};
  const bodyScale = isRecord(candidate.bodyScale) ? candidate.bodyScale : {};
  return {
    bodyScale: {
      height: boundedNumber(bodyScale.height, 1, 0.5, 1.6),
      width: boundedNumber(bodyScale.width, 1, 0.5, 1.6),
    },
    customColors: normalizeCustomColors(candidate.customColors),
    materialFx: normalizeMaterialFx(candidate.materialFx),
    mannequin: normalizeBoolean(candidate.mannequin, false),
    avatarForge: normalizedDataOrNull(candidate.avatarForge),
    costume: normalizedDataOrNull(candidate.costume),
    wardrobe: normalizedDataOrNull(candidate.wardrobe),
  };
}

function normalizeLighting(value: unknown): StudioVrmLightingSettings {
  const candidate = isRecord(value) ? value : {};
  return {
    intensity: boundedNumber(candidate.intensity, 1, 0.1, 4),
    colorTemp: boundedNumber(candidate.colorTemp, 0.5, 0, 1),
    directionDeg: boundedNumber(candidate.directionDeg, 45, -180, 180),
  };
}

function normalizeLightingTone(value: unknown): StudioVrmLightingTone {
  return isStudioVrmLightingTone(value) ? value : DEFAULT_STUDIO_VRM_LIGHTING_TONE;
}

function normalizePhysics(value: unknown): StudioVrmPhysicsSettings {
  const candidate = isRecord(value) ? value : {};
  return {
    version: 1,
    stiffnessScale: boundedNumber(candidate.stiffnessScale, 1, 0, 2),
    gravityScale: boundedNumber(candidate.gravityScale, 1, 0, 2),
    windDirectionDeg: boundedNumber(candidate.windDirectionDeg, 0, -180, 180),
    windStrength: boundedNumber(candidate.windStrength, 0, 0, 2),
  };
}

function normalizeRender(value: unknown): StudioVrmRenderSettings {
  const candidate = isRecord(value) ? value : {};
  let width = boundedInteger(candidate.width, 1024, 64, 8192);
  let height = boundedInteger(candidate.height, 1024, 64, 8192);
  if (width * height > MAX_RENDER_PIXELS) {
    const ratio = Math.sqrt(MAX_RENDER_PIXELS / (width * height));
    width = Math.max(64, Math.floor(width * ratio));
    height = Math.max(64, Math.floor(height * ratio));
  }
  return {
    width,
    height,
    transparentBackground: normalizeBoolean(candidate.transparentBackground, true),
    backgroundColor: normalizeCssHex(candidate.backgroundColor, "#ffffff"),
  };
}

function normalizeRig(value: unknown): StudioVrmRigSettings {
  const candidate = isRecord(value) ? value : {};
  const jointProfile = createStudioVrmRigProfileSelection(candidate.jointProfile)
    ?? createStudioVrmRigProfileSelection("neutral");
  if (!jointProfile) throw new Error("Missing internal neutral Studio VRM rig profile.");
  return {
    version: 1,
    jointProfile,
    fullBodyIk: normalizeBoolean(candidate.fullBodyIk, false),
    footPlant: normalizeBoolean(candidate.footPlant, false),
    floorHeight: boundedNumber(candidate.floorHeight, 0, -10, 10),
  };
}

function normalizeSurfacePaintIdentifier(value: unknown): string | null {
  if (
    typeof value !== "string"
    || !SAFE_ID_PATTERN.test(value)
    || FORBIDDEN_KEYS.has(value.toLowerCase())
    || UNSAFE_REFERENCE_PATTERN.test(value)
  ) return null;
  return value;
}

function normalizeSurfacePaintMaterialLocator(value: unknown): string | null {
  if (
    typeof value !== "string"
    || containsControlCharacter(value)
    || Array.from(value).length > 256
    || UNSAFE_REFERENCE_PATTERN.test(value)
  ) return null;
  return GLTF_MATERIAL_LOCATOR_PATTERN.test(value)
    || SCENE_PATH_MATERIAL_LOCATOR_PATTERN.test(value)
    ? value
    : null;
}

function normalizeSurfacePaintTexture(value: unknown): StudioVrmSurfacePaintTexture | null {
  if (!isRecord(value)) return null;
  const bindingKey = normalizeSurfacePaintIdentifier(value.bindingKey);
  const materialLocator = normalizeSurfacePaintMaterialLocator(value.materialLocator);
  const textureSlot = value.textureSlot === STUDIO_VRM_SURFACE_PAINT_BASE_COLOR_SLOT
    ? STUDIO_VRM_SURFACE_PAINT_BASE_COLOR_SLOT
    : null;
  if (
    !bindingKey
    || !materialLocator
    || !textureSlot
    || typeof value.hash !== "string"
    || !HASH_PATTERN.test(value.hash)
    || value.mime !== "image/png"
    || !Number.isSafeInteger(value.byteSize)
    || (value.byteSize as number) < 1
    || (value.byteSize as number) > STUDIO_VRM_SURFACE_PAINT_TEXTURE_MAX_BYTES
    || !Number.isSafeInteger(value.width)
    || (value.width as number) < 1
    || (value.width as number) > STUDIO_VRM_SURFACE_PAINT_MAX_DIMENSION
    || !Number.isSafeInteger(value.height)
    || (value.height as number) < 1
    || (value.height as number) > STUDIO_VRM_SURFACE_PAINT_MAX_DIMENSION
    || (value.width as number) * (value.height as number)
      > STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURE_PIXELS
  ) return null;
  return {
    bindingKey,
    materialLocator,
    textureSlot,
    hash: value.hash,
    mime: "image/png",
    byteSize: value.byteSize as number,
    width: value.width as number,
    height: value.height as number,
  };
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSurfacePaintTextures(
  left: StudioVrmSurfacePaintTexture,
  right: StudioVrmSurfacePaintTexture,
): number {
  return compareCanonicalStrings(left.materialLocator, right.materialLocator)
    || compareCanonicalStrings(left.textureSlot, right.textureSlot)
    || compareCanonicalStrings(left.bindingKey, right.bindingKey)
    || compareCanonicalStrings(left.hash, right.hash)
    || left.byteSize - right.byteSize
    || left.width - right.width
    || left.height - right.height;
}

function surfacePaintBindingIdentity(texture: StudioVrmSurfacePaintTexture): string {
  return `${texture.materialLocator}\u0000${texture.textureSlot}`;
}

function normalizeSurfacePaint(value: unknown): StudioVrmSurfacePaintSettings {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.textures)) {
    return { version: 1, textures: [] };
  }

  const sorted = value.textures
    .flatMap((texture) => {
      const normalized = normalizeSurfacePaintTexture(texture);
      return normalized ? [normalized] : [];
    })
    .sort(compareSurfacePaintTextures);
  const byIdentity = new Map<string, StudioVrmSurfacePaintTexture>();
  const conflictedIdentities = new Set<string>();
  const byHash = new Map<string, StudioVrmSurfacePaintTexture>();
  const conflictedHashes = new Set<string>();

  for (const texture of sorted) {
    const identity = surfacePaintBindingIdentity(texture);
    const existingBinding = byIdentity.get(identity);
    if (!existingBinding) {
      byIdentity.set(identity, texture);
    } else if (!jsonStructuresEqual(existingBinding, texture)) {
      conflictedIdentities.add(identity);
    }

    const existingAsset = byHash.get(texture.hash);
    if (!existingAsset) {
      byHash.set(texture.hash, texture);
    } else if (
      existingAsset.mime !== texture.mime
      || existingAsset.byteSize !== texture.byteSize
      || existingAsset.width !== texture.width
      || existingAsset.height !== texture.height
    ) {
      conflictedHashes.add(texture.hash);
    }
  }

  const uniqueBindings = Array.from(byIdentity.values())
    .filter((texture) => (
      !conflictedIdentities.has(surfacePaintBindingIdentity(texture))
      && !conflictedHashes.has(texture.hash)
    ))
    .sort(compareSurfacePaintTextures);
  if (uniqueBindings.length > STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES) {
    failSceneBudget("surface-paint-count-budget-exceeded");
  }
  const assets = Array.from(new Set(uniqueBindings.map((texture) => texture.hash)))
    .sort(compareCanonicalStrings);
  const acceptedHashes = new Set<string>();
  let totalBytes = 0;
  let totalDecodedPixels = 0;
  for (const hash of assets) {
    const texture = byHash.get(hash);
    if (!texture) continue;
    const decodedPixels = texture.width * texture.height;
    if (totalBytes + texture.byteSize > STUDIO_VRM_SURFACE_PAINT_TOTAL_MAX_BYTES) {
      failSceneBudget("surface-paint-byte-budget-exceeded");
    }
    if (totalDecodedPixels + decodedPixels > STUDIO_VRM_SURFACE_PAINT_MAX_DECODED_PIXELS) {
      failSceneBudget("surface-paint-decoded-pixel-budget-exceeded");
    }
    acceptedHashes.add(hash);
    totalBytes += texture.byteSize;
    totalDecodedPixels += decodedPixels;
  }

  return {
    version: 1,
    textures: uniqueBindings.filter((texture) => acceptedHashes.has(texture.hash)),
  };
}

function normalizeDecodedDocumentFields(value: Record<string, unknown>): StudioVrmSceneDocument {
  return {
    kind: STUDIO_VRM_SCENE_DOCUMENT_KIND,
    version: STUDIO_VRM_SCENE_DOCUMENT_VERSION,
    model: normalizeModel(value.model),
    pose: normalizePose(value.pose),
    expressions: normalizeExpressions(value.expressions),
    camera: normalizeCamera(value.camera),
    appearance: normalizeAppearance(value.appearance),
    rig: normalizeRig(value.rig),
    props: normalizedDataOrNull(value.props),
    sceneProps: normalizedDataOrNull(value.sceneProps),
    lighting: normalizeLighting(value.lighting),
    lightingTone: normalizeLightingTone(value.lightingTone),
    physics: normalizePhysics(value.physics),
    env: isStudioVrmEnvironment(value.env) ? value.env : "none",
    render: normalizeRender(value.render),
    surfacePaint: normalizeSurfacePaint(value.surfacePaint),
  };
}

function normalizeDecodedCurrentDocument(value: unknown): StudioVrmSceneDocument | null {
  if (
    !isRecord(value) ||
    value.kind !== STUDIO_VRM_SCENE_DOCUMENT_KIND ||
    value.version !== STUDIO_VRM_SCENE_DOCUMENT_VERSION
  ) return null;
  return deepFreeze(normalizeDecodedDocumentFields(value));
}

function hasStrictIkConstraints(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > STUDIO_VRM_MAX_IK_CONSTRAINTS) return false;
  const effectors = new Set<StudioVrmIkEffector>();
  for (const constraint of value) {
    if (!isRecord(constraint)) return false;
    const keys = Object.keys(constraint);
    if (
      keys.length !== IK_CONSTRAINT_KEYS.size
      || keys.some((key) => !IK_CONSTRAINT_KEYS.has(key))
      || !isStudioVrmIkEffector(constraint.effector)
      || effectors.has(constraint.effector)
    ) return false;
    effectors.add(constraint.effector);
  }
  return true;
}

function hasStrictSurfacePaint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== SURFACE_PAINT_KEYS.size
    || keys.some((key) => !SURFACE_PAINT_KEYS.has(key))
    || value.version !== 1
    || !Array.isArray(value.textures)
    || value.textures.length > STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES
  ) return false;
  return value.textures.every((texture) => {
    if (!isRecord(texture)) return false;
    const textureKeys = Object.keys(texture);
    return textureKeys.length === SURFACE_PAINT_TEXTURE_KEYS.size
      && textureKeys.every((key) => SURFACE_PAINT_TEXTURE_KEYS.has(key));
  });
}

function strictDecodedCurrentDocument(value: unknown): StudioVrmSceneDocument | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== CURRENT_ROOT_KEYS.size || keys.some((key) => !CURRENT_ROOT_KEYS.has(key))) {
    return null;
  }
  if (
    !isRecord(value.rig)
    || Object.keys(value.rig).length !== RIG_KEYS.size
    || Object.keys(value.rig).some((key) => !RIG_KEYS.has(key))
  ) return null;
  if (
    !isRecord(value.pose)
    || Object.keys(value.pose).length !== CURRENT_POSE_KEYS.size
    || Object.keys(value.pose).some((key) => !CURRENT_POSE_KEYS.has(key))
    || !isRecord(value.pose.translations)
    || Object.keys(value.pose.translations).length !== POSE_TRANSLATION_KEYS.size
    || Object.keys(value.pose.translations).some((key) => !POSE_TRANSLATION_KEYS.has(key))
    || !hasStrictIkConstraints(value.pose.ikConstraints)
    || !hasStrictSurfacePaint(value.surfacePaint)
  ) return null;
  let normalized: StudioVrmSceneDocument | null;
  try {
    normalized = normalizeDecodedCurrentDocument(value);
  } catch (cause) {
    if (cause instanceof StudioVrmSceneDocumentBudgetError) return null;
    throw cause;
  }
  if (!normalized || !jsonStructuresEqual(value, normalized)) return null;
  try {
    return utf8ByteLength(JSON.stringify(normalized)) <= STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function versionFiveProjection(document: StudioVrmSceneDocument): Record<string, unknown> {
  const { lightingTone: _lightingTone, ...projection } = document;
  return {
    ...projection,
    version: STUDIO_VRM_SCENE_DOCUMENT_PREVIOUS_VERSION,
  };
}

/**
 * Strict reader for v5 documents written before `lightingTone` became persistent. The historical
 * root vocabulary remains exact; the only authored addition is the deterministic morning tone.
 */
function migrateStrictDecodedVersionFiveDocument(
  value: unknown,
): StudioVrmSceneDocument | null {
  if (
    !isRecord(value)
    || value.kind !== STUDIO_VRM_SCENE_DOCUMENT_KIND
    || value.version !== STUDIO_VRM_SCENE_DOCUMENT_PREVIOUS_VERSION
  ) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== VERSION_FIVE_ROOT_KEYS.size
    || keys.some((key) => !VERSION_FIVE_ROOT_KEYS.has(key))
  ) return null;
  const migrated = strictDecodedCurrentDocument({
    ...value,
    version: STUDIO_VRM_SCENE_DOCUMENT_VERSION,
    lightingTone: DEFAULT_STUDIO_VRM_LIGHTING_TONE,
  });
  if (!migrated || !jsonStructuresEqual(value, versionFiveProjection(migrated))) return null;
  try {
    return utf8ByteLength(JSON.stringify(value)) <= STUDIO_VRM_SCENE_DOCUMENT_V5_MAX_BYTES
      ? migrated
      : null;
  } catch {
    return null;
  }
}

function versionOneProjection(document: StudioVrmSceneDocument): Record<string, unknown> {
  const {
    translations: _translations,
    ikConstraints: _ikConstraints,
    ...legacyPose
  } = document.pose;
  return {
    kind: document.kind,
    version: STUDIO_VRM_SCENE_DOCUMENT_LEGACY_VERSION,
    model: document.model,
    pose: legacyPose,
    expressions: document.expressions,
    camera: document.camera,
    appearance: document.appearance,
    props: document.props,
    sceneProps: document.sceneProps,
    lighting: document.lighting,
    physics: document.physics,
    env: document.env,
    render: document.render,
  };
}

function versionTwoProjection(document: StudioVrmSceneDocument): Record<string, unknown> {
  const {
    translations: _translations,
    ikConstraints: _ikConstraints,
    ...versionTwoPose
  } = document.pose;
  return {
    kind: document.kind,
    version: STUDIO_VRM_SCENE_DOCUMENT_VERSION_TWO,
    model: document.model,
    pose: versionTwoPose,
    expressions: document.expressions,
    camera: document.camera,
    appearance: document.appearance,
    rig: document.rig,
    props: document.props,
    sceneProps: document.sceneProps,
    lighting: document.lighting,
    physics: document.physics,
    env: document.env,
    render: document.render,
  };
}

function versionThreeProjection(document: StudioVrmSceneDocument): Record<string, unknown> {
  const { ikConstraints: _ikConstraints, ...versionThreePose } = document.pose;
  return {
    kind: document.kind,
    version: STUDIO_VRM_SCENE_DOCUMENT_VERSION_THREE,
    model: document.model,
    pose: versionThreePose,
    expressions: document.expressions,
    camera: document.camera,
    appearance: document.appearance,
    rig: document.rig,
    props: document.props,
    sceneProps: document.sceneProps,
    lighting: document.lighting,
    physics: document.physics,
    env: document.env,
    render: document.render,
  };
}

function versionFourProjection(document: StudioVrmSceneDocument): Record<string, unknown> {
  return {
    kind: document.kind,
    version: STUDIO_VRM_SCENE_DOCUMENT_VERSION_FOUR,
    model: document.model,
    pose: document.pose,
    expressions: document.expressions,
    camera: document.camera,
    appearance: document.appearance,
    rig: document.rig,
    props: document.props,
    sceneProps: document.sceneProps,
    lighting: document.lighting,
    physics: document.physics,
    env: document.env,
    render: document.render,
  };
}

/** Strict v1 reader; all later-version fields are added with documented neutral defaults. */
function migrateStrictDecodedVersionOneDocument(value: unknown): StudioVrmSceneDocument | null {
  if (
    !isRecord(value)
    || value.kind !== STUDIO_VRM_SCENE_DOCUMENT_KIND
    || value.version !== STUDIO_VRM_SCENE_DOCUMENT_LEGACY_VERSION
  ) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== VERSION_ONE_ROOT_KEYS.size
    || keys.some((key) => !VERSION_ONE_ROOT_KEYS.has(key))
  ) return null;
  const migrated = deepFreeze(normalizeDecodedDocumentFields({
    ...value,
    pose: isRecord(value.pose)
      ? {
          ...value.pose,
          translations: DEFAULT_RAW_DOCUMENT.pose.translations,
          ikConstraints: DEFAULT_RAW_DOCUMENT.pose.ikConstraints,
        }
      : value.pose,
    rig: DEFAULT_RAW_DOCUMENT.rig,
    surfacePaint: DEFAULT_RAW_DOCUMENT.surfacePaint,
  }));
  if (!jsonStructuresEqual(value, versionOneProjection(migrated))) return null;
  try {
    const sourceBytes = utf8ByteLength(JSON.stringify(value));
    const migratedBytes = utf8ByteLength(JSON.stringify(migrated));
    return sourceBytes <= STUDIO_VRM_SCENE_DOCUMENT_V1_MAX_BYTES
      && migratedBytes <= STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES
      ? migrated
      : null;
  } catch {
    return null;
  }
}

/** Strict v2 reader; translation, IK, and surface-paint fields receive neutral defaults. */
function migrateStrictDecodedVersionTwoDocument(value: unknown): StudioVrmSceneDocument | null {
  if (
    !isRecord(value)
    || value.kind !== STUDIO_VRM_SCENE_DOCUMENT_KIND
    || value.version !== STUDIO_VRM_SCENE_DOCUMENT_VERSION_TWO
  ) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== VERSION_TWO_TO_FOUR_ROOT_KEYS.size
    || keys.some((key) => !VERSION_TWO_TO_FOUR_ROOT_KEYS.has(key))
    || !isRecord(value.rig)
    || Object.keys(value.rig).length !== RIG_KEYS.size
    || Object.keys(value.rig).some((key) => !RIG_KEYS.has(key))
    || !isRecord(value.pose)
    || hasOwn(value.pose, "translations")
  ) return null;
  const migrated = deepFreeze(normalizeDecodedDocumentFields({
    ...value,
    pose: {
      ...value.pose,
      translations: DEFAULT_RAW_DOCUMENT.pose.translations,
      ikConstraints: DEFAULT_RAW_DOCUMENT.pose.ikConstraints,
    },
    surfacePaint: DEFAULT_RAW_DOCUMENT.surfacePaint,
  }));
  if (!jsonStructuresEqual(value, versionTwoProjection(migrated))) return null;
  try {
    const sourceBytes = utf8ByteLength(JSON.stringify(value));
    const migratedBytes = utf8ByteLength(JSON.stringify(migrated));
    return sourceBytes <= STUDIO_VRM_SCENE_DOCUMENT_V2_MAX_BYTES
      && migratedBytes <= STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES
      ? migrated
      : null;
  } catch {
    return null;
  }
}

/** Strict v3 reader; persistent IK and surface-paint fields receive neutral defaults. */
function migrateStrictDecodedVersionThreeDocument(value: unknown): StudioVrmSceneDocument | null {
  if (
    !isRecord(value)
    || value.kind !== STUDIO_VRM_SCENE_DOCUMENT_KIND
    || value.version !== STUDIO_VRM_SCENE_DOCUMENT_VERSION_THREE
  ) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== VERSION_TWO_TO_FOUR_ROOT_KEYS.size
    || keys.some((key) => !VERSION_TWO_TO_FOUR_ROOT_KEYS.has(key))
    || !isRecord(value.rig)
    || Object.keys(value.rig).length !== RIG_KEYS.size
    || Object.keys(value.rig).some((key) => !RIG_KEYS.has(key))
    || !isRecord(value.pose)
    || Object.keys(value.pose).length !== VERSION_THREE_POSE_KEYS.size
    || Object.keys(value.pose).some((key) => !VERSION_THREE_POSE_KEYS.has(key))
    || !isRecord(value.pose.translations)
    || Object.keys(value.pose.translations).length !== POSE_TRANSLATION_KEYS.size
    || Object.keys(value.pose.translations).some((key) => !POSE_TRANSLATION_KEYS.has(key))
  ) return null;
  const migrated = deepFreeze(normalizeDecodedDocumentFields({
    ...value,
    pose: {
      ...value.pose,
      ikConstraints: DEFAULT_RAW_DOCUMENT.pose.ikConstraints,
    },
    surfacePaint: DEFAULT_RAW_DOCUMENT.surfacePaint,
  }));
  if (!jsonStructuresEqual(value, versionThreeProjection(migrated))) return null;
  try {
    const sourceBytes = utf8ByteLength(JSON.stringify(value));
    const migratedBytes = utf8ByteLength(JSON.stringify(migrated));
    return sourceBytes <= STUDIO_VRM_SCENE_DOCUMENT_V3_MAX_BYTES
      && migratedBytes <= STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES
      ? migrated
      : null;
  } catch {
    return null;
  }
}

/** Strict, lossless v4 reader. The only authored addition is the empty surface-paint block. */
function migrateStrictDecodedVersionFourDocument(value: unknown): StudioVrmSceneDocument | null {
  if (
    !isRecord(value)
    || value.kind !== STUDIO_VRM_SCENE_DOCUMENT_KIND
    || value.version !== STUDIO_VRM_SCENE_DOCUMENT_VERSION_FOUR
  ) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== VERSION_TWO_TO_FOUR_ROOT_KEYS.size
    || keys.some((key) => !VERSION_TWO_TO_FOUR_ROOT_KEYS.has(key))
    || !isRecord(value.rig)
    || Object.keys(value.rig).length !== RIG_KEYS.size
    || Object.keys(value.rig).some((key) => !RIG_KEYS.has(key))
    || !isRecord(value.pose)
    || Object.keys(value.pose).length !== CURRENT_POSE_KEYS.size
    || Object.keys(value.pose).some((key) => !CURRENT_POSE_KEYS.has(key))
    || !isRecord(value.pose.translations)
    || Object.keys(value.pose.translations).length !== POSE_TRANSLATION_KEYS.size
    || Object.keys(value.pose.translations).some((key) => !POSE_TRANSLATION_KEYS.has(key))
    || !hasStrictIkConstraints(value.pose.ikConstraints)
  ) return null;
  const migrated = deepFreeze(normalizeDecodedDocumentFields({
    ...value,
    surfacePaint: DEFAULT_RAW_DOCUMENT.surfacePaint,
  }));
  if (!jsonStructuresEqual(value, versionFourProjection(migrated))) return null;
  try {
    const sourceBytes = utf8ByteLength(JSON.stringify(value));
    const migratedBytes = utf8ByteLength(JSON.stringify(migrated));
    return sourceBytes <= STUDIO_VRM_SCENE_DOCUMENT_V4_MAX_BYTES
      && migratedBytes <= STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES
      ? migrated
      : null;
  } catch {
    return null;
  }
}

/** Returns a new, deeply frozen default scene document on every call. */
export function createDefaultStudioVrmSceneDocument(): StudioVrmSceneDocument {
  const decoded = decodeBoundedDataGraph(DEFAULT_RAW_DOCUMENT);
  const document = strictDecodedCurrentDocument(decoded);
  if (!document) throw new Error("Invalid internal Studio VRM scene defaults.");
  return document;
}

/** Creates a default scene with a validated model descriptor. */
export function createStudioVrmSceneDocument(model?: StudioVrmSceneModel): StudioVrmSceneDocument {
  return normalizeStudioVrmSceneDocument({
    ...DEFAULT_RAW_DOCUMENT,
    model: model ?? DEFAULT_RAW_DOCUMENT.model,
  });
}

export const DEFAULT_STUDIO_VRM_SCENE_DOCUMENT = createDefaultStudioVrmSceneDocument();

/**
 * Lenient editor normalizer. Invalid roots, future versions, accessors, cycles, and oversized input
 * reset to a fresh default; persistence must use the strict parse/serialize functions below.
 */
export function normalizeStudioVrmSceneDocument(raw: unknown): StudioVrmSceneDocument {
  const decoded = decodeBoundedDataGraph(raw);
  if (exceedsHistoricalSourceLimit(raw, decoded)) return createDefaultStudioVrmSceneDocument();
  return normalizeDecodedCurrentDocument(decoded)
    ?? migrateStrictDecodedVersionFiveDocument(decoded)
    ?? migrateStrictDecodedVersionFourDocument(decoded)
    ?? migrateStrictDecodedVersionThreeDocument(decoded)
    ?? migrateStrictDecodedVersionTwoDocument(decoded)
    ?? migrateStrictDecodedVersionOneDocument(decoded)
    ?? createDefaultStudioVrmSceneDocument();
}

/** Parses canonical v6 and losslessly promotes complete canonical v1-v5 documents. */
export function parseStudioVrmSceneDocument(raw: string): StudioVrmSceneDocument | null {
  const decoded = decodeBoundedDataGraph(raw);
  if (exceedsHistoricalSourceLimit(raw, decoded)) return null;
  return strictDecodedCurrentDocument(decoded)
    ?? migrateStrictDecodedVersionFiveDocument(decoded)
    ?? migrateStrictDecodedVersionFourDocument(decoded)
    ?? migrateStrictDecodedVersionThreeDocument(decoded)
    ?? migrateStrictDecodedVersionTwoDocument(decoded)
    ?? migrateStrictDecodedVersionOneDocument(decoded);
}

/** Serializes only complete, losslessly canonical version-6 documents. */
export function serializeStudioVrmSceneDocument(raw: unknown): string | null {
  const document = strictDecodedCurrentDocument(decodeBoundedDataGraph(raw));
  if (!document) return null;
  try {
    const serialized = JSON.stringify(document);
    return utf8ByteLength(serialized) <= STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES
      ? serialized
      : null;
  } catch {
    return null;
  }
}

function readLegacyBundledModel(
  value: Record<string, unknown>,
  options: StudioVrmLegacyMigrationOptions
): StudioVrmBundledModel | null {
  const modelId = typeof value.modelId === "string" ? value.modelId : null;
  if (!modelId) return null;
  const registry = options.bundledModels ?? [{ id: "sample-vrm", name: "루미" }];
  const match = registry.find((entry) => entry.id === modelId);
  if (!match) return null;
  const id = normalizeSafeId(match.id, "");
  const name = normalizeSafeText(match.name, "", 128);
  return id && name ? { source: "bundled", id, name } : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function strictFullStateV2Translations(
  value: Record<string, unknown>,
): StudioVrmPoseTranslations | null {
  if (!hasOwn(value, "poseTranslations")) return DEFAULT_RAW_DOCUMENT.pose.translations;
  if (!isRecord(value.poseTranslations)) return null;
  const keys = Object.keys(value.poseTranslations);
  if (
    keys.length !== POSE_TRANSLATION_KEYS.size
    || keys.some((key) => !POSE_TRANSLATION_KEYS.has(key))
  ) return null;
  const normalized = normalizePoseTranslations(value.poseTranslations);
  return jsonStructuresEqual(value.poseTranslations, normalized) ? normalized : null;
}

/**
 * Migrates the currently emitted re-editable PNG metadata. Keeping this separate from the
 * pre-version reader makes mixed old/new field names and future FullVrmState versions fail closed.
 */
function migrateDecodedFullStateMetadata(
  value: unknown,
  options: StudioVrmLegacyMigrationOptions,
): StudioVrmLegacyMetadataMigration | null {
  const fullStateVersion = isRecord(value) ? value.version : undefined;
  const allowedKeys = fullStateVersion === 3
    ? FULL_STATE_V3_FRAGMENT_KEYS
    : FULL_STATE_V2_FRAGMENT_KEYS;
  if (
    !isRecord(value)
    || value.tool !== "vrm-poser"
    || (value.version !== 2 && value.version !== 3)
    || hasOwn(value, "kind")
    || !hasOnlyKeys(value, allowedKeys)
    || !hasOwn(value, "bones")
    || !hasOwn(value, "yOffset")
    || !hasOwn(value, "bodyRotation")
    || (value.version === 3 && !hasOwn(value, "ikConstraints"))
    || (value.version === 3 && !hasOwn(value, "poseTranslations"))
    || (hasOwn(value, "lightingTone") && !isStudioVrmLightingTone(value.lightingTone))
  ) return null;

  const translations = strictFullStateV2Translations(value);
  if (!translations) return null;
  const normalizedBones = normalizePoseBones(value.bones);
  if (!jsonStructuresEqual(value.bones, normalizedBones)) return null;
  const ikConstraints = value.version === 2
    ? DEFAULT_RAW_DOCUMENT.pose.ikConstraints
    : hasStrictIkConstraints(value.ikConstraints)
      ? normalizeIkConstraints(value.ikConstraints)
      : null;
  if (!ikConstraints || (value.version === 3 && !jsonStructuresEqual(value.ikConstraints, ikConstraints))) {
    return null;
  }
  if (
    typeof value.yOffset !== "number"
    || !Number.isFinite(value.yOffset)
    || value.yOffset < -10
    || value.yOffset > 10
    || typeof value.bodyRotation !== "number"
    || !Number.isFinite(value.bodyRotation)
    || value.bodyRotation < -Math.PI
    || value.bodyRotation > Math.PI
  ) return null;

  const bundledModel = readLegacyBundledModel(value, options);
  if (!bundledModel) {
    return deepFreeze({
      status: "unresolved-model",
      modelId: typeof value.modelId === "string" ? value.modelId : null,
      modelName: typeof value.modelName === "string"
        ? normalizeSafeText(value.modelName, "") || null
        : null,
    });
  }

  const candidate: StudioVrmSceneDocument = {
    ...DEFAULT_RAW_DOCUMENT,
    model: bundledModel,
    pose: normalizePose({
      bones: normalizedBones,
      yOffset: value.yOffset,
      translations,
      bodyRotationY: value.bodyRotation,
      fingerOverrides: value.fingerOverrides,
      ikConstraints,
    }),
    expressions: normalizeExpressions(value.expressionWeights),
    appearance: normalizeAppearance({
      bodyScale: value.bodyScale,
      customColors: value.customColors,
      materialFx: value.materialFx,
      avatarForge: value.avatarForge,
      costume: value.costume,
      wardrobe: value.wardrobe,
    }),
    props: normalizedDataOrNull(value.vrmProps),
    sceneProps: normalizedDataOrNull(value.sceneProps),
    lighting: normalizeLighting(value.lighting),
    lightingTone: normalizeLightingTone(value.lightingTone),
    physics: normalizePhysics(value.physics),
    env: isStudioVrmEnvironment(value.env) ? value.env : "none",
  };
  const serialized = serializeStudioVrmSceneDocument(candidate);
  const document = serialized ? parseStudioVrmSceneDocument(serialized) : null;
  return document ? deepFreeze({ status: "resolved", document }) : null;
}

function migrateDecodedLegacyMetadata(
  value: unknown,
  options: StudioVrmLegacyMigrationOptions
): StudioVrmLegacyMetadataMigration | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, LEGACY_ROOT_KEYS) ||
    (hasOwn(value, "tool") && value.tool !== "vrm-poser") ||
    hasOwn(value, "kind") ||
    hasOwn(value, "version") ||
    (hasOwn(value, "lightingTone") && !isStudioVrmLightingTone(value.lightingTone))
  ) return null;
  const bundledModel = readLegacyBundledModel(value, options);
  if (!bundledModel) {
    return deepFreeze({
      status: "unresolved-model",
      modelId: typeof value.modelId === "string" ? value.modelId : null,
      modelName: typeof value.modelName === "string"
        ? normalizeSafeText(value.modelName, "") || null
        : null,
    });
  }
  const vrmProps = value.vrmProps !== undefined ? value.vrmProps : value.props;
  const candidate: StudioVrmSceneDocument = {
    ...DEFAULT_RAW_DOCUMENT,
    model: bundledModel,
    pose: normalizePose({
      bones: value.bones,
      yOffset: value.yOffset,
      bodyRotationY: value.bodyRotationY,
      fingerOverrides: value.fingerOverrides,
    }),
    expressions: normalizeExpressions(value.expressionWeights),
    appearance: normalizeAppearance({
      bodyScale: value.bodyScale,
      customColors: value.customColors,
      materialFx: value.materialFx,
      mannequin: value.mannequin,
      avatarForge: value.avatarForge,
      costume: value.costume,
      wardrobe: value.wardrobe,
    }),
    props: normalizedDataOrNull(vrmProps),
    sceneProps: normalizedDataOrNull(value.sceneProps),
    lighting: normalizeLighting(value.lighting),
    lightingTone: normalizeLightingTone(value.lightingTone),
    physics: normalizePhysics(value.physics),
    env: isStudioVrmEnvironment(value.env) ? value.env : "none",
    render: normalizeRender({
      width: value.renderWidth,
      height: value.renderHeight,
      transparentBackground: value.transparentBackground,
      backgroundColor: "#ffffff",
    }),
  };
  const serialized = serializeStudioVrmSceneDocument(candidate);
  const document = serialized ? parseStudioVrmSceneDocument(serialized) : null;
  return document ? deepFreeze({ status: "resolved", document }) : null;
}

/**
 * Migrates a canonical scene or a legacy PNG-fragment metadata object. Legacy local-library ids
 * intentionally return null unless the id appears in the explicit bundled registry.
 */
export function migrateStudioVrmSceneDocument(
  raw: unknown,
  options: StudioVrmLegacyMigrationOptions = {}
): StudioVrmSceneDocument | null {
  const decoded = decodeBoundedDataGraph(raw);
  if (exceedsHistoricalSourceLimit(raw, decoded)) return null;
  const current = strictDecodedCurrentDocument(decoded);
  if (current) return current;
  const versionFive = migrateStrictDecodedVersionFiveDocument(decoded);
  if (versionFive) return versionFive;
  const versionFour = migrateStrictDecodedVersionFourDocument(decoded);
  if (versionFour) return versionFour;
  const versionThree = migrateStrictDecodedVersionThreeDocument(decoded);
  if (versionThree) return versionThree;
  const versionTwo = migrateStrictDecodedVersionTwoDocument(decoded);
  if (versionTwo) return versionTwo;
  const versionOne = migrateStrictDecodedVersionOneDocument(decoded);
  if (versionOne) return versionOne;
  const migrated = migrateDecodedFullStateMetadata(decoded, options)
    ?? migrateDecodedLegacyMetadata(decoded, options);
  return migrated?.status === "resolved" ? migrated.document : null;
}

/** Detailed legacy migration for callers that need to surface an unresolved local-model state. */
export function migrateStudioVrmLegacyMetadata(
  raw: unknown,
  options: StudioVrmLegacyMigrationOptions = {}
): StudioVrmLegacyMetadataMigration | null {
  const decoded = decodeBoundedDataGraph(raw);
  return migrateDecodedFullStateMetadata(decoded, options)
    ?? migrateDecodedLegacyMetadata(decoded, options);
}

/**
 * Splits a legacy captured PNG data URL from its URL-encoded JSON fragment and safely migrates the
 * metadata. The returned raster source never retains the fragment. Raster bytes are not decoded.
 */
export function parseStudioVrmLegacyFragment(
  src: string,
  options: StudioVrmLegacyMigrationOptions = {}
): StudioVrmLegacyFragmentMigration | null {
  if (typeof src !== "string") return null;
  const hashIndex = src.indexOf("#");
  if (hashIndex <= 0) return null;
  const rasterSrc = src.slice(0, hashIndex);
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/i.test(rasterSrc)) return null;
  const encodedFragment = src.slice(hashIndex + 1);
  if (!encodedFragment || utf8ByteLength(encodedFragment) > STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES * 3) {
    return null;
  }
  let json: string;
  try {
    json = decodeURIComponent(encodedFragment);
  } catch {
    return null;
  }
  if (utf8ByteLength(json) > STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES) return null;
  const migration = migrateStudioVrmLegacyMetadata(json, options);
  if (!migration) return null;
  return migration.status === "resolved"
    ? deepFreeze({ status: "resolved", rasterSrc, document: migration.document })
    : deepFreeze({
        status: "unresolved-model",
        rasterSrc,
        modelId: migration.modelId,
        modelName: migration.modelName,
      });
}

/** Canonical semantic equality independent of object identity and key insertion order. */
export function areStudioVrmSceneDocumentsEqual(left: unknown, right: unknown): boolean {
  const leftSerialized = serializeStudioVrmSceneDocument(migrateStudioVrmSceneDocument(left));
  return leftSerialized !== null
    && leftSerialized === serializeStudioVrmSceneDocument(migrateStudioVrmSceneDocument(right));
}

/** Returns whether a canonical scene contains authoring intent beyond the fresh default. */
export function studioVrmSceneHasContent(raw: unknown): boolean {
  const serialized = serializeStudioVrmSceneDocument(migrateStudioVrmSceneDocument(raw));
  if (!serialized) return false;
  return serialized !== serializeStudioVrmSceneDocument(DEFAULT_STUDIO_VRM_SCENE_DOCUMENT);
}
