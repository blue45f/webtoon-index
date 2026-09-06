/**
 * Renderer-independent validation boundary for user supplied GLB files.
 *
 * Keep this module free of Three.js/Babylon.js imports. A caller must validate the original bytes
 * here before creating an object URL, invoking a renderer loader, or resolving any glTF resource.
 */

import {
  isAttestedStudioBg3dKtx2TranscoderCapability,
  type StudioBg3dKtx2TranscoderCapability,
} from "./studio-bg3d-ktx2-transcoder-capability";
import {
  inspectStudioBg3dBasisKtx2,
  type StudioBg3dBasisKtx2Info,
} from "./studio-bg3d-ktx2-validation";

export const STUDIO_BG3D_GLB_MAX_BYTES = 100 * 1024 * 1024;
export const STUDIO_BG3D_GLB_MAX_JSON_BYTES = 4 * 1024 * 1024;
export const STUDIO_BG3D_GLB_MIME_TYPE = "model/gltf-binary" as const;

const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const SHA256_PATTERN = /^(?:sha256:)?([a-f0-9]{64})$/iu;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export type StudioBg3dGlbProfile = "mobile" | "desktop";

export interface StudioBg3dGlbDeclaredMetadata {
  /** Exact byte length recorded when the attachment was created. */
  readonly byteSize: number;
  /** A raw 64-character digest or `sha256:`-prefixed digest. */
  readonly sha256: string;
  /** If supplied, only the GLB media type is accepted. */
  readonly mimeType?: string;
}

export interface StudioBg3dGlbCumulativeByteBudget {
  /** Bytes already admitted into the project before this attachment. */
  readonly usedBytes: number;
  /** Caller-selected project/session ceiling. */
  readonly maximumBytes: number;
}

export interface StudioBg3dGlbComplexityBudget {
  readonly maxModelBytes: number;
  readonly maxNodes: number;
  readonly maxTriangles: number;
  readonly maxDrawCalls: number;
  readonly maxMaterials: number;
  readonly maxLights: number;
  readonly maxAnimations: number;
  readonly maxAnimationChannels: number;
  readonly maxAnimationKeyframes: number;
  readonly maxAnimationValues: number;
  readonly maxSkins: number;
  readonly maxJoints: number;
  readonly maxMorphTargets: number;
  readonly maxAccessorElements: number;
  readonly maxDecodedGeometryBytes: number;
}

export interface StudioBg3dGlbTextureBudget {
  readonly maxTextures: number;
  /** Sum of embedded compressed image buffer-view bytes. */
  readonly maxTotalBytes: number;
  /** Maximum width or height discovered in each supported embedded image. */
  readonly maxDimension: number;
}

export interface StudioBg3dGlbValidationBudget {
  readonly complexity: StudioBg3dGlbComplexityBudget;
  readonly textures: StudioBg3dGlbTextureBudget;
}

export interface StudioBg3dGlbBudgetProfiles {
  readonly mobile: StudioBg3dGlbValidationBudget;
  readonly desktop: StudioBg3dGlbValidationBudget;
}

/**
 * Conservative product defaults. Callers may supply stricter profiles for a document or device.
 */
export const DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES: StudioBg3dGlbBudgetProfiles =
  Object.freeze({
    mobile: Object.freeze({
      complexity: Object.freeze({
        maxModelBytes: 64 * 1024 * 1024,
        maxNodes: 256,
        maxTriangles: 500_000,
        maxDrawCalls: 256,
        maxMaterials: 128,
        maxLights: 4,
        maxAnimations: 32,
        maxAnimationChannels: 256,
        maxAnimationKeyframes: 250_000,
        maxAnimationValues: 2_000_000,
        maxSkins: 32,
        maxJoints: 1_024,
        maxMorphTargets: 128,
        maxAccessorElements: 20_000_000,
        maxDecodedGeometryBytes: 128 * 1024 * 1024,
      }),
      textures: Object.freeze({
        maxTextures: 64,
        maxTotalBytes: 128 * 1024 * 1024,
        maxDimension: 8192,
      }),
    }),
    desktop: Object.freeze({
      complexity: Object.freeze({
        maxModelBytes: STUDIO_BG3D_GLB_MAX_BYTES,
        maxNodes: 1024,
        maxTriangles: 2_000_000,
        maxDrawCalls: 1024,
        maxMaterials: 512,
        maxLights: 16,
        maxAnimations: 128,
        maxAnimationChannels: 2_048,
        maxAnimationKeyframes: 2_000_000,
        maxAnimationValues: 16_000_000,
        maxSkins: 128,
        maxJoints: 4_096,
        maxMorphTargets: 512,
        maxAccessorElements: 80_000_000,
        maxDecodedGeometryBytes: 512 * 1024 * 1024,
      }),
      textures: Object.freeze({
        maxTextures: 256,
        maxTotalBytes: STUDIO_BG3D_GLB_MAX_BYTES,
        maxDimension: 8192,
      }),
    }),
  });

export type StudioBg3dGlbDigest = (
  bytes: Uint8Array,
) => Promise<ArrayBuffer | Uint8Array | string>;

export type StudioBg3dBasisPayloadPreflight = (
  bytes: Uint8Array,
  info: StudioBg3dBasisKtx2Info,
) => Promise<boolean>;

export interface StudioBg3dBasisPayloadRuntime {
  readonly capability: StudioBg3dKtx2TranscoderCapability;
  readonly preflight: StudioBg3dBasisPayloadPreflight;
}

export type StudioBg3dBasisRuntimeProvider = () => Promise<
  StudioBg3dBasisPayloadRuntime | null
>;

export interface StudioBg3dGlbValidationOptions {
  readonly declared: StudioBg3dGlbDeclaredMetadata;
  readonly cumulative: StudioBg3dGlbCumulativeByteBudget;
  readonly profile: StudioBg3dGlbProfile;
  readonly budgets: StudioBg3dGlbBudgetProfiles;
  /** Dependency injection for restricted runtimes and deterministic tests. */
  readonly digest?: StudioBg3dGlbDigest;
  /** Always clamped to the module's 4 MiB hard JSON ceiling. */
  readonly maxJsonBytes?: number;
  /** Required extensions not in this allowlist are rejected before a renderer sees the file. */
  readonly supportedRequiredExtensions?: readonly string[];
  /**
   * Same-realm proof that the exact Three Basis JS/WASM assets were hashed successfully. Required
   * in addition to the allowlist for a required KHR_texture_basisu asset. This object cannot be
   * trusted after structured cloning; a Worker must attest its own executable assets.
   */
  readonly basisTranscoderCapability?: StudioBg3dKtx2TranscoderCapability;
  /**
   * Same-realm decoder gate for every embedded Basis payload. The callback receives a private copy
   * of bytes that already passed the decoder-free envelope checks and must transcode every mip.
   */
  readonly basisPayloadPreflight?: StudioBg3dBasisPayloadPreflight;
  /**
   * Lazy same-realm runtime resolver. It is invoked only after parsed glTF evidence proves the
   * document may use Basis, so escaped JSON spellings cannot bypass initialization and unrelated
   * raw strings cannot trigger the WASM download.
   */
  readonly basisRuntimeProvider?: StudioBg3dBasisRuntimeProvider;
}

export interface StudioBg3dGlbMetrics {
  readonly byteSize: number;
  readonly jsonByteSize: number;
  readonly binByteSize: number;
  readonly nodes: number;
  readonly meshes: number;
  /** Primitives declared once in the mesh table, before node instancing. */
  readonly meshPrimitives: number;
  /** Primitive count after ordinary and EXT_mesh_gpu_instancing node instances. */
  readonly drawCalls: number;
  /** Indexed/non-indexed triangle count after node instances. */
  readonly triangles: number;
  readonly materials: number;
  readonly textures: number;
  readonly images: number;
  readonly imageBytes: number;
  /** Conservative RGBA8 allocation estimate for images whose dimensions can be read safely. */
  readonly estimatedDecodedImageBytes: number;
  readonly maxImageDimension: number;
  readonly undeterminedImageDimensions: number;
  readonly lights: number;
  /** Animation clips declared by the model. */
  readonly animations: number;
  /** Evaluated animation channels, including channels that share a sampler. */
  readonly animationChannels: number;
  /** Input accessor keyframes summed once per evaluated channel. */
  readonly animationKeyframes: number;
  /** Output scalar cardinality, including cubic-spline tangents, summed per channel. */
  readonly animationValues: number;
  /** Skin records declared by the model. */
  readonly skins: number;
  /** Joint references summed across skins; shared joints are counted conservatively per skin. */
  readonly joints: number;
  /** Morph-target records summed across mesh primitives. */
  readonly morphTargets: number;
  readonly accessorElements: number;
  readonly estimatedDecodedGeometryBytes: number;
}

export type StudioBg3dGlbFailureCode =
  | "invalid-input"
  | "invalid-options"
  | "invalid-declared-metadata"
  | "mime-type-mismatch"
  | "byte-size-mismatch"
  | "file-too-large"
  | "model-byte-budget-exceeded"
  | "cumulative-byte-budget-exceeded"
  | "digest-unavailable"
  | "digest-failed"
  | "hash-mismatch"
  | "truncated-header"
  | "invalid-magic"
  | "unsupported-version"
  | "declared-length-mismatch"
  | "missing-json-chunk"
  | "json-chunk-too-large"
  | "invalid-chunk-alignment"
  | "invalid-chunk-bounds"
  | "duplicate-json-chunk"
  | "duplicate-bin-chunk"
  | "unsupported-chunk-type"
  | "invalid-json-encoding"
  | "invalid-json"
  | "invalid-gltf-root"
  | "unsupported-required-extension"
  | "external-resource-uri"
  | "missing-bin-chunk"
  | "invalid-buffer"
  | "invalid-buffer-view"
  | "invalid-accessor"
  | "invalid-mesh"
  | "invalid-node"
  | "invalid-animation"
  | "invalid-skin"
  | "invalid-image"
  | "basis-transcode-failed"
  | "arithmetic-overflow"
  | "node-budget-exceeded"
  | "triangle-budget-exceeded"
  | "draw-call-budget-exceeded"
  | "material-budget-exceeded"
  | "light-budget-exceeded"
  | "animation-count-budget-exceeded"
  | "animation-channel-budget-exceeded"
  | "animation-keyframe-budget-exceeded"
  | "animation-value-budget-exceeded"
  | "skin-count-budget-exceeded"
  | "joint-count-budget-exceeded"
  | "morph-target-budget-exceeded"
  | "accessor-element-budget-exceeded"
  | "geometry-memory-budget-exceeded"
  | "texture-count-budget-exceeded"
  | "texture-byte-budget-exceeded"
  | "texture-dimension-budget-exceeded";

export interface StudioBg3dGlbValidationFailure {
  readonly ok: false;
  readonly code: StudioBg3dGlbFailureCode;
  /** Stable, sanitized Korean UI copy. Never contains file-controlled strings. */
  readonly message: string;
}

export interface StudioBg3dGlbValidationSuccess {
  readonly ok: true;
  readonly code: "valid";
  readonly message: string;
  readonly profile: StudioBg3dGlbProfile;
  readonly verifiedSha256: `sha256:${string}`;
  /**
   * Validator-owned snapshot that passed every check. Renderers must parse only this value, never
   * the caller's original ArrayBuffer/Uint8Array, which may be mutated after this promise resolves.
   */
  readonly verifiedBytes: Uint8Array;
  readonly cumulativeBytesAfter: number;
  /** Parsed-root evidence, never a raw substring scan. Drives the lazy viewport KTX2 boundary. */
  readonly usesBasisTextures: boolean;
  /** True only when KHR_texture_basisu is required and no core PNG/JPEG fallback is permitted. */
  readonly requiresBasisTextures: boolean;
  readonly metrics: StudioBg3dGlbMetrics;
}

export type StudioBg3dGlbValidationResult =
  | StudioBg3dGlbValidationFailure
  | StudioBg3dGlbValidationSuccess;

const FAILURE_MESSAGES: Readonly<Record<StudioBg3dGlbFailureCode, string>> = Object.freeze({
  "invalid-input": "3D 모델 파일의 이진 데이터를 읽을 수 없습니다. 파일을 다시 선택해 주세요.",
  "invalid-options": "3D 모델 안전 검사 설정이 올바르지 않습니다. 작업공간을 새로고침해 주세요.",
  "invalid-declared-metadata": "3D 모델의 크기 또는 무결성 정보를 확인할 수 없습니다. 파일을 다시 등록해 주세요.",
  "mime-type-mismatch": "지원되는 GLB 형식의 3D 모델만 불러올 수 있습니다.",
  "byte-size-mismatch": "3D 모델의 기록된 크기와 실제 파일 크기가 다릅니다. 원본 파일을 다시 등록해 주세요.",
  "file-too-large": "3D 모델은 파일 하나당 최대 100MiB까지 불러올 수 있습니다. 모델을 최적화해 주세요.",
  "model-byte-budget-exceeded": "이 기기의 3D 모델 용량 기준을 초과했습니다. 더 작은 모델을 사용해 주세요.",
  "cumulative-byte-budget-exceeded": "프로젝트의 3D 모델 누적 용량 기준을 초과했습니다. 사용하지 않는 모델을 정리해 주세요.",
  "digest-unavailable": "이 환경에서는 3D 모델 무결성 검사를 사용할 수 없습니다. 최신 브라우저에서 다시 시도해 주세요.",
  "digest-failed": "3D 모델 무결성 검사를 완료하지 못했습니다. 파일을 다시 선택해 주세요.",
  "hash-mismatch": "3D 모델이 등록 이후 변경되었거나 손상되었습니다. 신뢰할 수 있는 원본을 다시 등록해 주세요.",
  "truncated-header": "3D 모델 파일이 완전하지 않습니다. 원본 GLB 파일을 다시 받아 주세요.",
  "invalid-magic": "이 파일은 유효한 GLB 모델이 아닙니다. GLB 2.0 형식으로 내보내 주세요.",
  "unsupported-version": "GLB 2.0 모델만 지원합니다. 모델을 GLB 2.0으로 다시 내보내 주세요.",
  "declared-length-mismatch": "3D 모델 컨테이너 길이가 실제 파일과 맞지 않습니다. 원본 파일을 다시 내보내 주세요.",
  "missing-json-chunk": "3D 모델에 필수 장면 정보가 없습니다. GLB 파일을 다시 내보내 주세요.",
  "json-chunk-too-large": "3D 모델의 장면 정보가 안전 처리 한도를 초과했습니다. 모델을 단순화해 주세요.",
  "invalid-chunk-alignment": "3D 모델 내부 블록 정렬이 올바르지 않습니다. GLB 파일을 다시 내보내 주세요.",
  "invalid-chunk-bounds": "3D 모델 내부 블록이 잘렸거나 손상되었습니다. 원본 파일을 다시 받아 주세요.",
  "duplicate-json-chunk": "3D 모델에 장면 정보 블록이 중복되어 있습니다. GLB 파일을 다시 내보내 주세요.",
  "duplicate-bin-chunk": "3D 모델에 이진 리소스 블록이 중복되어 있습니다. GLB 파일을 다시 내보내 주세요.",
  "unsupported-chunk-type": "지원하지 않는 내부 블록이 포함된 GLB 모델입니다. 표준 GLB 2.0으로 다시 내보내 주세요.",
  "invalid-json-encoding": "3D 모델 장면 정보의 문자 인코딩이 올바르지 않습니다. GLB 파일을 다시 내보내 주세요.",
  "invalid-json": "3D 모델 장면 정보를 해석할 수 없습니다. GLB 파일을 다시 내보내 주세요.",
  "invalid-gltf-root": "3D 모델의 glTF 2.0 장면 구조가 올바르지 않습니다. 파일을 다시 내보내 주세요.",
  "unsupported-required-extension": "현재 안전하게 처리할 수 없는 필수 3D 확장이 포함되어 있습니다. 호환 옵션으로 다시 내보내 주세요.",
  "external-resource-uri": "외부 파일이나 네트워크 리소스를 참조하는 모델은 불러올 수 없습니다. 모든 리소스를 GLB 안에 포함해 주세요.",
  "missing-bin-chunk": "3D 모델에 필요한 내장 리소스가 없습니다. 텍스처와 메시를 GLB 안에 포함해 주세요.",
  "invalid-buffer": "3D 모델의 내장 이진 리소스 정보가 올바르지 않습니다. 파일을 다시 내보내 주세요.",
  "invalid-buffer-view": "3D 모델의 내장 리소스 범위가 올바르지 않습니다. 파일을 다시 내보내 주세요.",
  "invalid-accessor": "3D 모델의 기하 데이터 개수 정보를 확인할 수 없습니다. 파일을 다시 내보내 주세요.",
  "invalid-mesh": "3D 모델의 메시 구조가 올바르지 않습니다. 파일을 다시 내보내 주세요.",
  "invalid-node": "3D 모델의 장면 노드 구조가 올바르지 않습니다. 파일을 다시 내보내 주세요.",
  "invalid-animation": "3D 모델의 애니메이션 구조가 올바르지 않습니다. 애니메이션을 정리해 다시 내보내 주세요.",
  "invalid-skin": "3D 모델의 스킨 또는 조인트 구조가 올바르지 않습니다. 리깅을 정리해 다시 내보내 주세요.",
  "invalid-image": "3D 모델의 내장 이미지 구조가 올바르지 않습니다. 지원 형식으로 다시 내보내 주세요.",
  "basis-transcode-failed": "3D 모델의 Basis 텍스처를 안전하게 디코딩할 수 없습니다. 텍스처를 다시 내보내 주세요.",
  "arithmetic-overflow": "3D 모델의 복잡도를 안전하게 계산할 수 없습니다. 모델을 단순화해 주세요.",
  "node-budget-exceeded": "이 기기의 장면 노드 수 기준을 초과했습니다. 모델 계층을 단순화해 주세요.",
  "triangle-budget-exceeded": "이 기기의 삼각형 수 기준을 초과했습니다. 메시를 경량화해 주세요.",
  "draw-call-budget-exceeded": "이 기기의 드로콜 기준을 초과했습니다. 메시와 재질을 병합해 주세요.",
  "material-budget-exceeded": "이 기기의 재질 수 기준을 초과했습니다. 재질을 정리하거나 병합해 주세요.",
  "light-budget-exceeded": "이 기기의 조명 수 기준을 초과했습니다. 조명 수를 줄여 주세요.",
  "animation-count-budget-exceeded": "이 기기의 애니메이션 클립 수 기준을 초과했습니다. 사용하지 않는 동작을 정리해 주세요.",
  "animation-channel-budget-exceeded": "이 기기의 애니메이션 채널 수 기준을 초과했습니다. 애니메이션 트랙을 단순화해 주세요.",
  "animation-keyframe-budget-exceeded": "이 기기의 애니메이션 키프레임 기준을 초과했습니다. 키프레임을 줄여 주세요.",
  "animation-value-budget-exceeded": "이 기기의 애니메이션 데이터 메모리 기준을 초과했습니다. 애니메이션을 압축하거나 단순화해 주세요.",
  "skin-count-budget-exceeded": "이 기기의 스킨 수 기준을 초과했습니다. 리깅 구조를 단순화해 주세요.",
  "joint-count-budget-exceeded": "이 기기의 조인트 수 기준을 초과했습니다. 본 구조를 단순화해 주세요.",
  "morph-target-budget-exceeded": "이 기기의 모프 타깃 수 기준을 초과했습니다. 표정·변형 타깃을 정리해 주세요.",
  "accessor-element-budget-exceeded": "이 기기의 3D 데이터 요소 수 기준을 초과했습니다. 메시와 애니메이션을 단순화해 주세요.",
  "geometry-memory-budget-exceeded": "이 기기의 디코딩된 3D 데이터 메모리 기준을 초과했습니다. 메시·리깅·애니메이션을 최적화해 주세요.",
  "texture-count-budget-exceeded": "이 기기의 텍스처 개수 기준을 초과했습니다. 텍스처를 정리해 주세요.",
  "texture-byte-budget-exceeded": "이 기기의 내장 텍스처 용량 기준을 초과했습니다. 텍스처를 압축해 주세요.",
  "texture-dimension-budget-exceeded": "이 기기의 텍스처 해상도 기준을 초과했습니다. 텍스처 크기를 낮춰 주세요.",
});

interface GlbChunk {
  readonly offset: number;
  readonly byteLength: number;
}

interface ParsedContainer {
  readonly root: Record<string, unknown>;
  readonly jsonByteSize: number;
  readonly bin: GlbChunk | null;
}

interface BufferViewRange {
  /** Logical offset in the parent (possibly placeholder) buffer after decompression. */
  readonly logicalOffset: number;
  /** Absolute offset in the GLB snapshot, or null when bytes exist only after Meshopt decode. */
  readonly embeddedOffset: number | null;
  readonly byteLength: number;
  readonly byteStride: number | null;
  readonly meshoptCompressed: boolean;
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

interface CountResult {
  readonly metrics?: Omit<StudioBg3dGlbMetrics, "byteSize" | "jsonByteSize" | "binByteSize">;
  readonly usesBasisTextures?: boolean;
  readonly failure?: StudioBg3dGlbValidationFailure;
}

function failure(code: StudioBg3dGlbFailureCode): StudioBg3dGlbValidationFailure {
  return Object.freeze({ ok: false, code, message: FAILURE_MESSAGES[code] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function readArray(root: Record<string, unknown>, key: string): readonly unknown[] | null {
  const value = root[key];
  return value === undefined ? [] : Array.isArray(value) ? value : null;
}

function safeAdd(left: number, right: number): number | null {
  return Number.isSafeInteger(left) && Number.isSafeInteger(right) && left <= Number.MAX_SAFE_INTEGER - right
    ? left + right
    : null;
}

function safeMultiply(left: number, right: number): number | null {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
  if (left === 0 || right === 0) return 0;
  return left <= Math.floor(Number.MAX_SAFE_INTEGER / right) ? left * right : null;
}

function normalizedDeclaredHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = SHA256_PATTERN.exec(value);
  return match?.[1]?.toLowerCase() ?? null;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function browserSha256(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("digest-unavailable");
  return subtle.digest("SHA-256", bytes);
}

async function calculateDigest(
  bytes: Uint8Array<ArrayBuffer>,
  injected: StudioBg3dGlbDigest | undefined,
): Promise<{ digest?: string; unavailable?: true }> {
  try {
    const result = await (injected ?? browserSha256)(bytes);
    if (typeof result === "string") {
      const normalized = normalizedDeclaredHash(result);
      return normalized ? { digest: normalized } : {};
    }
    const digestBytes = result instanceof ArrayBuffer ? new Uint8Array(result) : result;
    return digestBytes instanceof Uint8Array && digestBytes.byteLength === 32
      ? { digest: bytesToHex(digestBytes) }
      : {};
  } catch (error) {
    return error instanceof Error && error.message === "digest-unavailable"
      ? { unavailable: true }
      : {};
  }
}

function validBudget(budget: StudioBg3dGlbValidationBudget): boolean {
  return (
    isRecord(budget) &&
    isRecord(budget.complexity) &&
    isRecord(budget.textures) &&
    isSafePositiveInteger(budget.complexity.maxModelBytes) &&
    isSafePositiveInteger(budget.complexity.maxNodes) &&
    isSafePositiveInteger(budget.complexity.maxTriangles) &&
    isSafePositiveInteger(budget.complexity.maxDrawCalls) &&
    isSafePositiveInteger(budget.complexity.maxMaterials) &&
    isSafePositiveInteger(budget.complexity.maxLights) &&
    isSafeNonNegativeInteger(budget.complexity.maxAnimations) &&
    isSafeNonNegativeInteger(budget.complexity.maxAnimationChannels) &&
    isSafeNonNegativeInteger(budget.complexity.maxAnimationKeyframes) &&
    isSafeNonNegativeInteger(budget.complexity.maxAnimationValues) &&
    isSafeNonNegativeInteger(budget.complexity.maxSkins) &&
    isSafeNonNegativeInteger(budget.complexity.maxJoints) &&
    isSafeNonNegativeInteger(budget.complexity.maxMorphTargets) &&
    isSafeNonNegativeInteger(budget.complexity.maxAccessorElements) &&
    isSafeNonNegativeInteger(budget.complexity.maxDecodedGeometryBytes) &&
    isSafePositiveInteger(budget.textures.maxTextures) &&
    isSafePositiveInteger(budget.textures.maxTotalBytes) &&
    isSafePositiveInteger(budget.textures.maxDimension)
  );
}

function parseContainer(bytes: Uint8Array, maxJsonBytes: number): ParsedContainer | StudioBg3dGlbValidationFailure {
  if (bytes.byteLength < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) return failure("truncated-header");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return failure("invalid-magic");
  if (view.getUint32(4, true) !== GLB_VERSION) return failure("unsupported-version");
  if (view.getUint32(8, true) !== bytes.byteLength) return failure("declared-length-mismatch");

  let offset = GLB_HEADER_BYTES;
  let index = 0;
  let json: GlbChunk | null = null;
  let bin: GlbChunk | null = null;
  while (offset < bytes.byteLength) {
    if (offset % 4 !== 0) return failure("invalid-chunk-alignment");
    if (bytes.byteLength - offset < GLB_CHUNK_HEADER_BYTES) return failure("invalid-chunk-bounds");
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    if (chunkLength % 4 !== 0) return failure("invalid-chunk-alignment");
    const contentOffset = offset + GLB_CHUNK_HEADER_BYTES;
    if (chunkLength > bytes.byteLength - contentOffset) return failure("invalid-chunk-bounds");
    const chunk = { offset: contentOffset, byteLength: chunkLength };

    if (index === 0 && chunkType !== GLB_JSON_CHUNK) return failure("missing-json-chunk");
    if (chunkType === GLB_JSON_CHUNK) {
      if (json) return failure("duplicate-json-chunk");
      if (chunkLength > maxJsonBytes) return failure("json-chunk-too-large");
      json = chunk;
    } else if (chunkType === GLB_BIN_CHUNK) {
      if (bin) return failure("duplicate-bin-chunk");
      bin = chunk;
    } else {
      return failure("unsupported-chunk-type");
    }
    offset = contentOffset + chunkLength;
    index += 1;
  }

  if (!json) return failure("missing-json-chunk");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(json.offset, json.offset + json.byteLength),
    );
  } catch {
    return failure("invalid-json-encoding");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return failure("invalid-json");
  }
  if (!isRecord(parsed)) return failure("invalid-gltf-root");
  const asset = parsed.asset;
  if (!isRecord(asset) || asset.version !== "2.0") {
    return failure("invalid-gltf-root");
  }
  return { root: parsed, jsonByteSize: json.byteLength, bin };
}

function hasExternalResourceUri(root: Record<string, unknown>): boolean | null {
  for (const key of ["buffers", "images"] as const) {
    const resources = readArray(root, key);
    if (!resources) return null;
    for (const resource of resources) {
      if (!isRecord(resource)) return null;
      if (Object.hasOwn(resource, "uri")) return true;
    }
  }
  return false;
}

function hasParsedBasisRuntimeEvidence(root: Record<string, unknown>): boolean {
  for (const extensionKey of ["extensionsUsed", "extensionsRequired"] as const) {
    const extensions = root[extensionKey];
    if (Array.isArray(extensions) && extensions.includes("KHR_texture_basisu")) return true;
  }
  const images = root.images;
  if (
    Array.isArray(images) &&
    images.some((image) => isRecord(image) && image.mimeType === "image/ktx2")
  ) return true;
  const textures = root.textures;
  return Array.isArray(textures) && textures.some((texture) => (
    isRecord(texture) && isRecord(texture.extensions) &&
    Object.hasOwn(texture.extensions, "KHR_texture_basisu")
  ));
}

function validateRequiredExtensions(
  root: Record<string, unknown>,
  supported: readonly string[],
  basisTranscoderCapability: unknown,
  basisPayloadPreflight: unknown,
): StudioBg3dGlbValidationFailure | null {
  const required = root.extensionsRequired;
  if (required === undefined) return null;
  if (!Array.isArray(required) || required.some((value) => typeof value !== "string")) {
    return failure("invalid-gltf-root");
  }
  const allowed = new Set(supported);
  return required.some((extension) => (
    !allowed.has(extension as string) ||
    (
      extension === "KHR_texture_basisu" &&
      (
        !isAttestedStudioBg3dKtx2TranscoderCapability(basisTranscoderCapability) ||
        typeof basisPayloadPreflight !== "function"
      )
    )
  ))
    ? failure("unsupported-required-extension")
    : null;
}

function parseBufferViews(
  bytes: Uint8Array,
  root: Record<string, unknown>,
  bin: GlbChunk | null,
): readonly BufferViewRange[] | StudioBg3dGlbValidationFailure {
  const buffers = readArray(root, "buffers");
  const rawViews = readArray(root, "bufferViews");
  if (!buffers || !rawViews) return failure("invalid-gltf-root");
  const meshoptRequired = Array.isArray(root.extensionsRequired)
    && root.extensionsRequired.includes("EXT_meshopt_compression");
  if (buffers.length === 0) {
    if (rawViews.length > 0 || bin) return failure("invalid-buffer");
    return [];
  }

  const bufferLengths: number[] = [];
  const placeholderBufferReferenced = new Array<boolean>(buffers.length).fill(false);
  for (let index = 0; index < buffers.length; index += 1) {
    const buffer = buffers[index];
    if (!isRecord(buffer) || Object.hasOwn(buffer, "uri") || !isSafeNonNegativeInteger(buffer.byteLength)) {
      return Object.hasOwn(isRecord(buffer) ? buffer : {}, "uri")
        ? failure("external-resource-uri")
        : failure("invalid-buffer");
    }
    const extensions = buffer.extensions;
    if (extensions !== undefined) {
      if (!isRecord(extensions)) return failure("invalid-buffer");
      const meshoptFallback = extensions.EXT_meshopt_compression;
      if (
        meshoptFallback !== undefined
        && (!isRecord(meshoptFallback) || meshoptFallback.fallback !== true)
      ) {
        return failure("invalid-buffer");
      }
    }
    bufferLengths.push(buffer.byteLength);
  }

  const embeddedBufferLength = bufferLengths[0] ?? 0;
  if (!bin && embeddedBufferLength > 0) return failure("missing-bin-chunk");
  if (bin && (bin.byteLength < embeddedBufferLength || bin.byteLength > embeddedBufferLength + 3)) {
    return failure("invalid-buffer");
  }
  if (!bin && rawViews.length > 0) return failure("missing-bin-chunk");

  const views: BufferViewRange[] = [];
  for (const rawView of rawViews) {
    if (!isRecord(rawView)) return failure("invalid-buffer-view");
    const bufferIndex = rawView.buffer;
    const byteOffset = rawView.byteOffset ?? 0;
    const byteLength = rawView.byteLength;
    const byteStride = rawView.byteStride;
    if (
      !isSafeNonNegativeInteger(bufferIndex) ||
      bufferIndex >= bufferLengths.length ||
      !isSafeNonNegativeInteger(byteOffset) ||
      !isSafePositiveInteger(byteLength) ||
      byteOffset > (bufferLengths[bufferIndex] ?? -1) ||
      byteLength > (bufferLengths[bufferIndex] ?? -1) - byteOffset ||
      (byteStride !== undefined && (
        !isSafePositiveInteger(byteStride) || byteStride < 4 || byteStride > 252 || byteStride % 4 !== 0
      ))
    ) {
      return failure("invalid-buffer-view");
    }

    const extensions = rawView.extensions;
    if (extensions !== undefined && !isRecord(extensions)) return failure("invalid-buffer-view");
    const meshopt = isRecord(extensions) ? extensions.EXT_meshopt_compression : undefined;
    if (meshopt === undefined) {
      if (bufferIndex !== 0 || !bin || byteLength > bin.byteLength - byteOffset) {
        return failure("invalid-buffer-view");
      }
      views.push(Object.freeze({
        logicalOffset: byteOffset,
        embeddedOffset: bin.offset + byteOffset,
        byteLength,
        byteStride: byteStride ?? null,
        meshoptCompressed: false,
      }));
      continue;
    }
    if (!isRecord(meshopt) || !bin) return failure("invalid-buffer-view");

    const compressedBuffer = meshopt.buffer;
    const compressedOffset = meshopt.byteOffset ?? 0;
    const compressedLength = meshopt.byteLength;
    const decodedStride = meshopt.byteStride;
    const decodedCount = meshopt.count;
    const mode = meshopt.mode;
    const filter = meshopt.filter ?? "NONE";
    const decodedLength = isSafePositiveInteger(decodedStride) && isSafePositiveInteger(decodedCount)
      ? safeMultiply(decodedStride, decodedCount)
      : null;
    if (
      compressedBuffer !== 0 ||
      !isSafeNonNegativeInteger(compressedOffset) ||
      !isSafePositiveInteger(compressedLength) ||
      !isSafePositiveInteger(decodedStride) ||
      !isSafePositiveInteger(decodedCount) ||
      decodedLength === null || decodedLength !== byteLength ||
      compressedOffset > embeddedBufferLength ||
      compressedLength > embeddedBufferLength - compressedOffset ||
      compressedLength > bin.byteLength - compressedOffset ||
      (byteStride !== undefined && byteStride !== decodedStride) ||
      (mode !== "ATTRIBUTES" && mode !== "TRIANGLES" && mode !== "INDICES") ||
      (filter !== "NONE" && filter !== "OCTAHEDRAL" && filter !== "QUATERNION" && filter !== "EXPONENTIAL")
    ) {
      return failure("invalid-buffer-view");
    }
    if (
      (mode === "ATTRIBUTES" && (decodedStride % 4 !== 0 || decodedStride > 256)) ||
      (mode === "TRIANGLES" && (decodedCount % 3 !== 0 || (decodedStride !== 2 && decodedStride !== 4))) ||
      (mode === "INDICES" && decodedStride !== 2 && decodedStride !== 4) ||
      ((mode === "TRIANGLES" || mode === "INDICES") && filter !== "NONE") ||
      (filter === "OCTAHEDRAL" && decodedStride !== 4 && decodedStride !== 8) ||
      (filter === "QUATERNION" && decodedStride !== 8) ||
      (filter === "EXPONENTIAL" && decodedStride % 4 !== 0)
    ) {
      return failure("invalid-buffer-view");
    }
    const expectedHeader = mode === "ATTRIBUTES" ? 0xa0 : mode === "TRIANGLES" ? 0xe1 : 0xd1;
    if (bytes[bin.offset + compressedOffset] !== expectedHeader) {
      return failure("invalid-buffer-view");
    }
    if (bufferIndex > 0) {
      if (!meshoptRequired) return failure("invalid-buffer-view");
      placeholderBufferReferenced[bufferIndex] = true;
    }
    views.push(Object.freeze({
      logicalOffset: byteOffset,
      embeddedOffset: null,
      byteLength,
      byteStride: byteStride ?? null,
      meshoptCompressed: true,
    }));
  }
  if (placeholderBufferReferenced.slice(1).some((referenced) => !referenced)) {
    return failure("invalid-buffer");
  }
  return Object.freeze(views);
}

function matchesSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.byteLength >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 24 || !matchesSignature(bytes, PNG_SIGNATURE)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 1 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return null;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) return null;
    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (segmentLength < 2 || segmentLength > bytes.byteLength - offset) return null;
    if (sofMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.byteLength < 30 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) {
    return null;
  }
  const kind = String.fromCharCode(...bytes.subarray(12, 16));
  if (kind === "VP8X") {
    const width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16);
    const height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16);
    return { width, height };
  }
  if (kind === "VP8L" && bytes[20] === 0x2f) {
    const width = 1 + (((bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8)) & 0x3fff);
    const height = 1 + ((((bytes[22] ?? 0) >> 6) | ((bytes[23] ?? 0) << 2) | ((bytes[24] ?? 0) << 10)) & 0x3fff);
    return { width, height };
  }
  if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    const width = ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff;
    const height = ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

function imageDimensions(mimeType: string, bytes: Uint8Array): ImageDimensions | null {
  switch (mimeType) {
    case "image/png":
      return pngDimensions(bytes);
    case "image/jpeg":
      return jpegDimensions(bytes);
    case "image/webp":
      return webpDimensions(bytes);
    default:
      return null;
  }
}

function validateTextureImageReferences(
  root: Record<string, unknown>,
  textures: readonly unknown[],
  images: readonly unknown[],
): StudioBg3dGlbValidationFailure | null {
  const usedRaw = root.extensionsUsed;
  const requiredRaw = root.extensionsRequired;
  if (
    (usedRaw !== undefined && (
      !Array.isArray(usedRaw) || usedRaw.some((extension) => typeof extension !== "string") ||
      new Set(usedRaw).size !== usedRaw.length
    )) ||
    (requiredRaw !== undefined && (
      !Array.isArray(requiredRaw) || requiredRaw.some((extension) => typeof extension !== "string") ||
      new Set(requiredRaw).size !== requiredRaw.length
    ))
  ) return failure("invalid-gltf-root");
  const used = new Set((usedRaw ?? []) as string[]);
  const required = new Set((requiredRaw ?? []) as string[]);
  if (Array.from(required).some((extension) => !used.has(extension))) {
    return failure("invalid-gltf-root");
  }
  const samplersRaw = root.samplers;
  if (samplersRaw !== undefined && (
    !Array.isArray(samplersRaw) || samplersRaw.some((sampler) => !isRecord(sampler))
  )) return failure("invalid-gltf-root");
  const samplers = (samplersRaw ?? []) as readonly unknown[];
  const basisImageIndices = new Set<number>();
  let usesBasisTexture = false;

  for (const texture of textures) {
    if (!isRecord(texture)) return failure("invalid-gltf-root");
    if (
      texture.sampler !== undefined && (
        !isSafeNonNegativeInteger(texture.sampler) || texture.sampler >= samplers.length
      )
    ) return failure("invalid-gltf-root");
    const coreSource = texture.source;
    if (
      coreSource !== undefined && (
        !isSafeNonNegativeInteger(coreSource) || coreSource >= images.length ||
        !isRecord(images[coreSource]) || images[coreSource].mimeType === "image/ktx2"
      )
    ) return failure("invalid-image");
    const extensions = texture.extensions;
    if (extensions !== undefined && !isRecord(extensions)) return failure("invalid-gltf-root");
    const basis = isRecord(extensions) ? extensions.KHR_texture_basisu : undefined;
    if (basis === undefined) {
      if (coreSource === undefined) return failure("invalid-image");
      continue;
    }
    if (!isRecord(basis) || !isSafeNonNegativeInteger(basis.source) || basis.source >= images.length) {
      return failure("invalid-image");
    }
    const basisImage = images[basis.source];
    if (!isRecord(basisImage) || basisImage.mimeType !== "image/ktx2" || !used.has("KHR_texture_basisu")) {
      return failure("invalid-image");
    }
    if (coreSource !== undefined) {
      const fallbackImage = images[coreSource];
      if (
        !isRecord(fallbackImage) ||
        (fallbackImage.mimeType !== "image/png" && fallbackImage.mimeType !== "image/jpeg")
      ) return failure("invalid-image");
    }
    if (coreSource === undefined && !required.has("KHR_texture_basisu")) {
      return failure("invalid-image");
    }
    usesBasisTexture = true;
    basisImageIndices.add(basis.source);
  }

  if (used.has("KHR_texture_basisu") !== usesBasisTexture) return failure("invalid-image");
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (isRecord(image) && image.mimeType === "image/ktx2" && !basisImageIndices.has(index)) {
      return failure("invalid-image");
    }
  }
  return null;
}

function accessorCount(accessors: readonly unknown[], index: unknown): number | null {
  if (!isSafeNonNegativeInteger(index) || index >= accessors.length) return null;
  const accessor = accessors[index];
  return isRecord(accessor) && isSafePositiveInteger(accessor.count) ? accessor.count : null;
}

function primitiveVertexCount(primitive: Record<string, unknown>, accessors: readonly unknown[]): number | null {
  if (primitive.indices !== undefined) return accessorCount(accessors, primitive.indices);
  const attributes = primitive.attributes;
  return isRecord(attributes) ? accessorCount(accessors, attributes.POSITION) : null;
}

function triangleCount(vertexCount: number, mode: number): number {
  if (mode === 4) return Math.floor(vertexCount / 3);
  if (mode === 5 || mode === 6) return Math.max(0, vertexCount - 2);
  return 0;
}

function gpuInstanceCount(node: Record<string, unknown>, accessors: readonly unknown[]): number | null {
  const extensions = node.extensions;
  if (extensions === undefined) return 1;
  if (!isRecord(extensions)) return null;
  const instancing = extensions.EXT_mesh_gpu_instancing;
  if (instancing === undefined) return 1;
  if (!isRecord(instancing) || !isRecord(instancing.attributes)) return null;
  const indices = Object.values(instancing.attributes);
  if (indices.length === 0) return null;
  let maximum = 0;
  for (const index of indices) {
    const count = accessorCount(accessors, index);
    if (count === null) return null;
    maximum = Math.max(maximum, count);
  }
  return maximum;
}

const ACCESSOR_TYPE_COMPONENTS: Readonly<Record<string, number>> = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
});

const ACCESSOR_COMPONENT_BYTES: Readonly<Record<number, number>> = Object.freeze({
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
});

const ACCESSOR_MATRIX_SHAPE: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  MAT2: Object.freeze([2, 2] as const),
  MAT3: Object.freeze([3, 3] as const),
  MAT4: Object.freeze([4, 4] as const),
});

interface AnimationAccessorDescriptor {
  readonly count: number;
  readonly type: string;
  readonly components: number;
  readonly componentType: number;
}

interface AccessorValidationSuccess {
  readonly accessorElements: number;
  readonly estimatedDecodedGeometryBytes: number;
  readonly estimatedOrdinaryDecodedGeometryBytes: number;
}

function accessorElementByteSize(type: string, components: number, componentBytes: number): number | null {
  const matrix = ACCESSOR_MATRIX_SHAPE[type];
  if (!matrix) return safeMultiply(components, componentBytes);
  const [columns, rows] = matrix;
  const columnBytes = safeMultiply(rows, componentBytes);
  if (columnBytes === null) return null;
  const alignedColumnBytes = Math.ceil(columnBytes / 4) * 4;
  return safeMultiply(columns, alignedColumnBytes);
}

function rangeContainsElements(
  view: BufferViewRange,
  byteOffset: number,
  elementBytes: number,
  count: number,
  stride: number,
): boolean {
  if (
    byteOffset > view.byteLength ||
    stride < elementBytes
  ) {
    return false;
  }
  const precedingBytes = safeMultiply(count - 1, stride);
  const requiredBytes = precedingBytes === null ? null : safeAdd(precedingBytes, elementBytes);
  return requiredBytes !== null && requiredBytes <= view.byteLength - byteOffset;
}

function validateAccessors(
  accessors: readonly unknown[],
  views: readonly BufferViewRange[],
): AccessorValidationSuccess | StudioBg3dGlbValidationFailure {
  let accessorElements = 0;
  let estimatedDecodedGeometryBytes = 0;
  let estimatedOrdinaryDecodedGeometryBytes = 0;
  for (const accessor of accessors) {
    if (!isRecord(accessor) || !isSafePositiveInteger(accessor.count)) {
      return failure("invalid-accessor");
    }
    const type = accessor.type;
    const componentType = accessor.componentType;
    const components = typeof type === "string" ? ACCESSOR_TYPE_COMPONENTS[type] : undefined;
    const componentBytes = isSafeNonNegativeInteger(componentType)
      ? ACCESSOR_COMPONENT_BYTES[componentType]
      : undefined;
    if (
      components === undefined ||
      componentBytes === undefined ||
      (accessor.normalized !== undefined && typeof accessor.normalized !== "boolean")
    ) {
      return failure("invalid-accessor");
    }
    const elementBytes = accessorElementByteSize(type as string, components, componentBytes);
    if (elementBytes === null) return failure("arithmetic-overflow");
    const byteOffset = accessor.byteOffset ?? 0;
    if (!isSafeNonNegativeInteger(byteOffset) || byteOffset % componentBytes !== 0) {
      return failure("invalid-accessor");
    }
    if (accessor.bufferView === undefined) {
      if (byteOffset !== 0) return failure("invalid-accessor");
    } else {
      if (!isSafeNonNegativeInteger(accessor.bufferView) || accessor.bufferView >= views.length) {
        return failure("invalid-accessor");
      }
      const view = views[accessor.bufferView];
      if (
        !view ||
        (view.logicalOffset + byteOffset) % componentBytes !== 0 ||
        (view.byteStride !== null && view.byteStride % componentBytes !== 0)
      ) {
        return failure("invalid-accessor");
      }
      const stride = view.byteStride ?? elementBytes;
      if (!rangeContainsElements(view, byteOffset, elementBytes, accessor.count, stride)) {
        return failure("invalid-accessor");
      }
    }

    for (const extrema of [accessor.min, accessor.max]) {
      if (
        extrema !== undefined &&
        (!Array.isArray(extrema) || extrema.length !== components || extrema.some(
          (entry) => typeof entry !== "number" || !Number.isFinite(entry),
        ))
      ) {
        return failure("invalid-accessor");
      }
    }

    if (accessor.sparse !== undefined) {
      const sparse = accessor.sparse;
      if (
        !isRecord(sparse) ||
        !isSafePositiveInteger(sparse.count) ||
        sparse.count > accessor.count ||
        !isRecord(sparse.indices) ||
        !isRecord(sparse.values)
      ) {
        return failure("invalid-accessor");
      }
      const indicesComponentType = sparse.indices.componentType;
      const indicesComponentBytes = isSafeNonNegativeInteger(indicesComponentType)
        ? ACCESSOR_COMPONENT_BYTES[indicesComponentType]
        : undefined;
      if (
        (indicesComponentType !== 5121 && indicesComponentType !== 5123 && indicesComponentType !== 5125) ||
        indicesComponentBytes === undefined ||
        !isSafeNonNegativeInteger(sparse.indices.bufferView) ||
        sparse.indices.bufferView >= views.length ||
        !isSafeNonNegativeInteger(sparse.values.bufferView) ||
        sparse.values.bufferView >= views.length
      ) {
        return failure("invalid-accessor");
      }
      const indicesView = views[sparse.indices.bufferView];
      const valuesView = views[sparse.values.bufferView];
      const indicesOffset = sparse.indices.byteOffset ?? 0;
      const valuesOffset = sparse.values.byteOffset ?? 0;
      if (
        !indicesView || !valuesView ||
        indicesView.byteStride !== null || valuesView.byteStride !== null ||
        !isSafeNonNegativeInteger(indicesOffset) || indicesOffset % indicesComponentBytes !== 0 ||
        !isSafeNonNegativeInteger(valuesOffset) || valuesOffset % componentBytes !== 0 ||
        (indicesView.logicalOffset + indicesOffset) % indicesComponentBytes !== 0 ||
        (valuesView.logicalOffset + valuesOffset) % componentBytes !== 0 ||
        !rangeContainsElements(
          indicesView,
          indicesOffset,
          indicesComponentBytes,
          sparse.count,
          indicesComponentBytes,
        ) ||
        !rangeContainsElements(valuesView, valuesOffset, elementBytes, sparse.count, elementBytes)
      ) {
        return failure("invalid-accessor");
      }
    }

    const decodedBytes = safeMultiply(accessor.count, elementBytes);
    const nextElements = safeAdd(accessorElements, accessor.count);
    const nextDecodedBytes = decodedBytes === null
      ? null
      : safeAdd(estimatedDecodedGeometryBytes, decodedBytes);
    const primaryView = accessor.bufferView === undefined
      ? null
      : views[accessor.bufferView as number];
    // Meshopt buffer-view output is charged once at the view level below. Ordinary/zero-filled
    // accessors still need their own decoded allocation, and sparse patching can materialize a
    // distinct accessor even when its base view was Meshopt-compressed.
    const ordinaryDecodedBytes = primaryView?.meshoptCompressed === true && accessor.sparse === undefined
      ? 0
      : decodedBytes;
    const nextOrdinaryDecodedBytes = ordinaryDecodedBytes === null
      ? null
      : safeAdd(estimatedOrdinaryDecodedGeometryBytes, ordinaryDecodedBytes);
    if (
      nextElements === null ||
      nextDecodedBytes === null ||
      nextOrdinaryDecodedBytes === null
    ) {
      return failure("arithmetic-overflow");
    }
    accessorElements = nextElements;
    estimatedDecodedGeometryBytes = nextDecodedBytes;
    estimatedOrdinaryDecodedGeometryBytes = nextOrdinaryDecodedBytes;
  }
  return Object.freeze({
    accessorElements,
    estimatedDecodedGeometryBytes,
    estimatedOrdinaryDecodedGeometryBytes,
  });
}

function animationAccessorDescriptor(
  accessors: readonly unknown[],
  index: unknown,
): AnimationAccessorDescriptor | null {
  if (!isSafeNonNegativeInteger(index) || index >= accessors.length) return null;
  const accessor = accessors[index];
  if (!isRecord(accessor) || !isSafePositiveInteger(accessor.count)) return null;
  const type = accessor.type;
  const componentType = accessor.componentType;
  if (typeof type !== "string" || !isSafeNonNegativeInteger(componentType)) return null;
  const components = ACCESSOR_TYPE_COMPONENTS[type];
  return components === undefined
    ? null
    : Object.freeze({ count: accessor.count, type, components, componentType });
}

async function collectMetrics(
  bytes: Uint8Array,
  root: Record<string, unknown>,
  bin: GlbChunk | null,
  basisPayloadPreflight?: StudioBg3dBasisPayloadPreflight,
): Promise<CountResult> {
  const views = parseBufferViews(bytes, root, bin);
  if ("ok" in views) return { failure: views };

  const nodes = readArray(root, "nodes");
  const meshes = readArray(root, "meshes");
  const accessors = readArray(root, "accessors");
  const materials = readArray(root, "materials");
  const textures = readArray(root, "textures");
  const images = readArray(root, "images");
  const animations = readArray(root, "animations");
  const skins = readArray(root, "skins");
  if (!nodes || !meshes || !accessors || !materials || !textures || !images || !animations || !skins) {
    return { failure: failure("invalid-gltf-root") };
  }
  const validatedAccessors = validateAccessors(accessors, views);
  if ("ok" in validatedAccessors) return { failure: validatedAccessors };
  let meshoptDecodedBytes = 0;
  for (const view of views) {
    if (!view.meshoptCompressed) continue;
    const next = safeAdd(meshoptDecodedBytes, view.byteLength);
    if (next === null) return { failure: failure("arithmetic-overflow") };
    meshoptDecodedBytes = next;
  }
  const estimatedDecodedGeometryBytes = safeAdd(
    validatedAccessors.estimatedOrdinaryDecodedGeometryBytes,
    meshoptDecodedBytes,
  );
  if (estimatedDecodedGeometryBytes === null) {
    return { failure: failure("arithmetic-overflow") };
  }

  const meshInstances = new Array<number>(meshes.length).fill(0);
  for (const node of nodes) {
    if (!isRecord(node)) return { failure: failure("invalid-node") };
    if (node.mesh === undefined) continue;
    if (!isSafeNonNegativeInteger(node.mesh) || node.mesh >= meshes.length) {
      return { failure: failure("invalid-node") };
    }
    const instances = gpuInstanceCount(node, accessors);
    if (instances === null) return { failure: failure("invalid-node") };
    const total = safeAdd(meshInstances[node.mesh] ?? 0, instances);
    if (total === null) return { failure: failure("arithmetic-overflow") };
    meshInstances[node.mesh] = total;
  }

  let meshPrimitives = 0;
  let drawCalls = 0;
  let triangles = 0;
  let morphTargets = 0;
  let usesDefaultMaterial = false;
  const meshMorphTargetCounts = new Array<number>(meshes.length).fill(0);
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex];
    if (!isRecord(mesh) || !Array.isArray(mesh.primitives) || mesh.primitives.length === 0) {
      return { failure: failure("invalid-mesh") };
    }
    const instanceCount = Math.max(1, meshInstances[meshIndex] ?? 0);
    let meshMorphTargetCount: number | null = null;
    for (const rawPrimitive of mesh.primitives) {
      if (!isRecord(rawPrimitive)) return { failure: failure("invalid-mesh") };
      const mode = rawPrimitive.mode ?? 4;
      if (!isSafeNonNegativeInteger(mode) || mode > 6) return { failure: failure("invalid-mesh") };
      const vertices = primitiveVertexCount(rawPrimitive, accessors);
      if (vertices === null) return { failure: failure("invalid-accessor") };
      const attributes = rawPrimitive.attributes;
      const positionVertices = isRecord(attributes)
        ? accessorCount(accessors, attributes.POSITION)
        : null;
      if (positionVertices === null) return { failure: failure("invalid-accessor") };
      const rawTargets = rawPrimitive.targets;
      const targets = rawTargets === undefined ? [] : Array.isArray(rawTargets) ? rawTargets : null;
      if (!targets) return { failure: failure("invalid-mesh") };
      if (meshMorphTargetCount === null) meshMorphTargetCount = targets.length;
      else if (meshMorphTargetCount !== targets.length) return { failure: failure("invalid-mesh") };
      for (const target of targets) {
        if (!isRecord(target) || Object.keys(target).length === 0) {
          return { failure: failure("invalid-mesh") };
        }
        for (const [semantic, accessorIndex] of Object.entries(target)) {
          if (semantic !== "POSITION" && semantic !== "NORMAL" && semantic !== "TANGENT") {
            return { failure: failure("invalid-mesh") };
          }
          if (accessorCount(accessors, accessorIndex) !== positionVertices) {
            return { failure: failure("invalid-accessor") };
          }
        }
        const nextMorphTargets = safeAdd(morphTargets, 1);
        if (nextMorphTargets === null) return { failure: failure("arithmetic-overflow") };
        morphTargets = nextMorphTargets;
      }
      if (rawPrimitive.material === undefined) usesDefaultMaterial = true;
      else if (!isSafeNonNegativeInteger(rawPrimitive.material) || rawPrimitive.material >= materials.length) {
        return { failure: failure("invalid-mesh") };
      }
      const nextPrimitives = safeAdd(meshPrimitives, 1);
      const nextDrawCalls = safeAdd(drawCalls, instanceCount);
      const instantiatedTriangles = safeMultiply(triangleCount(vertices, mode), instanceCount);
      const nextTriangles = instantiatedTriangles === null ? null : safeAdd(triangles, instantiatedTriangles);
      if (nextPrimitives === null || nextDrawCalls === null || nextTriangles === null) {
        return { failure: failure("arithmetic-overflow") };
      }
      meshPrimitives = nextPrimitives;
      drawCalls = nextDrawCalls;
      triangles = nextTriangles;
    }
    meshMorphTargetCounts[meshIndex] = meshMorphTargetCount ?? 0;
  }

  let joints = 0;
  for (const skin of skins) {
    if (!isRecord(skin) || !Array.isArray(skin.joints) || skin.joints.length === 0) {
      return { failure: failure("invalid-skin") };
    }
    const uniqueJoints = new Set<number>();
    for (const joint of skin.joints) {
      if (!isSafeNonNegativeInteger(joint) || joint >= nodes.length || uniqueJoints.has(joint)) {
        return { failure: failure("invalid-skin") };
      }
      uniqueJoints.add(joint);
    }
    if (skin.skeleton !== undefined && (!isSafeNonNegativeInteger(skin.skeleton) || skin.skeleton >= nodes.length)) {
      return { failure: failure("invalid-skin") };
    }
    if (skin.inverseBindMatrices !== undefined) {
      const inverseBindMatrices = animationAccessorDescriptor(accessors, skin.inverseBindMatrices);
      if (
        !inverseBindMatrices ||
        inverseBindMatrices.componentType !== 5126 ||
        inverseBindMatrices.type !== "MAT4" ||
        inverseBindMatrices.count !== skin.joints.length
      ) {
        return { failure: failure("invalid-skin") };
      }
    }
    const nextJoints = safeAdd(joints, skin.joints.length);
    if (nextJoints === null) return { failure: failure("arithmetic-overflow") };
    joints = nextJoints;
  }

  for (const node of nodes) {
    if (!isRecord(node)) return { failure: failure("invalid-node") };
    if (node.skin !== undefined) {
      if (!isSafeNonNegativeInteger(node.skin) || node.skin >= skins.length || node.mesh === undefined) {
        return { failure: failure("invalid-skin") };
      }
    }
  }

  let animationChannels = 0;
  let animationKeyframes = 0;
  let animationValues = 0;
  for (const animation of animations) {
    if (
      !isRecord(animation) ||
      !Array.isArray(animation.samplers) ||
      !Array.isArray(animation.channels) ||
      animation.samplers.length === 0 ||
      animation.channels.length === 0
    ) {
      return { failure: failure("invalid-animation") };
    }
    for (const sampler of animation.samplers) {
      if (!isRecord(sampler)) return { failure: failure("invalid-animation") };
      const interpolation = sampler.interpolation ?? "LINEAR";
      if (interpolation !== "LINEAR" && interpolation !== "STEP" && interpolation !== "CUBICSPLINE") {
        return { failure: failure("invalid-animation") };
      }
      const input = animationAccessorDescriptor(accessors, sampler.input);
      const output = animationAccessorDescriptor(accessors, sampler.output);
      if (
        !input || !output ||
        input.componentType !== 5126 || input.type !== "SCALAR" ||
        output.componentType !== 5126
      ) {
        return { failure: failure("invalid-animation") };
      }
    }
    for (const channel of animation.channels) {
      if (
        !isRecord(channel) ||
        !isSafeNonNegativeInteger(channel.sampler) ||
        channel.sampler >= animation.samplers.length ||
        !isRecord(channel.target) ||
        !isSafeNonNegativeInteger(channel.target.node) ||
        channel.target.node >= nodes.length
      ) {
        return { failure: failure("invalid-animation") };
      }
      const sampler = animation.samplers[channel.sampler];
      if (!isRecord(sampler)) return { failure: failure("invalid-animation") };
      const input = animationAccessorDescriptor(accessors, sampler.input);
      const output = animationAccessorDescriptor(accessors, sampler.output);
      if (!input || !output) return { failure: failure("invalid-animation") };
      const interpolationMultiplier = sampler.interpolation === "CUBICSPLINE" ? 3 : 1;
      const targetPath = channel.target.path;
      let expectedOutputCount: number | null;
      if (targetPath === "translation" || targetPath === "scale") {
        if (output.type !== "VEC3") return { failure: failure("invalid-animation") };
        expectedOutputCount = safeMultiply(input.count, interpolationMultiplier);
      } else if (targetPath === "rotation") {
        if (output.type !== "VEC4") return { failure: failure("invalid-animation") };
        expectedOutputCount = safeMultiply(input.count, interpolationMultiplier);
      } else if (targetPath === "weights") {
        if (output.type !== "SCALAR") return { failure: failure("invalid-animation") };
        const targetNode = nodes[channel.target.node];
        if (!isRecord(targetNode) || !isSafeNonNegativeInteger(targetNode.mesh)) {
          return { failure: failure("invalid-animation") };
        }
        const targetCount = meshMorphTargetCounts[targetNode.mesh];
        if (!targetCount) return { failure: failure("invalid-animation") };
        const keyTargetCount = safeMultiply(input.count, targetCount);
        expectedOutputCount = keyTargetCount === null
          ? null
          : safeMultiply(keyTargetCount, interpolationMultiplier);
      } else {
        return { failure: failure("invalid-animation") };
      }
      if (expectedOutputCount === null) return { failure: failure("arithmetic-overflow") };
      if (output.count !== expectedOutputCount) return { failure: failure("invalid-animation") };
      const outputScalars = safeMultiply(output.count, output.components);
      const nextChannels = safeAdd(animationChannels, 1);
      const nextKeyframes = safeAdd(animationKeyframes, input.count);
      const nextValues = outputScalars === null ? null : safeAdd(animationValues, outputScalars);
      if (nextChannels === null || nextKeyframes === null || nextValues === null) {
        return { failure: failure("arithmetic-overflow") };
      }
      animationChannels = nextChannels;
      animationKeyframes = nextKeyframes;
      animationValues = nextValues;
    }
  }

  for (const material of materials) if (!isRecord(material)) return { failure: failure("invalid-gltf-root") };
  for (const texture of textures) if (!isRecord(texture)) return { failure: failure("invalid-gltf-root") };
  // Reject extension/reference topology before paying for any WASM pretranscode.
  const textureReferenceFailure = validateTextureImageReferences(root, textures, images);
  if (textureReferenceFailure) return { failure: textureReferenceFailure };

  let imageBytes = 0;
  let estimatedDecodedImageBytes = 0;
  let maxImageDimension = 0;
  let undeterminedImageDimensions = 0;
  let usesBasisTextures = false;
  for (const image of images) {
    if (!isRecord(image) || Object.hasOwn(image, "uri")) {
      return { failure: failure(Object.hasOwn(isRecord(image) ? image : {}, "uri") ? "external-resource-uri" : "invalid-image") };
    }
    if (!isSafeNonNegativeInteger(image.bufferView) || image.bufferView >= views.length) {
      return { failure: failure("invalid-image") };
    }
    const mimeType = image.mimeType;
    if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp" && mimeType !== "image/ktx2") {
      return { failure: failure("invalid-image") };
    }
    const range = views[image.bufferView];
    if (!range || range.meshoptCompressed || range.embeddedOffset === null) {
      return { failure: failure("invalid-image") };
    }
    const nextImageBytes = safeAdd(imageBytes, range.byteLength);
    if (nextImageBytes === null) return { failure: failure("arithmetic-overflow") };
    imageBytes = nextImageBytes;
    const imageData = bytes.subarray(range.embeddedOffset, range.embeddedOffset + range.byteLength);
    const basisInfo = mimeType === "image/ktx2"
      ? inspectStudioBg3dBasisKtx2(imageData)
      : null;
    if (mimeType === "image/ktx2" && !basisInfo) {
      return { failure: failure("invalid-image") };
    }
    if (basisInfo) usesBasisTextures = true;
    if (basisInfo && basisPayloadPreflight) {
      try {
        if (!await basisPayloadPreflight(Uint8Array.from(imageData), basisInfo)) {
          return { failure: failure("basis-transcode-failed") };
        }
      } catch {
        return { failure: failure("basis-transcode-failed") };
      }
    }
    const dimensions = basisInfo ?? imageDimensions(mimeType, imageData);
    if (dimensions) {
      maxImageDimension = Math.max(maxImageDimension, dimensions.width, dimensions.height);
      const pixels = basisInfo ? null : safeMultiply(dimensions.width, dimensions.height);
      const decodedBytes = basisInfo?.estimatedDecodedBytes ?? (
        pixels === null ? null : safeMultiply(pixels, 4)
      );
      const nextDecodedBytes = decodedBytes === null
        ? null
        : safeAdd(estimatedDecodedImageBytes, decodedBytes);
      if (nextDecodedBytes === null) return { failure: failure("arithmetic-overflow") };
      estimatedDecodedImageBytes = nextDecodedBytes;
    } else undeterminedImageDimensions += 1;
  }
  let lights = 0;
  const rootExtensions = root.extensions;
  if (rootExtensions !== undefined) {
    if (!isRecord(rootExtensions)) return { failure: failure("invalid-gltf-root") };
    const punctual = rootExtensions.KHR_lights_punctual;
    if (punctual !== undefined) {
      if (!isRecord(punctual) || !Array.isArray(punctual.lights) || punctual.lights.some((light) => !isRecord(light))) {
        return { failure: failure("invalid-gltf-root") };
      }
      lights = punctual.lights.length;
    }
  }

  const materialCount = materials.length + (usesDefaultMaterial ? 1 : 0);
  if (!Number.isSafeInteger(materialCount)) return { failure: failure("arithmetic-overflow") };
  return {
    usesBasisTextures,
    metrics: Object.freeze({
      nodes: nodes.length,
      meshes: meshes.length,
      meshPrimitives,
      drawCalls,
      triangles,
      materials: materialCount,
      textures: textures.length,
      images: images.length,
      imageBytes,
      estimatedDecodedImageBytes,
      maxImageDimension,
      undeterminedImageDimensions,
      lights,
      animations: animations.length,
      animationChannels,
      animationKeyframes,
      animationValues,
      skins: skins.length,
      joints,
      morphTargets,
      accessorElements: validatedAccessors.accessorElements,
      // Charge ordinary accessor allocations and every Meshopt view output together. Accessors
      // backed solely by a Meshopt view were excluded from the ordinary subtotal, so mixed files
      // cannot hide a second large allocation behind Math.max while compressed views are not
      // double-counted merely because several accessors reference them.
      estimatedDecodedGeometryBytes,
    }),
  };
}

function enforceBudgets(
  metrics: StudioBg3dGlbMetrics,
  budget: StudioBg3dGlbValidationBudget,
): StudioBg3dGlbValidationFailure | null {
  if (metrics.nodes > budget.complexity.maxNodes) return failure("node-budget-exceeded");
  if (metrics.triangles > budget.complexity.maxTriangles) return failure("triangle-budget-exceeded");
  if (metrics.drawCalls > budget.complexity.maxDrawCalls) return failure("draw-call-budget-exceeded");
  if (metrics.materials > budget.complexity.maxMaterials) return failure("material-budget-exceeded");
  if (metrics.lights > budget.complexity.maxLights) return failure("light-budget-exceeded");
  if (metrics.animations > budget.complexity.maxAnimations) return failure("animation-count-budget-exceeded");
  if (metrics.animationChannels > budget.complexity.maxAnimationChannels) return failure("animation-channel-budget-exceeded");
  if (metrics.animationKeyframes > budget.complexity.maxAnimationKeyframes) return failure("animation-keyframe-budget-exceeded");
  if (metrics.animationValues > budget.complexity.maxAnimationValues) return failure("animation-value-budget-exceeded");
  if (metrics.skins > budget.complexity.maxSkins) return failure("skin-count-budget-exceeded");
  if (metrics.joints > budget.complexity.maxJoints) return failure("joint-count-budget-exceeded");
  if (metrics.morphTargets > budget.complexity.maxMorphTargets) return failure("morph-target-budget-exceeded");
  if (metrics.accessorElements > budget.complexity.maxAccessorElements) return failure("accessor-element-budget-exceeded");
  if (metrics.estimatedDecodedGeometryBytes > budget.complexity.maxDecodedGeometryBytes) {
    return failure("geometry-memory-budget-exceeded");
  }
  if (metrics.textures > budget.textures.maxTextures) return failure("texture-count-budget-exceeded");
  if (
    Math.max(metrics.imageBytes, metrics.estimatedDecodedImageBytes) >
    budget.textures.maxTotalBytes
  ) {
    return failure("texture-byte-budget-exceeded");
  }
  if (metrics.maxImageDimension > budget.textures.maxDimension) return failure("texture-dimension-budget-exceeded");
  return null;
}

/**
 * Validates a complete, self-contained GLB before any renderer-specific parsing.
 *
 * The input is snapshotted after cheap byte/metadata guards so an async digest cannot be followed by
 * parsing caller-mutated bytes (a browser-side time-of-check/time-of-use race).
 */
export async function validateStudioBg3dGlb(
  input: ArrayBuffer | Uint8Array,
  options: StudioBg3dGlbValidationOptions,
): Promise<StudioBg3dGlbValidationResult> {
  if (!(input instanceof ArrayBuffer) && !(input instanceof Uint8Array)) return failure("invalid-input");
  if (!isRecord(options) || (options.profile !== "mobile" && options.profile !== "desktop")) {
    return failure("invalid-options");
  }
  if (
    options.basisPayloadPreflight !== undefined &&
    typeof options.basisPayloadPreflight !== "function"
  ) return failure("invalid-options");
  if (
    options.basisRuntimeProvider !== undefined &&
    (
      typeof options.basisRuntimeProvider !== "function" ||
      options.basisPayloadPreflight !== undefined ||
      options.basisTranscoderCapability !== undefined
    )
  ) return failure("invalid-options");
  const profileBudget = options.budgets?.[options.profile];
  if (
    !validBudget(profileBudget) ||
    !isRecord(options.cumulative) ||
    !isSafeNonNegativeInteger(options.cumulative.usedBytes) ||
    !isSafePositiveInteger(options.cumulative.maximumBytes) ||
    options.cumulative.usedBytes > options.cumulative.maximumBytes
  ) {
    return failure("invalid-options");
  }
  const declaredHash = normalizedDeclaredHash(options.declared?.sha256);
  if (
    !isRecord(options.declared) ||
    !isSafeNonNegativeInteger(options.declared.byteSize) ||
    !declaredHash
  ) {
    return failure("invalid-declared-metadata");
  }
  if (options.declared.mimeType !== undefined && options.declared.mimeType !== STUDIO_BG3D_GLB_MIME_TYPE) {
    return failure("mime-type-mismatch");
  }

  const byteLength = input.byteLength;
  if (byteLength !== options.declared.byteSize) return failure("byte-size-mismatch");
  if (byteLength > STUDIO_BG3D_GLB_MAX_BYTES) return failure("file-too-large");
  if (byteLength > profileBudget.complexity.maxModelBytes) return failure("model-byte-budget-exceeded");
  if (byteLength > options.cumulative.maximumBytes - options.cumulative.usedBytes) {
    return failure("cumulative-byte-budget-exceeded");
  }

  const source = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const bytes = Uint8Array.from(source);
  // Digest implementations receive a separate copy, so even an injected adapter cannot mutate the
  // canonical snapshot that will later be returned to the renderer boundary.
  const digestResult = await calculateDigest(Uint8Array.from(bytes), options.digest);
  if (digestResult.unavailable) return failure("digest-unavailable");
  if (!digestResult.digest) return failure("digest-failed");
  if (!constantTimeHexEqual(digestResult.digest, declaredHash)) return failure("hash-mismatch");

  const configuredJsonBytes = options.maxJsonBytes ?? STUDIO_BG3D_GLB_MAX_JSON_BYTES;
  if (!isSafePositiveInteger(configuredJsonBytes)) return failure("invalid-options");
  const parsed = parseContainer(bytes, Math.min(configuredJsonBytes, STUDIO_BG3D_GLB_MAX_JSON_BYTES));
  if ("ok" in parsed) return parsed;

  let basisTranscoderCapability = options.basisTranscoderCapability;
  let basisPayloadPreflight = options.basisPayloadPreflight;
  if (
    options.basisRuntimeProvider &&
    hasParsedBasisRuntimeEvidence(parsed.root)
  ) {
    try {
      const runtime = await options.basisRuntimeProvider();
      if (
        runtime && typeof runtime === "object" &&
        typeof runtime.preflight === "function"
      ) {
        basisTranscoderCapability = runtime.capability;
        basisPayloadPreflight = runtime.preflight;
      } else {
        basisPayloadPreflight = async () => false;
      }
    } catch {
      basisPayloadPreflight = async () => false;
    }
  }

  const requiredExtensionFailure = validateRequiredExtensions(
    parsed.root,
    options.supportedRequiredExtensions ?? [],
    basisTranscoderCapability,
    basisPayloadPreflight,
  );
  if (requiredExtensionFailure) return requiredExtensionFailure;
  const externalResource = hasExternalResourceUri(parsed.root);
  if (externalResource === null) return failure("invalid-gltf-root");
  if (externalResource) return failure("external-resource-uri");

  const collected = await collectMetrics(
    bytes,
    parsed.root,
    parsed.bin,
    basisPayloadPreflight,
  );
  if (collected.failure || !collected.metrics) return collected.failure ?? failure("invalid-gltf-root");
  const metrics: StudioBg3dGlbMetrics = Object.freeze({
    byteSize: byteLength,
    jsonByteSize: parsed.jsonByteSize,
    binByteSize: parsed.bin?.byteLength ?? 0,
    ...collected.metrics,
  });
  const budgetFailure = enforceBudgets(metrics, profileBudget);
  if (budgetFailure) return budgetFailure;

  return Object.freeze({
    ok: true,
    code: "valid",
    message: "3D 모델의 무결성·내장 리소스·기기 복잡도 검사를 통과했습니다.",
    profile: options.profile,
    verifiedSha256: `sha256:${digestResult.digest}`,
    verifiedBytes: bytes,
    cumulativeBytesAfter: options.cumulative.usedBytes + byteLength,
    usesBasisTextures: collected.usesBasisTextures === true,
    requiresBasisTextures: Array.isArray(parsed.root.extensionsRequired)
      && parsed.root.extensionsRequired.includes("KHR_texture_basisu"),
    metrics,
  });
}
