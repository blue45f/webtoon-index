import { buildStudioPackageArchiveBlob } from "../studio-package-archive";
import { compareStudioValidationStrings } from "../studio-validation-string-order";

import {
  verifyStudioBg3dLayeredPsdFile,
  verifyStudioBg3dOpaqueRgb8PngFile,
  verifyStudioBg3dRgba8PngFile,
} from "./studio-bg3d-file-integrity";
import { resolveStudioBg3dLtCaptureSize } from "./studio-bg3d-lt-capture-size";
import { STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION } from "./studio-bg3d-shot-batch-limits";
import {
  STUDIO_BG3D_SHOT_BATCH_MAX_FILES,
  STUDIO_BG3D_SHOT_BATCH_PASSES,
  STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_PIXELS,
  STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_SOURCE_DIMENSION,
  STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
  computeStudioBg3dShotBatchRenderDigest,
  hydrateStudioBg3dShotBatchPlan,
  verifyStudioBg3dShotBatchSourceRevision,
  type StudioBg3dShotBatchPlan,
  type StudioBg3dShotBatchPass,
} from "./studio-bg3d-shot-batch-plan";
import {
  STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHOTS,
  STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_OUTPUT_BYTES,
  type StudioBg3dShotContactSheetOutput,
} from "./studio-bg3d-shot-contact-sheet-contract";
import {
  STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_SHOT_PSD_MIME,
} from "./studio-bg3d-shot-psd-contract";

import type { StudioCrc32ExecutionMode } from "../studio-crc32-worker-client";

export const STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS = 64;
export const STUDIO_BG3D_SHOT_BATCH_MAX_ARTIFACTS = STUDIO_BG3D_SHOT_BATCH_MAX_FILES;
export const STUDIO_BG3D_SHOT_BATCH_MAX_ARCHIVE_ARTIFACTS =
  STUDIO_BG3D_SHOT_BATCH_MAX_ARTIFACTS + STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS * 2;
export const STUDIO_BG3D_SHOT_BATCH_MAX_IMAGE_BYTES = 24 * 1024 * 1024;
export const STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES = 384 * 1024 * 1024;
export { STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION } from "./studio-bg3d-shot-batch-limits";

export interface StudioBg3dShotBatchImage {
  readonly shotId: string;
  readonly shotName: string;
  readonly width: number;
  readonly height: number;
  /** Explicit v2 artifact identity. Omit only for a backwards-compatible v1 archive. */
  readonly pass?: StudioBg3dShotBatchPass;
  /** @deprecated v1 compatibility alias. New callers must use `pass`. */
  readonly output?: "beauty" | "lt-composite";
  /** Requested maximum height before device/raster budgets are applied. */
  readonly requestedHeight?: number;
  /** True when the actual artifact height is lower than `requestedHeight`. */
  readonly wasReduced?: boolean;
  readonly png: Blob;
}

export interface StudioBg3dShotBatchSkippedArtifact {
  readonly shotId: string;
  readonly shotName: string;
  readonly pass: StudioBg3dShotBatchPass;
  readonly reason: "disabled" | "unavailable";
}

export interface StudioBg3dShotBatchLayeredPsd {
  readonly shotId: string;
  readonly shotName: string;
  readonly width: number;
  readonly height: number;
  readonly psd: Blob;
}

export interface StudioBg3dShotBatchPsdFallback {
  readonly shotId: string;
  readonly shotName: string;
  readonly reason: "budget" | "unavailable" | "worker-failed";
}

export type StudioBg3dShotBatchContactSheet = StudioBg3dShotContactSheetOutput;

export type StudioBg3dShotBatchContactSheetFallback =
  | "budget"
  | "source-unavailable"
  | "unavailable"
  | "worker-failed";

export const STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_KIND =
  "toonspectrum-bg3d-shot-batch-public-render-plan";
export const STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_VERSION = 1;
export const STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1 =
  "toonspectrum-studio-bg3d-shot-batch-plan-v2";
export const STUDIO_BG3D_SHOT_BATCH_DEPTH_ENCODING_V1 =
  "normalized-device-depth-u8-near-black-far-white-v1";
export const STUDIO_BG3D_SHOT_BATCH_PSD_PROFILE_V1 =
  STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1;
export const STUDIO_BG3D_SHOT_BATCH_CONTACT_SHEET_PROFILE_V1 =
  "studio-bg3d-contact-sheet-srgb-opaque-rgb8-v1";
export const STUDIO_BG3D_SHOT_BATCH_ARCHIVE_PROFILE_V1 =
  "studio-bg3d-shot-batch-zip-store-manifest-v3";

export interface StudioBg3dShotBatchPublicRenderImplementation {
  readonly appProfileId: string;
  readonly engineId: StudioBg3dShotBatchPlan["captureOwner"]["engineId"];
  readonly engineRevision: string;
  readonly adapterImplementationRevision: string;
  readonly graphicsApi: StudioBg3dShotBatchPlan["captureOwner"]["graphicsApi"];
  readonly backend: StudioBg3dShotBatchPlan["captureOwner"]["backend"];
}

export interface StudioBg3dShotBatchPublicCaptureProfile {
  readonly profileId: string;
  readonly ltPipelineId: string;
  readonly pngEncodingId: string;
  readonly depthEncodingId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly maxPixels: number;
  readonly maxEdge: number;
  readonly deviceProfile: "mobile" | "desktop";
  readonly textureScale: number;
  readonly lodBias: number;
}

export interface StudioBg3dShotBatchPublicArtifactProfiles {
  readonly psdProfileId: string;
  readonly contactSheetProfileId: string;
  readonly archiveProfileId: string;
}

export interface StudioBg3dShotBatchPublicFrozenCaptureSpec {
  readonly width: number;
  readonly height: number;
  readonly requestedHeight: number;
  readonly wasReduced: boolean;
  readonly includeDepth: boolean;
  readonly shadows: boolean;
  readonly shadowMapSize: 0 | 256 | 512 | 1024 | 2048 | 4096;
  readonly background: {
    readonly color: string;
    readonly alpha: 0 | 1;
  };
}

export interface StudioBg3dShotBatchPublicPlannedFile {
  readonly shotId: string;
  readonly shotName: string;
  readonly shotIndex: number;
  readonly pass: StudioBg3dShotBatchPass;
  readonly path: string;
}

export interface StudioBg3dShotBatchPublicPlannedShot {
  readonly shotId: string;
  readonly shotName: string;
  readonly shotIndex: number;
  readonly capture: StudioBg3dShotBatchPublicFrozenCaptureSpec;
  readonly files: readonly StudioBg3dShotBatchPublicPlannedFile[];
}

/**
 * Public, engine-neutral projection of Plan v2. It deliberately has no recovery partition,
 * authorization/work/page/element ids, resume key, or canonical source bytes.
 */
export interface StudioBg3dShotBatchPublicRenderPlan {
  readonly kind: typeof STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_KIND;
  readonly version: typeof STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_VERSION;
  readonly sourceDigest: string;
  /** Plan v2's scope-independent `planDigest`, renamed to make its public purpose explicit. */
  readonly renderDigest: string;
  readonly implementation: StudioBg3dShotBatchPublicRenderImplementation;
  readonly captureProfile: StudioBg3dShotBatchPublicCaptureProfile;
  readonly artifactProfiles: StudioBg3dShotBatchPublicArtifactProfiles;
  readonly passes: readonly StudioBg3dShotBatchPass[];
  readonly exportHeight: "per-shot" | number;
  readonly artifactRequests: {
    readonly layeredPsd: boolean;
    readonly contactSheet: boolean;
  };
  readonly shots: readonly StudioBg3dShotBatchPublicPlannedShot[];
}

export type StudioBg3dShotBatchPublicRenderPlanInput = StudioBg3dShotBatchPublicRenderPlan;

export interface StudioBg3dShotBatchPublicRenderProjectionOptions {
  readonly appProfileId: string;
  /** Private canonical source used only to verify `sourceDigest`; never copied into the projection. */
  readonly sourceRevision: string;
}

export interface StudioBg3dShotBatchLegacyManifestContext {
  readonly publicRenderPlan?: never;
  readonly resumeKey?: string;
  readonly shots?: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly requestedPasses?: readonly StudioBg3dShotBatchPass[];
  readonly resolution?:
    | { readonly mode: "per-shot-maximum" }
    | { readonly mode: "maximum-height"; readonly height: number };
  readonly skippedArtifacts?: readonly StudioBg3dShotBatchSkippedArtifact[];
  readonly psdFallbacks?: readonly StudioBg3dShotBatchPsdFallback[];
  readonly layeredPsdRequested?: boolean;
  readonly contactSheetRequested?: boolean;
  readonly contactSheetFallback?: StudioBg3dShotBatchContactSheetFallback;
}

export interface StudioBg3dShotBatchPublicManifestContext {
  readonly publicRenderPlan: StudioBg3dShotBatchPublicRenderPlan;
  readonly skippedArtifacts?: readonly StudioBg3dShotBatchSkippedArtifact[];
  readonly psdFallbacks?: readonly StudioBg3dShotBatchPsdFallback[];
  readonly contactSheetFallback?: StudioBg3dShotBatchContactSheetFallback;
  readonly resumeKey?: never;
  readonly shots?: never;
  readonly requestedPasses?: never;
  readonly resolution?: never;
  readonly layeredPsdRequested?: never;
  readonly contactSheetRequested?: never;
}

export type StudioBg3dShotBatchManifestContext =
  | StudioBg3dShotBatchLegacyManifestContext
  | StudioBg3dShotBatchPublicManifestContext;

export interface StudioBg3dShotBatchProgress {
  readonly completedFiles: number;
  readonly totalFiles: number;
}

export interface StudioBg3dShotBatchBuildOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioBg3dShotBatchProgress) => void;
  readonly manifest?: StudioBg3dShotBatchManifestContext;
  readonly layeredPsds?: readonly StudioBg3dShotBatchLayeredPsd[];
  readonly contactSheets?: readonly StudioBg3dShotBatchContactSheet[];
  /** Fixed before ZIP construction. The archive Worker selects `direct-headless`. */
  readonly crc32ExecutionMode?: StudioCrc32ExecutionMode;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const UNSAFE_TEXT_PATTERN = /\p{Cc}/u;
const EXTERNAL_REFERENCE_PATTERN = /(?:\b(?:blob|data|file|https?):|:\/\/|\bwww\.)/iu;
const MAX_DIMENSION = STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION;
const MAX_NAME_LENGTH = 80;
const RESUME_KEY_PATTERN = /^bg3d-batch-[0-9a-f]{8}$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._:+/-]{0,119}$/u;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const PUBLIC_SOURCE_MAX_DIMENSION = STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_SOURCE_DIMENSION;
const PUBLIC_MAX_PIXELS = STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_PIXELS;
const SHADOW_MAP_SIZE_SET = new Set([0, 256, 512, 1024, 2048, 4096]);
const ENGINE_ID_SET = new Set(["three", "babylon", "playcanvas", "filament", "cesium"]);
const GRAPHICS_API_SET = new Set(["webgl2", "webgpu"]);
const CAPTURE_BACKEND_SET = new Set([
  "three-webgl",
  "three-webgpu",
  "babylon-webgl",
  "babylon-webgpu",
  "playcanvas-webgl",
  "playcanvas-webgpu",
  "filament-webgl",
  "filament-webgpu",
  "cesium-webgl",
  "cesium-webgpu",
]);
const PUBLIC_MANIFEST_KEYS = [
  "publicRenderPlan",
  "skippedArtifacts",
  "psdFallbacks",
  "contactSheetFallback",
] as const;
const LEGACY_MANIFEST_KEYS = [
  "resumeKey",
  "shots",
  "requestedPasses",
  "resolution",
  "skippedArtifacts",
  "psdFallbacks",
  "layeredPsdRequested",
  "contactSheetRequested",
  "contactSheetFallback",
] as const;
const PASS_SET = new Set<string>(STUDIO_BG3D_SHOT_BATCH_PASSES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort(compareStudioValidationStrings);
  const expected = [...keys].sort(compareStudioValidationStrings);
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

function abortError(): Error {
  const error = new Error("컷 일괄 렌더를 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function validShotName(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 &&
    Array.from(normalized).length <= MAX_NAME_LENGTH &&
    normalized === value &&
    !UNSAFE_TEXT_PATTERN.test(normalized) &&
    !EXTERNAL_REFERENCE_PATTERN.test(normalized);
}

async function validatePng(
  image: StudioBg3dShotBatchImage,
  signal?: AbortSignal,
): Promise<void> {
  if (
    !ID_PATTERN.test(image.shotId) ||
    !validShotName(image.shotName) ||
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > MAX_DIMENSION ||
    image.height > MAX_DIMENSION ||
    (image.pass !== undefined && !PASS_SET.has(image.pass)) ||
    (image.output !== undefined && image.output !== "beauty" && image.output !== "lt-composite") ||
    (image.pass !== undefined && image.output !== undefined && image.pass !== image.output) ||
    ((image.requestedHeight === undefined) !== (image.wasReduced === undefined)) ||
    (image.requestedHeight !== undefined && (
      !Number.isSafeInteger(image.requestedHeight) ||
      image.requestedHeight < 256 || image.requestedHeight > MAX_DIMENSION ||
      image.height > image.requestedHeight ||
      typeof image.wasReduced !== "boolean" ||
      image.wasReduced !== (image.height < image.requestedHeight)
    )) ||
    !(image.png instanceof Blob) ||
    image.png.type !== "image/png" ||
    image.png.size < 24 ||
    image.png.size > STUDIO_BG3D_SHOT_BATCH_MAX_IMAGE_BYTES
  ) {
    throw new TypeError("컷 일괄 렌더 PNG 항목이 안전한 형식 또는 예산을 벗어났습니다.");
  }
  await verifyStudioBg3dRgba8PngFile(image.png, {
    expectedWidth: image.width,
    expectedHeight: image.height,
    maxBytes: STUDIO_BG3D_SHOT_BATCH_MAX_IMAGE_BYTES,
    signal,
  });
}

async function validateLayeredPsd(
  artifact: StudioBg3dShotBatchLayeredPsd,
  signal?: AbortSignal,
): Promise<void> {
  if (
    !ID_PATTERN.test(artifact.shotId) ||
    !validShotName(artifact.shotName) ||
    !Number.isSafeInteger(artifact.width) || artifact.width < 1 || artifact.width > MAX_DIMENSION ||
    !Number.isSafeInteger(artifact.height) || artifact.height < 1 || artifact.height > MAX_DIMENSION ||
    !(artifact.psd instanceof Blob) ||
    artifact.psd.type !== STUDIO_BG3D_SHOT_PSD_MIME ||
    artifact.psd.size < 26 ||
    artifact.psd.size > STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES
  ) {
    throw new TypeError("컷 일괄 렌더 PSD artifact가 안전한 형식 또는 예산을 벗어났습니다.");
  }
  await verifyStudioBg3dLayeredPsdFile(artifact.psd, {
    expectedWidth: artifact.width,
    expectedHeight: artifact.height,
    maxBytes: STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES,
    signal,
  });
}

function artifactPass(image: StudioBg3dShotBatchImage): StudioBg3dShotBatchPass {
  return image.pass ?? image.output ?? "beauty";
}

function freezePublicRenderPlan(
  plan: StudioBg3dShotBatchPublicRenderPlan,
): StudioBg3dShotBatchPublicRenderPlan {
  Object.freeze(plan.implementation);
  Object.freeze(plan.captureProfile);
  Object.freeze(plan.artifactProfiles);
  Object.freeze(plan.artifactRequests);
  Object.freeze(plan.passes);
  for (const shot of plan.shots) {
    Object.freeze(shot.capture.background);
    Object.freeze(shot.capture);
    for (const file of shot.files) Object.freeze(file);
    Object.freeze(shot.files);
    Object.freeze(shot);
  }
  Object.freeze(plan.shots);
  return Object.freeze(plan);
}

function snapshotPublicRenderPlan(
  value: unknown,
  requireCanonicalOrder: boolean,
): StudioBg3dShotBatchPublicRenderPlan {
  if (!hasExactKeys(value, [
    "kind",
    "version",
    "sourceDigest",
    "renderDigest",
    "implementation",
    "captureProfile",
    "artifactProfiles",
    "passes",
    "exportHeight",
    "artifactRequests",
    "shots",
  ])) {
    throw new TypeError("공개 컷 렌더 계획에 알 수 없거나 누락된 필드가 있습니다.");
  }
  const plan = value as unknown as StudioBg3dShotBatchPublicRenderPlan;
  if (
    plan.kind !== STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_KIND ||
    plan.version !== STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_VERSION ||
    !SHA256_HEX_PATTERN.test(plan.sourceDigest) ||
    !SHA256_HEX_PATTERN.test(plan.renderDigest) ||
    !hasExactKeys(plan.implementation, [
      "appProfileId",
      "engineId",
      "engineRevision",
      "adapterImplementationRevision",
      "graphicsApi",
      "backend",
    ]) ||
    !PROFILE_ID_PATTERN.test(plan.implementation.appProfileId) ||
    plan.implementation.appProfileId !== STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1 ||
    !ENGINE_ID_SET.has(plan.implementation.engineId) ||
    !PROFILE_ID_PATTERN.test(plan.implementation.engineRevision) ||
    !PROFILE_ID_PATTERN.test(plan.implementation.adapterImplementationRevision) ||
    !GRAPHICS_API_SET.has(plan.implementation.graphicsApi) ||
    !CAPTURE_BACKEND_SET.has(plan.implementation.backend) ||
    plan.implementation.backend !== `${plan.implementation.engineId}-${
      plan.implementation.graphicsApi === "webgl2" ? "webgl" : "webgpu"
    }` ||
    !hasExactKeys(plan.captureProfile, [
      "profileId",
      "ltPipelineId",
      "pngEncodingId",
      "depthEncodingId",
      "sourceWidth",
      "sourceHeight",
      "maxPixels",
      "maxEdge",
      "deviceProfile",
      "textureScale",
      "lodBias",
    ]) ||
    !PROFILE_ID_PATTERN.test(plan.captureProfile.profileId) ||
    !PROFILE_ID_PATTERN.test(plan.captureProfile.ltPipelineId) ||
    !PROFILE_ID_PATTERN.test(plan.captureProfile.pngEncodingId) ||
    !PROFILE_ID_PATTERN.test(plan.captureProfile.depthEncodingId) ||
    plan.captureProfile.depthEncodingId !== STUDIO_BG3D_SHOT_BATCH_DEPTH_ENCODING_V1 ||
    !Number.isSafeInteger(plan.captureProfile.sourceWidth) ||
    plan.captureProfile.sourceWidth < 1 ||
    plan.captureProfile.sourceWidth > PUBLIC_SOURCE_MAX_DIMENSION ||
    !Number.isSafeInteger(plan.captureProfile.sourceHeight) ||
    plan.captureProfile.sourceHeight < 1 ||
    plan.captureProfile.sourceHeight > PUBLIC_SOURCE_MAX_DIMENSION ||
    !Number.isSafeInteger(plan.captureProfile.maxPixels) ||
    plan.captureProfile.maxPixels < 1 ||
    plan.captureProfile.maxPixels > PUBLIC_MAX_PIXELS ||
    !Number.isSafeInteger(plan.captureProfile.maxEdge) ||
    plan.captureProfile.maxEdge < 1 ||
    plan.captureProfile.maxEdge > MAX_DIMENSION ||
    (plan.captureProfile.deviceProfile !== "mobile" &&
      plan.captureProfile.deviceProfile !== "desktop") ||
    typeof plan.captureProfile.textureScale !== "number" ||
    !Number.isFinite(plan.captureProfile.textureScale) ||
    plan.captureProfile.textureScale < 0.01 ||
    plan.captureProfile.textureScale > 4 ||
    typeof plan.captureProfile.lodBias !== "number" ||
    !Number.isFinite(plan.captureProfile.lodBias) ||
    plan.captureProfile.lodBias < 0 ||
    plan.captureProfile.lodBias > 8 ||
    !hasExactKeys(plan.artifactProfiles, [
      "psdProfileId",
      "contactSheetProfileId",
      "archiveProfileId",
    ]) ||
    !PROFILE_ID_PATTERN.test(plan.artifactProfiles.psdProfileId) ||
    !PROFILE_ID_PATTERN.test(plan.artifactProfiles.contactSheetProfileId) ||
    plan.artifactProfiles.contactSheetProfileId !==
      STUDIO_BG3D_SHOT_BATCH_CONTACT_SHEET_PROFILE_V1 ||
    !PROFILE_ID_PATTERN.test(plan.artifactProfiles.archiveProfileId) ||
    plan.artifactProfiles.archiveProfileId !== STUDIO_BG3D_SHOT_BATCH_ARCHIVE_PROFILE_V1 ||
    !Array.isArray(plan.passes) ||
    plan.passes.length < 1 ||
    plan.passes.length > STUDIO_BG3D_SHOT_BATCH_PASSES.length ||
    plan.passes.some((pass) => !PASS_SET.has(pass)) ||
    new Set(plan.passes).size !== plan.passes.length ||
    (plan.exportHeight !== "per-shot" && (
      !Number.isSafeInteger(plan.exportHeight) ||
      plan.exportHeight < 256 ||
      plan.exportHeight > MAX_DIMENSION
    )) ||
    !hasExactKeys(plan.artifactRequests, ["layeredPsd", "contactSheet"]) ||
    typeof plan.artifactRequests.layeredPsd !== "boolean" ||
    typeof plan.artifactRequests.contactSheet !== "boolean" ||
    !Array.isArray(plan.shots) ||
    plan.shots.length < 1 ||
    plan.shots.length > STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS
  ) {
    throw new TypeError("공개 컷 렌더 계획이 안전한 형식 또는 예산을 벗어났습니다.");
  }
  const canonicalPasses = STUDIO_BG3D_SHOT_BATCH_PASSES.filter((pass) =>
    plan.passes.includes(pass));
  if (
    requireCanonicalOrder &&
    canonicalPasses.some((pass, index) => plan.passes[index] !== pass)
  ) {
    throw new TypeError("공개 컷 렌더 계획의 pass 순서가 canonical 순서가 아닙니다.");
  }

  const shotIds = new Set<string>();
  const shotIndexes = new Set<number>();
  const shots = plan.shots.map((shot) => {
    if (
      !hasExactKeys(shot, ["shotId", "shotName", "shotIndex", "capture", "files"]) ||
      !ID_PATTERN.test(shot.shotId) ||
      !validShotName(shot.shotName) ||
      !Number.isSafeInteger(shot.shotIndex) ||
      shot.shotIndex < 1 ||
      shot.shotIndex > plan.shots.length ||
      shotIds.has(shot.shotId) ||
      shotIndexes.has(shot.shotIndex) ||
      !hasExactKeys(shot.capture, [
        "width",
        "height",
        "requestedHeight",
        "wasReduced",
        "includeDepth",
        "shadows",
        "shadowMapSize",
        "background",
      ]) ||
      !Number.isSafeInteger(shot.capture.width) ||
      shot.capture.width < 1 ||
      shot.capture.width > plan.captureProfile.maxEdge ||
      !Number.isSafeInteger(shot.capture.height) ||
      shot.capture.height < 1 ||
      shot.capture.height > plan.captureProfile.maxEdge ||
      !Number.isSafeInteger(shot.capture.width * shot.capture.height) ||
      shot.capture.width * shot.capture.height > plan.captureProfile.maxPixels ||
      !Number.isSafeInteger(shot.capture.requestedHeight) ||
      shot.capture.requestedHeight < 256 ||
      shot.capture.requestedHeight > MAX_DIMENSION ||
      shot.capture.height > shot.capture.requestedHeight ||
      typeof shot.capture.wasReduced !== "boolean" ||
      shot.capture.wasReduced !== (shot.capture.height < shot.capture.requestedHeight) ||
      (plan.exportHeight !== "per-shot" &&
        shot.capture.requestedHeight !== plan.exportHeight) ||
      typeof shot.capture.includeDepth !== "boolean" ||
      (canonicalPasses.includes("depth") && !shot.capture.includeDepth) ||
      typeof shot.capture.shadows !== "boolean" ||
      !Number.isSafeInteger(shot.capture.shadowMapSize) ||
      !SHADOW_MAP_SIZE_SET.has(shot.capture.shadowMapSize) ||
      (shot.capture.shadows
        ? shot.capture.shadowMapSize === 0
        : shot.capture.shadowMapSize !== 0) ||
      !hasExactKeys(shot.capture.background, ["color", "alpha"]) ||
      typeof shot.capture.background.color !== "string" ||
      !HEX_COLOR_PATTERN.test(shot.capture.background.color) ||
      (shot.capture.background.alpha !== 0 && shot.capture.background.alpha !== 1) ||
      !Array.isArray(shot.files) ||
      shot.files.length !== canonicalPasses.length
    ) {
      throw new TypeError("공개 컷 렌더 계획의 frozen shot이 올바르지 않습니다.");
    }
    const resolvedSize = resolveStudioBg3dLtCaptureSize({
      sourceWidth: plan.captureProfile.sourceWidth,
      sourceHeight: plan.captureProfile.sourceHeight,
      requestedHeight: shot.capture.requestedHeight,
      maxPixels: plan.captureProfile.maxPixels,
      maxEdge: plan.captureProfile.maxEdge,
    });
    if (
      !resolvedSize ||
      shot.capture.width !== resolvedSize.width ||
      shot.capture.height !== resolvedSize.height ||
      shot.capture.wasReduced !== resolvedSize.wasReduced
    ) {
      throw new TypeError("공개 컷 렌더 계획의 frozen 해상도가 capture profile과 일치하지 않습니다.");
    }
    shotIds.add(shot.shotId);
    shotIndexes.add(shot.shotIndex);
    const seenPasses = new Set<StudioBg3dShotBatchPass>();
    const files = shot.files.map((file: StudioBg3dShotBatchPublicPlannedFile) => {
      const ordinal = String(shot.shotIndex).padStart(3, "0");
      if (
        !hasExactKeys(file, ["shotId", "shotName", "shotIndex", "pass", "path"]) ||
        file.shotId !== shot.shotId ||
        file.shotName !== shot.shotName ||
        file.shotIndex !== shot.shotIndex ||
        !PASS_SET.has(file.pass) ||
        !canonicalPasses.includes(file.pass) ||
        seenPasses.has(file.pass) ||
        file.path !== `shots/${ordinal}/${file.pass}.png`
      ) {
        throw new TypeError("공개 컷 렌더 계획의 file contract가 올바르지 않습니다.");
      }
      seenPasses.add(file.pass);
      return {
        shotId: file.shotId,
        shotName: file.shotName,
        shotIndex: file.shotIndex,
        pass: file.pass,
        path: file.path,
      } satisfies StudioBg3dShotBatchPublicPlannedFile;
    }).sort((left: StudioBg3dShotBatchPublicPlannedFile, right: StudioBg3dShotBatchPublicPlannedFile) =>
      canonicalPasses.indexOf(left.pass) - canonicalPasses.indexOf(right.pass));
    if (
      canonicalPasses.some((pass) => !seenPasses.has(pass)) ||
      (requireCanonicalOrder && canonicalPasses.some((pass, index) =>
        shot.files[index]?.pass !== pass))
    ) {
      throw new TypeError("공개 컷 렌더 계획의 file 순서가 canonical 순서가 아닙니다.");
    }
    return {
      shotId: shot.shotId,
      shotName: shot.shotName,
      shotIndex: shot.shotIndex,
      capture: {
        width: shot.capture.width,
        height: shot.capture.height,
        requestedHeight: shot.capture.requestedHeight,
        wasReduced: shot.capture.wasReduced,
        includeDepth: shot.capture.includeDepth,
        shadows: shot.capture.shadows,
        shadowMapSize: shot.capture.shadowMapSize,
        background: {
          color: shot.capture.background.color.toLowerCase(),
          alpha: shot.capture.background.alpha,
        },
      },
      files,
    } satisfies StudioBg3dShotBatchPublicPlannedShot;
  }).sort((left, right) => left.shotIndex - right.shotIndex);
  if (
    shots.some((shot, index) => shot.shotIndex !== index + 1) ||
    (requireCanonicalOrder && shots.some((shot, index) => shot.shotId !== plan.shots[index]?.shotId)) ||
    (requireCanonicalOrder && plan.shots.some((shot) =>
      shot.capture.background.color !== shot.capture.background.color.toLowerCase()))
  ) {
    throw new TypeError("공개 컷 렌더 계획의 shot 순서가 canonical 순서가 아닙니다.");
  }

  return freezePublicRenderPlan({
    kind: STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_KIND,
    version: STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_VERSION,
    sourceDigest: plan.sourceDigest,
    renderDigest: plan.renderDigest,
    implementation: {
      appProfileId: plan.implementation.appProfileId,
      engineId: plan.implementation.engineId,
      engineRevision: plan.implementation.engineRevision,
      adapterImplementationRevision: plan.implementation.adapterImplementationRevision,
      graphicsApi: plan.implementation.graphicsApi,
      backend: plan.implementation.backend,
    },
    captureProfile: {
      profileId: plan.captureProfile.profileId,
      ltPipelineId: plan.captureProfile.ltPipelineId,
      pngEncodingId: plan.captureProfile.pngEncodingId,
      depthEncodingId: plan.captureProfile.depthEncodingId,
      sourceWidth: plan.captureProfile.sourceWidth,
      sourceHeight: plan.captureProfile.sourceHeight,
      maxPixels: plan.captureProfile.maxPixels,
      maxEdge: plan.captureProfile.maxEdge,
      deviceProfile: plan.captureProfile.deviceProfile,
      textureScale: plan.captureProfile.textureScale,
      lodBias: plan.captureProfile.lodBias,
    },
    artifactProfiles: {
      psdProfileId: plan.artifactProfiles.psdProfileId,
      contactSheetProfileId: plan.artifactProfiles.contactSheetProfileId,
      archiveProfileId: plan.artifactProfiles.archiveProfileId,
    },
    passes: canonicalPasses,
    exportHeight: plan.exportHeight,
    artifactRequests: {
      layeredPsd: plan.artifactRequests.layeredPsd,
      contactSheet: plan.artifactRequests.contactSheet,
    },
    shots,
  });
}

/** Builds the only Plan-v2 projection allowed to cross the public archive boundary. */
export function createStudioBg3dShotBatchPublicRenderPlan(
  input: StudioBg3dShotBatchPublicRenderPlanInput,
): StudioBg3dShotBatchPublicRenderPlan {
  return snapshotPublicRenderPlan(input, false);
}

/**
 * Projects a validated private Plan v2 into the public archive schema. Recovery/scope fields and
 * private source bytes are never copied, even transiently into the returned object.
 */
export async function projectStudioBg3dShotBatchPlanForPublicArchive(
  plan: StudioBg3dShotBatchPlan,
  options: StudioBg3dShotBatchPublicRenderProjectionOptions,
): Promise<StudioBg3dShotBatchPublicRenderPlan> {
  let appProfileId: string;
  let sourceRevision: string;
  try {
    if (!hasExactKeys(options, ["appProfileId", "sourceRevision"])) {
      throw new TypeError("공개 archive 렌더 구현 프로필이 올바르지 않습니다.");
    }
    appProfileId = options.appProfileId;
    sourceRevision = options.sourceRevision;
  } catch {
    throw new TypeError("공개 archive 렌더 구현 프로필이 올바르지 않습니다.");
  }
  if (
    !PROFILE_ID_PATTERN.test(appProfileId) ||
    typeof sourceRevision !== "string"
  ) {
    throw new TypeError("공개 archive 렌더 구현 프로필이 올바르지 않습니다.");
  }
  const verifiedPlan = await hydrateStudioBg3dShotBatchPlan(plan);
  if (
    !verifiedPlan ||
    !await verifyStudioBg3dShotBatchSourceRevision(verifiedPlan, sourceRevision)
  ) {
    throw new TypeError("공개 archive로 투영할 컷 렌더 Plan v2의 digest가 올바르지 않습니다.");
  }
  return createStudioBg3dShotBatchPublicRenderPlan({
    kind: STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_KIND,
    version: STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_VERSION,
    sourceDigest: verifiedPlan.sourceDigest,
    renderDigest: verifiedPlan.planDigest,
    implementation: {
      appProfileId,
      engineId: verifiedPlan.captureOwner.engineId,
      engineRevision: verifiedPlan.captureOwner.engineRevision,
      adapterImplementationRevision: verifiedPlan.captureOwner.implementationRevision,
      graphicsApi: verifiedPlan.captureOwner.graphicsApi,
      backend: verifiedPlan.captureOwner.backend,
    },
    captureProfile: {
      profileId: verifiedPlan.captureOwner.profileId,
      ltPipelineId: verifiedPlan.captureOwner.ltPipelineId,
      pngEncodingId: verifiedPlan.captureOwner.pngEncodingId,
      depthEncodingId: STUDIO_BG3D_SHOT_BATCH_DEPTH_ENCODING_V1,
      sourceWidth: verifiedPlan.captureOwner.sourceWidth,
      sourceHeight: verifiedPlan.captureOwner.sourceHeight,
      maxPixels: verifiedPlan.captureOwner.maxPixels,
      maxEdge: verifiedPlan.captureOwner.maxEdge,
      deviceProfile: verifiedPlan.captureOwner.deviceProfile,
      textureScale: verifiedPlan.captureOwner.textureScale,
      lodBias: verifiedPlan.captureOwner.lodBias,
    },
    artifactProfiles: {
      psdProfileId: verifiedPlan.captureOwner.psdEncodingId,
      contactSheetProfileId: STUDIO_BG3D_SHOT_BATCH_CONTACT_SHEET_PROFILE_V1,
      archiveProfileId: STUDIO_BG3D_SHOT_BATCH_ARCHIVE_PROFILE_V1,
    },
    passes: verifiedPlan.passes,
    exportHeight: verifiedPlan.exportHeight,
    artifactRequests: {
      layeredPsd: verifiedPlan.includeLayeredPsd,
      contactSheet: verifiedPlan.includeContactSheet,
    },
    shots: verifiedPlan.shots.map((shot) => ({
      shotId: shot.shotId,
      shotName: shot.shotName,
      shotIndex: shot.shotIndex,
      capture: {
        width: shot.capture.width,
        height: shot.capture.height,
        requestedHeight: shot.capture.requestedHeight,
        wasReduced: shot.capture.wasReduced,
        includeDepth: shot.capture.includeDepth,
        shadows: shot.capture.shadows,
        shadowMapSize: shot.capture.shadowMapSize,
        background: {
          color: shot.capture.background.color,
          alpha: shot.capture.background.alpha as 0 | 1,
        },
      },
      files: shot.files.map((file) => ({
        shotId: file.shotId,
        shotName: file.shotName,
        shotIndex: file.shotIndex,
        pass: file.pass,
        path: file.path,
      })),
    })),
  });
}

async function verifyStudioBg3dShotBatchPublicRenderDigest(
  plan: StudioBg3dShotBatchPublicRenderPlan,
): Promise<boolean> {
  const digest = await computeStudioBg3dShotBatchRenderDigest({
    sourceDigest: plan.sourceDigest,
    captureOwner: {
      backend: plan.implementation.backend,
      engineId: plan.implementation.engineId,
      engineRevision: plan.implementation.engineRevision,
      implementationRevision: plan.implementation.adapterImplementationRevision,
      graphicsApi: plan.implementation.graphicsApi,
      profileId: plan.captureProfile.profileId,
      sourceWidth: plan.captureProfile.sourceWidth,
      sourceHeight: plan.captureProfile.sourceHeight,
      maxPixels: plan.captureProfile.maxPixels,
      maxEdge: plan.captureProfile.maxEdge,
      deviceProfile: plan.captureProfile.deviceProfile,
      textureScale: plan.captureProfile.textureScale,
      lodBias: plan.captureProfile.lodBias,
      ltPipelineId: plan.captureProfile.ltPipelineId,
      pngEncodingId: plan.captureProfile.pngEncodingId,
      psdEncodingId: plan.artifactProfiles.psdProfileId,
    },
    shots: plan.shots.map((shot) => ({
      shotId: shot.shotId,
      shotName: shot.shotName,
      shotIndex: shot.shotIndex,
      capture: {
        width: shot.capture.width,
        height: shot.capture.height,
        requestedHeight: shot.capture.requestedHeight,
        wasReduced: shot.capture.wasReduced,
        includeDepth: shot.capture.includeDepth,
        shadows: shot.capture.shadows,
        shadowMapSize: shot.capture.shadowMapSize,
        background: {
          color: shot.capture.background.color,
          alpha: shot.capture.background.alpha,
        },
      },
      files: shot.files.map((file) => ({
        key: `${file.shotId}:${file.pass}`,
        shotId: file.shotId,
        shotName: file.shotName,
        shotIndex: file.shotIndex,
        pass: file.pass,
        path: file.path,
      })),
    })),
    passes: [...plan.passes],
    exportHeight: plan.exportHeight,
    includeLayeredPsd: plan.artifactRequests.layeredPsd,
    includeContactSheet: plan.artifactRequests.contactSheet,
  });
  return digest !== null && digest === plan.renderDigest;
}

export function isStudioBg3dShotBatchPublicRenderPlan(
  value: unknown,
): value is StudioBg3dShotBatchPublicRenderPlan {
  try {
    snapshotPublicRenderPlan(value, true);
    return true;
  } catch {
    return false;
  }
}

function validateManifestContext(
  value: unknown,
): StudioBg3dShotBatchManifestContext {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new TypeError("컷 일괄 렌더 manifest 문맥이 올바르지 않습니다.");
  }
  const candidate = value as Record<string, unknown>;
  const publicRenderPlan = candidate.publicRenderPlan === undefined
    ? undefined
    : snapshotPublicRenderPlan(candidate.publicRenderPlan, true);
  if (!hasOnlyKeys(value, publicRenderPlan ? PUBLIC_MANIFEST_KEYS : LEGACY_MANIFEST_KEYS)) {
    throw new TypeError("컷 일괄 렌더 manifest 문맥에 알 수 없는 필드가 있습니다.");
  }
  if (
    candidate.resumeKey !== undefined &&
    (typeof candidate.resumeKey !== "string" || !RESUME_KEY_PATTERN.test(candidate.resumeKey))
  ) {
    throw new TypeError("컷 일괄 렌더 resume key가 올바르지 않습니다.");
  }
  if (publicRenderPlan && candidate.resumeKey !== undefined) {
    throw new TypeError("공개 컷 렌더 manifest에는 로컬 resume key를 포함할 수 없습니다.");
  }
  if (
    (candidate.layeredPsdRequested !== undefined &&
      typeof candidate.layeredPsdRequested !== "boolean") ||
    (candidate.contactSheetRequested !== undefined &&
      typeof candidate.contactSheetRequested !== "boolean")
  ) {
    throw new TypeError("컷 일괄 렌더 선택 artifact 요청 문맥이 올바르지 않습니다.");
  }
  const rawShots = publicRenderPlan
    ? publicRenderPlan.shots.map((shot) => ({ id: shot.shotId, name: shot.shotName }))
    : candidate.shots ?? [];
  if (
    !Array.isArray(rawShots) ||
    (candidate.shots !== undefined && rawShots.length < 1) ||
    rawShots.length > STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS
  ) {
    throw new RangeError("컷 일괄 렌더 manifest 컷 목록이 안전 한도를 벗어났습니다.");
  }
  const shotIds = new Set<string>();
  const shots = rawShots.map((rawShot): { readonly id: string; readonly name: string } => {
    const shot = rawShot as { readonly id?: unknown; readonly name?: unknown };
    if (
      !hasExactKeys(rawShot, ["id", "name"]) ||
      typeof shot.id !== "string" || !ID_PATTERN.test(shot.id) ||
      typeof shot.name !== "string" || !validShotName(shot.name) || shotIds.has(shot.id)
    ) {
      throw new TypeError("컷 일괄 렌더 manifest 컷 목록이 올바르지 않습니다.");
    }
    shotIds.add(shot.id);
    return { id: shot.id, name: shot.name };
  });
  const rawRequested = publicRenderPlan?.passes ?? candidate.requestedPasses ?? [];
  if (
    !Array.isArray(rawRequested) ||
    (candidate.requestedPasses !== undefined && rawRequested.length < 1) ||
    rawRequested.some((pass) => typeof pass !== "string" || !PASS_SET.has(pass))
  ) {
    throw new TypeError("컷 일괄 렌더 요청 패스가 올바르지 않습니다.");
  }
  const requested = rawRequested as StudioBg3dShotBatchPass[];
  if (new Set(requested).size !== requested.length) {
    throw new TypeError("컷 일괄 렌더 요청 패스가 중복되었습니다.");
  }
  let resolution: StudioBg3dShotBatchLegacyManifestContext["resolution"];
  if (candidate.resolution !== undefined) {
    if (!isRecord(candidate.resolution)) {
      throw new TypeError("컷 일괄 렌더 해상도 문맥이 올바르지 않습니다.");
    }
    if (candidate.resolution.mode === "per-shot-maximum") {
      if (!hasExactKeys(candidate.resolution, ["mode"])) {
        throw new TypeError("컷 일괄 렌더 컷별 최대 해상도 문맥에 알 수 없는 필드가 있습니다.");
      }
      resolution = { mode: "per-shot-maximum" };
    } else if (
      candidate.resolution.mode !== "maximum-height" ||
      !hasExactKeys(candidate.resolution, ["mode", "height"]) ||
      !Number.isSafeInteger(candidate.resolution.height) ||
      (candidate.resolution.height as number) < 256 ||
      (candidate.resolution.height as number) > MAX_DIMENSION
    ) {
      throw new TypeError("컷 일괄 렌더 최대 해상도 문맥이 올바르지 않습니다.");
    } else {
      resolution = {
        mode: "maximum-height",
        height: candidate.resolution.height as number,
      };
    }
  }
  const rawSkipped = candidate.skippedArtifacts ?? [];
  if (!Array.isArray(rawSkipped) || rawSkipped.length > STUDIO_BG3D_SHOT_BATCH_MAX_ARTIFACTS) {
    throw new RangeError("컷 일괄 렌더 생략 artifact가 안전 한도를 벗어났습니다.");
  }
  const skippedKeys = new Set<string>();
  const skippedArtifacts = rawSkipped.map((rawArtifact): StudioBg3dShotBatchSkippedArtifact => {
    const artifact = rawArtifact as Partial<StudioBg3dShotBatchSkippedArtifact>;
    if (
      !hasExactKeys(rawArtifact, ["shotId", "shotName", "pass", "reason"]) ||
      typeof artifact.shotId !== "string" || !ID_PATTERN.test(artifact.shotId) ||
      typeof artifact.shotName !== "string" || !validShotName(artifact.shotName) ||
      typeof artifact.pass !== "string" || !PASS_SET.has(artifact.pass) ||
      (artifact.reason !== "disabled" && artifact.reason !== "unavailable")
    ) {
      throw new TypeError("컷 일괄 렌더 생략 artifact가 올바르지 않습니다.");
    }
    const key = `${artifact.shotId}:${artifact.pass}`;
    if (skippedKeys.has(key)) {
      throw new TypeError("컷 일괄 렌더 생략 artifact가 중복되었습니다.");
    }
    skippedKeys.add(key);
    return {
      shotId: artifact.shotId,
      shotName: artifact.shotName,
      pass: artifact.pass as StudioBg3dShotBatchPass,
      reason: artifact.reason,
    };
  });
  const rawPsdFallbacks = candidate.psdFallbacks ?? [];
  if (!Array.isArray(rawPsdFallbacks) || rawPsdFallbacks.length > STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS) {
    throw new RangeError("컷 일괄 렌더 PSD fallback 목록이 안전 한도를 벗어났습니다.");
  }
  const fallbackIds = new Set<string>();
  const copiedPsdFallbacks = rawPsdFallbacks.map((rawFallback): StudioBg3dShotBatchPsdFallback => {
    const fallback = rawFallback as Partial<StudioBg3dShotBatchPsdFallback>;
    if (
      !hasExactKeys(rawFallback, ["shotId", "shotName", "reason"]) ||
      typeof fallback.shotId !== "string" || !ID_PATTERN.test(fallback.shotId) ||
      typeof fallback.shotName !== "string" || !validShotName(fallback.shotName) ||
      typeof fallback.reason !== "string" ||
      !["budget", "unavailable", "worker-failed"].includes(fallback.reason) ||
      fallbackIds.has(fallback.shotId)
    ) {
      throw new TypeError("컷 일괄 렌더 PSD fallback이 올바르지 않습니다.");
    }
    fallbackIds.add(fallback.shotId);
    return {
      shotId: fallback.shotId,
      shotName: fallback.shotName,
      reason: fallback.reason as StudioBg3dShotBatchPsdFallback["reason"],
    };
  });
  const contactSheetFallback = candidate.contactSheetFallback;
  if (
    contactSheetFallback !== undefined && (
      typeof contactSheetFallback !== "string" ||
      !["budget", "source-unavailable", "unavailable", "worker-failed"].includes(
        contactSheetFallback,
      )
    )
  ) {
    throw new TypeError("컷 일괄 렌더 콘택트 시트 fallback이 올바르지 않습니다.");
  }
  if (publicRenderPlan) {
    const shotOrder = new Map(publicRenderPlan.shots.map((shot) => [shot.shotId, shot.shotIndex]));
    skippedArtifacts.sort((left, right) =>
      (shotOrder.get(left.shotId) ?? Number.MAX_SAFE_INTEGER) -
        (shotOrder.get(right.shotId) ?? Number.MAX_SAFE_INTEGER) ||
      STUDIO_BG3D_SHOT_BATCH_PASSES.indexOf(left.pass) -
        STUDIO_BG3D_SHOT_BATCH_PASSES.indexOf(right.pass));
    copiedPsdFallbacks.sort((left, right) =>
      (shotOrder.get(left.shotId) ?? Number.MAX_SAFE_INTEGER) -
      (shotOrder.get(right.shotId) ?? Number.MAX_SAFE_INTEGER));
    return {
      publicRenderPlan,
      ...(skippedArtifacts.length > 0 ? { skippedArtifacts } : {}),
      ...(copiedPsdFallbacks.length > 0 ? { psdFallbacks: copiedPsdFallbacks } : {}),
      ...(contactSheetFallback === undefined
        ? {}
        : { contactSheetFallback: contactSheetFallback as StudioBg3dShotBatchContactSheetFallback }),
    };
  }
  return {
    ...(candidate.resumeKey === undefined ? {} : { resumeKey: candidate.resumeKey as string }),
    ...(candidate.shots === undefined ? {} : { shots }),
    ...(candidate.requestedPasses === undefined ? {} : { requestedPasses: [...requested] }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(candidate.skippedArtifacts === undefined ? {} : { skippedArtifacts }),
    ...(candidate.psdFallbacks === undefined ? {} : { psdFallbacks: copiedPsdFallbacks }),
    ...(candidate.layeredPsdRequested === undefined
      ? {}
      : { layeredPsdRequested: candidate.layeredPsdRequested as boolean }),
    ...(candidate.contactSheetRequested === undefined
      ? {}
      : { contactSheetRequested: candidate.contactSheetRequested as boolean }),
    ...(contactSheetFallback === undefined
      ? {}
      : { contactSheetFallback: contactSheetFallback as StudioBg3dShotBatchContactSheetFallback }),
  };
}

export function isStudioBg3dShotBatchManifestContext(
  value: unknown,
): value is StudioBg3dShotBatchManifestContext | undefined {
  try {
    validateManifestContext(value as StudioBg3dShotBatchManifestContext | undefined);
    return true;
  } catch {
    return false;
  }
}

/** Builds a deterministic, bounded PNG ZIP with a small engine-neutral manifest. */
export async function buildStudioBg3dShotBatchArchive(
  inputImages: readonly StudioBg3dShotBatchImage[],
  options: StudioBg3dShotBatchBuildOptions = {},
): Promise<Blob> {
  if (!Array.isArray(inputImages) || inputImages.length < 1 || inputImages.length > STUDIO_BG3D_SHOT_BATCH_MAX_ARTIFACTS) {
    throw new RangeError(`컷 일괄 렌더는 1~${STUDIO_BG3D_SHOT_BATCH_MAX_ARTIFACTS}개 artifact만 포함할 수 있습니다.`);
  }
  const signal = options.signal;
  const onProgress = options.onProgress;
  throwIfAborted(signal);
  // Snapshot every caller-owned collection and scalar before the first Blob read awaits. Blob
  // objects are immutable; all mutable wrappers and metadata are rebuilt explicitly.
  let images = inputImages.map((image): StudioBg3dShotBatchImage => {
    if (!isRecord(image)) {
      throw new TypeError("컷 일괄 렌더 PNG 항목이 올바르지 않습니다.");
    }
    return {
      shotId: image.shotId,
      shotName: image.shotName,
      width: image.width,
      height: image.height,
      ...(image.pass === undefined ? {} : { pass: image.pass }),
      ...(image.output === undefined ? {} : { output: image.output }),
      ...(image.requestedHeight === undefined ? {} : { requestedHeight: image.requestedHeight }),
      ...(image.wasReduced === undefined ? {} : { wasReduced: image.wasReduced }),
      png: image.png,
    } as StudioBg3dShotBatchImage;
  });
  const manifestContext = validateManifestContext(options.manifest);
  const inputLayeredPsds = options.layeredPsds ?? [];
  if (!Array.isArray(inputLayeredPsds) || inputLayeredPsds.length > STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS) {
    throw new RangeError("컷 일괄 렌더 PSD 수가 안전 한도를 벗어났습니다.");
  }
  let layeredPsds = inputLayeredPsds.map((artifact): StudioBg3dShotBatchLayeredPsd => {
    if (!isRecord(artifact)) {
      throw new TypeError("컷 일괄 렌더 PSD artifact가 올바르지 않습니다.");
    }
    return {
      shotId: artifact.shotId,
      shotName: artifact.shotName,
      width: artifact.width,
      height: artifact.height,
      psd: artifact.psd,
    } as StudioBg3dShotBatchLayeredPsd;
  });
  const inputContactSheets = options.contactSheets ?? [];
  if (
    !Array.isArray(inputContactSheets) ||
    inputContactSheets.length > STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_SHOTS
  ) {
    throw new RangeError("컷 일괄 렌더 콘택트 시트 수가 안전 한도를 벗어났습니다.");
  }
  const contactSheets = inputContactSheets.map((artifact): StudioBg3dShotBatchContactSheet => {
    if (!isRecord(artifact) || !Array.isArray(artifact.shotIds)) {
      throw new TypeError("컷 일괄 렌더 콘택트 시트 artifact가 올바르지 않습니다.");
    }
    return {
      sheetNumber: artifact.sheetNumber,
      fileName: artifact.fileName,
      width: artifact.width,
      height: artifact.height,
      shotIds: [...artifact.shotIds],
      png: artifact.png,
    } as StudioBg3dShotBatchContactSheet;
  });
  const publicRenderPlan = manifestContext.publicRenderPlan;
  if (
    publicRenderPlan &&
    !await verifyStudioBg3dShotBatchPublicRenderDigest(publicRenderPlan)
  ) {
    throw new TypeError("공개 컷 렌더 계획의 render digest가 필드와 일치하지 않습니다.");
  }
  throwIfAborted(signal);
  if (publicRenderPlan) {
    const fileOrder = new Map(publicRenderPlan.shots.flatMap((shot) => shot.files)
      .map((file, index) => [`${file.shotId}:${file.pass}`, index]));
    images = [...images].sort((left, right) =>
      (fileOrder.get(`${left.shotId}:${artifactPass(left)}`) ?? Number.MAX_SAFE_INTEGER) -
      (fileOrder.get(`${right.shotId}:${artifactPass(right)}`) ?? Number.MAX_SAFE_INTEGER));
    const shotOrder = new Map(publicRenderPlan.shots.map((shot) => [shot.shotId, shot.shotIndex]));
    layeredPsds = [...layeredPsds].sort((left, right) =>
      (shotOrder.get(left.shotId) ?? Number.MAX_SAFE_INTEGER) -
      (shotOrder.get(right.shotId) ?? Number.MAX_SAFE_INTEGER));
  }
  const manifestShots = publicRenderPlan
    ? publicRenderPlan.shots.map((shot) => ({ id: shot.shotId, name: shot.shotName }))
    : manifestContext.shots;
  const manifestRequestedPasses = publicRenderPlan?.passes ?? manifestContext.requestedPasses;
  const manifestResolution = publicRenderPlan
    ? publicRenderPlan.exportHeight === "per-shot"
      ? { mode: "per-shot-maximum" as const }
      : { mode: "maximum-height" as const, height: publicRenderPlan.exportHeight }
    : manifestContext.resolution;
  const layeredPsdRequested = publicRenderPlan?.artifactRequests.layeredPsd ??
    manifestContext.layeredPsdRequested;
  const contactSheetRequested = publicRenderPlan?.artifactRequests.contactSheet ??
    manifestContext.contactSheetRequested;
  const seenArtifactKeys = new Set<string>();
  const requestedPassSet = manifestRequestedPasses
    ? new Set(manifestRequestedPasses)
    : null;
  const shots = new Map<string, { readonly name: string; readonly index: number }>();
  const shotRasterShape = new Map<string, {
    readonly width: number;
    readonly height: number;
    readonly requestedHeight?: number;
    readonly wasReduced?: boolean;
  }>();
  for (const shot of manifestShots ?? []) {
    shots.set(shot.id, { name: shot.name, index: shots.size + 1 });
  }
  let totalImageBytes = 0;
  for (const image of images) {
    throwIfAborted(signal);
    await validatePng(image, signal);
    if (
      requestedPassSet &&
      (image.pass === undefined || !requestedPassSet.has(image.pass))
    ) {
      throw new TypeError("완료 PNG artifact가 manifest 요청 패스에 없습니다.");
    }
    const existingShot = shots.get(image.shotId);
    if (manifestShots && !existingShot) {
      throw new TypeError("완료 artifact가 요청 컷 목록에 없습니다.");
    }
    if (existingShot && existingShot.name !== image.shotName) {
      throw new TypeError("같은 컷 ID의 이름이 artifact 사이에서 일치하지 않습니다.");
    }
    if (publicRenderPlan) {
      const publicShot = publicRenderPlan.shots.find((shot) => shot.shotId === image.shotId);
      if (
        !publicShot ||
        image.pass === undefined ||
        !publicShot.files.some((file) => file.pass === image.pass) ||
        image.width !== publicShot.capture.width ||
        image.height !== publicShot.capture.height ||
        image.requestedHeight !== publicShot.capture.requestedHeight ||
        image.wasReduced !== publicShot.capture.wasReduced
      ) {
        throw new TypeError("완료 artifact가 공개 frozen 렌더 계획과 일치하지 않습니다.");
      }
    }
    if (!existingShot) {
      if (shots.size >= STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS) {
        throw new RangeError(`컷 일괄 렌더는 최대 ${STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS}개 컷만 포함할 수 있습니다.`);
      }
      shots.set(image.shotId, { name: image.shotName, index: shots.size + 1 });
    }
    const key = `${image.shotId}:${artifactPass(image)}`;
    if (seenArtifactKeys.has(key)) {
      throw new TypeError("컷 일괄 렌더에 중복 shot/pass artifact가 있습니다.");
    }
    seenArtifactKeys.add(key);
    const existingShape = shotRasterShape.get(image.shotId);
    if (
      existingShape && (
        existingShape.width !== image.width ||
        existingShape.height !== image.height ||
        existingShape.requestedHeight !== image.requestedHeight ||
        existingShape.wasReduced !== image.wasReduced
      )
    ) {
      throw new TypeError("같은 컷의 pass artifact 해상도 또는 축소 문맥이 일치하지 않습니다.");
    }
    if (!existingShape) {
      shotRasterShape.set(image.shotId, {
        width: image.width,
        height: image.height,
        ...(image.requestedHeight === undefined ? {} : {
          requestedHeight: image.requestedHeight,
          wasReduced: image.wasReduced,
        }),
      });
    }
    if (
      manifestResolution !== undefined && (
        image.requestedHeight === undefined ||
        (manifestResolution.mode === "maximum-height" &&
          image.requestedHeight !== manifestResolution.height)
      )
    ) {
      throw new TypeError("컷 pass artifact의 요청 높이가 manifest 최대 해상도 문맥과 일치하지 않습니다.");
    }
    totalImageBytes += image.png.size;
    if (totalImageBytes > STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES) {
      throw new RangeError("컷 일괄 렌더 이미지 합계가 브라우저 메모리 예산을 벗어났습니다.");
    }
  }

  const seenPsdShotIds = new Set<string>();
  for (const artifact of layeredPsds) {
    throwIfAborted(signal);
    await validateLayeredPsd(artifact, signal);
    const existingShot = shots.get(artifact.shotId);
    if (manifestShots && !existingShot) {
      throw new TypeError("PSD artifact가 요청 컷 목록에 없습니다.");
    }
    if (existingShot && existingShot.name !== artifact.shotName) {
      throw new TypeError("같은 컷 ID의 이름이 PSD artifact와 일치하지 않습니다.");
    }
    const rasterShape = shotRasterShape.get(artifact.shotId);
    if (rasterShape && (rasterShape.width !== artifact.width || rasterShape.height !== artifact.height)) {
      throw new TypeError("같은 컷의 PSD와 PNG pass 해상도가 일치하지 않습니다.");
    }
    if (!existingShot) {
      if (shots.size >= STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS) {
        throw new RangeError(`컷 일괄 렌더는 최대 ${STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS}개 컷만 포함할 수 있습니다.`);
      }
      shots.set(artifact.shotId, { name: artifact.shotName, index: shots.size + 1 });
    }
    if (seenPsdShotIds.has(artifact.shotId)) {
      throw new TypeError("컷 일괄 렌더에 중복 layered PSD가 있습니다.");
    }
    seenPsdShotIds.add(artifact.shotId);
    totalImageBytes += artifact.psd.size;
    if (totalImageBytes > STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES) {
      throw new RangeError("컷 일괄 렌더 artifact 합계가 브라우저 메모리 예산을 벗어났습니다.");
    }
  }

  let totalContactSheetBytes = 0;
  const contactShotIds = new Set<string>();
  for (const [index, artifact] of contactSheets.entries()) {
    throwIfAborted(signal);
    if (
      artifact.sheetNumber !== index + 1 ||
      artifact.fileName !== `contact-sheet-${String(index + 1).padStart(3, "0")}.png` ||
      !Number.isSafeInteger(artifact.width) || artifact.width < 1 || artifact.width > 8_192 ||
      !Number.isSafeInteger(artifact.height) || artifact.height < 1 || artifact.height > 8_192 ||
      !Array.isArray(artifact.shotIds) || artifact.shotIds.length < 1 ||
      artifact.shotIds.some((shotId: string) => (
        !ID_PATTERN.test(shotId) || !shots.has(shotId) || contactShotIds.has(shotId)
      )) ||
      new Set(artifact.shotIds).size !== artifact.shotIds.length ||
      !(artifact.png instanceof Blob) || artifact.png.type !== "image/png" ||
      artifact.png.size < 24 || artifact.png.size > STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_OUTPUT_BYTES
    ) {
      throw new TypeError("컷 일괄 렌더 콘택트 시트 artifact가 올바르지 않습니다.");
    }
    await verifyStudioBg3dOpaqueRgb8PngFile(artifact.png, {
      expectedWidth: artifact.width,
      expectedHeight: artifact.height,
      maxBytes: STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_OUTPUT_BYTES,
      signal,
    });
    artifact.shotIds.forEach((shotId: string) => contactShotIds.add(shotId));
    totalContactSheetBytes += artifact.png.size;
    totalImageBytes += artifact.png.size;
    if (
      totalContactSheetBytes > STUDIO_BG3D_SHOT_CONTACT_SHEET_MAX_TOTAL_OUTPUT_BYTES ||
      totalImageBytes > STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES
    ) {
      throw new RangeError("컷 일괄 렌더 콘택트 시트 합계가 브라우저 메모리 예산을 벗어났습니다.");
    }
  }
  if (contactSheets.length > 0 && contactShotIds.size !== shots.size) {
    throw new TypeError("컷 일괄 렌더 콘택트 시트가 요청한 모든 컷을 포함하지 않습니다.");
  }
  if (contactSheets.length > 0 && manifestContext.contactSheetFallback !== undefined) {
    throw new TypeError("완료 콘택트 시트와 fallback이 충돌합니다.");
  }

  const seenSkippedArtifactKeys = new Set<string>();
  for (const skipped of manifestContext.skippedArtifacts ?? []) {
    const existingShot = shots.get(skipped.shotId);
    if (manifestShots && !existingShot) {
      throw new TypeError("생략 artifact가 요청 컷 목록에 없습니다.");
    }
    if (existingShot && existingShot.name !== skipped.shotName) {
      throw new TypeError("같은 컷 ID의 이름이 생략 artifact와 일치하지 않습니다.");
    }
    if (!existingShot) {
      if (shots.size >= STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS) {
        throw new RangeError(`컷 일괄 렌더는 최대 ${STUDIO_BG3D_SHOT_BATCH_MAX_SHOTS}개 컷만 포함할 수 있습니다.`);
      }
      shots.set(skipped.shotId, { name: skipped.shotName, index: shots.size + 1 });
    }
    if (seenArtifactKeys.has(`${skipped.shotId}:${skipped.pass}`)) {
      throw new TypeError("완료 artifact와 생략 artifact가 충돌합니다.");
    }
    if (requestedPassSet && !requestedPassSet.has(skipped.pass)) {
      throw new TypeError("생략 artifact가 manifest 요청 패스에 없습니다.");
    }
    seenSkippedArtifactKeys.add(`${skipped.shotId}:${skipped.pass}`);
  }
  const seenPsdFallbackShotIds = new Set<string>();
  for (const fallback of manifestContext.psdFallbacks ?? []) {
    const existingShot = shots.get(fallback.shotId);
    if (!existingShot || existingShot.name !== fallback.shotName) {
      throw new TypeError("PSD fallback이 요청 컷 목록과 일치하지 않습니다.");
    }
    if (seenPsdShotIds.has(fallback.shotId)) {
      throw new TypeError("완료 PSD와 PSD fallback이 충돌합니다.");
    }
    seenPsdFallbackShotIds.add(fallback.shotId);
  }
  if (layeredPsdRequested === true) {
    for (const shot of manifestShots ?? []) {
      if (!seenPsdShotIds.has(shot.id) && !seenPsdFallbackShotIds.has(shot.id)) {
        throw new TypeError("요청한 컷 PSD가 완료 또는 fallback으로 정확히 설명되지 않았습니다.");
      }
    }
  } else if (
    layeredPsdRequested === false &&
    (layeredPsds.length > 0 || (manifestContext.psdFallbacks?.length ?? 0) > 0)
  ) {
    throw new TypeError("요청하지 않은 PSD artifact 또는 fallback이 포함되었습니다.");
  }
  if (contactSheetRequested === true) {
    if (contactSheets.length === 0 && manifestContext.contactSheetFallback === undefined) {
      throw new TypeError("요청한 콘택트 시트가 완료 또는 fallback으로 설명되지 않았습니다.");
    }
  } else if (
    contactSheetRequested === false &&
    (contactSheets.length > 0 || manifestContext.contactSheetFallback !== undefined)
  ) {
    throw new TypeError("요청하지 않은 콘택트 시트 artifact 또는 fallback이 포함되었습니다.");
  }
  if (requestedPassSet && manifestShots) {
    for (const shot of manifestShots) {
      for (const pass of requestedPassSet) {
        const key = `${shot.id}:${pass}`;
        if (!seenArtifactKeys.has(key) && !seenSkippedArtifactKeys.has(key)) {
          throw new TypeError("요청한 shot/pass가 완료 또는 생략 artifact로 정확히 설명되지 않았습니다.");
        }
      }
    }
  }
  if (
    images.length +
    layeredPsds.length +
    contactSheets.length +
    (manifestContext.skippedArtifacts?.length ?? 0) +
    (manifestContext.psdFallbacks?.length ?? 0) +
    (manifestContext.contactSheetFallback === undefined ? 0 : 1) >
      STUDIO_BG3D_SHOT_BATCH_MAX_ARCHIVE_ARTIFACTS
  ) {
    throw new RangeError("컷 일괄 렌더 artifact 합계가 안전 한도를 벗어났습니다.");
  }

  const legacyV1 = layeredPsds.length === 0 &&
    contactSheets.length === 0 &&
    images.every((image) => image.pass === undefined) &&
    images.length === shots.size &&
    publicRenderPlan === undefined &&
    manifestContext.resumeKey === undefined &&
    manifestContext.shots === undefined &&
    manifestContext.requestedPasses === undefined &&
    manifestContext.resolution === undefined &&
    manifestContext.skippedArtifacts === undefined &&
    manifestContext.psdFallbacks === undefined &&
    manifestContext.layeredPsdRequested === undefined &&
    manifestContext.contactSheetRequested === undefined &&
    manifestContext.contactSheetFallback === undefined;
  const files = images.map((image, index) => {
    const shot = shots.get(image.shotId)!;
    const pass = artifactPass(image);
    return {
      shotId: image.shotId,
      name: image.shotName,
      path: legacyV1
        ? `shots/${String(index + 1).padStart(3, "0")}.png`
        : `shots/${String(shot.index).padStart(3, "0")}/${pass}.png`,
      width: image.width,
      height: image.height,
      ...(legacyV1 ? { output: image.output ?? "beauty" } : {
        pass,
        status: "completed" as const,
        encoding: pass === "depth"
          ? "normalized-device-depth-u8"
          : "srgb-straight-alpha-rgba8",
        ...(pass === "depth" ? { nearIs: "black", farIs: "white" } : {}),
        ...(image.requestedHeight === undefined ? {} : {
          requestedHeight: image.requestedHeight,
          wasReduced: image.wasReduced,
        }),
      }),
    };
  });
  const requestedPasses = manifestRequestedPasses ??
    STUDIO_BG3D_SHOT_BATCH_PASSES.filter((pass) => images.some((image) => artifactPass(image) === pass));
  const producedPasses = STUDIO_BG3D_SHOT_BATCH_PASSES.filter((pass) =>
    images.some((image) => artifactPass(image) === pass));
  const artifacts = [
    ...files,
    ...layeredPsds.map((artifact) => {
      const shot = shots.get(artifact.shotId)!;
      return {
        shotId: artifact.shotId,
        name: artifact.shotName,
        kind: "layered-psd" as const,
        path: `shots/${String(shot.index).padStart(3, "0")}/layers.psd`,
        width: artifact.width,
        height: artifact.height,
        status: "completed" as const,
        encoding: "psd-v1-rle-rgba8",
      };
    }),
    ...contactSheets.map((artifact) => ({
      kind: "contact-sheet" as const,
      path: `contact/${artifact.fileName}`,
      sheetNumber: artifact.sheetNumber,
      width: artifact.width,
      height: artifact.height,
      shotIds: artifact.shotIds,
      status: "completed" as const,
      encoding: "srgb-opaque-rgb8",
    })),
    ...(manifestContext.skippedArtifacts ?? []).map((artifact) => ({
      shotId: artifact.shotId,
      name: artifact.shotName,
      pass: artifact.pass,
      status: "skipped" as const,
      reason: artifact.reason,
    })),
  ];
  const manifestPayload = legacyV1
    ? {
        kind: "toonspectrum-bg3d-shot-batch",
        version: 1,
        files,
      }
    : publicRenderPlan
      ? {
          kind: "toonspectrum-bg3d-shot-batch",
          version: 3,
          publicRenderPlan,
          producedPasses,
          artifacts,
          psdFallbacks: manifestContext.psdFallbacks ?? [],
          contactSheetFallback: manifestContext.contactSheetFallback ?? null,
        }
      : {
        kind: "toonspectrum-bg3d-shot-batch",
        version: 2,
        ...(manifestContext.resumeKey ? { resumeKey: manifestContext.resumeKey } : {}),
        requestedPasses,
        resolution: manifestResolution ?? { mode: "per-shot-maximum" as const },
        producedPasses,
        shots: [...shots].map(([shotId, shot]) => ({
          id: shotId,
          name: shot.name,
          index: shot.index,
        })),
        artifacts,
        layeredPsdRequested: layeredPsdRequested ?? layeredPsds.length > 0,
        psdFallbacks: manifestContext.psdFallbacks ?? [],
        contactSheetRequested: contactSheetRequested ?? contactSheets.length > 0,
        contactSheetFallback: manifestContext.contactSheetFallback ?? null,
      };
  const manifest = new TextEncoder().encode(JSON.stringify(manifestPayload, null, 2));
  throwIfAborted(signal);
  return buildStudioPackageArchiveBlob([
    { path: "manifest.json", data: manifest },
    ...images.map((image, index) => ({
      path: files[index]?.path ?? `shots/${String(index + 1).padStart(3, "0")}.png`,
      data: image.png,
    })),
    ...layeredPsds.map((artifact) => ({
      path: `shots/${String(shots.get(artifact.shotId)!.index).padStart(3, "0")}/layers.psd`,
      data: artifact.psd,
    })),
    ...contactSheets.map((artifact) => ({
      path: `contact/${artifact.fileName}`,
      data: artifact.png,
    })),
  ], {
    mimeType: "application/zip",
    crc32ExecutionMode: options.crc32ExecutionMode ?? "worker",
    signal,
    limits: {
      maxFiles: STUDIO_BG3D_SHOT_BATCH_MAX_ARCHIVE_ARTIFACTS + 1,
      maxEntryBytes: STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES,
      // The image budget was already checked above. Leave a small bounded allowance for the
      // manifest and ZIP bookkeeping instead of accidentally rejecting an exact-budget image set.
      maxTotalBytes: STUDIO_BG3D_SHOT_BATCH_MAX_TOTAL_BYTES + 256 * 1024,
      maxArchiveBytes: 400 * 1024 * 1024,
      maxPathBytes: 256,
    },
    onProgress: (progress) => {
      throwIfAborted(signal);
      onProgress?.({
        completedFiles: progress.completedFiles,
        totalFiles: progress.totalFiles,
      });
    },
  });
}
