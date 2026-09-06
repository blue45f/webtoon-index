/**
 * Engine-neutral planning contract for deterministic storyboard batch renders.
 *
 * Plan v2 is deliberately asynchronous: source, scope, and the complete frozen render plan are
 * identified with SHA-256 before any artifact is captured or recovery storage is opened. The
 * interactive renderer still owns applying one shot at a time, but it must execute the exact
 * dimensions/background/depth request recorded here instead of re-deriving them after a restart.
 */

import { compareStudioValidationStrings } from "../studio-validation-string-order";

import { getStudioBg3dCaptureBackendIdentity } from "./studio-bg3d-capture-adapter";
import {
  createStudioBg3dCaptureBackgroundSnapshot,
  studioBg3dCaptureBackgroundRequestFromSnapshot,
} from "./studio-bg3d-capture-background";
import {
  resolveStudioBg3dShotCaptureSize,
  type StudioBg3dLtCaptureSize,
} from "./studio-bg3d-lt-capture-size";
import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";
import {
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS,
  applyStudioBg3dShot,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import { STUDIO_BG3D_SHOT_BATCH_PASSES } from "./studio-bg3d-shot-batch-pass-catalog";

import type {
  StudioBg3dCaptureBackend,
  StudioBg3dCaptureEngineId,
  StudioBg3dCaptureGraphicsApi,
} from "./studio-bg3d-capture-adapter";
import type { StudioBg3dShotBatchPass } from "./studio-bg3d-shot-batch-pass-catalog";

export {
  STUDIO_BG3D_SHOT_BATCH_PASSES,
  STUDIO_BG3D_SHOT_BATCH_PASS_LABELS,
} from "./studio-bg3d-shot-batch-pass-catalog";
export type { StudioBg3dShotBatchPass } from "./studio-bg3d-shot-batch-pass-catalog";

export const STUDIO_BG3D_SHOT_BATCH_MAX_PASSES = STUDIO_BG3D_SHOT_BATCH_PASSES.length;
export const STUDIO_BG3D_SHOT_BATCH_MAX_FILES =
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS * STUDIO_BG3D_SHOT_BATCH_MAX_PASSES;
export const STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_DIMENSION = 4_096;
export const STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_PIXELS = STUDIO_BG3D_LT_RENDER_MAX_PIXELS;
export const STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_SOURCE_DIMENSION = 32_768;
export const STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1 = "studio-lt-color-tone-line-depth-v1";
export const STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1 = "png-srgb-straight-alpha-v1";
export const STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1 = "psd-rgba8-layered-v1";

/**
 * Resolve batch capture size with optional document aspect (insert-path parity).
 * Thin alias of {@link resolveStudioBg3dShotCaptureSize} kept for existing call sites/tests.
 */
export function resolveStudioBg3dShotBatchCaptureSize(input: {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly requestedHeight: number;
  readonly maxPixels: number;
  readonly maxEdge?: number;
  readonly exportAspectRatio?: number | null;
}): StudioBg3dLtCaptureSize | null {
  return resolveStudioBg3dShotCaptureSize(input);
}

export { resolveStudioBg3dShotCaptureSize };


export interface StudioBg3dShotBatchSourceShot {
  readonly id: string;
  readonly name: string;
}

/**
 * Same-origin recovery partition. This is not an authorization boundary: callers must re-check
 * current work access before hydrating or continuing a job.
 *
 * Sentinel values such as `anonymous`, `local-draft`, and `new-bg3d` are allowed, but callers must
 * still provide all fields. This prevents an authenticated user's artifacts from being resumed in
 * another work/page/element merely because the scene bytes happen to match.
 */
export interface StudioBg3dShotBatchRecoveryScope {
  /** Draft/new/guest sessions are deliberately memory-only until they own persisted stable ids. */
  readonly durability: "durable" | "memory";
  readonly authUserId: string;
  readonly workId: string;
  readonly pageId: string;
  readonly elementId: string;
}

export interface StudioBg3dShotBatchCaptureOwner {
  readonly backend: StudioBg3dCaptureBackend;
  readonly engineId: StudioBg3dCaptureEngineId;
  /** Upstream engine/library revision. */
  readonly engineRevision: string;
  /** ToonSpectrum-owned adapter/shader/readback revision. */
  readonly implementationRevision: string;
  readonly graphicsApi: StudioBg3dCaptureGraphicsApi;
  /** Versioned color/depth/readback contract, independent of a transient renderer instance. */
  readonly profileId: string;
  /** Source framebuffer sampled when every output size was frozen. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /**
   * Optional document panel aspect (width/height). When set, every shot freezes the same
   * composition regardless of the live 3D panel viewport — matching LT insert capture.
   */
  readonly exportAspectRatio?: number;
  readonly maxPixels: number;
  readonly maxEdge: number;
  /** Output-affecting resolved quality values; timing-only values are intentionally excluded. */
  readonly deviceProfile: "mobile" | "desktop";
  readonly textureScale: number;
  readonly lodBias: number;
  /** Bump independently when LT math/surfaces or PNG pixel semantics change. */
  readonly ltPipelineId: string;
  readonly pngEncodingId: string;
  readonly psdEncodingId: string;
}

export interface StudioBg3dShotBatchCaptureSpecInput {
  readonly shotId: string;
  readonly width: number;
  readonly height: number;
  readonly requestedHeight: number;
  readonly wasReduced: boolean;
  readonly includeDepth: boolean;
  readonly shadows: boolean;
  readonly shadowMapSize: 0 | 256 | 512 | 1024 | 2048 | 4096;
  readonly background: {
    readonly color: string;
    readonly alpha: number;
  };
}

export interface StudioBg3dShotBatchCapturePlanInput {
  readonly owner: StudioBg3dShotBatchCaptureOwner;
  /** Exactly one entry for every source shot; selection is applied only after validation. */
  readonly shots: readonly StudioBg3dShotBatchCaptureSpecInput[];
}

export type StudioBg3dShotBatchFrozenCaptureSpec = Omit<
  StudioBg3dShotBatchCaptureSpecInput,
  "shotId"
>;

export interface StudioBg3dShotBatchPlannedFile {
  /** Stable within one plan and safe to use as a recovery-map key. */
  readonly key: string;
  readonly shotId: string;
  readonly shotName: string;
  readonly shotIndex: number;
  readonly pass: StudioBg3dShotBatchPass;
  readonly path: string;
}

export interface StudioBg3dShotBatchPlannedShot {
  readonly shotId: string;
  readonly shotName: string;
  readonly shotIndex: number;
  readonly capture: StudioBg3dShotBatchFrozenCaptureSpec;
  readonly files: readonly StudioBg3dShotBatchPlannedFile[];
}

export interface StudioBg3dShotBatchPlan {
  readonly kind: "toonspectrum-bg3d-shot-batch-plan";
  readonly version: 2;
  /** SHA-256 over the canonical scene serialization supplied by the caller. */
  readonly sourceDigest: string;
  /** SHA-256 over the normalized auth/work/page/element scope. */
  readonly scopeDigest: string;
  /** SHA-256 over every deterministic plan field, excluding this digest and resumeKey. */
  readonly planDigest: string;
  /** SHA-256 over `{scopeDigest, planDigest}`; used only for local recovery partitioning. */
  readonly recoveryDigest: string;
  readonly resumeKey: string;
  /** Retained only in local plan/recovery state; archive manifests expose no raw scope values. */
  readonly scope: StudioBg3dShotBatchRecoveryScope;
  readonly captureOwner: StudioBg3dShotBatchCaptureOwner;
  readonly passes: readonly StudioBg3dShotBatchPass[];
  readonly exportHeight: "per-shot" | number;
  readonly includeLayeredPsd: boolean;
  readonly includeContactSheet: boolean;
  readonly shots: readonly StudioBg3dShotBatchPlannedShot[];
  readonly files: readonly StudioBg3dShotBatchPlannedFile[];
}

export type StudioBg3dShotBatchPlanErrorCode =
  | "invalid-shots"
  | "duplicate-shot-id"
  | "invalid-selection"
  | "invalid-source-revision"
  | "invalid-scope"
  | "invalid-capture"
  | "duplicate-capture-shot"
  | "missing-capture-shot"
  | "digest-unavailable"
  | "duplicate-selection"
  | "unknown-selection"
  | "empty-selection"
  | "invalid-pass"
  | "duplicate-pass"
  | "empty-passes"
  | "file-budget";

export interface StudioBg3dShotBatchPlanFailure {
  readonly ok: false;
  readonly code: StudioBg3dShotBatchPlanErrorCode;
  readonly message: string;
}

export interface StudioBg3dShotBatchPlanSuccess {
  readonly ok: true;
  readonly plan: StudioBg3dShotBatchPlan;
}

export interface CreateStudioBg3dShotBatchPlanOptions {
  /** Omit to render every shot. Input order never changes canonical storyboard order. */
  readonly selectedShotIds?: readonly string[];
  /** Omit to preserve the legacy one-file LT-composite export. */
  readonly passes?: readonly StudioBg3dShotBatchPass[];
  /** Canonical scene serialization. It is hashed and never retained in the plan. */
  readonly sourceRevision: string;
  /** Required durable ownership boundary. */
  readonly scope: StudioBg3dShotBatchRecoveryScope;
  /** Required, already budgeted capture requests for every source shot. */
  readonly capture: StudioBg3dShotBatchCapturePlanInput;
  readonly layeredPsd?: boolean;
  readonly contactSheet?: boolean;
  readonly exportHeight?: "per-shot" | number;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._:+/-]{0,119}$/u;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const NAME_MAX_CODE_POINTS = 80;
const SCOPE_VALUE_MAX_CODE_POINTS = 256;
const SOURCE_REVISION_MAX_BYTES = 320 * 1024;
const UNSAFE_SCOPE_PATTERN = /\p{Cc}/u;
const SHADOW_MAP_SIZES = new Set([0, 256, 512, 1024, 2048, 4096]);

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compareStudioValidationStrings);
  const canonical = [...expected].sort(compareStudioValidationStrings);
  return actual.length === canonical.length &&
    actual.every((key, index) => key === canonical[index]);
}

function failure(
  code: StudioBg3dShotBatchPlanErrorCode,
  message: string,
): StudioBg3dShotBatchPlanFailure {
  return { ok: false, code, message };
}

function validShot(value: unknown): value is StudioBg3dShotBatchSourceShot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const shot = value as Partial<StudioBg3dShotBatchSourceShot>;
  return typeof shot.id === "string" &&
    ID_PATTERN.test(shot.id) &&
    typeof shot.name === "string" &&
    shot.name === shot.name.trim() &&
    Array.from(shot.name).length >= 1 &&
    Array.from(shot.name).length <= NAME_MAX_CODE_POINTS;
}

function validScopeValue(value: unknown): value is string {
  return typeof value === "string" &&
    value === value.trim() &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= SCOPE_VALUE_MAX_CODE_POINTS &&
    !UNSAFE_SCOPE_PATTERN.test(value);
}

function validScope(value: unknown): value is StudioBg3dShotBatchRecoveryScope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const scope = value as Partial<StudioBg3dShotBatchRecoveryScope>;
  return hasExactKeys(value, ["durability", "authUserId", "workId", "pageId", "elementId"]) &&
    (scope.durability === "durable" || scope.durability === "memory") &&
    validScopeValue(scope.authUserId) &&
    validScopeValue(scope.workId) &&
    validScopeValue(scope.pageId) &&
    validScopeValue(scope.elementId);
}

function isPass(value: unknown): value is StudioBg3dShotBatchPass {
  return typeof value === "string" &&
    (STUDIO_BG3D_SHOT_BATCH_PASSES as readonly string[]).includes(value);
}

function canonicalPasses(
  requested: readonly StudioBg3dShotBatchPass[] | undefined,
): readonly StudioBg3dShotBatchPass[] | StudioBg3dShotBatchPlanFailure {
  const source = requested ?? ["lt-composite"];
  if (!Array.isArray(source)) {
    return failure("invalid-pass", "컷 배치 출력 패스 형식이 올바르지 않습니다.");
  }
  if (source.length === 0) {
    return failure("empty-passes", "컷 배치 출력 패스를 하나 이상 선택해 주세요.");
  }
  const seen = new Set<StudioBg3dShotBatchPass>();
  for (const pass of source) {
    if (!isPass(pass)) {
      return failure("invalid-pass", "지원하지 않는 컷 배치 출력 패스입니다.");
    }
    if (seen.has(pass)) {
      return failure("duplicate-pass", "컷 배치 출력 패스가 중복되었습니다.");
    }
    seen.add(pass);
  }
  return STUDIO_BG3D_SHOT_BATCH_PASSES.filter((pass) => seen.has(pass));
}

function validCaptureOwner(value: unknown): value is StudioBg3dShotBatchCaptureOwner {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const owner = value as Partial<StudioBg3dShotBatchCaptureOwner> & Record<string, unknown>;
  const expectedIdentity = owner.backend
    ? getStudioBg3dCaptureBackendIdentity(owner.backend)
    : null;
  const requiredKeys = [
    "backend",
    "engineId",
    "engineRevision",
    "implementationRevision",
    "graphicsApi",
    "profileId",
    "sourceWidth",
    "sourceHeight",
    "maxPixels",
    "maxEdge",
    "deviceProfile",
    "textureScale",
    "lodBias",
    "ltPipelineId",
    "pngEncodingId",
    "psdEncodingId",
  ] as const;
  const keys = Object.keys(owner);
  const allowed = new Set<string>([...requiredKeys, "exportAspectRatio"]);
  if (
    keys.length < requiredKeys.length
    || keys.length > requiredKeys.length + 1
    || !keys.every((key) => allowed.has(key))
    || !requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(owner, key))
  ) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(owner, "exportAspectRatio")) {
    if (
      typeof owner.exportAspectRatio !== "number"
      || !Number.isFinite(owner.exportAspectRatio)
      || owner.exportAspectRatio <= 0
      || owner.exportAspectRatio > 32
    ) {
      return false;
    }
  }
  return expectedIdentity !== null && owner.engineId === expectedIdentity[0] &&
    owner.graphicsApi === expectedIdentity[1] &&
    typeof owner.engineRevision === "string" && PROFILE_ID_PATTERN.test(owner.engineRevision) &&
    typeof owner.implementationRevision === "string" &&
    PROFILE_ID_PATTERN.test(owner.implementationRevision) &&
    typeof owner.profileId === "string" && PROFILE_ID_PATTERN.test(owner.profileId) &&
    Number.isSafeInteger(owner.sourceWidth) && owner.sourceWidth! >= 1 &&
    owner.sourceWidth! <= STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_SOURCE_DIMENSION &&
    Number.isSafeInteger(owner.sourceHeight) && owner.sourceHeight! >= 1 &&
    owner.sourceHeight! <= STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_SOURCE_DIMENSION &&
    Number.isSafeInteger(owner.maxPixels) && owner.maxPixels! >= 1 &&
    owner.maxPixels! <= STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_PIXELS &&
    Number.isSafeInteger(owner.maxEdge) && owner.maxEdge! >= 1 &&
    owner.maxEdge! <= STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_DIMENSION &&
    (owner.deviceProfile === "mobile" || owner.deviceProfile === "desktop") &&
    typeof owner.textureScale === "number" && Number.isFinite(owner.textureScale) &&
    owner.textureScale >= 0.01 && owner.textureScale <= 4 &&
    typeof owner.lodBias === "number" && Number.isFinite(owner.lodBias) &&
    owner.lodBias >= 0 && owner.lodBias <= 8 &&
    typeof owner.ltPipelineId === "string" && PROFILE_ID_PATTERN.test(owner.ltPipelineId) &&
    typeof owner.pngEncodingId === "string" && PROFILE_ID_PATTERN.test(owner.pngEncodingId) &&
    typeof owner.psdEncodingId === "string" && PROFILE_ID_PATTERN.test(owner.psdEncodingId);
}

function validCaptureSpec(value: unknown): value is StudioBg3dShotBatchCaptureSpecInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const spec = value as Partial<StudioBg3dShotBatchCaptureSpecInput>;
  const pixels = typeof spec.width === "number" && typeof spec.height === "number"
    ? spec.width * spec.height
    : Number.NaN;
  return hasExactKeys(value, [
    "shotId",
    "width",
    "height",
    "requestedHeight",
    "wasReduced",
    "includeDepth",
    "shadows",
    "shadowMapSize",
    "background",
  ]) &&
    typeof spec.shotId === "string" && ID_PATTERN.test(spec.shotId) &&
    Number.isSafeInteger(spec.width) && spec.width! >= 1 &&
    spec.width! <= STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_DIMENSION &&
    Number.isSafeInteger(spec.height) && spec.height! >= 1 &&
    spec.height! <= STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_DIMENSION &&
    Number.isSafeInteger(pixels) && pixels >= 1 &&
    pixels <= STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_PIXELS &&
    Number.isSafeInteger(spec.requestedHeight) && spec.requestedHeight! >= 256 &&
    spec.requestedHeight! <= STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_DIMENSION &&
    spec.height! <= spec.requestedHeight! &&
    typeof spec.wasReduced === "boolean" &&
    spec.wasReduced === (spec.height! < spec.requestedHeight!) &&
    typeof spec.includeDepth === "boolean" &&
    typeof spec.shadows === "boolean" &&
    Number.isSafeInteger(spec.shadowMapSize) && SHADOW_MAP_SIZES.has(spec.shadowMapSize!) &&
    spec.shadowMapSize === (spec.shadows ? spec.shadowMapSize : 0) &&
    (!spec.shadows || spec.shadowMapSize! > 0) &&
    typeof spec.background === "object" && spec.background !== null &&
    hasExactKeys(spec.background, ["color", "alpha"]) &&
    typeof spec.background.color === "string" && HEX_COLOR_PATTERN.test(spec.background.color) &&
    (spec.background.alpha === 0 || spec.background.alpha === 1);
}

function copyCaptureOwner(owner: StudioBg3dShotBatchCaptureOwner): StudioBg3dShotBatchCaptureOwner {
  const next: StudioBg3dShotBatchCaptureOwner = {
    backend: owner.backend,
    engineId: owner.engineId,
    engineRevision: owner.engineRevision,
    implementationRevision: owner.implementationRevision,
    graphicsApi: owner.graphicsApi,
    profileId: owner.profileId,
    sourceWidth: owner.sourceWidth,
    sourceHeight: owner.sourceHeight,
    maxPixels: owner.maxPixels,
    maxEdge: owner.maxEdge,
    deviceProfile: owner.deviceProfile,
    textureScale: owner.textureScale,
    lodBias: owner.lodBias,
    ltPipelineId: owner.ltPipelineId,
    pngEncodingId: owner.pngEncodingId,
    psdEncodingId: owner.psdEncodingId,
  };
  if (
    typeof owner.exportAspectRatio === "number"
    && Number.isFinite(owner.exportAspectRatio)
    && owner.exportAspectRatio > 0
  ) {
    return { ...next, exportAspectRatio: owner.exportAspectRatio };
  }
  return next;
}

function copyCaptureSpec(
  spec: StudioBg3dShotBatchCaptureSpecInput,
): StudioBg3dShotBatchFrozenCaptureSpec {
  return {
    width: spec.width,
    height: spec.height,
    requestedHeight: spec.requestedHeight,
    wasReduced: spec.wasReduced,
    includeDepth: spec.includeDepth,
    shadows: spec.shadows,
    shadowMapSize: spec.shadowMapSize,
    background: { color: spec.background.color.toLowerCase(), alpha: spec.background.alpha },
  };
}

function copyPlannedFile(
  file: StudioBg3dShotBatchPlannedFile,
): StudioBg3dShotBatchPlannedFile {
  return {
    key: file.key,
    shotId: file.shotId,
    shotName: file.shotName,
    shotIndex: file.shotIndex,
    pass: file.pass,
    path: file.path,
  };
}

function samePlannedFile(
  left: StudioBg3dShotBatchPlannedFile | undefined,
  right: StudioBg3dShotBatchPlannedFile,
): boolean {
  return left !== undefined &&
    left.key === right.key &&
    left.shotId === right.shotId &&
    left.shotName === right.shotName &&
    left.shotIndex === right.shotIndex &&
    left.pass === right.pass &&
    left.path === right.path;
}

/** Rebuilds every retained field in its canonical serialization order. */
function copyCanonicalPlan(plan: StudioBg3dShotBatchPlan): StudioBg3dShotBatchPlan {
  const shots = plan.shots.map((shot): StudioBg3dShotBatchPlannedShot => ({
    shotId: shot.shotId,
    shotName: shot.shotName,
    shotIndex: shot.shotIndex,
    capture: copyCaptureSpec({ shotId: shot.shotId, ...shot.capture }),
    files: shot.files.map(copyPlannedFile),
  }));
  const files = shots.flatMap((shot) => shot.files);
  return {
    kind: "toonspectrum-bg3d-shot-batch-plan",
    version: 2,
    sourceDigest: plan.sourceDigest,
    scopeDigest: plan.scopeDigest,
    planDigest: plan.planDigest,
    recoveryDigest: plan.recoveryDigest,
    resumeKey: plan.resumeKey,
    scope: {
      durability: plan.scope.durability,
      authUserId: plan.scope.authUserId,
      workId: plan.scope.workId,
      pageId: plan.scope.pageId,
      elementId: plan.scope.elementId,
    },
    captureOwner: copyCaptureOwner(plan.captureOwner),
    passes: [...plan.passes],
    exportHeight: plan.exportHeight,
    includeLayeredPsd: plan.includeLayeredPsd,
    includeContactSheet: plan.includeContactSheet,
    shots,
    files,
  };
}

async function sha256Hex(value: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") return null;
  try {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function canonicalRenderIdentity(input: Pick<
  StudioBg3dShotBatchPlan,
  | "sourceDigest"
  | "captureOwner"
  | "shots"
  | "passes"
  | "exportHeight"
  | "includeLayeredPsd"
  | "includeContactSheet"
>): string {
  return JSON.stringify({
    kind: "toonspectrum-bg3d-shot-batch-plan",
    version: 2,
    sourceDigest: input.sourceDigest,
    captureOwner: input.captureOwner,
    shots: input.shots.map(({ shotId, shotName, shotIndex, capture }) => ({
      shotId,
      shotName,
      shotIndex,
      capture,
    })),
    passes: input.passes,
    exportHeight: input.exportHeight,
    includeLayeredPsd: input.includeLayeredPsd,
    includeContactSheet: input.includeContactSheet,
  });
}

/**
 * Recomputes the scope-independent Plan-v2 render digest from a canonical identity snapshot. Public
 * archive code uses this to reject a structurally valid manifest whose digest does not own its fields.
 */
export async function computeStudioBg3dShotBatchRenderDigest(input: Pick<
  StudioBg3dShotBatchPlan,
  | "sourceDigest"
  | "captureOwner"
  | "shots"
  | "passes"
  | "exportHeight"
  | "includeLayeredPsd"
  | "includeContactSheet"
>): Promise<string | null> {
  let identity: string;
  try {
    identity = canonicalRenderIdentity(input);
  } catch {
    return null;
  }
  return sha256Hex(identity);
}

function canonicalRecoveryIdentity(scopeDigest: string, planDigest: string): string {
  return JSON.stringify({
    kind: "toonspectrum-bg3d-shot-batch-recovery",
    version: 2,
    scopeDigest,
    planDigest,
  });
}

function freezePlan(plan: StudioBg3dShotBatchPlan): StudioBg3dShotBatchPlan {
  Object.freeze(plan.scope);
  Object.freeze(plan.captureOwner);
  for (const shot of plan.shots) {
    Object.freeze(shot.capture.background);
    Object.freeze(shot.capture);
    for (const file of shot.files) Object.freeze(file);
    Object.freeze(shot.files);
    Object.freeze(shot);
  }
  Object.freeze(plan.shots);
  Object.freeze(plan.files);
  Object.freeze(plan.passes);
  return Object.freeze(plan);
}

export function isStudioBg3dShotBatchPlan(value: unknown): value is StudioBg3dShotBatchPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const plan = value as Partial<StudioBg3dShotBatchPlan>;
  if (
    !hasExactKeys(value, [
      "kind",
      "version",
      "sourceDigest",
      "scopeDigest",
      "planDigest",
      "recoveryDigest",
      "resumeKey",
      "scope",
      "captureOwner",
      "passes",
      "exportHeight",
      "includeLayeredPsd",
      "includeContactSheet",
      "shots",
      "files",
    ]) ||
    plan.kind !== "toonspectrum-bg3d-shot-batch-plan" ||
    plan.version !== 2 ||
    typeof plan.sourceDigest !== "string" || !SHA256_HEX_PATTERN.test(plan.sourceDigest) ||
    typeof plan.scopeDigest !== "string" || !SHA256_HEX_PATTERN.test(plan.scopeDigest) ||
    typeof plan.planDigest !== "string" || !SHA256_HEX_PATTERN.test(plan.planDigest) ||
    typeof plan.recoveryDigest !== "string" || !SHA256_HEX_PATTERN.test(plan.recoveryDigest) ||
    plan.resumeKey !== `bg3d-batch-v2-${plan.recoveryDigest}` ||
    !validScope(plan.scope) ||
    !validCaptureOwner(plan.captureOwner) ||
    !Array.isArray(plan.passes) || plan.passes.length < 1 ||
    plan.passes.some((pass) => !isPass(pass)) || new Set(plan.passes).size !== plan.passes.length ||
    STUDIO_BG3D_SHOT_BATCH_PASSES.filter((pass) => plan.passes!.includes(pass))
      .some((pass, index) => pass !== plan.passes![index]) ||
    (plan.exportHeight !== "per-shot" && (
      !Number.isSafeInteger(plan.exportHeight) || plan.exportHeight! < 256 ||
      plan.exportHeight! > STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_DIMENSION
    )) ||
    typeof plan.includeLayeredPsd !== "boolean" ||
    typeof plan.includeContactSheet !== "boolean" ||
    !Array.isArray(plan.shots) || plan.shots.length < 1 ||
    plan.shots.length > STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS ||
    !Array.isArray(plan.files) || plan.files.length < 1 ||
    plan.files.length > STUDIO_BG3D_SHOT_BATCH_MAX_FILES
  ) return false;
  const shotIds = new Set<string>();
  let fileCount = 0;
  for (let index = 0; index < plan.shots.length; index += 1) {
    const shot = plan.shots[index];
    if (!shot || !hasExactKeys(shot, ["shotId", "shotName", "shotIndex", "capture", "files"]) ||
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
      !validShot({ id: shot.shotId, name: shot.shotName }) ||
      shot.shotIndex !== index + 1 || shotIds.has(shot.shotId) ||
      !validCaptureSpec({ shotId: shot.shotId, ...shot.capture }) ||
      !Array.isArray(shot.files) || shot.files.length !== plan.passes.length
    ) return false;
    const resolvedSize = resolveStudioBg3dShotCaptureSize({
      sourceWidth: plan.captureOwner.sourceWidth,
      sourceHeight: plan.captureOwner.sourceHeight,
      requestedHeight: shot.capture.requestedHeight,
      maxPixels: plan.captureOwner.maxPixels,
      maxEdge: plan.captureOwner.maxEdge,
      exportAspectRatio: plan.captureOwner.exportAspectRatio,
    });
    if (!resolvedSize ||
      shot.capture.width !== resolvedSize.width ||
      shot.capture.height !== resolvedSize.height ||
      shot.capture.wasReduced !== resolvedSize.wasReduced ||
      (plan.exportHeight !== "per-shot" &&
        shot.capture.requestedHeight !== plan.exportHeight) ||
      (plan.passes.includes("depth") && !shot.capture.includeDepth)
    ) return false;
    shotIds.add(shot.shotId);
    for (let passIndex = 0; passIndex < shot.files.length; passIndex += 1) {
      const file = shot.files[passIndex];
      const pass = plan.passes[passIndex];
      const ordinal = String(index + 1).padStart(3, "0");
      if (!file || !hasExactKeys(file, [
        "key",
        "shotId",
        "shotName",
        "shotIndex",
        "pass",
        "path",
      ]) || !pass || file.key !== `${shot.shotId}:${pass}` ||
        file.shotId !== shot.shotId || file.shotName !== shot.shotName ||
        file.shotIndex !== index + 1 || file.pass !== pass ||
        file.path !== `shots/${ordinal}/${pass}.png`
      ) return false;
      if (!samePlannedFile(plan.files[fileCount], file)) return false;
      fileCount += 1;
    }
  }
  return fileCount === plan.files.length;
}

/**
 * Strict durable-hydration boundary. It snapshots the value before awaiting WebCrypto, rejects
 * unknown fields and forged digests, then returns a deeply frozen defensive copy.
 */
export async function hydrateStudioBg3dShotBatchPlan(
  value: unknown,
): Promise<StudioBg3dShotBatchPlan | null> {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return null;
  }
  if (!isStudioBg3dShotBatchPlan(snapshot)) return null;
  const canonical = copyCanonicalPlan(snapshot);
  const [scopeDigest, planDigest] = await Promise.all([
    sha256Hex(JSON.stringify(canonical.scope)),
    sha256Hex(canonicalRenderIdentity(canonical)),
  ]);
  if (!scopeDigest || !planDigest ||
    scopeDigest !== canonical.scopeDigest || planDigest !== canonical.planDigest) return null;
  const recoveryDigest = await sha256Hex(canonicalRecoveryIdentity(scopeDigest, planDigest));
  if (!recoveryDigest || recoveryDigest !== canonical.recoveryDigest ||
    canonical.resumeKey !== `bg3d-batch-v2-${recoveryDigest}`) return null;
  return freezePlan(canonical);
}

/** Verifies the private canonical scene snapshot retained by durable recovery storage. */
export async function verifyStudioBg3dShotBatchSourceRevision(
  plan: StudioBg3dShotBatchPlan,
  sourceRevision: string,
): Promise<boolean> {
  if (!isStudioBg3dShotBatchPlan(plan) || typeof sourceRevision !== "string") return false;
  const parsed = parseStudioBg3dSceneDocument(sourceRevision);
  if (!parsed || serializeStudioBg3dSceneDocument(parsed) !== sourceRevision) return false;
  return await sha256Hex(sourceRevision) === plan.sourceDigest;
}

export async function createStudioBg3dShotBatchPlan(
  shots: readonly StudioBg3dShotBatchSourceShot[],
  options: CreateStudioBg3dShotBatchPlanOptions,
): Promise<StudioBg3dShotBatchPlanSuccess | StudioBg3dShotBatchPlanFailure> {
  if (
    !Array.isArray(shots) ||
    shots.length < 1 ||
    shots.length > STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS ||
    shots.some((shot) => !validShot(shot))
  ) {
    return failure("invalid-shots", "컷 배치 원본이 장면 문서 한도 또는 형식을 벗어났습니다.");
  }
  const shotById = new Map<string, StudioBg3dShotBatchSourceShot>();
  for (const shot of shots) {
    if (shotById.has(shot.id)) {
      return failure("duplicate-shot-id", "컷 배치 원본에 중복 ID가 있습니다.");
    }
    shotById.set(shot.id, shot);
  }
  if (
    !options || typeof options !== "object" ||
    typeof options.sourceRevision !== "string" ||
    options.sourceRevision.length < 1 ||
    new TextEncoder().encode(options.sourceRevision).byteLength > SOURCE_REVISION_MAX_BYTES
  ) {
    return failure("invalid-source-revision", "컷 배치 장면 revision이 올바르지 않습니다.");
  }
  const parsedSourceRevision = parseStudioBg3dSceneDocument(options.sourceRevision);
  if (
    !parsedSourceRevision ||
    serializeStudioBg3dSceneDocument(parsedSourceRevision) !== options.sourceRevision
  ) {
    return failure("invalid-source-revision", "컷 배치 장면 revision이 canonical JSON이 아닙니다.");
  }
  const revisionShots = parsedSourceRevision.shots ?? [];
  if (
    revisionShots.length !== shots.length ||
    revisionShots.some((shot, index) =>
      shot.id !== shots[index]?.id || shot.name !== shots[index]?.name
    )
  ) {
    return failure("invalid-source-revision", "컷 배치 원본 컷이 canonical 장면 revision과 일치하지 않습니다.");
  }
  if (!validScope(options.scope)) {
    return failure("invalid-scope", "컷 배치 복구 소유 범위가 올바르지 않습니다.");
  }
  if (options.layeredPsd !== undefined && typeof options.layeredPsd !== "boolean") {
    return failure("invalid-pass", "컷 배치 PSD 옵션이 올바르지 않습니다.");
  }
  if (options.contactSheet !== undefined && typeof options.contactSheet !== "boolean") {
    return failure("invalid-pass", "컷 배치 콘택트 시트 옵션이 올바르지 않습니다.");
  }
  const exportHeight = options.exportHeight ?? "per-shot";
  if (
    exportHeight !== "per-shot" &&
    (!Number.isSafeInteger(exportHeight) || exportHeight < 256 ||
      exportHeight > STUDIO_BG3D_SHOT_BATCH_PLAN_MAX_DIMENSION)
  ) {
    return failure("invalid-pass", "컷 배치 고정 출력 높이가 올바르지 않습니다.");
  }
  const passes = canonicalPasses(options.passes);
  if ("ok" in passes) return passes;
  if (
    !options.capture || typeof options.capture !== "object" ||
    !validCaptureOwner(options.capture.owner) || !Array.isArray(options.capture.shots) ||
    options.capture.shots.length !== shots.length ||
    options.capture.shots.some((spec) => !validCaptureSpec(spec))
  ) {
    return failure("invalid-capture", "컷 배치 캡처 계획이 올바르지 않습니다.");
  }
  const captureByShotId = new Map<string, StudioBg3dShotBatchCaptureSpecInput>();
  /** Aspects observed from applied shot output when the owner omits exportAspectRatio. */
  const derivedAspects = new Set<number>();
  for (const capture of options.capture.shots) {
    if (captureByShotId.has(capture.shotId)) {
      return failure("duplicate-capture-shot", "컷 배치 캡처 계획에 중복 컷이 있습니다.");
    }
    if (!shotById.has(capture.shotId)) {
      return failure("missing-capture-shot", "컷 배치 캡처 계획이 원본 컷과 일치하지 않습니다.");
    }
    if (
      capture.width * capture.height > options.capture.owner.maxPixels ||
      capture.width > options.capture.owner.maxEdge ||
      capture.height > options.capture.owner.maxEdge
    ) {
      return failure("invalid-capture", "컷 배치 캡처 계획이 선언한 기기 예산을 벗어났습니다.");
    }
    const applied = applyStudioBg3dShot(parsedSourceRevision, capture.shotId);
    if (!applied) {
      return failure("invalid-capture", "컷 배치 캡처 계획을 canonical 컷에 적용할 수 없습니다.");
    }
    const requestedHeight = exportHeight === "per-shot"
      ? applied.output.exportHeight
      : exportHeight;
    // Owner freezes plan-level aspect; otherwise fall back to the applied shot document field.
    const exportAspectRatio =
      options.capture.owner.exportAspectRatio ??
      applied.output.exportAspectRatio;
    if (
      options.capture.owner.exportAspectRatio === undefined &&
      typeof applied.output.exportAspectRatio === "number" &&
      Number.isFinite(applied.output.exportAspectRatio) &&
      applied.output.exportAspectRatio > 0
    ) {
      derivedAspects.add(applied.output.exportAspectRatio);
    }
    const resolvedSize = resolveStudioBg3dShotCaptureSize({
      sourceWidth: options.capture.owner.sourceWidth,
      sourceHeight: options.capture.owner.sourceHeight,
      requestedHeight,
      maxPixels: options.capture.owner.maxPixels,
      maxEdge: options.capture.owner.maxEdge,
      exportAspectRatio,
    });
    if (!resolvedSize ||
      capture.width !== resolvedSize.width ||
      capture.height !== resolvedSize.height ||
      capture.requestedHeight !== requestedHeight ||
      capture.wasReduced !== resolvedSize.wasReduced
    ) {
      return failure("invalid-capture", "컷 배치 캡처 해상도가 canonical 출력 계획과 일치하지 않습니다.");
    }
    const includeDepth = applied.output.line.depthEnabled || passes.includes("depth");
    if (capture.includeDepth !== includeDepth) {
      return failure("invalid-capture", "컷 배치 깊이 캡처가 canonical 출력 패스와 일치하지 않습니다.");
    }
    const background = createStudioBg3dCaptureBackgroundSnapshot({
      background: applied.background,
      transparent: applied.output.transparentBackground,
    });
    const plannedBackground = studioBg3dCaptureBackgroundRequestFromSnapshot(background);
    if (
      capture.background.color.toLowerCase() !== plannedBackground.color.toLowerCase() ||
      capture.background.alpha !== plannedBackground.alpha
    ) {
      return failure("invalid-capture", "컷 배치 배경 캡처가 canonical 장면 배경과 일치하지 않습니다.");
    }
    captureByShotId.set(capture.shotId, capture);
  }
  if (shots.some((shot) => !captureByShotId.has(shot.id))) {
    return failure("missing-capture-shot", "일부 컷의 고정 캡처 계획이 없습니다.");
  }

  const requestedIds = options.selectedShotIds ?? shots.map(({ id }) => id);
  if (!Array.isArray(requestedIds) || requestedIds.some((id) => typeof id !== "string")) {
    return failure("invalid-selection", "컷 배치 선택 형식이 올바르지 않습니다.");
  }
  if (requestedIds.length === 0) {
    return failure("empty-selection", "렌더할 컷을 하나 이상 선택해 주세요.");
  }
  const selectedIds = new Set<string>();
  for (const id of requestedIds) {
    if (selectedIds.has(id)) {
      return failure("duplicate-selection", "선택한 컷 ID가 중복되었습니다.");
    }
    if (!shotById.has(id)) {
      return failure("unknown-selection", "장면에 없는 컷이 선택되었습니다.");
    }
    selectedIds.add(id);
  }

  const selectedShots = shots.filter(({ id }) => selectedIds.has(id));
  const fileCount = selectedShots.length * passes.length;
  if (fileCount < 1 || fileCount > STUDIO_BG3D_SHOT_BATCH_MAX_FILES) {
    return failure("file-budget", "컷 배치 출력 파일 수가 브라우저 안전 한도를 벗어났습니다.");
  }

  const plannedShots: StudioBg3dShotBatchPlannedShot[] = selectedShots.map((shot, index) => {
    const shotIndex = index + 1;
    const ordinal = String(shotIndex).padStart(3, "0");
    const files = passes.map((pass): StudioBg3dShotBatchPlannedFile => ({
      key: `${shot.id}:${pass}`,
      shotId: shot.id,
      shotName: shot.name,
      shotIndex,
      pass,
      path: `shots/${ordinal}/${pass}.png`,
    }));
    return {
      shotId: shot.id,
      shotName: shot.name,
      shotIndex,
      capture: copyCaptureSpec(captureByShotId.get(shot.id)!),
      files,
    };
  });
  const files = plannedShots.flatMap(({ files: shotFiles }) => shotFiles);
  const scope = {
    durability: options.scope.durability,
    authUserId: options.scope.authUserId,
    workId: options.scope.workId,
    pageId: options.scope.pageId,
    elementId: options.scope.elementId,
  };
  // Stamp a single derived aspect onto the frozen owner so re-admission matches create-time sizes.
  if (
    options.capture.owner.exportAspectRatio === undefined &&
    derivedAspects.size > 1
  ) {
    return failure(
      "invalid-capture",
      "컷 배치 캡처 비율이 컷마다 달라 고정 출력 계획을 만들 수 없습니다.",
    );
  }
  const stampedAspect =
    options.capture.owner.exportAspectRatio ??
    (derivedAspects.size === 1 ? derivedAspects.values().next().value : undefined);
  const captureOwner = copyCaptureOwner(
    typeof stampedAspect === "number"
      ? { ...options.capture.owner, exportAspectRatio: stampedAspect }
      : options.capture.owner,
  );
  const [sourceDigest, scopeDigest] = await Promise.all([
    sha256Hex(options.sourceRevision),
    sha256Hex(JSON.stringify(scope)),
  ]);
  if (!sourceDigest || !scopeDigest) {
    return failure("digest-unavailable", "이 브라우저에서 안전한 SHA-256 컷 계획을 만들 수 없습니다.");
  }
  const identity = canonicalRenderIdentity({
    sourceDigest,
    captureOwner,
    shots: plannedShots,
    passes,
    exportHeight,
    includeLayeredPsd: options.layeredPsd ?? false,
    includeContactSheet: options.contactSheet ?? false,
  });
  const planDigest = await sha256Hex(identity);
  if (!planDigest) {
    return failure("digest-unavailable", "이 브라우저에서 안전한 SHA-256 컷 계획을 만들 수 없습니다.");
  }
  const recoveryDigest = await sha256Hex(canonicalRecoveryIdentity(scopeDigest, planDigest));
  if (!recoveryDigest) {
    return failure("digest-unavailable", "이 브라우저에서 안전한 SHA-256 복구 범위를 만들 수 없습니다.");
  }

  return {
    ok: true,
    plan: freezePlan({
      kind: "toonspectrum-bg3d-shot-batch-plan",
      version: 2,
      sourceDigest,
      scopeDigest,
      planDigest,
      recoveryDigest,
      resumeKey: `bg3d-batch-v2-${recoveryDigest}`,
      scope,
      captureOwner,
      passes,
      exportHeight,
      includeLayeredPsd: options.layeredPsd ?? false,
      includeContactSheet: options.contactSheet ?? false,
      shots: plannedShots,
      files,
    }),
  };
}

/** Returns only unfinished files when a bounded recovery checkpoint is resumed. */
export function pendingStudioBg3dShotBatchFiles(
  plan: StudioBg3dShotBatchPlan,
  completedKeys: ReadonlySet<string>,
): readonly StudioBg3dShotBatchPlannedFile[] {
  if (!(completedKeys instanceof Set)) return plan.files;
  return plan.files.filter(({ key }) => !completedKeys.has(key));
}
