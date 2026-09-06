import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  type StudioBg3dGlbBudgetProfiles,
  type StudioBg3dGlbProfile,
} from "./studio-bg3d-glb-validation";

import type {
  StudioBg3dQualityProfile,
  StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

/**
 * Renderer-independent device policy for the 3D background editor.
 *
 * This module deliberately does not read `window`, `navigator`, media queries, or renderer state.
 * Browser adapters must collect capability signals explicitly and pass them into these pure
 * functions so tests, workers, server rendering, and restricted webviews all behave identically.
 */

export const STUDIO_BG3D_AUTO_MOBILE_MAX_CSS_WIDTH = 767;
export const STUDIO_BG3D_LOW_DEVICE_MEMORY_GB = 4;
export const STUDIO_BG3D_LOW_HARDWARE_CONCURRENCY = 4;
export const STUDIO_BG3D_MAX_CSS_DIMENSION = 32_768;
export const STUDIO_BG3D_HARD_MAX_RENDER_PIXELS = 16_777_216;

const MIN_PROFILE_DPR = 0.01;
const MAX_PROFILE_DPR = 8;
const DPR_ROUNDING_FACTOR = 1_000_000;
const SHADOW_MAP_SIZES = [256, 512, 1024, 2048, 4096] as const;

export type StudioBg3dDeviceProfile = "mobile" | "desktop";
export type StudioBg3dQualityPreference = "auto" | StudioBg3dDeviceProfile;
export type StudioBg3dQualityMode = "edit" | "capture";
export type StudioBg3dPointerKind = "coarse" | "fine" | "none";

export interface StudioBg3dDeviceSignals {
  readonly cssWidth?: number;
  readonly cssHeight?: number;
  readonly devicePixelRatio?: number;
  readonly pointer?: StudioBg3dPointerKind;
  readonly saveData?: boolean;
  readonly deviceMemoryGb?: number;
  readonly hardwareConcurrency?: number;
}

export type StudioBg3dQualityReasonCode =
  | "user-mobile-override"
  | "user-desktop-override"
  | "invalid-preference-mobile-fallback"
  | "auto-mobile-viewport"
  | "auto-coarse-pointer"
  | "auto-save-data"
  | "auto-low-device-memory"
  | "auto-low-hardware-concurrency"
  | "auto-missing-or-invalid-viewport"
  | "auto-missing-or-invalid-pointer"
  | "auto-missing-or-invalid-save-data"
  | "auto-missing-or-invalid-device-memory"
  | "auto-missing-or-invalid-hardware-concurrency"
  | "auto-desktop-capable"
  | "capture-mode"
  | "invalid-css-size-clamped"
  | "oversized-css-size-clamped"
  | "invalid-device-pixel-ratio-fallback"
  | "device-pixel-ratio-clamped"
  | "profile-value-sanitized"
  | "absolute-pixel-cap-applied"
  | "invalid-absolute-pixel-cap-restricted"
  | "profile-dpr-max-limited"
  | "device-dpr-limited"
  | "pixel-budget-limited"
  | "profile-dpr-min-bypassed-for-safety"
  | "shadows-disabled-by-scene";

export interface StudioBg3dQualityReason {
  readonly code: StudioBg3dQualityReasonCode;
  readonly severity: "info" | "warning";
  readonly message: string;
}

export interface StudioBg3dProfileSelection {
  readonly profile: StudioBg3dDeviceProfile;
  readonly preference: StudioBg3dQualityPreference;
  readonly reasons: readonly StudioBg3dQualityReason[];
}

export interface ResolveStudioBg3dDeviceQualityInput {
  readonly document: Pick<StudioBg3dSceneDocument, "quality" | "render">;
  readonly mode: StudioBg3dQualityMode;
  /** `mobile` or `desktop` is an explicit user override. Invalid runtime values fail to mobile. */
  readonly preference?: StudioBg3dQualityPreference;
  readonly signals: StudioBg3dDeviceSignals;
  /** Optional host/capture allocation ceiling. It can only tighten the document profile ceiling. */
  readonly absolutePixelCap?: number;
}

export interface StudioBg3dResolvedDeviceQuality {
  readonly mode: StudioBg3dQualityMode;
  readonly profile: StudioBg3dDeviceProfile;
  readonly preference: StudioBg3dQualityPreference;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly effectiveDpr: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly renderPixels: number;
  readonly maxRenderPixels: number;
  readonly shadows: boolean;
  readonly shadowMapSize: 0 | 256 | 512 | 1024 | 2048 | 4096;
  readonly textureScale: number;
  readonly lodBias: number;
  readonly targetFps: number;
  readonly reasons: readonly StudioBg3dQualityReason[];
}

export interface StudioBg3dGlbValidationPolicy {
  readonly profile: StudioBg3dGlbProfile;
  readonly budgets: StudioBg3dGlbBudgetProfiles;
}

const REASON_MESSAGES: Readonly<Record<StudioBg3dQualityReasonCode, string>> = Object.freeze({
  "user-mobile-override": "사용자가 모바일 3D 품질을 선택했습니다.",
  "user-desktop-override": "사용자가 데스크톱 3D 품질을 선택했습니다.",
  "invalid-preference-mobile-fallback":
    "알 수 없는 품질 선택을 안전한 모바일 품질로 대체했습니다.",
  "auto-mobile-viewport": "좁은 작업 화면에 맞춰 모바일 3D 품질을 선택했습니다.",
  "auto-coarse-pointer": "터치 중심 입력 환경에 맞춰 모바일 3D 품질을 선택했습니다.",
  "auto-save-data": "데이터 절약 설정을 존중해 모바일 3D 품질을 선택했습니다.",
  "auto-low-device-memory": "기기 메모리 여유를 고려해 모바일 3D 품질을 선택했습니다.",
  "auto-low-hardware-concurrency": "기기 처리 코어 수를 고려해 모바일 3D 품질을 선택했습니다.",
  "auto-missing-or-invalid-viewport":
    "화면 크기를 신뢰할 수 없어 안전한 모바일 3D 품질을 선택했습니다.",
  "auto-missing-or-invalid-pointer":
    "포인터 성능 정보를 확인할 수 없어 안전한 모바일 3D 품질을 선택했습니다.",
  "auto-missing-or-invalid-save-data":
    "데이터 절약 설정을 확인할 수 없어 안전한 모바일 3D 품질을 선택했습니다.",
  "auto-missing-or-invalid-device-memory":
    "기기 메모리 정보를 확인할 수 없어 안전한 모바일 3D 품질을 선택했습니다.",
  "auto-missing-or-invalid-hardware-concurrency":
    "기기 처리 코어 수를 확인할 수 없어 안전한 모바일 3D 품질을 선택했습니다.",
  "auto-desktop-capable": "화면과 기기 성능 신호가 데스크톱 3D 품질 기준을 충족합니다.",
  "capture-mode": "캡처 품질을 적용하되 픽셀 안전 한도는 유지합니다.",
  "invalid-css-size-clamped": "잘못된 화면 크기를 안전 계산 상한으로 대체했습니다.",
  "oversized-css-size-clamped": "지나치게 큰 화면 크기를 안전 계산 상한으로 제한했습니다.",
  "invalid-device-pixel-ratio-fallback":
    "기기 픽셀 비율을 확인할 수 없어 안전한 기본값을 사용했습니다.",
  "device-pixel-ratio-clamped": "기기 픽셀 비율을 안전 계산 범위로 제한했습니다.",
  "profile-value-sanitized": "유효하지 않은 품질 프로필 값을 안전 범위로 제한했습니다.",
  "absolute-pixel-cap-applied": "호스트가 지정한 절대 픽셀 한도를 적용했습니다.",
  "invalid-absolute-pixel-cap-restricted":
    "잘못된 절대 픽셀 한도를 가장 보수적인 한도로 대체했습니다.",
  "profile-dpr-max-limited": "품질 프로필의 최대 픽셀 비율을 적용했습니다.",
  "device-dpr-limited": "기기의 픽셀 비율을 적용했습니다.",
  "pixel-budget-limited": "렌더 픽셀 예산을 지키기 위해 픽셀 비율을 낮췄습니다.",
  "profile-dpr-min-bypassed-for-safety":
    "렌더 픽셀 예산을 지키기 위해 프로필의 최소 픽셀 비율보다 낮게 조정했습니다.",
  "shadows-disabled-by-scene": "장면 렌더 설정에서 그림자가 꺼져 있어 그림자를 생략합니다.",
});

function reason(
  code: StudioBg3dQualityReasonCode,
  severity: StudioBg3dQualityReason["severity"] = "info",
): StudioBg3dQualityReason {
  return Object.freeze({ code, severity, message: REASON_MESSAGES[code] });
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isUsableCssDimension(value: unknown): value is number {
  return isFinitePositive(value) && value >= 1 && value <= STUDIO_BG3D_MAX_CSS_DIMENSION;
}

function isValidViewport(signals: StudioBg3dDeviceSignals): boolean {
  return isUsableCssDimension(signals.cssWidth) && isUsableCssDimension(signals.cssHeight);
}

function isValidPointer(value: unknown): value is StudioBg3dPointerKind {
  return value === "coarse" || value === "fine" || value === "none";
}

function normalizedPreference(value: unknown): StudioBg3dQualityPreference | null {
  return value === undefined || value === "auto"
    ? "auto"
    : value === "mobile" || value === "desktop"
      ? value
      : null;
}

/**
 * Chooses the profile without accessing browser globals. An explicit user choice always wins.
 * Auto mode requires complete, trustworthy desktop-capable signals; uncertainty falls to mobile.
 */
export function selectStudioBg3dQualityProfile(
  signals: StudioBg3dDeviceSignals,
  preferenceValue: StudioBg3dQualityPreference = "auto",
): StudioBg3dProfileSelection {
  const preference = normalizedPreference(preferenceValue);
  if (preference === "mobile" || preference === "desktop") {
    return Object.freeze({
      profile: preference,
      preference,
      reasons: Object.freeze([
        reason(preference === "mobile" ? "user-mobile-override" : "user-desktop-override"),
      ]),
    });
  }
  if (preference === null) {
    return Object.freeze({
      profile: "mobile",
      preference: "auto",
      reasons: Object.freeze([reason("invalid-preference-mobile-fallback", "warning")]),
    });
  }

  const reasons: StudioBg3dQualityReason[] = [];
  const viewportValid = isValidViewport(signals);
  if (!viewportValid) {
    reasons.push(reason("auto-missing-or-invalid-viewport", "warning"));
  } else if (
    isFinitePositive(signals.cssWidth) &&
    signals.cssWidth <= STUDIO_BG3D_AUTO_MOBILE_MAX_CSS_WIDTH
  ) {
    reasons.push(reason("auto-mobile-viewport"));
  }

  if (!isValidPointer(signals.pointer) || signals.pointer === "none") {
    reasons.push(reason("auto-missing-or-invalid-pointer", "warning"));
  } else if (signals.pointer === "coarse") {
    reasons.push(reason("auto-coarse-pointer"));
  }

  if (typeof signals.saveData !== "boolean") {
    reasons.push(reason("auto-missing-or-invalid-save-data", "warning"));
  } else if (signals.saveData) {
    reasons.push(reason("auto-save-data"));
  }

  if (!isFinitePositive(signals.deviceMemoryGb)) {
    reasons.push(reason("auto-missing-or-invalid-device-memory", "warning"));
  } else if (signals.deviceMemoryGb <= STUDIO_BG3D_LOW_DEVICE_MEMORY_GB) {
    reasons.push(reason("auto-low-device-memory"));
  }

  if (
    !isFinitePositive(signals.hardwareConcurrency) ||
    !Number.isSafeInteger(signals.hardwareConcurrency)
  ) {
    reasons.push(reason("auto-missing-or-invalid-hardware-concurrency", "warning"));
  } else if (signals.hardwareConcurrency <= STUDIO_BG3D_LOW_HARDWARE_CONCURRENCY) {
    reasons.push(reason("auto-low-hardware-concurrency"));
  }

  if (reasons.length > 0) {
    return Object.freeze({
      profile: "mobile",
      preference,
      reasons: Object.freeze(reasons),
    });
  }

  return Object.freeze({
    profile: "desktop",
    preference,
    reasons: Object.freeze([reason("auto-desktop-capable")]),
  });
}

function sanitizeCssDimension(
  value: unknown,
  reasons: StudioBg3dQualityReason[],
): number {
  if (!isFinitePositive(value) || value < 1) {
    reasons.push(reason("invalid-css-size-clamped", "warning"));
    return STUDIO_BG3D_MAX_CSS_DIMENSION;
  }
  if (value > STUDIO_BG3D_MAX_CSS_DIMENSION) {
    reasons.push(reason("oversized-css-size-clamped", "warning"));
    return STUDIO_BG3D_MAX_CSS_DIMENSION;
  }
  return value;
}

function sanitizeDevicePixelRatio(
  value: unknown,
  reasons: StudioBg3dQualityReason[],
): number {
  if (!isFinitePositive(value)) {
    reasons.push(reason("invalid-device-pixel-ratio-fallback", "warning"));
    return 1;
  }
  const bounded = Math.min(MAX_PROFILE_DPR, Math.max(MIN_PROFILE_DPR, value));
  if (bounded !== value) reasons.push(reason("device-pixel-ratio-clamped", "warning"));
  return bounded;
}

function boundedFinite(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
  reasons: StudioBg3dQualityReason[],
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    reasons.push(reason("profile-value-sanitized", "warning"));
    return fallback;
  }
  const bounded = Math.min(maximum, Math.max(minimum, value));
  if (bounded !== value) reasons.push(reason("profile-value-sanitized", "warning"));
  return bounded;
}

function sanitizeShadowMapSize(
  value: unknown,
  reasons: StudioBg3dQualityReason[],
): (typeof SHADOW_MAP_SIZES)[number] {
  if (SHADOW_MAP_SIZES.some((size) => size === value)) {
    return value as (typeof SHADOW_MAP_SIZES)[number];
  }
  reasons.push(reason("profile-value-sanitized", "warning"));
  return 256;
}

function sanitizeProfile(
  profile: StudioBg3dQualityProfile,
  reasons: StudioBg3dQualityReason[],
): StudioBg3dQualityProfile {
  const dprMin = boundedFinite(profile.dprMin, MIN_PROFILE_DPR, MAX_PROFILE_DPR, 0.5, reasons);
  const dprMax = boundedFinite(profile.dprMax, MIN_PROFILE_DPR, MAX_PROFILE_DPR, 1, reasons);
  const maxRenderPixels = Math.floor(
    boundedFinite(
      profile.maxRenderPixels,
      1,
      STUDIO_BG3D_HARD_MAX_RENDER_PIXELS,
      1,
      reasons,
    ),
  );
  return {
    targetFps: Math.round(boundedFinite(profile.targetFps, 1, 120, 15, reasons)),
    dprMin: Math.min(dprMin, dprMax),
    dprMax,
    maxRenderPixels,
    shadows: profile.shadows === true,
    shadowMapSize: sanitizeShadowMapSize(profile.shadowMapSize, reasons),
    textureScale: boundedFinite(profile.textureScale, 0.01, 1, 0.25, reasons),
    lodBias: boundedFinite(profile.lodBias, -2, 8, 4, reasons),
  };
}

function resolvePixelCap(
  profileMaxRenderPixels: number,
  absolutePixelCap: number | undefined,
  reasons: StudioBg3dQualityReason[],
): number {
  if (absolutePixelCap === undefined) return profileMaxRenderPixels;
  if (!isFinitePositive(absolutePixelCap)) {
    reasons.push(reason("invalid-absolute-pixel-cap-restricted", "warning"));
    return 1;
  }
  const boundedAbsoluteCap = Math.max(
    1,
    Math.min(STUDIO_BG3D_HARD_MAX_RENDER_PIXELS, Math.floor(absolutePixelCap)),
  );
  if (boundedAbsoluteCap < profileMaxRenderPixels) {
    reasons.push(reason("absolute-pixel-cap-applied"));
  }
  return Math.min(profileMaxRenderPixels, boundedAbsoluteCap);
}

/** Rounds down so decimal normalization can never push a render over its pixel ceiling. */
function roundDprDown(value: number): number {
  return Math.floor(value * DPR_ROUNDING_FACTOR) / DPR_ROUNDING_FACTOR;
}

function fitRenderDimensions(
  cssWidth: number,
  cssHeight: number,
  effectiveDpr: number,
  maxRenderPixels: number,
): { readonly renderWidth: number; readonly renderHeight: number; readonly renderPixels: number } {
  let renderWidth = Math.max(1, Math.floor(cssWidth * effectiveDpr));
  let renderHeight = Math.max(1, Math.floor(cssHeight * effectiveDpr));
  if (renderWidth * renderHeight > maxRenderPixels) {
    if (renderWidth >= renderHeight) {
      renderWidth = Math.max(1, Math.floor(maxRenderPixels / renderHeight));
    } else {
      renderHeight = Math.max(1, Math.floor(maxRenderPixels / renderWidth));
    }
  }
  return {
    renderWidth,
    renderHeight,
    renderPixels: renderWidth * renderHeight,
  };
}

function includesReason(
  reasons: readonly StudioBg3dQualityReason[],
  code: StudioBg3dQualityReasonCode,
): boolean {
  return reasons.some((item) => item.code === code);
}

/**
 * Resolves concrete renderer settings. The continuous DPR formula is exactly:
 * `min(device DPR, profile DPR max, sqrt(pixel cap / CSS pixel area))`.
 * `dprMin` is advisory: it is never allowed to violate the pixel ceiling.
 */
export function resolveStudioBg3dDeviceQuality(
  input: ResolveStudioBg3dDeviceQualityInput,
): StudioBg3dResolvedDeviceQuality {
  const selection = selectStudioBg3dQualityProfile(
    input.signals,
    input.preference ?? "auto",
  );
  const reasons = [...selection.reasons];
  if (input.mode === "capture") reasons.push(reason("capture-mode"));

  const cssWidth = sanitizeCssDimension(input.signals.cssWidth, reasons);
  const cssHeight = sanitizeCssDimension(input.signals.cssHeight, reasons);
  const devicePixelRatio = sanitizeDevicePixelRatio(input.signals.devicePixelRatio, reasons);
  const selectedProfile = sanitizeProfile(input.document.quality[selection.profile], reasons);
  const maxRenderPixels = resolvePixelCap(
    selectedProfile.maxRenderPixels,
    input.absolutePixelCap,
    reasons,
  );
  const cssPixelArea = cssWidth * cssHeight;
  const pixelBudgetDpr = Math.sqrt(maxRenderPixels / cssPixelArea);
  const rawEffectiveDpr = Math.min(
    devicePixelRatio,
    selectedProfile.dprMax,
    pixelBudgetDpr,
  );
  const effectiveDpr = Math.max(
    1 / DPR_ROUNDING_FACTOR,
    roundDprDown(rawEffectiveDpr),
  );

  if (
    selectedProfile.dprMax <= devicePixelRatio &&
    selectedProfile.dprMax <= pixelBudgetDpr
  ) {
    reasons.push(reason("profile-dpr-max-limited"));
  } else if (devicePixelRatio <= selectedProfile.dprMax && devicePixelRatio <= pixelBudgetDpr) {
    reasons.push(reason("device-dpr-limited"));
  }
  if (pixelBudgetDpr <= devicePixelRatio && pixelBudgetDpr <= selectedProfile.dprMax) {
    reasons.push(reason("pixel-budget-limited", "warning"));
  }
  if (effectiveDpr < selectedProfile.dprMin) {
    reasons.push(reason("profile-dpr-min-bypassed-for-safety", "warning"));
  }

  const { renderWidth, renderHeight, renderPixels } = fitRenderDimensions(
    cssWidth,
    cssHeight,
    effectiveDpr,
    maxRenderPixels,
  );
  const sceneShadows = input.document.render.shadows === true;
  const shadows = sceneShadows && selectedProfile.shadows;
  if (!sceneShadows && selectedProfile.shadows) reasons.push(reason("shadows-disabled-by-scene"));

  return Object.freeze({
    mode: input.mode,
    profile: selection.profile,
    preference: selection.preference,
    cssWidth,
    cssHeight,
    effectiveDpr,
    renderWidth,
    renderHeight,
    renderPixels,
    maxRenderPixels,
    shadows,
    shadowMapSize: shadows ? selectedProfile.shadowMapSize : 0,
    textureScale: selectedProfile.textureScale,
    lodBias: selectedProfile.lodBias,
    targetFps: selectedProfile.targetFps,
    reasons: Object.freeze(
      reasons.filter(
        (item, index, all) => all.findIndex((candidate) => candidate.code === item.code) === index,
      ),
    ),
  });
}

function safeDocumentLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function cappedDocumentLimit(value: unknown, productMaximum: number): number {
  return Math.min(safeDocumentLimit(value), productMaximum);
}

/**
 * Builds both GLB validator profiles by intersecting validator defaults with document budgets.
 * Every result is less than or equal to the corresponding persisted document limit, so this
 * adapter can tighten admission but can never silently widen a project's declared limits.
 */
export function deriveStudioBg3dGlbBudgetProfiles(
  document: Pick<StudioBg3dSceneDocument, "budgets">,
): StudioBg3dGlbBudgetProfiles {
  const deriveProfile = (profile: StudioBg3dGlbProfile) => {
    const defaults = DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES[profile];
    return Object.freeze({
      complexity: Object.freeze({
        maxModelBytes: cappedDocumentLimit(
          document.budgets.complexity.maxModelBytes,
          defaults.complexity.maxModelBytes,
        ),
        maxNodes: cappedDocumentLimit(
          document.budgets.complexity.maxNodes,
          defaults.complexity.maxNodes,
        ),
        maxTriangles: cappedDocumentLimit(
          document.budgets.complexity.maxTriangles,
          defaults.complexity.maxTriangles,
        ),
        maxDrawCalls: cappedDocumentLimit(
          document.budgets.complexity.maxDrawCalls,
          defaults.complexity.maxDrawCalls,
        ),
        maxMaterials: cappedDocumentLimit(
          document.budgets.complexity.maxMaterials,
          defaults.complexity.maxMaterials,
        ),
        maxLights: cappedDocumentLimit(
          document.budgets.complexity.maxLights,
          defaults.complexity.maxLights,
        ),
        maxAnimations: cappedDocumentLimit(
          document.budgets.complexity.maxAnimations,
          defaults.complexity.maxAnimations,
        ),
        maxAnimationChannels: cappedDocumentLimit(
          document.budgets.complexity.maxAnimationChannels,
          defaults.complexity.maxAnimationChannels,
        ),
        maxAnimationKeyframes: cappedDocumentLimit(
          document.budgets.complexity.maxAnimationKeyframes,
          defaults.complexity.maxAnimationKeyframes,
        ),
        maxAnimationValues: cappedDocumentLimit(
          document.budgets.complexity.maxAnimationValues,
          defaults.complexity.maxAnimationValues,
        ),
        maxSkins: cappedDocumentLimit(
          document.budgets.complexity.maxSkins,
          defaults.complexity.maxSkins,
        ),
        maxJoints: cappedDocumentLimit(
          document.budgets.complexity.maxJoints,
          defaults.complexity.maxJoints,
        ),
        maxMorphTargets: cappedDocumentLimit(
          document.budgets.complexity.maxMorphTargets,
          defaults.complexity.maxMorphTargets,
        ),
        maxAccessorElements: cappedDocumentLimit(
          document.budgets.complexity.maxAccessorElements,
          defaults.complexity.maxAccessorElements,
        ),
        maxDecodedGeometryBytes: cappedDocumentLimit(
          document.budgets.complexity.maxDecodedGeometryBytes,
          defaults.complexity.maxDecodedGeometryBytes,
        ),
      }),
      textures: Object.freeze({
        maxTextures: cappedDocumentLimit(
          document.budgets.textures.maxTextures,
          defaults.textures.maxTextures,
        ),
        maxTotalBytes: cappedDocumentLimit(
          document.budgets.textures.maxTotalBytes,
          defaults.textures.maxTotalBytes,
        ),
        maxDimension: cappedDocumentLimit(
          document.budgets.textures.maxDimension,
          defaults.textures.maxDimension,
        ),
      }),
    });
  };

  return Object.freeze({
    mobile: deriveProfile("mobile"),
    desktop: deriveProfile("desktop"),
  });
}

/** Connects a resolved edit/capture profile to the validator without renderer-specific state. */
export function deriveStudioBg3dGlbValidationPolicy(
  document: Pick<StudioBg3dSceneDocument, "budgets">,
  resolvedQuality: Pick<StudioBg3dResolvedDeviceQuality, "profile">,
): StudioBg3dGlbValidationPolicy {
  return Object.freeze({
    profile: resolvedQuality.profile,
    budgets: deriveStudioBg3dGlbBudgetProfiles(document),
  });
}

/** Useful to avoid code-only diagnostics being lost when policies are shown in UI telemetry. */
export function hasStudioBg3dQualityReason(
  quality: Pick<StudioBg3dResolvedDeviceQuality, "reasons">,
  code: StudioBg3dQualityReasonCode,
): boolean {
  return includesReason(quality.reasons, code);
}
