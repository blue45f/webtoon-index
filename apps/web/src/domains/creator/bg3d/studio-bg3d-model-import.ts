import {
  disposeStudioBg3dThreeResources,
  measureStudioBg3dThreeMetrics,
} from "../studio-background-3d-model";

import {
  StudioBg3dGeometryWorkerClientError,
  parseStudioBg3dGeometryInWorker,
} from "./studio-bg3d-geometry-worker-client";
import {
  hasValidStudioBg3dCanonicalGeometryNumbers,
  isStudioBg3dCanonicalGeometryPayload,
  type StudioBg3dCanonicalGeometryPayload,
} from "./studio-bg3d-geometry-worker-protocol";
import {
  STUDIO_BG3D_GLB_MAX_BYTES,
  type StudioBg3dGlbBudgetProfiles,
  type StudioBg3dGlbProfile,
  type StudioBg3dGlbValidationBudget,
} from "./studio-bg3d-glb-validation";
import { STUDIO_BG3D_MESHOPT_EXTENSION } from "./studio-bg3d-meshopt";
import {
  StudioBg3dObjPreflightWorkerClientError,
  preflightStudioBg3dMtlBytesInWorker,
  preflightStudioBg3dObjBytesInWorker,
} from "./studio-bg3d-obj-preflight-worker-client";
import {
  STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS,
  STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
  type StudioBg3dObjPreflightWorkerFailureCode,
  type StudioBg3dObjPreflightWorkerMtlEntry,
  type StudioBg3dObjPreflightWorkerMtlRequest,
  type StudioBg3dObjPreflightWorkerMtlResult,
  type StudioBg3dObjPreflightWorkerObjRequest,
  type StudioBg3dObjPreflightWorkerObjResult,
} from "./studio-bg3d-obj-preflight-worker-protocol";
import { hydrateStudioBg3dObjWorkerResult } from "./studio-bg3d-obj-three-hydrator";
import {
  StudioBg3dObjWorkerClientError,
  parseStudioBg3dObjInWorker,
} from "./studio-bg3d-obj-worker-client";
import {
  STUDIO_BG3D_OBJ_WORKER_BUDGETS,
  STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
  isStudioBg3dObjWorkerResponseForRequest,
  type StudioBg3dObjWorkerCanonicalResult,
  type StudioBg3dObjWorkerFailureCode,
  type StudioBg3dObjWorkerMtlEntry,
  type StudioBg3dObjWorkerParseRequest,
} from "./studio-bg3d-obj-worker-protocol";

import type { Bg3dModelUploadSource } from "./bg3d-model-library";
import type { StudioBg3dParsedGlbMetrics } from "./studio-bg3d-scene-document";
import type * as THREE from "three";

import {
  inspectStrictJpegDimensions,
  inspectStrictStaticWebpDimensions,
} from "@/shared/lib/strict-raster-image-inspector";

export const STUDIO_BG3D_IMPORT_MAX_FILES = 256;
export const STUDIO_BG3D_IMPORT_MAX_MODELS = 32;
export const STUDIO_BG3D_IMPORT_MAX_FILE_BYTES = STUDIO_BG3D_GLB_MAX_BYTES;
export const STUDIO_BG3D_IMPORT_MAX_CONVERSION_SOURCE_BYTES = 32 * 1024 * 1024;
export const STUDIO_BG3D_IMPORT_MAX_TOTAL_BYTES = 300 * 1024 * 1024;
export const STUDIO_BG3D_IMPORT_MAX_TEXT_BYTES = 32 * 1024 * 1024;
export const STUDIO_BG3D_IMPORT_MAX_IMAGE_DIMENSION = 8_192;
export const STUDIO_BG3D_IMPORT_MAX_DECODED_IMAGE_BYTES = 256 * 1024 * 1024;
/** Hard pre-parser ceilings. The canonical GLB validator applies the active device/document budget later. */
export const STUDIO_BG3D_IMPORT_MAX_INLINE_RESOURCE_BYTES = 8 * 1024 * 1024;
export const STUDIO_BG3D_IMPORT_MAX_INLINE_TOTAL_BYTES = 32 * 1024 * 1024;
export const STUDIO_BG3D_IMPORT_MAX_NODES = 2_048;
export const STUDIO_BG3D_IMPORT_MAX_MESHES = 1_024;
export const STUDIO_BG3D_IMPORT_MAX_MESH_PRIMITIVES = 2_048;
export const STUDIO_BG3D_IMPORT_MAX_VERTICES = 4_000_000;
export const STUDIO_BG3D_IMPORT_MAX_TRIANGLES = 2_000_000;
export const STUDIO_BG3D_IMPORT_MAX_ACCESSOR_ELEMENTS = 40_000_000;
export const STUDIO_BG3D_IMPORT_MAX_DECODED_GEOMETRY_BYTES = 256 * 1024 * 1024;
export const STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIALS = 1_024;
export const STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIAL_SLOTS = 4_096;
export const STUDIO_BG3D_IMPORT_MAX_ANIMATION_CLIPS = 128;
export const STUDIO_BG3D_IMPORT_MAX_ANIMATION_TRACKS = 4_096;
export const STUDIO_BG3D_IMPORT_MAX_ANIMATION_KEYFRAMES = 2_000_000;
export const STUDIO_BG3D_IMPORT_MAX_ANIMATION_BYTES = 128 * 1024 * 1024;
export const STUDIO_BG3D_IMPORT_MAX_ANIMATION_DURATION_SECONDS = 6 * 60 * 60;
export const STUDIO_BG3D_IMPORT_MAX_OBJ_MTL_REFERENCE_DIRECTIVES = 256;
export const STUDIO_BG3D_IMPORT_MAX_OBJ_MATERIAL_LIBRARIES = 64;
export const STUDIO_BG3D_IMPORT_MAX_OBJ_MTL_TOTAL_BYTES = 16 * 1024 * 1024;
export const STUDIO_BG3D_IMPORT_MAX_OBJ_MTL_DIRECTIVES = 65_536;
export const STUDIO_BG3D_IMPORT_DIRECT_MAX_BYTES = 512 * 1024;
const STUDIO_BG3D_IMPORT_MAX_GLTF_TABLE_ENTRIES = 65_536;
const STUDIO_BG3D_IMPORT_MAX_RESOURCE_RECORDS = 256;
const STUDIO_BG3D_IMPORT_MAX_MATERIAL_RECORDS = STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIALS;
/** Mirrors the downstream model library's default cumulative admission budget. */
export const STUDIO_BG3D_IMPORT_MAX_OUTPUT_TOTAL_BYTES = STUDIO_BG3D_GLB_MAX_BYTES;

export const STUDIO_BG3D_IMPORT_PRIMARY_FORMATS = [
  "glb",
  "gltf",
  "obj",
  "fbx",
  "dae",
  "stl",
  "ply",
  "3ds",
] as const;
export const STUDIO_BG3D_IMPORT_COMPANION_FORMATS = [
  "bin",
  "mtl",
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const;

export type StudioBg3dImportPrimaryFormat = (typeof STUDIO_BG3D_IMPORT_PRIMARY_FORMATS)[number];
export type StudioBg3dImportCompanionFormat = (typeof STUDIO_BG3D_IMPORT_COMPANION_FORMATS)[number];
export type StudioBg3dImportProgressStage = "planning" | "reading" | "parsing" | "exporting" | "ready";

export interface StudioBg3dImportFile extends Blob {
  readonly name: string;
  readonly webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StudioBg3dImportPlanItem {
  readonly primary: StudioBg3dImportFile;
  readonly primaryPath: string;
  readonly format: StudioBg3dImportPrimaryFormat;
}

export interface StudioBg3dImportPlan {
  readonly items: readonly StudioBg3dImportPlanItem[];
  readonly resources: ReadonlyMap<string, StudioBg3dImportFile>;
  readonly ignoredFiles: readonly string[];
  readonly totalBytes: number;
}

export interface StudioBg3dImportProgress {
  readonly stage: StudioBg3dImportProgressStage;
  readonly completedModels: number;
  readonly totalModels: number;
  readonly sourceName: string;
}

export interface StudioBg3dModelImportOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioBg3dImportProgress) => void;
  /** Selected exactly once before conversion starts. Omission selects the product Worker. */
  readonly executionBackend?: StudioBg3dModelImportExecutionBackend;
  /**
   * Optional active device profile and document-intersected budgets. Supplying neither preserves
   * the legacy absolute pre-export ceilings; supplying one without the other fails closed.
   */
  readonly profile?: StudioBg3dGlbProfile;
  readonly budgets?: StudioBg3dGlbBudgetProfiles;
}

export type StudioBg3dModelImportExecutionBackend = "worker" | "direct";

export type StudioBg3dModelImportErrorCode =
  | "aborted"
  | "animation-budget-exceeded"
  | "duplicate-resource"
  | "empty-file"
  | "environment-unsupported"
  | "export-failed"
  | "file-too-large"
  | "image-dimension-too-large"
  | "image-memory-too-large"
  | "inline-resource-too-large"
  | "invalid-image"
  | "invalid-path"
  | "invalid-text"
  | "missing-resource"
  | "mesh-budget-exceeded"
  | "material-budget-exceeded"
  | "model-byte-budget-exceeded"
  | "no-model"
  | "node-budget-exceeded"
  | "output-too-large"
  | "output-total-too-large"
  | "parse-failed"
  | "too-many-files"
  | "too-many-models"
  | "total-too-large"
  | "triangle-budget-exceeded"
  | "light-budget-exceeded"
  | "skin-count-budget-exceeded"
  | "joint-count-budget-exceeded"
  | "morph-target-budget-exceeded"
  | "texture-count-budget-exceeded"
  | "texture-byte-budget-exceeded"
  | "texture-dimension-budget-exceeded"
  | "unsafe-resource-uri"
  | "unsupported-extension"
  | "vertex-budget-exceeded"
  | "worker-required"
  | "geometry-memory-too-large";

const ERROR_MESSAGES: Readonly<Record<StudioBg3dModelImportErrorCode, string>> = Object.freeze({
  aborted: "3D 모델 가져오기를 취소했습니다.",
  "animation-budget-exceeded": "3D 애니메이션의 클립·트랙·키프레임 또는 재생 시간이 변환 안전 기준을 초과했습니다. 애니메이션을 줄이거나 키를 단순화해 주세요.",
  "duplicate-resource": "같은 경로 또는 이름의 3D 리소스가 중복되어 있습니다. 파일 구성을 정리해 주세요.",
  "empty-file": "비어 있는 3D 모델 또는 리소스 파일은 가져올 수 없습니다.",
  "environment-unsupported": "이 브라우저에서는 3D 모델 변환 기능을 사용할 수 없습니다. 최신 브라우저에서 다시 시도해 주세요.",
  "export-failed": "3D 모델을 자체 포함 GLB로 변환하지 못했습니다. 원본 모델과 텍스처를 확인해 주세요.",
  "file-too-large": "GLB·리소스는 100MiB, 변환할 원본 모델은 32MiB 제한을 초과할 수 없습니다.",
  "image-dimension-too-large": "3D 모델 텍스처 한 변은 8192px을 초과할 수 없습니다. 텍스처 해상도를 낮춰 주세요.",
  "image-memory-too-large": "선택한 3D 텍스처의 디코딩 메모리가 256MiB 제한을 초과했습니다. 텍스처를 줄여 주세요.",
  "inline-resource-too-large": "glTF에 직접 포함된 데이터의 용량 제한을 초과했습니다. BIN·텍스처를 별도 파일로 내보내거나 모델을 줄여 주세요.",
  "invalid-image": "3D 모델 텍스처의 형식 또는 크기 정보를 안전하게 확인할 수 없습니다.",
  "invalid-path": "3D 모델 리소스 경로가 안전하지 않습니다. 상대 경로로 구성된 원본을 선택해 주세요.",
  "invalid-text": "3D 모델의 텍스트 데이터를 UTF-8로 읽지 못했습니다.",
  "missing-resource": "3D 모델이 참조하는 BIN·MTL·텍스처 파일이 선택 항목에 없습니다.",
  "mesh-budget-exceeded": "3D 모델의 메시 또는 프리미티브 수가 가져오기 안전 기준을 초과했습니다. 메시를 병합해 주세요.",
  "material-budget-exceeded": "3D 모델의 재질 또는 재질 슬롯 수가 변환 안전 기준을 초과했습니다. OBJ/MTL 재질을 병합해 주세요.",
  "model-byte-budget-exceeded": "변환될 3D 모델의 예상 용량이 이 기기의 안전 기준을 초과했습니다. 메시와 텍스처를 줄여 주세요.",
  "no-model": "GLB, glTF, OBJ, FBX, DAE, STL, PLY 또는 3DS 모델 파일을 하나 이상 선택해 주세요.",
  "node-budget-exceeded": "3D 모델의 노드 수가 가져오기 안전 기준을 초과했습니다. 계층을 단순화해 주세요.",
  "output-too-large": "변환된 GLB가 100MiB 제한을 초과했습니다. 텍스처나 메시를 최적화해 주세요.",
  "output-total-too-large": "한 번에 변환된 GLB의 총용량은 100MiB를 초과할 수 없습니다. 모델을 나누어 가져와 주세요.",
  "parse-failed": "3D 모델 구조를 해석하지 못했습니다. 원본 파일과 연결 리소스를 확인해 주세요.",
  "too-many-files": "한 번에 선택할 수 있는 3D 모델과 연결 리소스는 최대 256개입니다.",
  "too-many-models": "한 번에 가져올 수 있는 3D 모델은 최대 32개입니다.",
  "total-too-large": "한 번에 가져올 파일의 총용량은 300MiB를 초과할 수 없습니다.",
  "triangle-budget-exceeded": "3D 모델의 삼각형 수가 가져오기 안전 기준을 초과했습니다. 메시를 경량화해 주세요.",
  "light-budget-exceeded": "3D 모델의 조명 수가 이 기기의 안전 기준을 초과했습니다. 조명 수를 줄여 주세요.",
  "skin-count-budget-exceeded": "3D 모델의 스킨 수가 이 기기의 안전 기준을 초과했습니다. 리깅 구조를 단순화해 주세요.",
  "joint-count-budget-exceeded": "3D 모델의 조인트 수가 이 기기의 안전 기준을 초과했습니다. 본 구조를 단순화해 주세요.",
  "morph-target-budget-exceeded": "3D 모델의 모프 타깃 수가 이 기기의 안전 기준을 초과했습니다. 표정·변형 타깃을 줄여 주세요.",
  "texture-count-budget-exceeded": "3D 모델의 고유 텍스처 수가 이 기기의 안전 기준을 초과했습니다. 텍스처를 정리해 주세요.",
  "texture-byte-budget-exceeded": "3D 모델 텍스처의 예상 디코딩 메모리가 이 기기의 안전 기준을 초과했습니다. 텍스처를 축소해 주세요.",
  "texture-dimension-budget-exceeded": "3D 모델 텍스처 해상도가 이 기기의 안전 기준을 초과했습니다. 텍스처 크기를 낮춰 주세요.",
  "unsafe-resource-uri": "3D 모델이 로컬 선택 범위 밖의 네트워크 또는 파일 리소스를 참조합니다.",
  "unsupported-extension": "아직 변환할 수 없는 압축 또는 텍스처 확장이 포함되어 있습니다. 표준 glTF/GLB로 다시 내보내 주세요.",
  "vertex-budget-exceeded": "3D 모델의 정점 수가 가져오기 안전 기준을 초과했습니다. 메시를 경량화해 주세요.",
  "worker-required": "선택한 OBJ·STL·PLY 변환 백엔드를 사용할 수 없습니다. Worker를 지원하는 최신 브라우저에서 다시 시도하거나 명시적 직접 실행 모델의 크기를 줄여 주세요.",
  "geometry-memory-too-large": "3D 모델의 디코딩된 기하 데이터가 256MiB 안전 기준을 초과했습니다. 메시를 경량화해 주세요.",
});

export class StudioBg3dModelImportError extends Error {
  constructor(readonly code: StudioBg3dModelImportErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "StudioBg3dModelImportError";
  }
}

const PRIMARY_FORMAT_SET = new Set<string>(STUDIO_BG3D_IMPORT_PRIMARY_FORMATS);
const COMPANION_FORMAT_SET = new Set<string>(STUDIO_BG3D_IMPORT_COMPANION_FORMATS);
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;
const ENCODED_SEPARATOR_PATTERN = /%(?:2f|5c)/iu;
const SAFE_DATA_URI_PREFIX_PATTERN = /^data:(application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,/iu;
const UNSUPPORTED_REQUIRED_GLTF_EXTENSIONS = new Set([
  "KHR_draco_mesh_compression",
  "KHR_texture_basisu",
  STUDIO_BG3D_MESHOPT_EXTENSION,
  "KHR_meshopt_compression",
]);
const JSON_GLTF_MESHOPT_EXTENSIONS = [
  STUDIO_BG3D_MESHOPT_EXTENSION,
  "KHR_meshopt_compression",
] as const;

function importError(code: StudioBg3dModelImportErrorCode): StudioBg3dModelImportError {
  return new StudioBg3dModelImportError(code);
}

function isSafeBudgetLimit(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function resolvePreExportBudget(
  options: Pick<StudioBg3dModelImportOptions, "budgets" | "profile">,
): StudioBg3dGlbValidationBudget | undefined {
  if (options.profile === undefined && options.budgets === undefined) return undefined;
  if (
    (options.profile !== "mobile" && options.profile !== "desktop")
    || !options.budgets
  ) {
    throw importError("parse-failed");
  }
  const budget = options.budgets[options.profile];
  const complexity = budget?.complexity;
  const textures = budget?.textures;
  if (
    !complexity
    || !textures
    || ![
      complexity.maxModelBytes,
      complexity.maxNodes,
      complexity.maxTriangles,
      complexity.maxDrawCalls,
      complexity.maxMaterials,
      complexity.maxLights,
      complexity.maxAnimations,
      complexity.maxAnimationChannels,
      complexity.maxAnimationKeyframes,
      complexity.maxAnimationValues,
      complexity.maxSkins,
      complexity.maxJoints,
      complexity.maxMorphTargets,
      complexity.maxAccessorElements,
      complexity.maxDecodedGeometryBytes,
      textures.maxTextures,
      textures.maxTotalBytes,
      textures.maxDimension,
    ].every(isSafeBudgetLimit)
  ) {
    throw importError("parse-failed");
  }
  return Object.freeze({
    complexity: Object.freeze({ ...complexity }),
    textures: Object.freeze({ ...textures }),
  });
}

function profileLimit(absoluteCeiling: number, selectedLimit: number | undefined): number {
  return selectedLimit === undefined
    ? absoluteCeiling
    : Math.min(absoluteCeiling, selectedLimit);
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 31 || codePoint === 127;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some(isControlCharacter);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw importError("aborted");
}

function safeAddCount(left: number, right: number, code: StudioBg3dModelImportErrorCode): number {
  if (
    !Number.isSafeInteger(left)
    || left < 0
    || !Number.isSafeInteger(right)
    || right < 0
    || left > Number.MAX_SAFE_INTEGER - right
  ) {
    throw importError(code);
  }
  return left + right;
}

function safeMultiplyCount(left: number, right: number, code: StudioBg3dModelImportErrorCode): number {
  if (
    !Number.isSafeInteger(left)
    || left < 0
    || !Number.isSafeInteger(right)
    || right < 0
    || (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) {
    throw importError(code);
  }
  return left * right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extensionOf(path: string): string {
  const lastSegment = path.slice(path.lastIndexOf("/") + 1);
  const dot = lastSegment.lastIndexOf(".");
  return dot > 0 && dot < lastSegment.length - 1 ? lastSegment.slice(dot + 1).toLowerCase() : "";
}

function modelBaseName(path: string): string {
  const segment = path.slice(path.lastIndexOf("/") + 1);
  const dot = segment.lastIndexOf(".");
  const raw = dot > 0 ? segment.slice(0, dot) : segment;
  const normalized = Array.from(raw.normalize("NFKC"), (character) =>
    isControlCharacter(character) ? " " : character)
    .slice(0, 116)
    .join("")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}._~-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "3d-model";
}

function canonicalFilePath(file: StudioBg3dImportFile): string {
  const raw = (file.webkitRelativePath || file.name).normalize("NFC").replace(/\\/gu, "/");
  if (!raw || raw.length > 1024 || raw.startsWith("/") || containsControlCharacter(raw)) {
    throw importError("invalid-path");
  }
  const segments = raw.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw importError("invalid-path");
  }
  return segments.join("/");
}

function validateInputFile(file: StudioBg3dImportFile): void {
  validateInputFileShape(file);
  if (file.size <= 0) throw importError("empty-file");
  if (file.size > STUDIO_BG3D_IMPORT_MAX_FILE_BYTES) throw importError("file-too-large");
}

function validateInputFileShape(file: StudioBg3dImportFile): void {
  if (
    typeof file?.name !== "string"
    || typeof file.size !== "number"
    || !Number.isSafeInteger(file.size)
    || typeof file.arrayBuffer !== "function"
  ) {
    throw importError("invalid-path");
  }
}

/**
 * Creates a bounded, deterministic plan before any file bytes are materialized. Unknown files are
 * ignored so a directory selection may include licenses/readmes, but every usable resource path
 * must still be unique case-insensitively across platforms.
 */
export function planStudioBg3dModelImports(
  input: readonly StudioBg3dImportFile[],
): StudioBg3dImportPlan {
  if (input.length > STUDIO_BG3D_IMPORT_MAX_FILES) throw importError("too-many-files");
  const resources = new Map<string, StudioBg3dImportFile>();
  const canonicalPathByFoldedPath = new Map<string, string>();
  const items: StudioBg3dImportPlanItem[] = [];
  const ignoredFiles: string[] = [];
  let totalBytes = 0;

  for (const file of input) {
    validateInputFileShape(file);
    const path = canonicalFilePath(file);
    const extension = extensionOf(path);
    const isPrimary = PRIMARY_FORMAT_SET.has(extension);
    const isCompanion = COMPANION_FORMAT_SET.has(extension);
    if (!isPrimary && !isCompanion) {
      ignoredFiles.push(path);
      continue;
    }
    validateInputFile(file);
    if (
      isPrimary
      && extension !== "glb"
      && file.size > STUDIO_BG3D_IMPORT_MAX_CONVERSION_SOURCE_BYTES
    ) {
      throw importError("file-too-large");
    }
    if (totalBytes > STUDIO_BG3D_IMPORT_MAX_TOTAL_BYTES - file.size) throw importError("total-too-large");
    totalBytes += file.size;
    const foldedPath = path.toLocaleLowerCase("en-US");
    if (canonicalPathByFoldedPath.has(foldedPath)) throw importError("duplicate-resource");
    canonicalPathByFoldedPath.set(foldedPath, path);
    resources.set(path, file);
    if (isPrimary) {
      items.push({
        primary: file,
        primaryPath: path,
        format: extension as StudioBg3dImportPrimaryFormat,
      });
    }
  }

  if (items.length === 0) throw importError("no-model");
  if (items.length > STUDIO_BG3D_IMPORT_MAX_MODELS) throw importError("too-many-models");
  return Object.freeze({
    items: Object.freeze(items),
    resources,
    ignoredFiles: Object.freeze(ignoredFiles),
    totalBytes,
  });
}

function safeDecodeUriPath(value: string): string {
  const withoutQuery = value.split(/[?#]/u, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery).replace(/\\/gu, "/");
  } catch {
    throw importError("unsafe-resource-uri");
  }
  if (!decoded || decoded.startsWith("/") || containsControlCharacter(decoded)) {
    throw importError("unsafe-resource-uri");
  }
  const normalized: string[] = [];
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      // Do not normalize traversal, even when it would remain below the selected directory root.
      // The browser file picker does not give us a trustworthy package root to authorize it.
      throw importError("unsafe-resource-uri");
    } else {
      normalized.push(segment);
    }
  }
  if (normalized.length === 0) throw importError("unsafe-resource-uri");
  return normalized.join("/");
}

function directoryOf(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator >= 0 ? path.slice(0, separator + 1) : "";
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

class LocalResourceResolver {
  readonly #resources: ReadonlyMap<string, StudioBg3dImportFile>;
  readonly #primaryDirectory: string;
  readonly #pathByFoldedPath = new Map<string, string>();
  readonly #uniquePathByFoldedBaseName = new Map<string, string | null>();
  readonly #objectUrlByPath = new Map<string, string>();
  readonly #ownedObjectUrls = new Set<string>();
  readonly #approvedInlineUris = new Set<string>();
  readonly #packageRootDepth: number;

  constructor(resources: ReadonlyMap<string, StudioBg3dImportFile>, primaryPath: string) {
    this.#resources = resources;
    this.#primaryDirectory = directoryOf(primaryPath);
    this.#packageRootDepth = primaryPath.includes("/") ? 1 : 0;
    for (const path of resources.keys()) {
      this.#pathByFoldedPath.set(path.toLocaleLowerCase("en-US"), path);
      const baseName = path.slice(path.lastIndexOf("/") + 1).toLocaleLowerCase("en-US");
      if (!this.#uniquePathByFoldedBaseName.has(baseName)) {
        this.#uniquePathByFoldedBaseName.set(baseName, path);
      } else {
        this.#uniquePathByFoldedBaseName.set(baseName, null);
      }
    }
  }

  fileForUri(uri: string): StudioBg3dImportFile {
    return this.resourceForUri(uri).file;
  }

  fileForCanonicalPath(path: string): StudioBg3dImportFile {
    const file = this.#resources.get(path);
    if (!file) throw importError("missing-resource");
    return file;
  }

  canonicalResourcePaths(): readonly string[] {
    return [...this.#resources.keys()].sort(compareUtf8);
  }

  resourceForPackageUri(referrerPath: string, uri: string): {
    readonly path: string;
    readonly file: StudioBg3dImportFile;
  } {
    const path = this.#resolvePackagePath(referrerPath, uri);
    const file = this.#resources.get(path);
    if (!file) throw importError("missing-resource");
    return { path, file };
  }

  resourceForUri(uri: string): {
    readonly path: string;
    readonly file: StudioBg3dImportFile;
  } {
    const path = this.#resolvePath(uri);
    const file = this.#resources.get(path);
    if (!file) throw importError("missing-resource");
    return { path, file };
  }

  approveInlineUri(uri: string): void {
    this.#approvedInlineUris.add(uri);
  }

  urlForUri = (uri: string): string => {
    if (uri.startsWith("data:")) {
      if (!this.#approvedInlineUris.has(uri)) throw importError("unsafe-resource-uri");
      return uri;
    }
    if (uri.startsWith("blob:") && this.#ownedObjectUrls.has(uri)) return uri;
    if (SCHEME_PATTERN.test(uri) || uri.startsWith("//")) throw importError("unsafe-resource-uri");
    const path = this.#resolvePath(uri);
    return this.#urlForCanonicalPath(path);
  };

  urlForCanonicalPath(path: string): string {
    if (!this.#resources.has(path)) throw importError("missing-resource");
    return this.#urlForCanonicalPath(path);
  }

  #urlForCanonicalPath(path: string): string {
    const existing = this.#objectUrlByPath.get(path);
    if (existing) return existing;
    if (typeof URL?.createObjectURL !== "function") throw importError("environment-unsupported");
    const file = this.#resources.get(path);
    if (!file) throw importError("missing-resource");
    const objectUrl = URL.createObjectURL(file);
    this.#objectUrlByPath.set(path, objectUrl);
    this.#ownedObjectUrls.add(objectUrl);
    return objectUrl;
  }

  dispose(): void {
    for (const objectUrl of this.#ownedObjectUrls) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Revocation is best-effort, but one browser failure must not strand the remaining URLs.
      }
    }
    this.#ownedObjectUrls.clear();
    this.#objectUrlByPath.clear();
    this.#approvedInlineUris.clear();
  }

  #resolvePath(uri: string): string {
    if (SCHEME_PATTERN.test(uri) || uri.startsWith("//")) throw importError("unsafe-resource-uri");
    const normalized = safeDecodeUriPath(uri);
    const candidates = [`${this.#primaryDirectory}${normalized}`, normalized];
    for (const candidate of candidates) {
      const exact = this.#resources.has(candidate)
        ? candidate
        : this.#pathByFoldedPath.get(candidate.toLocaleLowerCase("en-US"));
      if (exact) return exact;
    }
    const baseName = normalized.slice(normalized.lastIndexOf("/") + 1).toLocaleLowerCase("en-US");
    const uniquePath = this.#uniquePathByFoldedBaseName.get(baseName);
    if (uniquePath) return uniquePath;
    throw importError("missing-resource");
  }

  #resolvePackagePath(referrerPath: string, uri: string): string {
    const raw = uri.trim();
    if (
      !raw
      || raw.length > 1_024
      || raw.startsWith("/")
      || raw.startsWith("//")
      || raw.includes("\\")
      || raw.includes("?")
      || raw.includes("#")
      || containsControlCharacter(raw)
      || SCHEME_PATTERN.test(raw)
      || ENCODED_SEPARATOR_PATTERN.test(raw)
    ) throw importError("unsafe-resource-uri");

    let decoded: string;
    try {
      decoded = decodeURIComponent(raw).normalize("NFC");
    } catch {
      throw importError("unsafe-resource-uri");
    }
    if (
      !decoded
      || decoded.startsWith("/")
      || decoded.startsWith("//")
      || decoded.includes("\\")
      || decoded.includes("?")
      || decoded.includes("#")
      || containsControlCharacter(decoded)
      || SCHEME_PATTERN.test(decoded)
    ) throw importError("unsafe-resource-uri");

    const segments = referrerPath.split("/").slice(0, -1);
    for (const segment of decoded.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        if (segments.length <= this.#packageRootDepth) throw importError("unsafe-resource-uri");
        segments.pop();
      } else {
        segments.push(segment);
      }
    }
    const relative = this.#canonicalPathForCandidate(segments.join("/"));
    if (relative) return relative;

    if (!decoded.includes("..")) {
      const direct = this.#canonicalPathForCandidate(
        decoded.split("/").filter((segment) => segment && segment !== ".").join("/"),
      );
      if (direct) return direct;
    }
    throw importError("missing-resource");
  }

  #canonicalPathForCandidate(candidate: string): string | null {
    if (!candidate) return null;
    if (this.#resources.has(candidate)) return candidate;
    return this.#pathByFoldedPath.get(candidate.toLocaleLowerCase("en-US")) ?? null;
  }
}

interface TrackedLoadingManager {
  readonly manager: THREE.LoadingManager;
  waitForIdle(signal?: AbortSignal): Promise<void>;
}

async function createTrackedLoadingManager(
  resolver: LocalResourceResolver,
): Promise<TrackedLoadingManager> {
  const { LoadingManager } = await import("three");
  const manager = new LoadingManager();
  let started = false;
  let settled = false;
  let failed = false;
  let settle: (() => void) | null = null;
  const idle = new Promise<void>((resolve) => {
    settle = resolve;
  });
  manager.setURLModifier(resolver.urlForUri);
  manager.onStart = () => {
    started = true;
  };
  manager.onLoad = () => {
    settled = true;
    settle?.();
  };
  manager.onError = () => {
    failed = true;
    settled = true;
    settle?.();
  };
  return {
    manager,
    async waitForIdle(signal) {
      throwIfAborted(signal);
      await Promise.resolve();
      if (!started || settled) {
        if (failed) throw importError("missing-resource");
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const handleAbort = () => reject(importError("aborted"));
        signal?.addEventListener("abort", handleAbort, { once: true });
        if (signal?.aborted) handleAbort();
        void idle.then(() => {
          signal?.removeEventListener("abort", handleAbort);
          resolve();
        });
      });
      if (failed) throw importError("missing-resource");
      throwIfAborted(signal);
    },
  };
}

async function readBytes(
  file: StudioBg3dImportFile,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  try {
    const result = await file.arrayBuffer();
    throwIfAborted(signal);
    if (!(result instanceof ArrayBuffer) || result.byteLength !== file.size) throw importError("parse-failed");
    return result;
  } catch (error) {
    if (error instanceof StudioBg3dModelImportError) throw error;
    throw importError("parse-failed");
  }
}

async function readUtf8(
  file: StudioBg3dImportFile,
  signal?: AbortSignal,
): Promise<string> {
  if (file.size > STUDIO_BG3D_IMPORT_MAX_TEXT_BYTES) throw importError("file-too-large");
  const bytes = await readBytes(file, signal);
  return decodeUtf8(bytes, signal);
}

function decodeUtf8(bytes: ArrayBuffer, signal?: AbortSignal): string {
  throwIfAborted(signal);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw importError("invalid-text");
  }
}

interface ImportedImageDimensions {
  readonly width: number;
  readonly height: number;
}

function importedPngDimensions(bytes: Uint8Array): ImportedImageDimensions | null {
  if (
    bytes.byteLength < 24 ||
    ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

function importedImageDimensions(
  extension: string,
  bytes: Uint8Array,
): ImportedImageDimensions | null {
  if (extension === "png") return importedPngDimensions(bytes);
  try {
    if (extension === "jpg" || extension === "jpeg") {
      return inspectStrictJpegDimensions(bytes);
    }
    if (extension === "webp") return inspectStrictStaticWebpDimensions(bytes);
  } catch {
    return null;
  }
  return null;
}

async function preflightCompanionImageMemory(
  resources: ReadonlyMap<string, StudioBg3dImportFile>,
  signal?: AbortSignal,
): Promise<number> {
  let decodedBytes = 0;
  for (const [path, file] of resources) {
    const extension = extensionOf(path);
    if (extension !== "png" && extension !== "jpg" && extension !== "jpeg" && extension !== "webp") {
      continue;
    }
    const dimensions = importedImageDimensions(
      extension,
      new Uint8Array(await readBytes(file, signal)),
    );
    if (!dimensions) throw importError("invalid-image");
    if (
      dimensions.width > STUDIO_BG3D_IMPORT_MAX_IMAGE_DIMENSION ||
      dimensions.height > STUDIO_BG3D_IMPORT_MAX_IMAGE_DIMENSION
    ) {
      throw importError("image-dimension-too-large");
    }
    const imageBytes = dimensions.width * dimensions.height * 4;
    if (
      !Number.isSafeInteger(imageBytes) ||
      decodedBytes > STUDIO_BG3D_IMPORT_MAX_DECODED_IMAGE_BYTES - imageBytes
    ) {
      throw importError("image-memory-too-large");
    }
    decodedBytes += imageBytes;
  }
  return decodedBytes;
}

interface ParsedInlineResource {
  readonly mimeType: string;
  readonly payload: string;
  readonly decodedByteLength: number;
}

function isBase64CodeUnit(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a)
    || (code >= 0x61 && code <= 0x7a)
    || (code >= 0x30 && code <= 0x39)
    || code === 0x2b
    || code === 0x2f
  );
}

/** Validates strict, unescaped base64 and computes its size without materializing decoded bytes. */
function parseInlineResourceUri(
  uri: string,
  expectedKind: "buffer" | "image",
  signal?: AbortSignal,
): ParsedInlineResource {
  const prefix = SAFE_DATA_URI_PREFIX_PATTERN.exec(uri);
  if (!prefix || typeof prefix[1] !== "string") throw importError("unsafe-resource-uri");
  const mimeType = prefix[1].toLowerCase();
  if (
    (expectedKind === "buffer" && !mimeType.startsWith("application/"))
    || (expectedKind === "image" && !mimeType.startsWith("image/"))
  ) {
    throw importError("unsafe-resource-uri");
  }
  const payload = uri.slice(prefix[0].length);
  if (payload.length === 0 || payload.length % 4 !== 0) throw importError("unsafe-resource-uri");
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const contentLength = payload.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    if (!isBase64CodeUnit(payload.charCodeAt(index))) throw importError("unsafe-resource-uri");
  }
  for (let index = contentLength; index < payload.length; index += 1) {
    if (payload.charCodeAt(index) !== 0x3d) throw importError("unsafe-resource-uri");
  }
  const decodedByteLength = (payload.length / 4) * 3 - padding;
  if (
    !Number.isSafeInteger(decodedByteLength)
    || decodedByteLength <= 0
    || decodedByteLength > STUDIO_BG3D_IMPORT_MAX_INLINE_RESOURCE_BYTES
  ) {
    throw importError("inline-resource-too-large");
  }
  return { mimeType, payload, decodedByteLength };
}

function base64Value(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  return code === 0x2b ? 62 : 63;
}

/** Decodes only already-validated, individually capped inline resources. */
function decodeInlineResource(
  resource: ParsedInlineResource,
  signal?: AbortSignal,
): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(resource.decodedByteLength);
  let outputOffset = 0;
  for (let offset = 0; offset < resource.payload.length; offset += 4) {
    if ((offset & 0xffff) === 0) throwIfAborted(signal);
    const first = base64Value(resource.payload.charCodeAt(offset));
    const second = base64Value(resource.payload.charCodeAt(offset + 1));
    const thirdCode = resource.payload.charCodeAt(offset + 2);
    const fourthCode = resource.payload.charCodeAt(offset + 3);
    const third = thirdCode === 0x3d ? 0 : base64Value(thirdCode);
    const fourth = fourthCode === 0x3d ? 0 : base64Value(fourthCode);
    if (outputOffset < output.length) output[outputOffset++] = (first << 2) | (second >> 4);
    if (outputOffset < output.length) output[outputOffset++] = ((second & 0x0f) << 4) | (third >> 2);
    if (outputOffset < output.length) output[outputOffset++] = ((third & 0x03) << 6) | fourth;
  }
  return output;
}

function rejectJsonGltfMeshoptBufferViews(root: Record<string, unknown>): void {
  const bufferViews = root.bufferViews;
  if (bufferViews === undefined) return;
  if (!Array.isArray(bufferViews)) throw importError("parse-failed");
  for (const bufferView of bufferViews) {
    if (!isRecord(bufferView)) throw importError("parse-failed");
    const extensions = bufferView.extensions;
    if (extensions === undefined) continue;
    if (!isRecord(extensions)) throw importError("parse-failed");
    if (JSON_GLTF_MESHOPT_EXTENSIONS.some((extension) => Object.hasOwn(extensions, extension))) {
      throw importError("unsupported-extension");
    }
  }
}

function optionalGltfArray(
  root: Record<string, unknown>,
  key: string,
): readonly unknown[] {
  const value = root[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw importError("parse-failed");
  return value;
}

function preflightJsonGltf(
  root: unknown,
  resolver: LocalResourceResolver,
  signal?: AbortSignal,
  companionDecodedImageBytes = 0,
): void {
  if (!isRecord(root)) throw importError("parse-failed");
  const candidate = root as {
    readonly asset?: { readonly version?: unknown };
    readonly extensionsRequired?: unknown;
  };
  if (candidate.asset?.version !== "2.0") throw importError("parse-failed");
  rejectJsonGltfMeshoptBufferViews(root);
  const extensionsRequired = candidate.extensionsRequired;
  if (extensionsRequired !== undefined && !Array.isArray(extensionsRequired)) {
    throw importError("parse-failed");
  }
  for (const extension of extensionsRequired ?? []) {
    if (typeof extension !== "string") throw importError("parse-failed");
    if (UNSUPPORTED_REQUIRED_GLTF_EXTENSIONS.has(extension)) throw importError("unsupported-extension");
  }

  const nodes = optionalGltfArray(root, "nodes");
  if (nodes.length > STUDIO_BG3D_IMPORT_MAX_NODES) throw importError("node-budget-exceeded");
  const meshes = optionalGltfArray(root, "meshes");
  if (meshes.length > STUDIO_BG3D_IMPORT_MAX_MESHES) throw importError("mesh-budget-exceeded");
  const accessors = optionalGltfArray(root, "accessors");
  if (accessors.length > STUDIO_BG3D_IMPORT_MAX_GLTF_TABLE_ENTRIES) {
    throw importError("vertex-budget-exceeded");
  }
  for (const [key, limit, code] of [
    ["animations", 128, "mesh-budget-exceeded"],
    ["bufferViews", STUDIO_BG3D_IMPORT_MAX_GLTF_TABLE_ENTRIES, "geometry-memory-too-large"],
    ["cameras", 64, "node-budget-exceeded"],
    ["materials", STUDIO_BG3D_IMPORT_MAX_MATERIAL_RECORDS, "mesh-budget-exceeded"],
    ["samplers", STUDIO_BG3D_IMPORT_MAX_RESOURCE_RECORDS, "image-memory-too-large"],
    ["scenes", 128, "node-budget-exceeded"],
    ["skins", 128, "node-budget-exceeded"],
    ["textures", STUDIO_BG3D_IMPORT_MAX_RESOURCE_RECORDS, "image-memory-too-large"],
  ] as const) {
    if (optionalGltfArray(root, key).length > limit) throw importError(code);
  }
  const accessorCounts: number[] = [];
  let accessorElements = 0;
  for (let index = 0; index < accessors.length; index += 1) {
    if ((index & 0x3ff) === 0) throwIfAborted(signal);
    const accessor = accessors[index];
    if (!isRecord(accessor) || !Number.isSafeInteger(accessor.count) || (accessor.count as number) < 0) {
      throw importError("parse-failed");
    }
    const count = accessor.count as number;
    accessorElements = safeAddCount(accessorElements, count, "vertex-budget-exceeded");
    if (accessorElements > STUDIO_BG3D_IMPORT_MAX_ACCESSOR_ELEMENTS) {
      throw importError("vertex-budget-exceeded");
    }
    accessorCounts.push(count);
  }

  let primitiveCount = 0;
  let vertices = 0;
  let triangles = 0;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    throwIfAborted(signal);
    const mesh = meshes[meshIndex];
    if (!isRecord(mesh) || !Array.isArray(mesh.primitives)) throw importError("parse-failed");
    primitiveCount = safeAddCount(primitiveCount, mesh.primitives.length, "mesh-budget-exceeded");
    if (primitiveCount > STUDIO_BG3D_IMPORT_MAX_MESH_PRIMITIVES) {
      throw importError("mesh-budget-exceeded");
    }
    for (const primitive of mesh.primitives) {
      if (!isRecord(primitive) || !isRecord(primitive.attributes)) throw importError("parse-failed");
      const positionIndex = primitive.attributes.POSITION;
      if (
        !Number.isSafeInteger(positionIndex)
        || (positionIndex as number) < 0
        || (positionIndex as number) >= accessorCounts.length
      ) {
        throw importError("parse-failed");
      }
      const vertexCount = accessorCounts[positionIndex as number] ?? 0;
      vertices = safeAddCount(vertices, vertexCount, "vertex-budget-exceeded");
      if (vertices > STUDIO_BG3D_IMPORT_MAX_VERTICES) throw importError("vertex-budget-exceeded");

      const mode = primitive.mode === undefined ? 4 : primitive.mode;
      if (!Number.isSafeInteger(mode) || (mode as number) < 0 || (mode as number) > 6) {
        throw importError("parse-failed");
      }
      let elementCount = vertexCount;
      if (primitive.indices !== undefined) {
        if (
          !Number.isSafeInteger(primitive.indices)
          || (primitive.indices as number) < 0
          || (primitive.indices as number) >= accessorCounts.length
        ) {
          throw importError("parse-failed");
        }
        elementCount = accessorCounts[primitive.indices as number] ?? 0;
      }
      const primitiveTriangles = mode === 4
        ? Math.floor(elementCount / 3)
        : mode === 5 || mode === 6
          ? Math.max(0, elementCount - 2)
          : 0;
      triangles = safeAddCount(triangles, primitiveTriangles, "triangle-budget-exceeded");
      if (triangles > STUDIO_BG3D_IMPORT_MAX_TRIANGLES) {
        throw importError("triangle-budget-exceeded");
      }
    }
  }

  let inlineBytes = 0;
  let declaredBufferBytes = 0;
  const buffers = optionalGltfArray(root, "buffers");
  if (buffers.length > STUDIO_BG3D_IMPORT_MAX_RESOURCE_RECORDS) {
    throw importError("geometry-memory-too-large");
  }
  for (let index = 0; index < buffers.length; index += 1) {
    throwIfAborted(signal);
    const entry = buffers[index];
    if (
      !isRecord(entry)
      || !Number.isSafeInteger(entry.byteLength)
      || (entry.byteLength as number) <= 0
      || typeof entry.uri !== "string"
      || !entry.uri
    ) {
      // JSON glTF has no GLB BIN chunk, so every declared buffer must resolve locally.
      throw importError("parse-failed");
    }
    const declaredBytes = entry.byteLength as number;
    declaredBufferBytes = safeAddCount(
      declaredBufferBytes,
      declaredBytes,
      "geometry-memory-too-large",
    );
    if (declaredBufferBytes > STUDIO_BG3D_IMPORT_MAX_DECODED_GEOMETRY_BYTES) {
      throw importError("geometry-memory-too-large");
    }
    if (entry.uri.startsWith("data:")) {
      const inline = parseInlineResourceUri(entry.uri, "buffer", signal);
      if (inline.decodedByteLength < declaredBytes) throw importError("parse-failed");
      inlineBytes = safeAddCount(inlineBytes, inline.decodedByteLength, "inline-resource-too-large");
      if (inlineBytes > STUDIO_BG3D_IMPORT_MAX_INLINE_TOTAL_BYTES) {
        throw importError("inline-resource-too-large");
      }
      resolver.approveInlineUri(entry.uri);
    } else {
      const file = resolver.fileForUri(entry.uri);
      if (file.size < declaredBytes) throw importError("parse-failed");
    }
  }

  let decodedImageBytes = companionDecodedImageBytes;
  const images = optionalGltfArray(root, "images");
  if (images.length > STUDIO_BG3D_IMPORT_MAX_RESOURCE_RECORDS) {
    throw importError("image-memory-too-large");
  }
  for (let index = 0; index < images.length; index += 1) {
    throwIfAborted(signal);
    const entry = images[index];
    if (!isRecord(entry)) throw importError("parse-failed");
    if (typeof entry.uri !== "string" || !entry.uri) {
      // Buffer-view images require slicing and decoding arbitrary binary packages before the
      // canonical GLB validator can inspect them. Keep JSON glTF fail-closed at this boundary.
      throw importError("unsupported-extension");
    }
    if (entry.uri.startsWith("data:")) {
      const inline = parseInlineResourceUri(entry.uri, "image", signal);
      inlineBytes = safeAddCount(inlineBytes, inline.decodedByteLength, "inline-resource-too-large");
      if (inlineBytes > STUDIO_BG3D_IMPORT_MAX_INLINE_TOTAL_BYTES) {
        throw importError("inline-resource-too-large");
      }
      const extension = inline.mimeType.slice("image/".length);
      const dimensions = importedImageDimensions(
        extension,
        decodeInlineResource(inline, signal),
      );
      if (!dimensions) throw importError("invalid-image");
      if (
        dimensions.width > STUDIO_BG3D_IMPORT_MAX_IMAGE_DIMENSION
        || dimensions.height > STUDIO_BG3D_IMPORT_MAX_IMAGE_DIMENSION
      ) {
        throw importError("image-dimension-too-large");
      }
      const imageBytes = safeMultiplyCount(
        safeMultiplyCount(dimensions.width, dimensions.height, "image-memory-too-large"),
        4,
        "image-memory-too-large",
      );
      decodedImageBytes = safeAddCount(decodedImageBytes, imageBytes, "image-memory-too-large");
      if (decodedImageBytes > STUDIO_BG3D_IMPORT_MAX_DECODED_IMAGE_BYTES) {
        throw importError("image-memory-too-large");
      }
      resolver.approveInlineUri(entry.uri);
    } else {
      resolver.fileForUri(entry.uri);
    }
  }
}

export interface StudioBg3dParsedExportCandidate {
  readonly root: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
}

type ParsedImport = StudioBg3dParsedExportCandidate;

async function parseGltfImport(
  item: StudioBg3dImportPlanItem,
  resolver: LocalResourceResolver,
  signal?: AbortSignal,
  companionDecodedImageBytes = 0,
): Promise<ParsedImport> {
  const source = item.format === "gltf"
    ? await readUtf8(item.primary, signal)
    : await readBytes(item.primary, signal);
  throwIfAborted(signal);
  if (typeof source === "string") {
    let root: unknown;
    try {
      root = JSON.parse(source) as unknown;
    } catch {
      throw importError("parse-failed");
    }
    preflightJsonGltf(root, resolver, signal, companionDecodedImageBytes);
  }
  const tracked = await createTrackedLoadingManager(resolver);
  throwIfAborted(signal);
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  throwIfAborted(signal);
  const loader = new GLTFLoader(tracked.manager);
  let parsedRoot: THREE.Object3D | null = null;
  try {
    const gltf = await new Promise<import("three/examples/jsm/loaders/GLTFLoader.js").GLTF>((resolve, reject) => {
      loader.parse(source, "", resolve, () => reject(importError("parse-failed")));
    });
    throwIfAborted(signal);
    if (!gltf.scene) throw importError("parse-failed");
    parsedRoot = gltf.scene;
    await tracked.waitForIdle(signal);
    throwIfAborted(signal);
    return { root: parsedRoot, animations: gltf.animations };
  } catch (error) {
    if (parsedRoot) disposeStudioBg3dThreeResources(parsedRoot);
    throw error;
  }
}

async function preflightObjBytesForImport(
  bytes: ArrayBuffer,
  executionBackend: StudioBg3dModelImportExecutionBackend,
  signal?: AbortSignal,
): Promise<StudioBg3dObjPreflightWorkerObjResult> {
  if (executionBackend === "worker") {
    try {
      return await preflightStudioBg3dObjBytesInWorker(bytes, { signal });
    } catch (error) {
      if (!(error instanceof StudioBg3dObjPreflightWorkerClientError)) throw error;
      throw mapObjPreflightFailure(error.code);
    }
  }
  if (bytes.byteLength > STUDIO_BG3D_IMPORT_DIRECT_MAX_BYTES) {
    throw importError("worker-required");
  }
  const {
    StudioBg3dObjPreflightWorkerRuntimeError,
    preflightStudioBg3dObjWorkerRequest,
  } = await import("./studio-bg3d-obj-preflight-worker-runtime");
  const directRequest: StudioBg3dObjPreflightWorkerObjRequest = {
    version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
    kind: "preflight-obj",
    requestId: 1,
    generationId: 1,
    sourceByteLength: bytes.byteLength,
    bytes,
    budgets: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS,
  };
  try {
    const result = preflightStudioBg3dObjWorkerRequest(directRequest);
    if (result.kind !== "obj") throw importError("parse-failed");
    throwIfAborted(signal);
    return result;
  } catch (error) {
    if (error instanceof StudioBg3dObjPreflightWorkerRuntimeError) {
      throw mapObjPreflightFailure(error.code);
    }
    throw error;
  }
}

async function preflightMtlBytesForImport(
  materialLibraries: readonly StudioBg3dObjPreflightWorkerMtlEntry[],
  executionBackend: StudioBg3dModelImportExecutionBackend,
  signal?: AbortSignal,
): Promise<StudioBg3dObjPreflightWorkerMtlResult> {
  if (executionBackend === "worker") {
    try {
      return await preflightStudioBg3dMtlBytesInWorker(materialLibraries, { signal });
    } catch (error) {
      if (!(error instanceof StudioBg3dObjPreflightWorkerClientError)) throw error;
      throw mapObjPreflightFailure(error.code);
    }
  }
  const directInputBytes = materialLibraries.reduce(
    (total, entry) => safeAddCount(
      total,
      entry.sourceByteLength,
      "material-budget-exceeded",
    ),
    0,
  );
  if (directInputBytes > STUDIO_BG3D_IMPORT_DIRECT_MAX_BYTES) {
    throw importError("worker-required");
  }
  const {
    StudioBg3dObjPreflightWorkerRuntimeError,
    preflightStudioBg3dObjWorkerRequest,
  } = await import("./studio-bg3d-obj-preflight-worker-runtime");
  const directRequest: StudioBg3dObjPreflightWorkerMtlRequest = {
    version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
    kind: "preflight-mtl",
    requestId: 1,
    generationId: 1,
    materialLibraries,
    budgets: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS,
  };
  try {
    const result = preflightStudioBg3dObjWorkerRequest(directRequest);
    if (result.kind !== "mtl") throw importError("parse-failed");
    throwIfAborted(signal);
    return result;
  } catch (error) {
    if (error instanceof StudioBg3dObjPreflightWorkerRuntimeError) {
      throw mapObjPreflightFailure(error.code);
    }
    throw error;
  }
}

async function parseObjImport(
  item: StudioBg3dImportPlanItem,
  resolver: LocalResourceResolver,
  executionBackend: StudioBg3dModelImportExecutionBackend,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  let bytes = await readBytes(item.primary, signal);
  const objPreflight = await preflightObjBytesForImport(bytes, executionBackend, signal);
  bytes = objPreflight.bytes;
  const materialLibraryReferences = objPreflight.materialLibraryReferences;
  const materialResources: Array<{
    readonly path: string;
    readonly file: StudioBg3dImportFile;
  }> = [];
  const seenMaterialPaths = new Set<string>();
  let totalMaterialBytes = 0;
  for (const reference of materialLibraryReferences) {
    let resources: readonly { readonly path: string; readonly file: StudioBg3dImportFile }[];
    try {
      resources = [resolver.resourceForPackageUri(item.primaryPath, reference)];
    } catch (error) {
      if (!(error instanceof StudioBg3dModelImportError) || error.code !== "missing-resource") {
        throw error;
      }
      const tokens = reference.split(/[\t ]+/u).filter(Boolean);
      if (tokens.length < 2) throw error;
      resources = tokens.map((token) => resolver.resourceForPackageUri(item.primaryPath, token));
    }
    for (const resource of resources) {
      if (extensionOf(resource.path) !== "mtl") throw importError("missing-resource");
      if (seenMaterialPaths.has(resource.path)) continue;
      seenMaterialPaths.add(resource.path);
      if (seenMaterialPaths.size > STUDIO_BG3D_IMPORT_MAX_OBJ_MATERIAL_LIBRARIES) {
        throw importError("material-budget-exceeded");
      }
      totalMaterialBytes = safeAddCount(
        totalMaterialBytes,
        resource.file.size,
        "material-budget-exceeded",
      );
      if (totalMaterialBytes > STUDIO_BG3D_IMPORT_MAX_OBJ_MTL_TOTAL_BYTES) {
        throw importError("material-budget-exceeded");
      }
      materialResources.push(resource);
    }
  }

  let materialLibraries: StudioBg3dObjWorkerMtlEntry[] = [];
  for (const resource of materialResources.sort((left, right) => compareUtf8(left.path, right.path))) {
    const materialBytes = await readBytes(resource.file, signal);
    materialLibraries.push({
      path: resource.path,
      sourceByteLength: materialBytes.byteLength,
      bytes: materialBytes,
    });
  }
  if (materialLibraries.length > 0) {
    const materialPreflight = await preflightMtlBytesForImport(
      materialLibraries,
      executionBackend,
      signal,
    );
    materialLibraries = materialPreflight.materialLibraries.map((entry) => ({
      path: entry.path,
      sourceByteLength: entry.sourceByteLength,
      bytes: entry.bytes,
    }));
  }

  const resourcePaths = resolver.canonicalResourcePaths();
  const directInputBytes = safeAddCount(
    bytes.byteLength,
    totalMaterialBytes,
    "material-budget-exceeded",
  );

  let result: StudioBg3dObjWorkerCanonicalResult;
  let root: THREE.Object3D | null = null;
  try {
    if (executionBackend === "worker") {
      try {
        result = await parseStudioBg3dObjInWorker({
          primaryPath: item.primaryPath,
          bytes,
          materialLibraries,
          resourcePaths,
        }, { signal });
      } catch (error) {
        if (!(error instanceof StudioBg3dObjWorkerClientError)) throw error;
        throw mapObjWorkerFailure(error.code);
      }
    } else {
      if (directInputBytes > STUDIO_BG3D_IMPORT_DIRECT_MAX_BYTES) {
        throw importError("worker-required");
      }
      const directRequest: StudioBg3dObjWorkerParseRequest = {
        version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
        kind: "parse",
        requestId: 1,
        generationId: 1,
        primaryPath: item.primaryPath,
        sourceByteLength: bytes.byteLength,
        bytes: bytes.slice(0),
        materialLibraries: materialLibraries.map((entry) => ({
          path: entry.path,
          sourceByteLength: entry.sourceByteLength,
          bytes: entry.bytes.slice(0),
        })),
        resourcePaths,
        budgets: STUDIO_BG3D_OBJ_WORKER_BUDGETS,
      };
      const {
        StudioBg3dObjWorkerRuntimeError,
        parseStudioBg3dObjWorkerRequest,
      } = await import("./studio-bg3d-obj-worker-runtime");
      let directResult: StudioBg3dObjWorkerCanonicalResult;
      try {
        directResult = await parseStudioBg3dObjWorkerRequest(directRequest);
      } catch (error) {
        if (error instanceof StudioBg3dObjWorkerRuntimeError) {
          throw mapObjWorkerFailure(error.code);
        }
        throw error;
      }
      const response = {
        version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
        kind: "result" as const,
        requestId: directRequest.requestId,
        generationId: directRequest.generationId,
        result: directResult,
      };
      if (!isStudioBg3dObjWorkerResponseForRequest(response, directRequest)) {
        throw importError("parse-failed");
      }
      result = response.result;
    }
    throwIfAborted(signal);
    for (const path of result.usedResourcePaths) resolver.fileForCanonicalPath(path);
    const tracked = await createTrackedLoadingManager(resolver);
    root = await hydrateStudioBg3dObjWorkerResult(result, {
      loadingManager: tracked.manager,
      signal,
      textureUrlForPath: (path) => resolver.urlForCanonicalPath(path),
    });
    await tracked.waitForIdle(signal);
    throwIfAborted(signal);
    return { root, animations: [] };
  } catch (error) {
    if (root) disposeStudioBg3dThreeResources(root);
    if (signal?.aborted) throw importError("aborted");
    throw error;
  }
}

function mapObjWorkerFailure(
  code: StudioBg3dObjWorkerFailureCode | StudioBg3dObjWorkerClientError["code"],
): StudioBg3dModelImportError {
  if (code === "aborted") return importError("aborted");
  if (
    code === "geometry-memory-too-large"
    || code === "material-budget-exceeded"
    || code === "mesh-budget-exceeded"
    || code === "missing-resource"
    || code === "node-budget-exceeded"
    || code === "triangle-budget-exceeded"
    || code === "unsafe-resource-uri"
    || code === "vertex-budget-exceeded"
  ) return importError(code);
  if (code === "parse-failed" || code === "protocol") return importError("parse-failed");
  return importError("worker-required");
}

function mapObjPreflightFailure(
  code:
    | StudioBg3dObjPreflightWorkerFailureCode
    | StudioBg3dObjPreflightWorkerClientError["code"],
): StudioBg3dModelImportError {
  if (code === "aborted") return importError("aborted");
  if (code === "invalid-text") return importError("invalid-text");
  if (
    code === "material-budget-exceeded"
    || code === "mesh-budget-exceeded"
    || code === "node-budget-exceeded"
    || code === "triangle-budget-exceeded"
    || code === "unsafe-resource-uri"
    || code === "vertex-budget-exceeded"
  ) return importError(code);
  if (code === "parse-failed" || code === "protocol") return importError("parse-failed");
  return importError("worker-required");
}

async function parseFbxImport(
  item: StudioBg3dImportPlanItem,
  resolver: LocalResourceResolver,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  const bytes = await readBytes(item.primary, signal);
  const tracked = await createTrackedLoadingManager(resolver);
  throwIfAborted(signal);
  const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
  throwIfAborted(signal);
  let root: THREE.Group | null = null;
  try {
    root = new FBXLoader(tracked.manager).parse(bytes, "");
    throwIfAborted(signal);
    await tracked.waitForIdle(signal);
    throwIfAborted(signal);
    return { root, animations: root.animations };
  } catch (error) {
    if (root) disposeStudioBg3dThreeResources(root);
    throw error;
  }
}

async function parseDaeImport(
  item: StudioBg3dImportPlanItem,
  resolver: LocalResourceResolver,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  const text = await readUtf8(item.primary, signal);
  const tracked = await createTrackedLoadingManager(resolver);
  throwIfAborted(signal);
  const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
  throwIfAborted(signal);
  let root: THREE.Object3D | null = null;
  try {
    const collada = new ColladaLoader(tracked.manager).parse(text, "");
    throwIfAborted(signal);
    const scene = collada?.scene;
    if (!scene) throw importError("parse-failed");
    root = scene;
    await tracked.waitForIdle(signal);
    throwIfAborted(signal);
    return { root, animations: scene.animations };
  } catch (error) {
    if (root) disposeStudioBg3dThreeResources(root);
    throw error;
  }
}

async function parseStlOnMainThread(
  item: StudioBg3dImportPlanItem,
  bytes: ArrayBuffer,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  const [{ Mesh, MeshStandardMaterial }, { STLLoader }] = await Promise.all([
    import("three"),
    import("three/examples/jsm/loaders/STLLoader.js"),
  ]);
  throwIfAborted(signal);
  let geometry: THREE.BufferGeometry;
  try {
    geometry = new STLLoader().parse(bytes);
  } catch {
    throw importError("parse-failed");
  }
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  if (signal?.aborted) {
    geometry.dispose();
    throw importError("aborted");
  }
  const root = new Mesh(geometry, new MeshStandardMaterial({ color: 0xb8b8c2 }));
  root.name = modelBaseName(item.primaryPath);
  return { root, animations: [] };
}

async function parsePlyOnMainThread(
  item: StudioBg3dImportPlanItem,
  bytes: ArrayBuffer,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  const [{ Mesh, MeshStandardMaterial, Points, PointsMaterial }, { PLYLoader }] = await Promise.all([
    import("three"),
    import("three/examples/jsm/loaders/PLYLoader.js"),
  ]);
  throwIfAborted(signal);
  let geometry: THREE.BufferGeometry;
  try {
    geometry = new PLYLoader().parse(bytes);
  } catch {
    throw importError("parse-failed");
  }
  if (signal?.aborted) {
    geometry.dispose();
    throw importError("aborted");
  }
  const hasVertexColors = Boolean(geometry.getAttribute("color"));
  const hasMeshTopology = Boolean(geometry.index || geometry.getAttribute("normal"));
  if (hasMeshTopology) {
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const root = new Mesh(geometry, new MeshStandardMaterial({
      color: 0xb8b8c2,
      vertexColors: hasVertexColors,
    }));
    root.name = modelBaseName(item.primaryPath);
    return { root, animations: [] };
  }
  const root = new Points(geometry, new PointsMaterial({
    color: 0xb8b8c2,
    size: 0.01,
    sizeAttenuation: true,
    vertexColors: hasVertexColors,
  }));
  root.name = modelBaseName(item.primaryPath);
  return { root, animations: [] };
}

function mapGeometryWorkerFailure(error: StudioBg3dGeometryWorkerClientError): StudioBg3dModelImportError {
  if (error.code === "aborted") return importError("aborted");
  if (
    error.code === "geometry-memory-too-large"
    || error.code === "triangle-budget-exceeded"
    || error.code === "vertex-budget-exceeded"
  ) return importError(error.code);
  if (error.code === "parse-failed" || error.code === "protocol") return importError("parse-failed");
  return importError("worker-required");
}

async function parsedImportFromCanonicalGeometry(
  item: StudioBg3dImportPlanItem,
  payload: StudioBg3dCanonicalGeometryPayload,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  if (
    !isStudioBg3dCanonicalGeometryPayload(payload, item.format === "stl" ? "stl" : "ply")
    || !hasValidStudioBg3dCanonicalGeometryNumbers(payload)
  ) throw importError("parse-failed");
  throwIfAborted(signal);
  const {
    BufferAttribute,
    BufferGeometry,
    Mesh,
    MeshStandardMaterial,
    Points,
    PointsMaterial,
  } = await import("three");
  throwIfAborted(signal);
  const geometry = new BufferGeometry();
  try {
    for (const attribute of payload.attributes) {
      geometry.setAttribute(
        attribute.name,
        new BufferAttribute(new Float32Array(attribute.buffer), attribute.itemSize, false),
      );
    }
    if (payload.index) {
      geometry.setIndex(new BufferAttribute(new Uint32Array(payload.index.buffer), 1, false));
    }
    const hasVertexColors = payload.attributes.some((attribute) => attribute.name === "color");
    if (payload.kind === "mesh") {
      const root = new Mesh(geometry, new MeshStandardMaterial({
        color: 0xb8b8c2,
        vertexColors: hasVertexColors,
      }));
      root.name = modelBaseName(item.primaryPath);
      return { root, animations: [] };
    }
    const root = new Points(geometry, new PointsMaterial({
      color: 0xb8b8c2,
      size: 0.01,
      sizeAttenuation: true,
      vertexColors: hasVertexColors,
    }));
    root.name = modelBaseName(item.primaryPath);
    return { root, animations: [] };
  } catch (error) {
    geometry.dispose();
    throw error;
  }
}

async function parseGeometryImport(
  item: StudioBg3dImportPlanItem & { readonly format: "ply" | "stl" },
  executionBackend: StudioBg3dModelImportExecutionBackend,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  const bytes = await readBytes(item.primary, signal);
  if (executionBackend === "direct") {
    if (bytes.byteLength > STUDIO_BG3D_IMPORT_DIRECT_MAX_BYTES) {
      throw importError("worker-required");
    }
    return item.format === "stl"
      ? parseStlOnMainThread(item, bytes, signal)
      : parsePlyOnMainThread(item, bytes, signal);
  }
  try {
    const payload = await parseStudioBg3dGeometryInWorker(item.format, bytes, { signal });
    throwIfAborted(signal);
    return parsedImportFromCanonicalGeometry(item, payload, signal);
  } catch (error) {
    if (!(error instanceof StudioBg3dGeometryWorkerClientError)) throw error;
    throw mapGeometryWorkerFailure(error);
  }
}

async function parseStlImport(
  item: StudioBg3dImportPlanItem,
  executionBackend: StudioBg3dModelImportExecutionBackend,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  return parseGeometryImport(
    item as StudioBg3dImportPlanItem & { readonly format: "stl" },
    executionBackend,
    signal,
  );
}

async function parsePlyImport(
  item: StudioBg3dImportPlanItem,
  executionBackend: StudioBg3dModelImportExecutionBackend,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  return parseGeometryImport(
    item as StudioBg3dImportPlanItem & { readonly format: "ply" },
    executionBackend,
    signal,
  );
}

async function parse3dsImport(
  item: StudioBg3dImportPlanItem,
  resolver: LocalResourceResolver,
  signal?: AbortSignal,
): Promise<ParsedImport> {
  const bytes = await readBytes(item.primary, signal);
  const tracked = await createTrackedLoadingManager(resolver);
  throwIfAborted(signal);
  const { TDSLoader } = await import("three/examples/jsm/loaders/TDSLoader.js");
  throwIfAborted(signal);
  let root: THREE.Group | null = null;
  try {
    root = new TDSLoader(tracked.manager).parse(bytes, "");
    throwIfAborted(signal);
    await tracked.waitForIdle(signal);
    throwIfAborted(signal);
    return { root, animations: root.animations };
  } catch (error) {
    if (root) disposeStudioBg3dThreeResources(root);
    throw error;
  }
}

async function parsePlanItem(
  item: StudioBg3dImportPlanItem,
  resolver: LocalResourceResolver,
  executionBackend: StudioBg3dModelImportExecutionBackend,
  signal?: AbortSignal,
  companionDecodedImageBytes = 0,
): Promise<ParsedImport> {
  switch (item.format) {
    case "gltf":
      return parseGltfImport(item, resolver, signal, companionDecodedImageBytes);
    case "obj":
      return parseObjImport(item, resolver, executionBackend, signal);
    case "fbx":
      return parseFbxImport(item, resolver, signal);
    case "dae":
      return parseDaeImport(item, resolver, signal);
    case "stl":
      return parseStlImport(item, executionBackend, signal);
    case "ply":
      return parsePlyImport(item, executionBackend, signal);
    case "3ds":
      return parse3dsImport(item, resolver, signal);
    case "glb":
      throw importError("parse-failed");
  }
}

function assertParsedImportBudgets(
  root: THREE.Object3D,
  signal?: AbortSignal,
  budget?: StudioBg3dGlbValidationBudget,
): void {
  const stack: THREE.Object3D[] = [root];
  const visited = new Set<THREE.Object3D>();
  const geometryBuffers = new Set<ArrayBufferLike>();
  const accessorAttributes = new Set<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>();
  let nodes = 0;
  let meshes = 0;
  let drawCalls = 0;
  let vertices = 0;
  let triangles = 0;
  let accessorElements = 0;
  let geometryBytes = 0;
  const nodeLimit = profileLimit(
    STUDIO_BG3D_IMPORT_MAX_NODES,
    budget?.complexity.maxNodes,
  );
  const drawCallLimit = profileLimit(
    STUDIO_BG3D_IMPORT_MAX_MESH_PRIMITIVES,
    budget?.complexity.maxDrawCalls,
  );
  const triangleLimit = profileLimit(
    STUDIO_BG3D_IMPORT_MAX_TRIANGLES,
    budget?.complexity.maxTriangles,
  );
  const accessorElementLimit = profileLimit(
    STUDIO_BG3D_IMPORT_MAX_ACCESSOR_ELEMENTS,
    budget?.complexity.maxAccessorElements,
  );
  const decodedGeometryByteLimit = profileLimit(
    STUDIO_BG3D_IMPORT_MAX_DECODED_GEOMETRY_BYTES,
    budget?.complexity.maxDecodedGeometryBytes,
  );

  const countAttribute = (
    attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  ): void => {
    if (!accessorAttributes.has(attribute)) {
      accessorAttributes.add(attribute);
      if (!Number.isSafeInteger(attribute.count) || attribute.count < 0) {
        throw importError("parse-failed");
      }
      accessorElements = safeAddCount(
        accessorElements,
        attribute.count,
        "geometry-memory-too-large",
      );
      if (accessorElements > accessorElementLimit) {
        throw importError("geometry-memory-too-large");
      }
    }
    const interleaved = attribute as THREE.InterleavedBufferAttribute;
    const array = interleaved.isInterleavedBufferAttribute === true
      ? interleaved.data.array
      : (attribute as THREE.BufferAttribute).array;
    if (!ArrayBuffer.isView(array) || geometryBuffers.has(array.buffer)) return;
    geometryBuffers.add(array.buffer);
    geometryBytes = safeAddCount(
      geometryBytes,
      array.buffer.byteLength,
      "geometry-memory-too-large",
    );
    if (geometryBytes > decodedGeometryByteLimit) {
      throw importError("geometry-memory-too-large");
    }
  };

  while (stack.length > 0) {
    if ((nodes & 0xff) === 0) throwIfAborted(signal);
    const object = stack.pop();
    if (!object || visited.has(object)) throw importError("parse-failed");
    visited.add(object);
    nodes = safeAddCount(nodes, 1, "node-budget-exceeded");
    if (nodes > nodeLimit) throw importError("node-budget-exceeded");
    for (const child of object.children) stack.push(child);

    const renderable = object as THREE.Object3D & {
      readonly count?: number;
      readonly geometry?: THREE.BufferGeometry;
      readonly isInstancedMesh?: boolean;
      readonly isLine?: boolean;
      readonly isMesh?: boolean;
      readonly isPoints?: boolean;
    };
    if (!renderable.isMesh && !renderable.isLine && !renderable.isPoints) continue;
    meshes = safeAddCount(meshes, 1, "mesh-budget-exceeded");
    if (meshes > STUDIO_BG3D_IMPORT_MAX_MESHES) throw importError("mesh-budget-exceeded");
    const geometry = renderable.geometry;
    if (!geometry?.isBufferGeometry) throw importError("parse-failed");
    const primitiveCount = Math.max(1, geometry.groups.length);
    drawCalls = safeAddCount(drawCalls, primitiveCount, "mesh-budget-exceeded");
    if (drawCalls > drawCallLimit) throw importError("mesh-budget-exceeded");
    const position = geometry.getAttribute("position");
    if (!position || !Number.isSafeInteger(position.count) || position.count < 0) {
      throw importError("parse-failed");
    }
    const instances = renderable.isInstancedMesh ? renderable.count : 1;
    if (!Number.isSafeInteger(instances) || (instances ?? -1) < 0) throw importError("parse-failed");
    const effectiveInstances = instances ?? 1;
    const effectiveVertices = safeMultiplyCount(
      position.count,
      effectiveInstances,
      "vertex-budget-exceeded",
    );
    vertices = safeAddCount(vertices, effectiveVertices, "vertex-budget-exceeded");
    if (vertices > STUDIO_BG3D_IMPORT_MAX_VERTICES) throw importError("vertex-budget-exceeded");

    if (renderable.isMesh) {
      const elements = geometry.index?.count ?? position.count;
      if (!Number.isSafeInteger(elements) || elements < 0) throw importError("parse-failed");
      const effectiveTriangles = safeMultiplyCount(
        Math.floor(elements / 3),
        effectiveInstances,
        "triangle-budget-exceeded",
      );
      triangles = safeAddCount(triangles, effectiveTriangles, "triangle-budget-exceeded");
      if (triangles > triangleLimit) {
        throw importError("triangle-budget-exceeded");
      }
    }

    if (geometry.index) countAttribute(geometry.index);
    for (const attribute of Object.values(geometry.attributes)) countAttribute(attribute);
    for (const attributes of Object.values(geometry.morphAttributes)) {
      for (const attribute of attributes) countAttribute(attribute);
    }
  }
}

function assertParsedMaterialBudgets(
  root: THREE.Object3D,
  signal?: AbortSignal,
  budget?: StudioBg3dGlbValidationBudget,
): void {
  const stack: THREE.Object3D[] = [root];
  const visited = new Set<THREE.Object3D>();
  const materials = new Set<THREE.Material>();
  let materialSlots = 0;
  const materialLimit = profileLimit(
    STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIALS,
    budget?.complexity.maxMaterials,
  );

  while (stack.length > 0) {
    if ((visited.size & 0xff) === 0) throwIfAborted(signal);
    const object = stack.pop();
    if (!object || visited.has(object)) throw importError("parse-failed");
    visited.add(object);
    for (const child of object.children) stack.push(child);

    const material = (object as THREE.Object3D & {
      readonly material?: THREE.Material | readonly THREE.Material[];
    }).material;
    if (!material) continue;
    const slots = Array.isArray(material) ? material : [material];
    materialSlots = safeAddCount(
      materialSlots,
      slots.length,
      "material-budget-exceeded",
    );
    if (materialSlots > STUDIO_BG3D_IMPORT_MAX_EXPORT_MATERIAL_SLOTS) {
      throw importError("material-budget-exceeded");
    }
    for (const candidate of slots) {
      if (!candidate || typeof candidate !== "object") throw importError("parse-failed");
      materials.add(candidate);
      if (materials.size > materialLimit) {
        throw importError("material-budget-exceeded");
      }
    }
  }
}

type StudioAnimationNumberArray = ArrayLike<number> & ArrayBufferView;

function animationNumberArray(value: unknown): ArrayLike<number> | null {
  if (Array.isArray(value)) return value;
  if (!ArrayBuffer.isView(value) || value instanceof DataView) return null;
  const length = (value as { readonly length?: unknown }).length;
  return Number.isSafeInteger(length) && (length as number) >= 0
    ? value as StudioAnimationNumberArray
    : null;
}

function countAnimationArrayBytes(
  values: ArrayLike<number>,
  countedBuffers: Set<ArrayBufferLike>,
): number {
  if (ArrayBuffer.isView(values)) {
    if (countedBuffers.has(values.buffer)) return 0;
    countedBuffers.add(values.buffer);
    return values.buffer.byteLength;
  }
  return safeMultiplyCount(values.length, 8, "animation-budget-exceeded");
}

function assertAnimationNumberArray(
  values: ArrayLike<number>,
  signal: AbortSignal | undefined,
  options: { nondecreasing?: boolean } = {},
): void {
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    const value = values[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw importError("animation-budget-exceeded");
    }
    if (options.nondecreasing && value < previous) {
      throw importError("animation-budget-exceeded");
    }
    previous = value;
  }
}

function assertParsedAnimationBudgets(
  animations: readonly THREE.AnimationClip[],
  signal?: AbortSignal,
  budget?: StudioBg3dGlbValidationBudget,
): void {
  const animationClipLimit = profileLimit(
    STUDIO_BG3D_IMPORT_MAX_ANIMATION_CLIPS,
    budget?.complexity.maxAnimations,
  );
  const animationTrackLimit = profileLimit(
    STUDIO_BG3D_IMPORT_MAX_ANIMATION_TRACKS,
    budget?.complexity.maxAnimationChannels,
  );
  const animationKeyframeLimit = profileLimit(
    STUDIO_BG3D_IMPORT_MAX_ANIMATION_KEYFRAMES,
    budget?.complexity.maxAnimationKeyframes,
  );
  if (
    !Array.isArray(animations)
    || animations.length > animationClipLimit
  ) {
    throw importError("animation-budget-exceeded");
  }
  const countedBuffers = new Set<ArrayBufferLike>();
  let tracks = 0;
  let keyframes = 0;
  let animationValues = 0;
  let decodedBytes = 0;

  for (const clip of animations) {
    throwIfAborted(signal);
    if (
      !clip
      || typeof clip !== "object"
      || typeof clip.name !== "string"
      || clip.name.length > 256
      || !Number.isFinite(clip.duration)
      || clip.duration < 0
      || clip.duration > STUDIO_BG3D_IMPORT_MAX_ANIMATION_DURATION_SECONDS
      || !Array.isArray(clip.tracks)
    ) {
      throw importError("animation-budget-exceeded");
    }
    tracks = safeAddCount(tracks, clip.tracks.length, "animation-budget-exceeded");
    if (tracks > animationTrackLimit) {
      throw importError("animation-budget-exceeded");
    }

    for (const track of clip.tracks) {
      if (!track || typeof track.name !== "string" || track.name.length > 512) {
        throw importError("animation-budget-exceeded");
      }
      const times = animationNumberArray(track.times);
      const values = animationNumberArray(track.values);
      if (!times || !values || (times.length === 0 ? values.length !== 0 : values.length % times.length !== 0)) {
        throw importError("animation-budget-exceeded");
      }
      keyframes = safeAddCount(keyframes, times.length, "animation-budget-exceeded");
      if (keyframes > animationKeyframeLimit) {
        throw importError("animation-budget-exceeded");
      }
      animationValues = safeAddCount(
        animationValues,
        values.length,
        "animation-budget-exceeded",
      );
      if (
        budget
        && animationValues > budget.complexity.maxAnimationValues
      ) {
        throw importError("animation-budget-exceeded");
      }
      decodedBytes = safeAddCount(
        decodedBytes,
        countAnimationArrayBytes(times, countedBuffers),
        "animation-budget-exceeded",
      );
      decodedBytes = safeAddCount(
        decodedBytes,
        countAnimationArrayBytes(values, countedBuffers),
        "animation-budget-exceeded",
      );
      if (decodedBytes > STUDIO_BG3D_IMPORT_MAX_ANIMATION_BYTES) {
        throw importError("animation-budget-exceeded");
      }
      assertAnimationNumberArray(times, signal, { nondecreasing: true });
      assertAnimationNumberArray(values, signal);
    }
  }
}

const STUDIO_BG3D_PRE_EXPORT_BASE_MODEL_BYTES = 4_096;
const STUDIO_BG3D_PRE_EXPORT_RESOURCE_ENVELOPE_NUMERATOR = 5;
const STUDIO_BG3D_PRE_EXPORT_RESOURCE_ENVELOPE_DENOMINATOR = 4;
const STUDIO_BG3D_PRE_EXPORT_MAX_METADATA_DEPTH = 32;
const STUDIO_BG3D_PRE_EXPORT_MAX_METADATA_ENTRIES = 65_536;
const STUDIO_BG3D_PRE_EXPORT_TEXTURE_SLOTS = [
  "anisotropyMap",
  "aoMap",
  "bumpMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "emissiveMap",
  "iridescenceMap",
  "iridescenceThicknessMap",
  "map",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "thicknessMap",
  "transmissionMap",
] as const;

interface StudioBg3dPreExportJsonMeasurement {
  readonly bytes: number;
  readonly entries: number;
}

interface StudioBg3dPreExportSupplementalMetrics {
  readonly joints: number;
  readonly maxTextureDimension: number;
  readonly morphTargets: number;
  readonly serializedMetadataBytes: number;
  readonly skins: number;
  readonly textureBytes: number;
}

function ownPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw importError("parse-failed");
  }
}

function ownDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = ownPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw importError("parse-failed");
  return descriptor.value;
}

function enumerableOwnKeys(value: object): readonly string[] {
  try {
    return Object.keys(value);
  } catch {
    throw importError("parse-failed");
  }
}

function plainJsonPrototype(value: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function jsonStringByteLength(
  value: string,
  signal: AbortSignal | undefined,
  maximumBytes: number,
): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    if ((index & 0x3fff) === 0) throwIfAborted(signal);
    const codeUnit = value.charCodeAt(index);
    let encodedBytes: number;
    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      encodedBytes = 2;
    } else if (codeUnit <= 0x1f) {
      encodedBytes = 6;
    } else if (codeUnit <= 0x7f) {
      encodedBytes = 1;
    } else if (codeUnit <= 0x7ff) {
      encodedBytes = 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (following >= 0xdc00 && following <= 0xdfff) {
        encodedBytes = 4;
        index += 1;
      } else {
        encodedBytes = 6;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      encodedBytes = 6;
    } else {
      encodedBytes = 3;
    }
    bytes = safeAddCount(bytes, encodedBytes, "model-byte-budget-exceeded");
    if (bytes > maximumBytes) throw importError("model-byte-budget-exceeded");
  }
  return bytes;
}

function measureStudioBg3dSerializableJson(
  root: unknown,
  signal: AbortSignal | undefined,
  maximumBytes: number,
): StudioBg3dPreExportJsonMeasurement {
  type Frame =
    | { readonly kind: "enter"; readonly depth: number; readonly value: unknown }
    | { readonly kind: "exit"; readonly value: object };
  const frames: Frame[] = [{ kind: "enter", depth: 0, value: root }];
  const active = new WeakSet<object>();
  let bytes = 0;
  let entries = 0;
  const addBytes = (amount: number): void => {
    bytes = safeAddCount(bytes, amount, "model-byte-budget-exceeded");
    if (bytes > maximumBytes) throw importError("model-byte-budget-exceeded");
  };
  const addEntries = (amount: number): void => {
    entries = safeAddCount(entries, amount, "parse-failed");
    if (entries > STUDIO_BG3D_PRE_EXPORT_MAX_METADATA_ENTRIES) {
      throw importError("parse-failed");
    }
  };

  while (frames.length > 0) {
    if ((entries & 0xff) === 0) throwIfAborted(signal);
    const frame = frames.pop();
    if (!frame) break;
    if (frame.kind === "exit") {
      active.delete(frame.value);
      continue;
    }
    const { depth, value } = frame;
    if (value === null) {
      addBytes(4);
      continue;
    }
    switch (typeof value) {
      case "boolean":
        addBytes(value ? 4 : 5);
        continue;
      case "number":
        if (!Number.isFinite(value)) throw importError("parse-failed");
        // Covers every finite decimal representation plus a conservative delimiter allowance.
        addBytes(32);
        continue;
      case "string":
        addBytes(jsonStringByteLength(value, signal, maximumBytes - bytes));
        continue;
      case "object":
        break;
      default:
        throw importError("parse-failed");
    }
    if (depth > STUDIO_BG3D_PRE_EXPORT_MAX_METADATA_DEPTH || active.has(value)) {
      throw importError("parse-failed");
    }
    active.add(value);
    frames.push({ kind: "exit", value });

    if (Array.isArray(value)) {
      const rawLength = ownDataProperty(value, "length");
      if (
        !Number.isSafeInteger(rawLength)
        || (rawLength as number) < 0
        || (rawLength as number) > STUDIO_BG3D_PRE_EXPORT_MAX_METADATA_ENTRIES
      ) {
        throw importError("parse-failed");
      }
      const length = rawLength as number;
      addEntries(length);
      addBytes(safeAddCount(2, Math.max(0, length - 1), "model-byte-budget-exceeded"));
      for (let index = length - 1; index >= 0; index -= 1) {
        const descriptor = ownPropertyDescriptor(value, String(index));
        if (descriptor && !("value" in descriptor)) throw importError("parse-failed");
        frames.push({
          kind: "enter",
          depth: depth + 1,
          value: descriptor ? descriptor.value : null,
        });
      }
      continue;
    }

    if (!plainJsonPrototype(value)) throw importError("parse-failed");
    const keys = enumerableOwnKeys(value);
    addEntries(keys.length);
    addBytes(safeAddCount(2, Math.max(0, keys.length - 1), "model-byte-budget-exceeded"));
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const descriptor = ownPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw importError("parse-failed");
      addBytes(jsonStringByteLength(key, signal, maximumBytes - bytes));
      addBytes(1);
      frames.push({ kind: "enter", depth: depth + 1, value: descriptor.value });
    }
  }
  return Object.freeze({ bytes, entries });
}

function measureStudioBg3dOwnerMetadata(
  owner: object,
  signal: AbortSignal | undefined,
  maximumBytes: number,
  includeName: boolean,
): StudioBg3dPreExportJsonMeasurement {
  let bytes = 0;
  let entries = 0;
  if (includeName) {
    const name = ownDataProperty(owner, "name");
    if (name !== undefined) {
      if (typeof name !== "string") throw importError("parse-failed");
      if (name.length > 0) {
        bytes = safeAddCount(
          16,
          jsonStringByteLength(name, signal, maximumBytes),
          "model-byte-budget-exceeded",
        );
        entries = 1;
      }
    }
  }
  const userData = ownDataProperty(owner, "userData");
  if (userData === undefined) return Object.freeze({ bytes, entries });
  if (!userData || typeof userData !== "object" || Array.isArray(userData)) {
    throw importError("parse-failed");
  }
  const keys = enumerableOwnKeys(userData);
  if (keys.length === 0) return Object.freeze({ bytes, entries });
  const remainingBytes = maximumBytes - bytes;
  if (remainingBytes < 0) throw importError("model-byte-budget-exceeded");
  const measured = measureStudioBg3dSerializableJson(userData, signal, remainingBytes);
  return Object.freeze({
    bytes: safeAddCount(
      safeAddCount(bytes, measured.bytes, "model-byte-budget-exceeded"),
      16,
      "model-byte-budget-exceeded",
    ),
    entries: safeAddCount(entries, measured.entries, "parse-failed"),
  });
}

function inheritedDataProperty(value: object, key: PropertyKey): unknown {
  let current: object | null = value;
  for (let depth = 0; current && depth <= 16; depth += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, key);
      current = Object.getPrototypeOf(current) as object | null;
    } catch {
      throw importError("parse-failed");
    }
    if (!descriptor) continue;
    if (!("value" in descriptor)) throw importError("parse-failed");
    return descriptor.value;
  }
  return undefined;
}

function isStudioBg3dTexture(value: unknown): value is THREE.Texture {
  return Boolean(
    value
    && typeof value === "object"
    && inheritedDataProperty(value, "isTexture") === true
  );
}

function preExportImageDimension(
  value: unknown,
  keys: readonly string[],
): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  let largest = 0;
  for (const key of keys) {
    const candidate = record[key];
    if (Number.isSafeInteger(candidate) && (candidate as number) > largest) {
      largest = candidate as number;
    }
  }
  return largest > 0 ? largest : null;
}

function preExportBufferByteLength(value: unknown): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

function measureStudioBg3dExportImageSource(
  value: unknown,
): { readonly decodedBytes: number; readonly maxDimension: number } {
  if (!value || typeof value !== "object") throw importError("parse-failed");
  const width = preExportImageDimension(value, ["width", "naturalWidth", "videoWidth"]);
  const height = preExportImageDimension(value, ["height", "naturalHeight", "videoHeight"]);
  if (width === null || height === null) throw importError("parse-failed");
  const record = value as Record<string, unknown>;
  const rawDepth = record.depth;
  const depth = rawDepth === undefined ? 1 : rawDepth;
  if (!Number.isSafeInteger(depth) || (depth as number) < 1) throw importError("parse-failed");
  const baseTexels = safeMultiplyCount(
    safeMultiplyCount(width, height, "texture-byte-budget-exceeded"),
    depth as number,
    "texture-byte-budget-exceeded",
  );
  const baseBytes = Math.max(
    safeMultiplyCount(baseTexels, 4, "texture-byte-budget-exceeded"),
    preExportBufferByteLength(record.data),
  );
  return Object.freeze({
    decodedBytes: baseBytes,
    maxDimension: Math.max(width, height),
  });
}

function measureStudioBg3dExportTexture(
  texture: THREE.Texture,
): { readonly decodedBytes: number; readonly maxDimension: number } {
  const source = ownDataProperty(texture, "source");
  const sourceData = source && typeof source === "object"
    ? ownDataProperty(source, "data")
    : ownDataProperty(texture, "image");
  const sources = Array.isArray(sourceData) ? sourceData : [sourceData];
  if (sources.length === 0 || sources.some((candidate) => candidate === undefined || candidate === null)) {
    throw importError("parse-failed");
  }
  let decodedBytes = 0;
  let maxTextureDimension = 0;
  for (const candidate of sources) {
    const measured = measureStudioBg3dExportImageSource(candidate);
    decodedBytes = safeAddCount(
      decodedBytes,
      measured.decodedBytes,
      "texture-byte-budget-exceeded",
    );
    maxTextureDimension = Math.max(maxTextureDimension, measured.maxDimension);
  }
  return Object.freeze({ decodedBytes, maxDimension: maxTextureDimension });
}

function measureStudioBg3dPreExportSupplementalMetrics(
  parsed: StudioBg3dParsedExportCandidate,
  signal: AbortSignal | undefined,
  maximumMetadataBytes: number,
): StudioBg3dPreExportSupplementalMetrics {
  const stack: THREE.Object3D[] = [parsed.root];
  const visited = new Set<THREE.Object3D>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let joints = 0;
  let morphTargets = 0;
  let serializedMetadataBytes = 0;
  let serializedMetadataEntries = 0;
  let skins = 0;
  const addMetadata = (
    measurement: StudioBg3dPreExportJsonMeasurement,
    multiplier = 1,
  ): void => {
    serializedMetadataBytes = safeAddCount(
      serializedMetadataBytes,
      safeMultiplyCount(
        measurement.bytes,
        multiplier,
        "model-byte-budget-exceeded",
      ),
      "model-byte-budget-exceeded",
    );
    if (serializedMetadataBytes > maximumMetadataBytes) {
      throw importError("model-byte-budget-exceeded");
    }
    serializedMetadataEntries = safeAddCount(
      serializedMetadataEntries,
      safeMultiplyCount(measurement.entries, multiplier, "parse-failed"),
      "parse-failed",
    );
    if (serializedMetadataEntries > STUDIO_BG3D_PRE_EXPORT_MAX_METADATA_ENTRIES) {
      throw importError("parse-failed");
    }
  };

  while (stack.length > 0) {
    if ((visited.size & 0xff) === 0) throwIfAborted(signal);
    const object = stack.pop();
    if (!object || visited.has(object)) throw importError("parse-failed");
    visited.add(object);
    for (const child of object.children) stack.push(child);
    addMetadata(measureStudioBg3dOwnerMetadata(
      object,
      signal,
      maximumMetadataBytes - serializedMetadataBytes,
      true,
    ));

    const renderable = object as THREE.Object3D & {
      readonly geometry?: THREE.BufferGeometry;
      readonly isLine?: boolean;
      readonly isMesh?: boolean;
      readonly isPoints?: boolean;
      readonly isSkinnedMesh?: boolean;
      readonly material?: THREE.Material | readonly THREE.Material[];
      readonly morphTargetDictionary?: Readonly<Record<string, number>>;
      readonly morphTargetInfluences?: readonly number[];
      readonly skeleton?: { readonly bones?: readonly THREE.Bone[] };
    };
    if (renderable.isSkinnedMesh === true) {
      const bones = renderable.skeleton?.bones;
      if (!Array.isArray(bones)) throw importError("parse-failed");
      skins = safeAddCount(skins, 1, "skin-count-budget-exceeded");
      joints = safeAddCount(joints, bones.length, "joint-count-budget-exceeded");
    }
    if (
      (!renderable.isMesh && !renderable.isLine && !renderable.isPoints)
      || !renderable.geometry?.isBufferGeometry
    ) continue;

    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    for (const material of objectMaterials) {
      if (!material || typeof material !== "object") throw importError("parse-failed");
      materials.add(material);
    }
    const primitiveCount = Array.isArray(renderable.material)
      ? Math.max(1, renderable.geometry.groups.length)
      : 1;
    addMetadata(
      measureStudioBg3dOwnerMetadata(
        renderable.geometry,
        signal,
        maximumMetadataBytes - serializedMetadataBytes,
        false,
      ),
      primitiveCount,
    );
    if (!renderable.isMesh) continue;
    const morphAttributeSets = Object.values(renderable.geometry.morphAttributes);
    if (morphAttributeSets.some((attributes) => !Array.isArray(attributes))) {
      throw importError("parse-failed");
    }
    const attributeTargets = morphAttributeSets.reduce(
      (largest, attributes) => Math.max(largest, attributes.length),
      0,
    );
    const influences = renderable.morphTargetInfluences;
    if (influences !== undefined && !Array.isArray(influences)) {
      throw importError("parse-failed");
    }
    const targetCount = Math.max(attributeTargets, influences?.length ?? 0);
    morphTargets = safeAddCount(
      morphTargets,
      safeMultiplyCount(
        targetCount,
        primitiveCount,
        "morph-target-budget-exceeded",
      ),
      "morph-target-budget-exceeded",
    );
    const morphTargetDictionary = renderable.morphTargetDictionary;
    if (morphTargetDictionary !== undefined) {
      addMetadata(measureStudioBg3dSerializableJson(
        morphTargetDictionary,
        signal,
        maximumMetadataBytes - serializedMetadataBytes,
      ));
    }
  }

  for (const material of materials) {
    throwIfAborted(signal);
    addMetadata(measureStudioBg3dOwnerMetadata(
      material,
      signal,
      maximumMetadataBytes - serializedMetadataBytes,
      true,
    ));
    for (const slot of STUDIO_BG3D_PRE_EXPORT_TEXTURE_SLOTS) {
      const candidate = ownDataProperty(material, slot);
      if (candidate === undefined || candidate === null) continue;
      if (!isStudioBg3dTexture(candidate)) throw importError("parse-failed");
      textures.add(candidate);
    }
  }
  for (const animation of parsed.animations) {
    throwIfAborted(signal);
    if (!animation || typeof animation !== "object") throw importError("parse-failed");
    addMetadata(measureStudioBg3dOwnerMetadata(
      animation,
      signal,
      maximumMetadataBytes - serializedMetadataBytes,
      true,
    ));
    for (const track of animation.tracks) {
      const trackName = ownDataProperty(track, "name");
      if (typeof trackName !== "string") throw importError("parse-failed");
      addMetadata(Object.freeze({
        bytes: safeAddCount(
          16,
          jsonStringByteLength(
            trackName,
            signal,
            maximumMetadataBytes - serializedMetadataBytes,
          ),
          "model-byte-budget-exceeded",
        ),
        entries: 1,
      }));
    }
  }

  let textureBytes = 0;
  let maxTextureDimension = 0;
  for (const texture of textures) {
    throwIfAborted(signal);
    addMetadata(measureStudioBg3dOwnerMetadata(
      texture,
      signal,
      maximumMetadataBytes - serializedMetadataBytes,
      true,
    ));
    const measured = measureStudioBg3dExportTexture(texture);
    textureBytes = safeAddCount(
      textureBytes,
      measured.decodedBytes,
      "texture-byte-budget-exceeded",
    );
    maxTextureDimension = Math.max(maxTextureDimension, measured.maxDimension);
  }
  return Object.freeze({
    joints,
    maxTextureDimension,
    morphTargets,
    serializedMetadataBytes,
    skins,
    textureBytes,
  });
}

/**
 * GLTFExporter must materialize a JSON document, aligned buffer views, and image/container
 * records in addition to the arrays that are already resident in memory. The decoded geometry
 * and texture footprint is therefore wrapped in a conservative 25% envelope, then bounded
 * structural allowances are added without serializing the scene or allocating pixel buffers.
 */
function estimateStudioBg3dPreExportModelBytes(
  metrics: StudioBg3dParsedGlbMetrics,
  serializedMetadataBytes = 0,
): number {
  const code: StudioBg3dModelImportErrorCode = "model-byte-budget-exceeded";
  const resourceBytes = safeAddCount(
    metrics.estimatedDecodedGeometryBytes,
    metrics.textureBytes,
    code,
  );
  const envelopedResourceBytes = Math.ceil(
    safeMultiplyCount(
      resourceBytes,
      STUDIO_BG3D_PRE_EXPORT_RESOURCE_ENVELOPE_NUMERATOR,
      code,
    ) / STUDIO_BG3D_PRE_EXPORT_RESOURCE_ENVELOPE_DENOMINATOR,
  );
  let estimate = safeAddCount(
    STUDIO_BG3D_PRE_EXPORT_BASE_MODEL_BYTES,
    envelopedResourceBytes,
    code,
  );
  estimate = safeAddCount(
    estimate,
    Math.ceil(
      safeMultiplyCount(
        serializedMetadataBytes,
        STUDIO_BG3D_PRE_EXPORT_RESOURCE_ENVELOPE_NUMERATOR,
        code,
      ) / STUDIO_BG3D_PRE_EXPORT_RESOURCE_ENVELOPE_DENOMINATOR,
    ),
    code,
  );
  const structuralAllowances = [
    [metrics.nodes, 512],
    [metrics.drawCalls, 512],
    [metrics.materials, 2_048],
    [metrics.lights, 512],
    [metrics.animations, 512],
    [metrics.animationChannels, 384],
    [metrics.skins, 512],
    [metrics.joints, 128],
    [metrics.morphTargets, 256],
    [metrics.textures, 1_024],
  ] as const;
  for (const [count, bytesPerRecord] of structuralAllowances) {
    estimate = safeAddCount(
      estimate,
      safeMultiplyCount(count, bytesPerRecord, code),
      code,
    );
  }
  return estimate;
}

function assertActiveProfilePreExportBudgets(
  parsed: StudioBg3dParsedExportCandidate,
  budget: StudioBg3dGlbValidationBudget,
  signal?: AbortSignal,
): void {
  const measured = measureStudioBg3dThreeMetrics(parsed.root, parsed.animations);
  if (!measured.ok) throw importError("parse-failed");
  const supplemental = measureStudioBg3dPreExportSupplementalMetrics(
    parsed,
    signal,
    budget.complexity.maxModelBytes,
  );
  const metrics: StudioBg3dParsedGlbMetrics = Object.freeze({
    ...measured.metrics,
    joints: Math.max(measured.metrics.joints, supplemental.joints),
    maxTextureDimension: Math.max(
      measured.metrics.maxTextureDimension,
      supplemental.maxTextureDimension,
    ),
    morphTargets: Math.max(measured.metrics.morphTargets, supplemental.morphTargets),
    skins: Math.max(measured.metrics.skins, supplemental.skins),
    textureBytes: Math.max(measured.metrics.textureBytes, supplemental.textureBytes),
  });

  if (metrics.lights > budget.complexity.maxLights) {
    throw importError("light-budget-exceeded");
  }
  if (metrics.skins > budget.complexity.maxSkins) {
    throw importError("skin-count-budget-exceeded");
  }
  if (metrics.joints > budget.complexity.maxJoints) {
    throw importError("joint-count-budget-exceeded");
  }
  if (metrics.morphTargets > budget.complexity.maxMorphTargets) {
    throw importError("morph-target-budget-exceeded");
  }
  if (
    metrics.accessorElements > budget.complexity.maxAccessorElements
    || metrics.estimatedDecodedGeometryBytes
      > budget.complexity.maxDecodedGeometryBytes
  ) {
    throw importError("geometry-memory-too-large");
  }
  if (metrics.textures > budget.textures.maxTextures) {
    throw importError("texture-count-budget-exceeded");
  }
  if (metrics.maxTextureDimension > budget.textures.maxDimension) {
    throw importError("texture-dimension-budget-exceeded");
  }
  if (metrics.textureBytes > budget.textures.maxTotalBytes) {
    throw importError("texture-byte-budget-exceeded");
  }
  if (
    estimateStudioBg3dPreExportModelBytes(metrics, supplemental.serializedMetadataBytes)
    > budget.complexity.maxModelBytes
  ) {
    throw importError("model-byte-budget-exceeded");
  }
}

/**
 * Bounds every CPU-heavy structure that GLTFExporter will walk. This runs after format parsing but
 * before legacy material conversion, matrix updates, texture encoding, or GLB allocation.
 */
export function assertStudioBg3dPreExportBudgets(
  parsed: StudioBg3dParsedExportCandidate,
  signal?: AbortSignal,
  budget?: StudioBg3dGlbValidationBudget,
): void {
  assertParsedImportBudgets(parsed.root, signal, budget);
  assertParsedMaterialBudgets(parsed.root, signal, budget);
  assertParsedAnimationBudgets(parsed.animations, signal, budget);
  if (budget) {
    throwIfAborted(signal);
    assertActiveProfilePreExportBudgets(parsed, budget, signal);
    throwIfAborted(signal);
  }
}

function isLegacyPhongMaterial(material: THREE.Material): material is THREE.MeshPhongMaterial {
  return (material as THREE.MeshPhongMaterial).isMeshPhongMaterial === true;
}

/**
 * OBJ/MTL, FBX, COLLADA and 3DS loaders commonly produce MeshPhongMaterial. GLTFExporter can
 * approximate it but emits a browser warning for every material. Convert that known legacy PBR
 * boundary explicitly, preserving supported texture slots and a deterministic shininess ->
 * roughness approximation before export. Shared source materials remain shared after conversion.
 */
async function upgradeLegacyPhongMaterialsForGlb(root: THREE.Object3D): Promise<void> {
  const { MeshStandardMaterial } = await import("three");
  const converted = new Map<THREE.MeshPhongMaterial, THREE.MeshStandardMaterial>();

  const convert = (material: THREE.Material): THREE.Material => {
    if (!isLegacyPhongMaterial(material)) return material;
    const existing = converted.get(material);
    if (existing) return existing;
    const shininess = Number.isFinite(material.shininess) ? Math.max(0, material.shininess) : 30;
    const replacement = new MeshStandardMaterial({
      alphaMap: material.alphaMap,
      alphaTest: material.alphaTest,
      aoMap: material.aoMap,
      aoMapIntensity: material.aoMapIntensity,
      bumpMap: material.bumpMap,
      bumpScale: material.bumpScale,
      color: material.color,
      depthTest: material.depthTest,
      depthWrite: material.depthWrite,
      displacementBias: material.displacementBias,
      displacementMap: material.displacementMap,
      displacementScale: material.displacementScale,
      emissive: material.emissive,
      emissiveIntensity: material.emissiveIntensity,
      emissiveMap: material.emissiveMap,
      envMap: material.envMap,
      envMapRotation: material.envMapRotation,
      flatShading: material.flatShading,
      fog: material.fog,
      lightMap: material.lightMap,
      lightMapIntensity: material.lightMapIntensity,
      map: material.map,
      metalness: 0,
      normalMap: material.normalMap,
      normalMapType: material.normalMapType,
      normalScale: material.normalScale,
      opacity: material.opacity,
      roughness: Math.max(0.04, Math.min(1, Math.sqrt(2 / (shininess + 2)))),
      side: material.side,
      transparent: material.transparent,
      vertexColors: material.vertexColors,
      wireframe: material.wireframe,
    });
    replacement.name = material.name;
    replacement.alphaHash = material.alphaHash;
    replacement.alphaToCoverage = material.alphaToCoverage;
    replacement.colorWrite = material.colorWrite;
    replacement.depthFunc = material.depthFunc;
    replacement.dithering = material.dithering;
    replacement.forceSinglePass = material.forceSinglePass;
    replacement.premultipliedAlpha = material.premultipliedAlpha;
    replacement.shadowSide = material.shadowSide;
    replacement.toneMapped = material.toneMapped;
    replacement.userData = { ...material.userData };
    replacement.visible = material.visible;
    converted.set(material, replacement);
    return replacement;
  };

  root.traverse((object) => {
    const candidate = object as THREE.Object3D & {
      material?: THREE.Material | THREE.Material[];
    };
    if (!candidate.material) return;
    candidate.material = Array.isArray(candidate.material)
      ? candidate.material.map(convert)
      : convert(candidate.material);
  });

  // Material.dispose() does not dispose the texture slots reused by the replacement. The parsed
  // root now owns every replacement and the regular scene-resource disposer handles them later.
  for (const material of converted.keys()) material.dispose();
}

async function exportParsedImportToGlb(
  parsed: ParsedImport,
  sourcePath: string,
  signal?: AbortSignal,
): Promise<Bg3dModelUploadSource> {
  throwIfAborted(signal);
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  throwIfAborted(signal);
  await upgradeLegacyPhongMaterialsForGlb(parsed.root);
  throwIfAborted(signal);
  parsed.root.updateMatrixWorld(true);
  let exported: ArrayBuffer | object;
  try {
    exported = await new GLTFExporter().parseAsync(parsed.root, {
      animations: [...parsed.animations],
      binary: true,
      includeCustomExtensions: true,
      maxTextureSize: 8192,
      onlyVisible: false,
      truncateDrawRange: true,
    });
  } catch {
    throwIfAborted(signal);
    throw importError("export-failed");
  }
  throwIfAborted(signal);
  if (!(exported instanceof ArrayBuffer)) throw importError("export-failed");
  if (exported.byteLength <= 0) throw importError("export-failed");
  if (exported.byteLength > STUDIO_BG3D_IMPORT_MAX_FILE_BYTES) throw importError("output-too-large");
  const canonicalBytes = exported.slice(0);
  const name = `${modelBaseName(sourcePath)}.glb`;
  return Object.freeze({
    name,
    size: canonicalBytes.byteLength,
    type: "model/gltf-binary",
    async arrayBuffer() {
      return canonicalBytes.slice(0);
    },
  });
}

async function convertPlanItem(
  item: StudioBg3dImportPlanItem,
  resources: ReadonlyMap<string, StudioBg3dImportFile>,
  executionBackend: StudioBg3dModelImportExecutionBackend,
  signal: AbortSignal | undefined,
  companionDecodedImageBytes: number,
  preExportBudget: StudioBg3dGlbValidationBudget | undefined,
  onBeforeExport?: () => void,
): Promise<Bg3dModelUploadSource> {
  throwIfAborted(signal);
  if (item.format === "glb") return item.primary;
  const resolver = new LocalResourceResolver(resources, item.primaryPath);
  let parsed: ParsedImport | null = null;
  try {
    parsed = await parsePlanItem(
      item,
      resolver,
      executionBackend,
      signal,
      companionDecodedImageBytes,
    );
    throwIfAborted(signal);
    assertStudioBg3dPreExportBudgets(parsed, signal, preExportBudget);
    throwIfAborted(signal);
    onBeforeExport?.();
    throwIfAborted(signal);
    const exported = await exportParsedImportToGlb(parsed, item.primaryPath, signal);
    throwIfAborted(signal);
    return exported;
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof StudioBg3dModelImportError) throw error;
    throw importError("parse-failed");
  } finally {
    resolver.dispose();
    if (parsed) disposeStudioBg3dThreeResources(parsed.root);
  }
}

/**
 * Converts heterogeneous user files into the sole trusted persistence format: self-contained GLB.
 * GLB inputs pass through without copying here; every output still enters the existing hash,
 * container, extension, decoded-memory, and renderer-admission validation boundary afterwards.
 */
export async function convertStudioBg3dModelFilesToGlb(
  input: readonly StudioBg3dImportFile[],
  options: StudioBg3dModelImportOptions = {},
): Promise<readonly Bg3dModelUploadSource[]> {
  throwIfAborted(options.signal);
  const executionBackend = options.executionBackend ?? "worker";
  if (executionBackend !== "worker" && executionBackend !== "direct") {
    throw new TypeError("studio-bg3d-model-import:invalid-execution-backend");
  }
  const preExportBudget = resolvePreExportBudget(options);
  const plan = planStudioBg3dModelImports(input);
  options.onProgress?.({
    stage: "planning",
    completedModels: 0,
    totalModels: plan.items.length,
    sourceName: "",
  });
  throwIfAborted(options.signal);
  const converted: Bg3dModelUploadSource[] = [];
  let convertedOutputBytes = 0;
  let companionDecodedImageBytes = 0;
  if (plan.items.some((item) => item.format !== "glb")) {
    companionDecodedImageBytes = await preflightCompanionImageMemory(plan.resources, options.signal);
    throwIfAborted(options.signal);
  }
  for (let index = 0; index < plan.items.length; index += 1) {
    const item = plan.items[index];
    const progress = (stage: StudioBg3dImportProgressStage) => options.onProgress?.({
      stage,
      completedModels: index,
      totalModels: plan.items.length,
      sourceName: item.primary.name,
    });
    progress("reading");
    throwIfAborted(options.signal);
    if (
      item.format === "glb"
      && item.primary.size > STUDIO_BG3D_IMPORT_MAX_OUTPUT_TOTAL_BYTES - convertedOutputBytes
    ) {
      throw importError("output-total-too-large");
    }
    if (item.format !== "glb") progress("parsing");
    throwIfAborted(options.signal);
    const result = await convertPlanItem(
      item,
      plan.resources,
      executionBackend,
      options.signal,
      companionDecodedImageBytes,
      preExportBudget,
      item.format === "glb" ? undefined : () => progress("exporting"),
    );
    throwIfAborted(options.signal);
    if (result.size > STUDIO_BG3D_IMPORT_MAX_OUTPUT_TOTAL_BYTES - convertedOutputBytes) {
      throw importError("output-total-too-large");
    }
    convertedOutputBytes += result.size;
    converted.push(result);
    options.onProgress?.({
      stage: "ready",
      completedModels: index + 1,
      totalModels: plan.items.length,
      sourceName: item.primary.name,
    });
    throwIfAborted(options.signal);
  }
  throwIfAborted(options.signal);
  return Object.freeze(converted);
}
