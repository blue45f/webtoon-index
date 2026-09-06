/**
 * Studio Advanced Fill settings.
 *
 * The fill engine deliberately does not own this module: UI, persistence, and future engine
 * implementations can share the same defensive contract without creating a circular dependency.
 * All persisted values are untrusted and are normalized before use.
 */

export const STUDIO_ADVANCED_FILL_REFERENCE_SCOPES = [
  "current",
  "reference",
  "all-visible",
] as const;

export type StudioAdvancedFillReferenceScope =
  (typeof STUDIO_ADVANCED_FILL_REFERENCE_SCOPES)[number];

export interface StudioAdvancedFillSettings {
  version: 1;
  referenceScope: StudioAdvancedFillReferenceScope;
  tolerance: number;
  contiguous: boolean;
  expansionPx: number;
  closeGapPx: number;
  antiAlias: boolean;
  continuousFill: boolean;
  leakGuard: boolean;
  leakGuardMaxFillRatio: number;
  treatCanvasEdgeAsBoundary: boolean;
}

export type StudioAdvancedFillSettingKey = Exclude<keyof StudioAdvancedFillSettings, "version">;

export interface StudioAdvancedFillSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STUDIO_ADVANCED_FILL_SETTINGS_STORAGE_KEY =
  "toonspectrum-studio-advanced-fill-settings:v1";

/** Public numeric constraints shared by sliders, number inputs, and persisted-value recovery. */
export const STUDIO_ADVANCED_FILL_LIMITS = {
  tolerance: { min: 0, max: 255, step: 1 },
  expansionPx: { min: -16, max: 16, step: 0.5 },
  closeGapPx: { min: 0, max: 32, step: 1 },
  leakGuardMaxFillRatio: { min: 0.05, max: 0.95, step: 0.01 },
} as const;

export const DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS: Readonly<StudioAdvancedFillSettings> =
  Object.freeze({
    version: 1,
    referenceScope: "current",
    tolerance: 32,
    contiguous: true,
    expansionPx: 1.5,
    closeGapPx: 0,
    antiAlias: true,
    continuousFill: true,
    leakGuard: true,
    leakGuardMaxFillRatio: 0.65,
    treatCanvasEdgeAsBoundary: true,
  });

export const STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_LABELS: Readonly<
  Record<StudioAdvancedFillReferenceScope, string>
> = Object.freeze({
  current: "현재 레이어",
  reference: "참조 레이어",
  "all-visible": "표시 래스터(편집 대상 제외)",
});

export const STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_DESCRIPTIONS: Readonly<
  Record<StudioAdvancedFillReferenceScope, string>
> = Object.freeze({
  current: "현재 편집 중인 레이어의 픽셀만 경계로 사용합니다.",
  reference: "참조로 지정한 선화 레이어를 경계로 사용합니다.",
  "all-visible": "현재 편집 대상은 제외하고 화면에 보이는 래스터 원본을 경계로 사용합니다.",
});

export const STUDIO_ADVANCED_FILL_SETTING_LABELS: Readonly<
  Record<StudioAdvancedFillSettingKey, string>
> = Object.freeze({
  referenceScope: "참조 범위",
  tolerance: "허용 오차",
  contiguous: "연결된 영역만",
  expansionPx: "확장·축소",
  closeGapPx: "틈 닫기",
  antiAlias: "가장자리 부드럽게",
  continuousFill: "연속 채우기",
  leakGuard: "채우기 누수 보호",
  leakGuardMaxFillRatio: "누수 경고 면적",
  treatCanvasEdgeAsBoundary: "캔버스 가장자리를 경계로 사용",
});

export const STUDIO_ADVANCED_FILL_LEAK_REMEDY_IDS = [
  "cancel-fill",
  "increase-close-gap",
  "lower-tolerance",
  "use-reference-layer",
] as const;

export type StudioAdvancedFillLeakRemedyId =
  (typeof STUDIO_ADVANCED_FILL_LEAK_REMEDY_IDS)[number];

export interface StudioAdvancedFillLeakRemedy {
  id: StudioAdvancedFillLeakRemedyId;
  label: string;
  description: string;
}

/**
 * 누수 경고에서 바로 제안할 수 있는 비파괴 해결책. 배열 순서는 안전한 복구 우선순위다.
 */
export const STUDIO_ADVANCED_FILL_LEAK_REMEDIES: readonly StudioAdvancedFillLeakRemedy[] =
  Object.freeze([
    Object.freeze({
      id: "cancel-fill",
      label: "채우기 취소",
      description: "넓게 번진 결과를 적용하지 않고 캔버스로 돌아갑니다.",
    }),
    Object.freeze({
      id: "increase-close-gap",
      label: "틈 닫기 늘리기",
      description: "끊어진 선 사이의 간격을 더 크게 막은 뒤 다시 채웁니다.",
    }),
    Object.freeze({
      id: "lower-tolerance",
      label: "허용 오차 낮추기",
      description: "비슷하지만 다른 색을 경계로 인식하도록 허용 오차를 낮춥니다.",
    }),
    Object.freeze({
      id: "use-reference-layer",
      label: "참조 선화 사용",
      description: "채색과 선화를 분리하고 참조 레이어의 선만 경계로 사용합니다.",
    }),
  ]);

const REFERENCE_SCOPE_SET = new Set<string>(STUDIO_ADVANCED_FILL_REFERENCE_SCOPES);

function copyDefaultSettings(): StudioAdvancedFillSettings {
  return { ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReferenceScope(value: unknown): value is StudioAdvancedFillReferenceScope {
  return typeof value === "string" && REFERENCE_SCOPE_SET.has(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundToStep(value: number, step: number): number {
  const units = value / step;
  const roundedUnits = units < 0 ? -Math.round(-units) : Math.round(units);
  const rounded = roundedUnits * step;
  // Avoid leaking floating-point tails or -0 into JSON and controlled number inputs.
  const precision = Math.max(0, (String(step).split(".")[1] ?? "").length);
  const normalized = Number(rounded.toFixed(precision));
  return Object.is(normalized, -0) ? 0 : normalized;
}

function normalizeSteppedNumber(
  value: unknown,
  fallback: number,
  limits: Readonly<{ min: number; max: number; step: number }>
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(roundToStep(clamp(value, limits.min, limits.max), limits.step), limits.min, limits.max);
}

/**
 * JSON text or an unknown object is recovered into the stable v1 contract.
 *
 * An invalid root/version falls back as a whole. A valid v1 object recovers field by field so one
 * corrupt option does not discard the rest of the artist's preferences. Numeric strings are not
 * coerced: accepting them would make malformed persisted values silently change behavior.
 */
export function normalizeStudioAdvancedFillSettings(raw: unknown): StudioAdvancedFillSettings {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return copyDefaultSettings();
    }
  }

  if (!isRecord(parsed) || parsed.version !== 1) return copyDefaultSettings();

  return {
    version: 1,
    referenceScope: isReferenceScope(parsed.referenceScope)
      ? parsed.referenceScope
      : DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.referenceScope,
    tolerance: normalizeSteppedNumber(
      parsed.tolerance,
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.tolerance,
      STUDIO_ADVANCED_FILL_LIMITS.tolerance
    ),
    contiguous: normalizeBoolean(
      parsed.contiguous,
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.contiguous
    ),
    expansionPx: normalizeSteppedNumber(
      parsed.expansionPx,
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.expansionPx,
      STUDIO_ADVANCED_FILL_LIMITS.expansionPx
    ),
    closeGapPx: normalizeSteppedNumber(
      parsed.closeGapPx,
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.closeGapPx,
      STUDIO_ADVANCED_FILL_LIMITS.closeGapPx
    ),
    antiAlias: normalizeBoolean(
      parsed.antiAlias,
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.antiAlias
    ),
    continuousFill: normalizeBoolean(
      parsed.continuousFill,
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.continuousFill
    ),
    leakGuard: normalizeBoolean(parsed.leakGuard, DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.leakGuard),
    leakGuardMaxFillRatio: normalizeSteppedNumber(
      parsed.leakGuardMaxFillRatio,
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.leakGuardMaxFillRatio,
      STUDIO_ADVANCED_FILL_LIMITS.leakGuardMaxFillRatio
    ),
    treatCanvasEdgeAsBoundary: normalizeBoolean(
      parsed.treatCanvasEdgeAsBoundary,
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.treatCanvasEdgeAsBoundary
    ),
  };
}

/** Storage absence, blocked reads, missing values, and corrupt JSON all safely use fresh defaults. */
export function loadStudioAdvancedFillSettings(
  storage: StudioAdvancedFillSettingsStorage | null | undefined
): StudioAdvancedFillSettings {
  if (!storage) return copyDefaultSettings();
  try {
    return normalizeStudioAdvancedFillSettings(
      storage.getItem(STUDIO_ADVANCED_FILL_SETTINGS_STORAGE_KEY)
    );
  } catch {
    return copyDefaultSettings();
  }
}

/** Normalize before persistence and keep quota/privacy/SSR storage failures out of the editor flow. */
export function saveStudioAdvancedFillSettings(
  storage: StudioAdvancedFillSettingsStorage | null | undefined,
  settings: unknown
): void {
  if (!storage) return;
  try {
    storage.setItem(
      STUDIO_ADVANCED_FILL_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeStudioAdvancedFillSettings(settings))
    );
  } catch {
    // Private browsing, quota limits, and embedded contexts may expose a throwing Storage object.
  }
}
