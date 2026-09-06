// Studio Brush Library — 이름 붙은 브러시 설정(펜 종류·크기·색상·손떨림 보정 등)을 저장·관리하고
// JSON으로 가져오기/내보내기 한다. ibisPaint의 브러시/머티리얼 라이브러리에 대응하는 기능.
//
// 기존 localStorage envelope와 동기 API는 이전 호출부를 위해 계속 읽고 쓴다. 권위 계약은 브러시 수에
// 상한을 두지 않으며, 대규모 라이브러리는 studio-brush-library-repository.ts의 비동기 페이지 포트로
// SQLite/OPFS 같은 저장소에 연결한다. 브러시 설정(강도·필압 곡선 등)에는 단일 표준 포맷이 없으므로
// 내보내기/가져오기는 이 앱 전용 JSON 포맷(kind: "toonspectrum-studio-brush")을 쓴다.
//
// 저장소(localStorage 호환 인터페이스)를 주입받아 순수하게 동작한다(studio-palette-library.ts와 동일).

import { STABILIZER_MAX } from "../studio-brush";
import { normalizeHexColor } from "../studio-color-utils";

import {
  DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS,
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsEqual,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import {
  normalizeStudioBrushEngineProgramSet,
  type StudioBrushEngineProgramSet,
} from "./studio-brush-engine-program-set";
import { resolveStudioBrushRuntime } from "./studio-brush-runtime-contract";
import {
  resolveStudioStampBrushKind,
  STUDIO_STAMP_BRUSH_DEFAULTS,
} from "./studio-brush-stamp-engine";
import {
  isStudioStabilizerMode,
  normalizeStudioStabilizerMode,
  type StudioStabilizerMode,
} from "./studio-stroke-stabilizer";

// ── 브러시 설정 스냅샷 ───────────────────────────────────────────────────
// StudioPage.tsx의 "그리기 도구 설정" 패널에서 drawMode === "pen"일 때 실제로 그리기에 쓰이는
// state를 그대로 미러링한 필드들. 정확한 대응은 docs/studio-brush-library-integration.md 참고.

export interface StudioBrushStampTuning {
  /** dab 하나의 도포량. UI와 획 스냅샷이 사용하는 0~1 비율. */
  flow: number;
  /** 스탬프 팁 가장자리 경도. 0=부드러움, 1=선명함. */
  hardness: number;
  /** 필압이 0일 때 유지할 최소 굵기 비율. */
  minSize: number;
}

export const BRUSH_SOURCE_PRESET_ID_MAX_LENGTH = 160;
export const BRUSH_SOURCE_PRESET_NAME_MAX_LENGTH = 120;

/**
 * 원본 카탈로그 프리셋의 안정적인 식별 정보다. `brushId`는 언제나 ToonSpectrum의 실제 렌더링
 * 엔진(BRUSH_PRESETS)을 가리키고, 이 메타데이터만 팩 안의 세부 프리셋을 구분한다.
 */
export interface StudioBrushSourcePresetMetadata {
  sourcePresetId?: string;
  sourcePresetName?: string;
}

export interface StudioBrushSnapshot extends StudioBrushSourcePresetMetadata {
  /** BRUSH_PRESETS[].id (studio-brush.ts). StudioPage의 `brush` state에 대응. */
  brushId: string;
  /** StudioPage의 `strokeWidth` state에 대응. UI 슬라이더 범위와 동일하게 1~80로 clamp. */
  strokeWidth: number;
  /** StudioPage의 `brushOpacity` state에 대응(0~1). UI 슬라이더 범위와 동일하게 0.05~1로 clamp. */
  brushOpacity: number;
  /** 정규화된 소문자 #rrggbb. StudioPage의 `color` state에 대응. */
  color: string;
  /** StudioPage의 `stabilizer` state에 대응(0~STABILIZER_MAX). */
  stabilizer: number;
  /** 라이브 입력 보정 알고리즘. 표준/속도 적응/정밀 추적. */
  stabilizerMode: StudioStabilizerMode;
  /** 펜을 놓은 뒤 적용하는 독립 후보정 강도(0~STABILIZER_MAX). */
  postCorrection: number;
  /** 후보정이 의도적인 각점을 둥글리지 않도록 보존할지 여부. */
  preserveCorners: boolean;
  /** StudioPage의 `pressureCurve` state에 대응. UI는 0.65(민감하게)/1.0(선형)/1.8(단단하게) 중 하나만
   *  설정하지만, 저장 데이터가 다른 값이어도 동작은 하므로 0.3~3 범위로만 clamp한다. */
  pressureCurve: number;
  /**
   * CSP Size dynamics Min for residual pen/marker — 0..1 fraction of selected size kept at p=0.
   * Default 0 preserves Magma-compatible zero-pressure coverage.
   */
  pressureMinSize: number;
  /** StudioPage의 `useVelocityPressure` state에 대응. */
  useVelocityPressure: boolean;
  /** StudioPage의 `velocitySensitivity` state에 대응(0.1~1.0). */
  velocitySensitivity: number;
  /** 스타일러스 tiltX/tiltY/twist를 캘리그래피 펜촉에 반영할지 여부. */
  tiltEnabled: boolean;
  /** 틸트 입력이 없을 때 사용할 캘리그래피 펜촉 기본 각도(도). */
  tipAngle: number;
  /** 캘리그래피 펜촉의 단축/장축 비율(0.08=납작한 촉, 1=원형 촉). */
  tipRoundness: number;
  /** 필압·속도·틸트·트위스트에 따른 입자 크기/농도/간격/산포를 재현하는 정규화된 동역학 설정. */
  brushDynamics: NormalizedStudioBrushDynamicsSettings;
  /** 스탬프 엔진 브러시의 흐름·경도·최소 굵기. 비스탬프 브러시는 null. */
  stampTuning: StudioBrushStampTuning | null;
  /**
   * 이 브러시가 어떤 엔진 프로그램 조합으로 그리는지. null 이면 brushId 에서 유도한 기본 조합.
   *
   * 이 키가 없던 동안 저장 브러시는 brushId + 스칼라 + brushDynamics 만 실었고, 프로그램 조합은
   * 페인트 시점에 id 로부터 다시 유도됐다. 그래서 프리셋에 없는 조합(예: 필버트의 붓털 물리 +
   * 임파스토 능선)은 만들 수는 있어도 저장할 수가 없었다 — 다시 열면 id 의 기본 조합으로
   * 돌아왔기 때문이다. 커스텀 브러시가 성립하려면 조합이 브러시와 함께 저장돼야 한다.
   */
  enginePrograms: StudioBrushEngineProgramSet | null;
}

export interface StudioSavedBrush extends StudioBrushSnapshot {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 모바일/데스크톱 빠른 선반의 상단에 고정할지 여부. 내보내기 파일에는 포함하지 않는 기기별 UI 메타데이터다. */
  pinned: boolean;
  /** 마지막으로 실제 적용한 시각. null이면 아직 적용하지 않은 브러시다. */
  lastUsedAt: number | null;
}

export interface BrushLibraryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 보안 샌드박스·사생활 보호 모드에서 localStorage 속성 접근 자체가 던지는 경우까지 막는다. */
export function browserBrushLibraryStorage(): BrushLibraryStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export const BRUSH_LIBRARY_KEY = "toonspectrum-studio-brush-library";
export const BRUSH_LIBRARY_STORAGE_VERSION = 1;
export const BRUSH_LIBRARY_CAPACITY = "unbounded" as const;
/**
 * @deprecated 브러시 라이브러리에는 개수 상한이 없다. 이전 호출부의 수치 비교가 새 항목을 거부하지
 * 않도록 무한대 센티널만 유지한다. 신규 코드는 BRUSH_LIBRARY_CAPACITY와 페이지 repository를 쓴다.
 */
export const MAX_BRUSHES = Number.POSITIVE_INFINITY;
export const MAX_QUICK_BRUSHES = 8; // Procreate Recent와 같은, 한 번에 기억하기 좋은 빠른 접근 상한.
export const DEFAULT_BRUSH_NAME = "이름 없는 브러시";

export type BrushLibraryReadStatus =
  | "ok"
  | "empty"
  | "unavailable"
  | "read-error"
  | "corrupt"
  | "unsupported-version";

export interface BrushLibraryReadResult {
  brushes: StudioSavedBrush[];
  status: BrushLibraryReadStatus;
}

type BrushMutationFailureStatus = "storage-error" | "library-unreadable";

export interface BrushSaveResult {
  brushes: StudioSavedBrush[];
  /** `full`은 이전 호출부의 소스 호환만 위한 값이며 무제한 권위 구현은 반환하지 않는다. */
  status: "saved" | "full" | BrushMutationFailureStatus;
}

export interface BrushBatchSaveResult {
  brushes: StudioSavedBrush[];
  savedCount: number;
  skippedCount: number;
  /** `full`은 이전 호출부의 소스 호환만 위한 값이며 무제한 권위 구현은 반환하지 않는다. */
  status: "saved" | "partial" | "full" | BrushMutationFailureStatus;
}

export interface DeletedBrushRecord {
  brush: StudioSavedBrush;
  index: number;
}

export interface BrushDeleteResult {
  brushes: StudioSavedBrush[];
  deleted: DeletedBrushRecord | null;
  status: "deleted" | "missing" | BrushMutationFailureStatus;
}

export interface BrushRestoreResult {
  brushes: StudioSavedBrush[];
  /** `full`은 이전 호출부의 소스 호환만 위한 값이며 무제한 권위 구현은 반환하지 않는다. */
  status: "restored" | "full" | BrushMutationFailureStatus;
}

export interface BrushDuplicateResult {
  brushes: StudioSavedBrush[];
  brush: StudioSavedBrush | null;
  /** `full`은 이전 호출부의 소스 호환만 위한 값이며 무제한 권위 구현은 반환하지 않는다. */
  status: "duplicated" | "full" | "missing" | BrushMutationFailureStatus;
}

export interface BrushUpdateResult {
  brushes: StudioSavedBrush[];
  status: "updated" | "missing" | "unchanged" | BrushMutationFailureStatus;
}

export const BRUSH_STROKE_WIDTH_RANGE = [1, 80] as const;
export const BRUSH_OPACITY_RANGE = [0.05, 1] as const;
export const BRUSH_PRESSURE_CURVE_RANGE = [0.3, 3] as const;
export const BRUSH_VELOCITY_SENSITIVITY_RANGE = [0.1, 1] as const;
export const BRUSH_TIP_ANGLE_RANGE = [-180, 180] as const;
export const BRUSH_TIP_ROUNDNESS_RANGE = [0.08, 1] as const;
export const BRUSH_STAMP_TUNING_RANGE = [0, 1] as const;

/**
 * 새 캔버스와 누락 필드를 가진 레거시 브러시가 공유하는 기본 필기감.
 *
 * 이전 3.4 고정 cascade 기본값은 t90 약 60ms trailing으로 펜 끝이 무거웠고, 그 반작용으로 0(보정
 * 없음)까지 내렸다. 0에서는 손떨림이 그대로 통과해 느린 장선에서 미세한 흔들림이 보인다
 * (scripts/probe-stabilizer-tradeoff.mts 실측: 통과율 100%).
 *
 * 그래서 고정 cascade 대신 속도 적응 3을 기본으로 둔다. 같은 실측에서 350px/s 느린 장선은
 * 떨림 통과율 48%(강도 0 대비 절반)를 지연 3.9px로 얻고, 2000px/s 빠른 플릭에서는 지연 0px로
 * 완전히 비켜선다 — 같은 강도의 고정 cascade가 플릭에서 44.8px를 끄는 것과 대비된다. 즉 손떨림이
 * 보이는 느린 선만 잡고 필기감은 건드리지 않는다. 저장된 사용자 브러시의 값은 그대로 유지하며,
 * 신규/누락 필드만 이 기본값을 사용한다.
 */
export const DEFAULT_STUDIO_BRUSH_SNAPSHOT: StudioBrushSnapshot = {
  brushId: "pen",
  strokeWidth: 6,
  brushOpacity: 1,
  color: "#7c5cfc",
  stabilizer: 3,
  stabilizerMode: "adaptive",
  postCorrection: 0,
  preserveCorners: true,
  pressureCurve: 1.0,
  pressureMinSize: 0,
  // On by default. A stylus never sees it — `hardwarePressureOf` returns the pen's own reading and
  // the resolver runs "hardware-precedence", so this only reaches a mouse, a trackpad, and the
  // force-incapable touch that Pointer Events reports as exactly 0.5. Those inputs used to draw
  // every stroke at one dead constant width and opacity from first pixel to last, which is the
  // largest single stroke-feel gap against every reference app that does not assume a pen.
  //
  // Measured on a synthetic drag-then-flick at both 60 and 240 Hz: a slow drag resolves to 0.858
  // pressure and a fast flick to 0.350, identically at both rates. The temporal low-pass stays at
  // its calibrated 12 ms — raising it to settle the simulated pressure was considered and measured
  // instead: sample-to-sample movement during a steady drag is already 0.0026, below one 8-bit
  // step, so there is nothing to settle, while 90 ms would have cost 380-570 ms of catch-up after
  // a speed change.
  useVelocityPressure: true,
  velocitySensitivity: 0.65,
  tiltEnabled: true,
  tipAngle: -30,
  tipRoundness: 0.24,
  brushDynamics: DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS,
  stampTuning: null,
  enginePrograms: null,
};

const DEFAULT_SNAPSHOT = DEFAULT_STUDIO_BRUSH_SNAPSHOT;

function boundedOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Array.from(trimmed).slice(0, maxLength).join("");
}

/**
 * 외부 팩/내장 확장 프리셋의 출처 문자열을 localStorage와 내보내기에 안전한 크기로 제한한다.
 * 누락된 필드는 그대로 생략해 v1 라이브러리 레코드와 구조적으로도 호환된다.
 */
export function normalizeStudioBrushSourcePresetMetadata(
  raw: unknown
): StudioBrushSourcePresetMetadata {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const sourcePresetId = boundedOptionalText(
    source.sourcePresetId,
    BRUSH_SOURCE_PRESET_ID_MAX_LENGTH
  );
  const sourcePresetName = boundedOptionalText(
    source.sourcePresetName,
    BRUSH_SOURCE_PRESET_NAME_MAX_LENGTH
  );
  return {
    ...(sourcePresetId ? { sourcePresetId } : {}),
    ...(sourcePresetName ? { sourcePresetName } : {}),
  };
}

function recordSourcePresetAdjustments(
  source: Record<string, unknown>,
  normalized: StudioBrushSourcePresetMetadata,
  adjusted: string[]
): void {
  for (const key of ["sourcePresetId", "sourcePresetName"] as const) {
    if (!(key in source)) continue;
    if (source[key] !== normalized[key]) adjusted.push(key);
  }
}

function replaceBrushSnapshot<T extends StudioBrushSnapshot>(
  source: T,
  snapshot: StudioBrushSnapshot
): Omit<T, keyof StudioBrushSnapshot> & StudioBrushSnapshot {
  const {
    sourcePresetId: _sourcePresetId,
    sourcePresetName: _sourcePresetName,
    brushId: _brushId,
    strokeWidth: _strokeWidth,
    brushOpacity: _brushOpacity,
    color: _color,
    stabilizer: _stabilizer,
    stabilizerMode: _stabilizerMode,
    postCorrection: _postCorrection,
    preserveCorners: _preserveCorners,
    pressureCurve: _pressureCurve,
    pressureMinSize: _pressureMinSize,
    useVelocityPressure: _useVelocityPressure,
    velocitySensitivity: _velocitySensitivity,
    tiltEnabled: _tiltEnabled,
    tipAngle: _tipAngle,
    tipRoundness: _tipRoundness,
    brushDynamics: _brushDynamics,
    stampTuning: _stampTuning,
    enginePrograms: _enginePrograms,
    ...metadata
  } = source;
  return { ...metadata, ...snapshot };
}

function clampedNumberField(
  o: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fallback: number,
  adjusted: string[]
): number {
  const v = o[key];
  if (typeof v === "number" && Number.isFinite(v)) {
    const clamped = Math.min(max, Math.max(min, v));
    if (clamped !== v) adjusted.push(key);
    return clamped;
  }
  adjusted.push(key);
  return fallback;
}

function sanitizeStampTuning(
  brushId: string,
  raw: unknown,
  adjusted: string[]
): StudioBrushStampTuning | null {
  const kind = resolveStudioStampBrushKind(brushId);
  if (!kind) {
    if (raw !== null && raw !== undefined) adjusted.push("stampTuning");
    return null;
  }

  const defaults = STUDIO_STAMP_BRUSH_DEFAULTS[kind];
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const fieldAdjusted: string[] = [];
  const flow = clampedNumberField(
    source,
    "flow",
    BRUSH_STAMP_TUNING_RANGE[0],
    BRUSH_STAMP_TUNING_RANGE[1],
    defaults.flow,
    fieldAdjusted
  );
  const hardness = clampedNumberField(
    source,
    "hardness",
    BRUSH_STAMP_TUNING_RANGE[0],
    BRUSH_STAMP_TUNING_RANGE[1],
    defaults.hardness,
    fieldAdjusted
  );
  const minSize = clampedNumberField(
    source,
    "minSize",
    BRUSH_STAMP_TUNING_RANGE[0],
    BRUSH_STAMP_TUNING_RANGE[1],
    defaults.minSizeRatio,
    fieldAdjusted
  );
  if (fieldAdjusted.length > 0 || !raw || typeof raw !== "object") {
    adjusted.push("stampTuning");
  }
  return { flow, hardness, minSize };
}

/** JSON 데이터의 키 순서와 무관한 구조 비교. 순환 참조 입력도 보정 대상으로 안전하게 처리한다. */
function jsonStructureEqual(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, object>()
): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => jsonStructureEqual(value, right[index], seen));
  }

  const knownRight = seen.get(left);
  if (knownRight) return knownRight === right;
  seen.set(left, right);
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key) => !(key in rightRecord))) return false;
  return leftKeys.every((key) => jsonStructureEqual(leftRecord[key], rightRecord[key], seen));
}

/**
 * Phase-two material fields are additive identity defaults. A v1 saved brush that predates those
 * keys is already semantically normalized and should not be reported to the artist as repaired.
 * Invalid present values still compare against their normalized form and remain visible as fixes.
 */
function brushDynamicsComparisonValue(
  raw: unknown,
  normalized: NormalizedStudioBrushDynamicsSettings
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const source = raw as Record<string, unknown>;
  return {
    ...source,
    ...(source.colorDynamics === undefined ? { colorDynamics: normalized.colorDynamics } : {}),
    ...(source.grain === undefined ? { grain: normalized.grain } : {}),
    ...(source.tipLayers === undefined ? { tipLayers: normalized.tipLayers } : {}),
  };
}

/**
 * 신뢰할 수 없는 입력(가져오기 파일 등)을 유효한 StudioBrushSnapshot으로 정제한다.
 * 필드가 없거나 타입이 다르거나 범위를 벗어나면 기본값으로 대체/clamp하고 adjustedFields에 그
 * 필드 이름을 기록한다(어떤 값이 보정됐는지 호출부가 사용자에게 알릴 수 있게). 절대 던지지 않는다
 * — "파일 자체가 브러시 설정이 아님"의 판별은 importBrushFromJson의 kind 체크가 담당한다.
 */
export function sanitizeBrushSnapshot(raw: unknown): { snapshot: StudioBrushSnapshot; adjustedFields: string[] } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const adjustedFields: string[] = [];
  const sourcePresetMetadata = normalizeStudioBrushSourcePresetMetadata(o);
  recordSourcePresetAdjustments(o, sourcePresetMetadata, adjustedFields);

  const runtime = resolveStudioBrushRuntime(o.brushId);
  const brushId = runtime.resolvedId;
  if (runtime.status === "safe-fallback") {
    adjustedFields.push("brushId");
  }
  const strokeWidth = clampedNumberField(
    o,
    "strokeWidth",
    BRUSH_STROKE_WIDTH_RANGE[0],
    BRUSH_STROKE_WIDTH_RANGE[1],
    DEFAULT_SNAPSHOT.strokeWidth,
    adjustedFields
  );
  const brushOpacity = clampedNumberField(
    o,
    "brushOpacity",
    BRUSH_OPACITY_RANGE[0],
    BRUSH_OPACITY_RANGE[1],
    DEFAULT_SNAPSHOT.brushOpacity,
    adjustedFields
  );
  const stabilizer = clampedNumberField(o, "stabilizer", 0, STABILIZER_MAX, DEFAULT_SNAPSHOT.stabilizer, adjustedFields);
  const postCorrection = clampedNumberField(
    o,
    "postCorrection",
    0,
    STABILIZER_MAX,
    DEFAULT_SNAPSHOT.postCorrection,
    adjustedFields
  );
  const stabilizerMode = isStudioStabilizerMode(o.stabilizerMode)
    ? o.stabilizerMode
    : normalizeStudioStabilizerMode(DEFAULT_SNAPSHOT.stabilizerMode);
  if (!isStudioStabilizerMode(o.stabilizerMode)) adjustedFields.push("stabilizerMode");
  const pressureCurve = clampedNumberField(
    o,
    "pressureCurve",
    BRUSH_PRESSURE_CURVE_RANGE[0],
    BRUSH_PRESSURE_CURVE_RANGE[1],
    DEFAULT_SNAPSHOT.pressureCurve,
    adjustedFields
  );
  const pressureMinSize = clampedNumberField(
    o,
    "pressureMinSize",
    0,
    1,
    DEFAULT_SNAPSHOT.pressureMinSize,
    adjustedFields
  );
  const velocitySensitivity = clampedNumberField(
    o,
    "velocitySensitivity",
    BRUSH_VELOCITY_SENSITIVITY_RANGE[0],
    BRUSH_VELOCITY_SENSITIVITY_RANGE[1],
    DEFAULT_SNAPSHOT.velocitySensitivity,
    adjustedFields
  );
  const tipAngle = clampedNumberField(
    o,
    "tipAngle",
    BRUSH_TIP_ANGLE_RANGE[0],
    BRUSH_TIP_ANGLE_RANGE[1],
    DEFAULT_SNAPSHOT.tipAngle,
    adjustedFields
  );
  const tipRoundness = clampedNumberField(
    o,
    "tipRoundness",
    BRUSH_TIP_ROUNDNESS_RANGE[0],
    BRUSH_TIP_ROUNDNESS_RANGE[1],
    DEFAULT_SNAPSHOT.tipRoundness,
    adjustedFields
  );
  const brushDynamics = normalizeStudioBrushDynamicsSettings(o.brushDynamics);
  if (!jsonStructureEqual(
    brushDynamicsComparisonValue(o.brushDynamics, brushDynamics),
    brushDynamics
  )) adjustedFields.push("brushDynamics");
  const stampTuning = sanitizeStampTuning(brushId, o.stampTuning, adjustedFields);

  let useVelocityPressure: boolean;
  if (typeof o.useVelocityPressure === "boolean") {
    useVelocityPressure = o.useVelocityPressure;
  } else {
    adjustedFields.push("useVelocityPressure");
    useVelocityPressure = DEFAULT_SNAPSHOT.useVelocityPressure;
  }

  let preserveCorners: boolean;
  if (typeof o.preserveCorners === "boolean") {
    preserveCorners = o.preserveCorners;
  } else {
    adjustedFields.push("preserveCorners");
    preserveCorners = DEFAULT_SNAPSHOT.preserveCorners;
  }

  let tiltEnabled: boolean;
  if (typeof o.tiltEnabled === "boolean") {
    tiltEnabled = o.tiltEnabled;
  } else {
    adjustedFields.push("tiltEnabled");
    tiltEnabled = DEFAULT_SNAPSHOT.tiltEnabled;
  }

  const normalizedColor = typeof o.color === "string" ? normalizeHexColor(o.color) : null;
  let color: string;
  if (normalizedColor) {
    color = normalizedColor;
  } else {
    adjustedFields.push("color");
    color = DEFAULT_SNAPSHOT.color;
  }

  return {
    snapshot: {
      ...sourcePresetMetadata,
      brushId,
      strokeWidth,
      brushOpacity,
      color,
      stabilizer,
      stabilizerMode,
      postCorrection,
      preserveCorners,
      pressureCurve,
      pressureMinSize,
      useVelocityPressure,
      velocitySensitivity,
      tiltEnabled,
      tipAngle,
      tipRoundness,
      brushDynamics,
      stampTuning,
      // 신뢰할 수 없는 입력은 normalize 가 fail-closed 로 null 을 돌려주고, null 은 곧 "브러시
      // id 의 기본 조합"이다 — 저장된 브러시가 다시 열릴 때 없던 프로그램이 켜지지 않는다.
      enginePrograms: normalizeStudioBrushEngineProgramSet(o.enginePrograms),
    },
    adjustedFields,
  };
}

/** SQL/OPFS repository가 payload를 같은 권위 규칙으로 검증할 때 재사용한다. */
export function normalizeStoredBrush(v: unknown): StudioSavedBrush | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.id !== "string"
    || typeof o.name !== "string"
    || typeof o.createdAt !== "number"
    || !Number.isFinite(o.createdAt)
    || typeof o.updatedAt !== "number"
    || !Number.isFinite(o.updatedAt)
  ) {
    return null;
  }
  const { snapshot } = sanitizeBrushSnapshot(o);
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    // v1~v3 레코드에는 두 메타데이터가 없으므로 false/null로 무손실 마이그레이션한다.
    pinned: o.pinned === true || o.favorite === true,
    lastUsedAt:
      typeof o.lastUsedAt === "number" && Number.isFinite(o.lastUsedAt)
        ? o.lastUsedAt
        : null,
    ...snapshot,
  };
}

// ── 저장소 CRUD (studio-palette-library.ts와 동일한 패턴) ──────────────

/**
 * 저장소를 상태까지 포함해 읽는다. 깨진 JSON·미래 버전·부분 손상은 빈 라이브러리와 구분한다.
 * 호출부가 이 결과를 무시하고 덮어쓰지 않도록 모든 mutation은 이 함수를 거친다.
 * 기존 배열 저장 형식은 무손실 마이그레이션을 위해 계속 읽되, 다음 정상 쓰기부터 버전 envelope로 바꾼다.
 */
export function readBrushLibrary(storage: BrushLibraryStorage | null | undefined): BrushLibraryReadResult {
  if (!storage) return { brushes: [], status: "unavailable" };
  let raw: string | null;
  try {
    raw = storage.getItem(BRUSH_LIBRARY_KEY);
  } catch {
    return { brushes: [], status: "read-error" };
  }
  if (!raw) return { brushes: [], status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { brushes: [], status: "corrupt" };
  }

  let records: unknown[];
  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (parsed && typeof parsed === "object") {
    const envelope = parsed as Record<string, unknown>;
    if (!("version" in envelope)) {
      return { brushes: [], status: "corrupt" };
    }
    if (envelope.version !== BRUSH_LIBRARY_STORAGE_VERSION) {
      return { brushes: [], status: "unsupported-version" };
    }
    if (!Array.isArray(envelope.brushes)) {
      return { brushes: [], status: "corrupt" };
    }
    records = envelope.brushes;
  } else {
    return { brushes: [], status: "corrupt" };
  }

  const brushes: StudioSavedBrush[] = [];
  let invalidRecordFound = false;
  const ids = new Set<string>();
  for (const value of records) {
    const brush = normalizeStoredBrush(value);
    if (!brush || ids.has(brush.id)) {
      invalidRecordFound = true;
      continue;
    }
    ids.add(brush.id);
    brushes.push(brush);
  }
  if (invalidRecordFound) return { brushes, status: "corrupt" };
  return { brushes, status: brushes.length === 0 ? "empty" : "ok" };
}

/** 표시용 호환 API. 저장소 오류 상태가 필요한 mutation/복구 UI는 readBrushLibrary를 사용한다. */
export function listBrushes(storage: BrushLibraryStorage | null | undefined): StudioSavedBrush[] {
  return readBrushLibrary(storage).brushes;
}

function mutationFailureStatus(status: BrushLibraryReadStatus): BrushMutationFailureStatus | null {
  if (status === "ok" || status === "empty") return null;
  return status === "unavailable" ? "storage-error" : "library-unreadable";
}

function persist(storage: BrushLibraryStorage | null | undefined, brushes: StudioSavedBrush[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(BRUSH_LIBRARY_KEY, JSON.stringify({
      version: BRUSH_LIBRARY_STORAGE_VERSION,
      brushes,
    }));
    return true;
  } catch {
    return false;
  }
}

/** 저장(같은 id면 교체하며 맨 앞으로, 새 항목도 맨 앞). 개수 상한이나 자동 퇴출은 없다. */
export function saveBrushWithResult(
  storage: BrushLibraryStorage | null | undefined,
  brush: StudioSavedBrush
): BrushSaveResult {
  const read = readBrushLibrary(storage);
  const readFailure = mutationFailureStatus(read.status);
  if (readFailure) return { brushes: read.brushes, status: readFailure };
  const current = read.brushes;
  const { snapshot: safeSnapshot } = sanitizeBrushSnapshot(brush);
  const safeBrush: StudioSavedBrush = replaceBrushSnapshot(brush, safeSnapshot);
  const next = [safeBrush, ...current.filter((b) => b.id !== brush.id)];
  if (!persist(storage, next)) return { brushes: current, status: "storage-error" };
  return { brushes: next, status: "saved" };
}

/** 배열만 필요한 기존 호출부를 위한 호환 래퍼. */
export function saveBrush(storage: BrushLibraryStorage | null | undefined, brush: StudioSavedBrush): StudioSavedBrush[] {
  return saveBrushWithResult(storage, brush).brushes;
}

/**
 * Persist a third-party brush pack in one storage write. Brushes keep source order, duplicate ids
 * are deterministically collapsed to the first occurrence, and no half-written JSON state is
 * exposed if the single write fails. Storage quota failures remain explicit storage errors.
 */
export function saveBrushBatchWithResult(
  storage: BrushLibraryStorage | null | undefined,
  incoming: readonly StudioSavedBrush[]
): BrushBatchSaveResult {
  const read = readBrushLibrary(storage);
  const readFailure = mutationFailureStatus(read.status);
  if (readFailure) {
    return {
      brushes: read.brushes,
      savedCount: 0,
      skippedCount: incoming.length,
      status: readFailure,
    };
  }
  const unique: StudioSavedBrush[] = [];
  const incomingIds = new Set<string>();
  for (const brush of incoming) {
    if (incomingIds.has(brush.id)) continue;
    incomingIds.add(brush.id);
    const { snapshot } = sanitizeBrushSnapshot(brush);
    unique.push(replaceBrushSnapshot(brush, snapshot));
  }
  if (unique.length === 0) {
    return { brushes: read.brushes, savedCount: 0, skippedCount: 0, status: "saved" };
  }
  const retained = read.brushes.filter((brush) => !incomingIds.has(brush.id));
  const skippedCount = incoming.length - unique.length;
  const next = [...unique, ...retained];
  if (!persist(storage, next)) {
    return {
      brushes: read.brushes,
      savedCount: 0,
      skippedCount: incoming.length,
      status: "storage-error",
    };
  }
  return {
    brushes: next,
    savedCount: unique.length,
    skippedCount,
    status: skippedCount > 0 ? "partial" : "saved",
  };
}

/**
 * 기존 브러시의 id·이름·고정·생성 시각은 그대로 두고 그리기 설정(snapshot)만 지금 값으로
 * 덮어쓴다. saveBrushWithResult가 이미 "같은 id면 교체" 동작을 지원하므로 그걸 그대로 쓴다 —
 * 지금까지 이 경로로 오는 호출이 없었을 뿐이다(항상 createBrush로 새 id를 만들어 저장했다).
 */
export function updateBrushSnapshotWithResult(
  storage: BrushLibraryStorage | null | undefined,
  id: string,
  snapshot: StudioBrushSnapshot
): BrushUpdateResult {
  const read = readBrushLibrary(storage);
  const readFailure = mutationFailureStatus(read.status);
  if (readFailure) return { brushes: read.brushes, status: readFailure };
  const existing = read.brushes.find((b) => b.id === id);
  if (!existing) return { brushes: read.brushes, status: "missing" };
  const { snapshot: safe } = sanitizeBrushSnapshot(snapshot);
  const updated: StudioSavedBrush = {
    ...replaceBrushSnapshot(existing, safe),
    updatedAt: Date.now(),
  };
  const result = saveBrushWithResult(storage, updated);
  if (result.status === "storage-error" || result.status === "library-unreadable") {
    return { brushes: result.brushes, status: result.status };
  }
  return { brushes: result.brushes, status: "updated" };
}

/** 이름 변경(목록 순서는 유지 — 저장과 달리 맨 앞으로 옮기지 않는다). 빈 이름은 무시(원본 목록 그대로 반환). */
export function renameBrush(storage: BrushLibraryStorage | null | undefined, id: string, name: string): StudioSavedBrush[] {
  return renameBrushWithResult(storage, id, name).brushes;
}

/** 이름 변경 결과를 명시해 missing·저장소 장애를 UI가 정상 성공과 구분하게 한다. */
export function renameBrushWithResult(
  storage: BrushLibraryStorage | null | undefined,
  id: string,
  name: string
): BrushUpdateResult {
  const trimmed = name.trim();
  const read = readBrushLibrary(storage);
  const readFailure = mutationFailureStatus(read.status);
  if (readFailure) return { brushes: read.brushes, status: readFailure };
  const current = read.brushes;
  if (!trimmed) return { brushes: current, status: "unchanged" };
  if (!current.some((brush) => brush.id === id)) {
    return { brushes: current, status: "missing" };
  }
  const next = current.map((b) => (b.id === id ? { ...b, name: trimmed, updatedAt: Date.now() } : b));
  return persist(storage, next)
    ? { brushes: next, status: "updated" }
    : { brushes: current, status: "storage-error" };
}

/** 삭제. 새 목록 반환. */
export function deleteBrush(storage: BrushLibraryStorage | null | undefined, id: string): StudioSavedBrush[] {
  return deleteBrushWithRecord(storage, id).brushes;
}

/** 삭제된 레코드와 원래 위치를 함께 돌려줘 비모달 실행취소가 동일 id/메타데이터를 복구하게 한다. */
export function deleteBrushWithRecord(
  storage: BrushLibraryStorage | null | undefined,
  id: string
): BrushDeleteResult {
  const read = readBrushLibrary(storage);
  const readFailure = mutationFailureStatus(read.status);
  if (readFailure) {
    return { brushes: read.brushes, deleted: null, status: readFailure };
  }
  const current = read.brushes;
  const index = current.findIndex((brush) => brush.id === id);
  if (index < 0) return { brushes: current, deleted: null, status: "missing" };
  const deleted: DeletedBrushRecord = { brush: current[index], index };
  const next = current.filter((brush) => brush.id !== id);
  if (!persist(storage, next)) {
    return { brushes: current, deleted: null, status: "storage-error" };
  }
  return { brushes: next, deleted, status: "deleted" };
}

/** deleteBrushWithRecord가 보존한 위치에 브러시를 복원한다. 같은 id는 한 항목으로 교체한다. */
export function restoreDeletedBrush(
  storage: BrushLibraryStorage | null | undefined,
  deleted: DeletedBrushRecord
): BrushRestoreResult {
  const read = readBrushLibrary(storage);
  const readFailure = mutationFailureStatus(read.status);
  if (readFailure) return { brushes: read.brushes, status: readFailure };
  const current = read.brushes;
  const withoutDuplicate = current.filter((brush) => brush.id !== deleted.brush.id);
  const index = Math.max(0, Math.min(deleted.index, withoutDuplicate.length));
  const next = [
    ...withoutDuplicate.slice(0, index),
    deleted.brush,
    ...withoutDuplicate.slice(index),
  ];
  if (!persist(storage, next)) return { brushes: current, status: "storage-error" };
  return { brushes: next, status: "restored" };
}

/** 현재 라이브 브러시 설정(snapshot)에 이름을 붙여 저장 대상 레코드로 만든다. 절대 던지지 않는다
 *  (모든 필드를 방어적으로 clamp/정규화 — 호출부가 항상 유효한 값을 넘기더라도 이중 안전장치). */
export function createBrush(name: string, snapshot: StudioBrushSnapshot): StudioSavedBrush {
  const { snapshot: safe } = sanitizeBrushSnapshot(snapshot);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: name.trim() || DEFAULT_BRUSH_NAME,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    lastUsedAt: now,
    ...safe,
  };
}

/** 라이브러리 안에서 충돌하지 않는 `이름 2`, `이름 3` 형태의 복제 이름을 만든다. */
export function duplicateBrushName(name: string, existingNames: Iterable<string>): string {
  const normalized = name.trim() || DEFAULT_BRUSH_NAME;
  const base = normalized.replace(/\s+\d+$/u, "").trim() || DEFAULT_BRUSH_NAME;
  const names = new Set(Array.from(existingNames, (candidate) => candidate.trim()));
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

/** 기존 브러시를 독립 id/시각/메타데이터로 복제해 원본 바로 다음에 둔다. */
export function duplicateBrush(
  storage: BrushLibraryStorage | null | undefined,
  id: string
): BrushDuplicateResult {
  const read = readBrushLibrary(storage);
  const readFailure = mutationFailureStatus(read.status);
  if (readFailure) {
    return { brushes: read.brushes, brush: null, status: readFailure };
  }
  const current = read.brushes;
  const index = current.findIndex((brush) => brush.id === id);
  if (index < 0) return { brushes: current, brush: null, status: "missing" };
  const now = Date.now();
  const source = current[index];
  const brush: StudioSavedBrush = {
    ...source,
    id: crypto.randomUUID(),
    name: duplicateBrushName(source.name, current.map((candidate) => candidate.name)),
    createdAt: now,
    updatedAt: now,
    pinned: false,
    lastUsedAt: null,
  };
  const next = [...current.slice(0, index + 1), brush, ...current.slice(index + 1)];
  if (!persist(storage, next)) {
    return { brushes: current, brush: null, status: "storage-error" };
  }
  return { brushes: next, brush, status: "duplicated" };
}

/** 빠른 선반 고정 상태를 전환한다. 브러시 본문 수정 시각은 건드리지 않는다. */
export function toggleBrushPinned(
  storage: BrushLibraryStorage | null | undefined,
  id: string
): StudioSavedBrush[] {
  return toggleBrushPinnedWithResult(storage, id).brushes;
}

export function toggleBrushPinnedWithResult(
  storage: BrushLibraryStorage | null | undefined,
  id: string
): BrushUpdateResult {
  const read = readBrushLibrary(storage);
  const readFailure = mutationFailureStatus(read.status);
  if (readFailure) return { brushes: read.brushes, status: readFailure };
  const current = read.brushes;
  if (!current.some((brush) => brush.id === id)) {
    return { brushes: current, status: "missing" };
  }
  const next = current.map((brush) =>
    brush.id === id ? { ...brush, pinned: !brush.pinned } : brush
  );
  return persist(storage, next)
    ? { brushes: next, status: "updated" }
    : { brushes: current, status: "storage-error" };
}

/** 브러시를 캔버스 설정에 적용한 시각을 기록한다. */
export function markBrushUsed(
  storage: BrushLibraryStorage | null | undefined,
  id: string,
  usedAt = Date.now()
): StudioSavedBrush[] {
  return markBrushUsedWithResult(storage, id, usedAt).brushes;
}

export function markBrushUsedWithResult(
  storage: BrushLibraryStorage | null | undefined,
  id: string,
  usedAt = Date.now()
): BrushUpdateResult {
  const read = readBrushLibrary(storage);
  const readFailure = mutationFailureStatus(read.status);
  if (readFailure) return { brushes: read.brushes, status: readFailure };
  const current = read.brushes;
  if (!current.some((brush) => brush.id === id)) {
    return { brushes: current, status: "missing" };
  }
  const next = current.map((brush) =>
    brush.id === id ? { ...brush, lastUsedAt: usedAt } : brush
  );
  return persist(storage, next)
    ? { brushes: next, status: "updated" }
    : { brushes: current, status: "storage-error" };
}

export function brushActivityAt(brush: StudioSavedBrush): number {
  return brush.lastUsedAt ?? brush.updatedAt;
}

function compareStableBrushId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 페이지 cursor와 배열 정렬이 공유하는 완전 순서다. 동률에서도 id가 결정성을 보장한다. */
export function compareBrushesForLibrary(
  a: StudioSavedBrush,
  b: StudioSavedBrush
): number {
  return Number(b.pinned) - Number(a.pinned)
    || brushActivityAt(b) - brushActivityAt(a)
    || b.createdAt - a.createdAt
    || compareStableBrushId(a.id, b.id);
}

/** 전체 라이브러리: 고정 → 최근 적용 → 최근 수정 순. 입력 배열은 변경하지 않는다. */
export function sortBrushesForLibrary(brushes: readonly StudioSavedBrush[]): StudioSavedBrush[] {
  return [...brushes].sort(compareBrushesForLibrary);
}

/** 모바일/컴팩트 선반: 고정 또는 사용 이력이 있는 브러시만, 고정 우선으로 최대 8개. */
export function selectQuickBrushes(
  brushes: readonly StudioSavedBrush[],
  limit = MAX_QUICK_BRUSHES
): StudioSavedBrush[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return sortBrushesForLibrary(
    brushes.filter((brush) => brush.pinned || brush.lastUsedAt !== null)
  ).slice(0, Math.floor(limit));
}

/** 현재 라이브 설정이 저장 브러시와 정확히 같은지 판별해 편집 뒤 선택 강조가 자동으로 풀리게 한다. */
export function brushMatchesSnapshot(
  brush: StudioSavedBrush,
  snapshot: StudioBrushSnapshot
): boolean {
  return brush.sourcePresetId === snapshot.sourcePresetId
    && brush.sourcePresetName === snapshot.sourcePresetName
    && brush.brushId === snapshot.brushId
    && brush.strokeWidth === snapshot.strokeWidth
    && brush.brushOpacity === snapshot.brushOpacity
    && brush.color.toLowerCase() === snapshot.color.toLowerCase()
    && brush.stabilizer === snapshot.stabilizer
    && brush.stabilizerMode === snapshot.stabilizerMode
    && brush.postCorrection === snapshot.postCorrection
    && brush.preserveCorners === snapshot.preserveCorners
    && brush.pressureCurve === snapshot.pressureCurve
    && brush.pressureMinSize === snapshot.pressureMinSize
    && brush.useVelocityPressure === snapshot.useVelocityPressure
    && brush.velocitySensitivity === snapshot.velocitySensitivity
    && brush.tiltEnabled === snapshot.tiltEnabled
    && brush.tipAngle === snapshot.tipAngle
    && brush.tipRoundness === snapshot.tipRoundness
    && jsonStructureEqual(brush.stampTuning, snapshot.stampTuning)
    && studioBrushDynamicsSettingsEqual(brush.brushDynamics, snapshot.brushDynamics);
}

// ── JSON 내보내기/가져오기(이 앱 전용 포맷 — 브러시 설정엔 GPL 같은 표준이 없다) ──────

export const BRUSH_EXPORT_KIND = "toonspectrum-studio-brush";
export const BRUSH_EXPORT_VERSION = 6;

/** StudioSavedBrush → JSON 텍스트(들여쓰기 2칸, 사람이 읽을 수 있게). */
export function writeBrushJson(brush: StudioSavedBrush): string {
  const { snapshot } = sanitizeBrushSnapshot(brush);
  const payload = {
    kind: BRUSH_EXPORT_KIND,
    version: BRUSH_EXPORT_VERSION,
    name: brush.name,
    ...normalizeStudioBrushSourcePresetMetadata(snapshot),
    brushId: snapshot.brushId,
    strokeWidth: snapshot.strokeWidth,
    brushOpacity: snapshot.brushOpacity,
    color: snapshot.color,
    stabilizer: snapshot.stabilizer,
    stabilizerMode: snapshot.stabilizerMode,
    postCorrection: snapshot.postCorrection,
    preserveCorners: snapshot.preserveCorners,
    pressureCurve: snapshot.pressureCurve,
    pressureMinSize: snapshot.pressureMinSize,
    useVelocityPressure: snapshot.useVelocityPressure,
    velocitySensitivity: snapshot.velocitySensitivity,
    tiltEnabled: snapshot.tiltEnabled,
    tipAngle: snapshot.tipAngle,
    tipRoundness: snapshot.tipRoundness,
    brushDynamics: snapshot.brushDynamics,
    stampTuning: snapshot.stampTuning,
  };
  return JSON.stringify(payload, null, 2);
}

const FILENAME_ILLEGAL_CHARS = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);

/** 내보내기 파일명 — 이름의 파일시스템 금지 문자·제어 문자만 제거, 한글은 그대로 유지(paletteFileName과
 *  동일 규칙이되, 정규식 제어문자 범위 리터럴을 피하려고 코드포인트 필터로 구현). */
export function brushFileName(brush: { name: string }): string {
  const safe = Array.from(brush.name.trim())
    .filter((ch) => (ch.codePointAt(0) ?? 0) > 0x1f && !FILENAME_ILLEGAL_CHARS.has(ch))
    .join("")
    .trim();
  return `${safe || "brush"}.json`;
}

/**
 * writeBrushJson이 만든(또는 호환되는) JSON 텍스트 → StudioSavedBrush.
 * kind가 "toonspectrum-studio-brush"가 아니면 던진다(parseGplPalette의 매직 헤더 체크와 동일 역할).
 * 그 외 필드 누락·범위 이탈은 sanitizeBrushSnapshot이 조용히 기본값으로 보정하고 adjustedFields로 알린다.
 */
export function importBrushFromJson(
  text: string,
  fallbackName?: string
): { brush: StudioSavedBrush; adjustedFields: string[] } {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("빈 파일이에요. 브러시 설정(.json) 파일을 선택해주세요.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("브러시 설정 파일을 읽지 못했어요.");
  }
  if (!parsed || typeof parsed !== "object" || (parsed as Record<string, unknown>).kind !== BRUSH_EXPORT_KIND) {
    throw new Error("브러시 설정(.json) 파일이 아니에요.");
  }
  const obj = parsed as Record<string, unknown>;
  const { snapshot, adjustedFields } = sanitizeBrushSnapshot(obj);
  const rawName = typeof obj.name === "string" ? obj.name.trim() : "";
  const now = Date.now();
  return {
    brush: {
      id: crypto.randomUUID(),
      name: rawName || fallbackName?.trim() || DEFAULT_BRUSH_NAME,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      lastUsedAt: null,
      ...snapshot,
    },
    adjustedFields,
  };
}
