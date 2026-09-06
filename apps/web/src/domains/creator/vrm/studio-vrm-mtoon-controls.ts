/**
 * MToon(툰 셰이더) 컨트롤 모델 — 선화 추출 품질을 실제로 좌우하는 파라미터만 골라 담는다.
 *
 * 왜 중요한가: Studio 의 LT(선/톤) 추출은 렌더된 컬러 버퍼의 **휘도 소벨**(내부 선) + **알파
 * 소벨**(외곽) + 선택적 깊이 에지로 선을 뽑고, 같은 휘도를 `tone.levels` 단계로 양자화해 톤을
 * 만든다(`studio-bg3d-lt-render`). 즉 "어떤 선이 뽑히는가"는 전적으로 **모델이 화면에 어떤
 * 휘도 계단을 만들었는가**로 결정된다. MToon 의 아웃라인·셰이드·토니 파라미터가 바로 그 계단을
 * 직접 만드는 손잡이다.
 *
 * 설계:
 *  - three/@pixiv 의존 없음. 재질은 **구조적 타입**으로만 받아 GPU 없이 테스트한다.
 *  - 그룹(outline/shading/rim)마다 `enabled` 를 둔다. 끄면 최초 1 회 캐시해 둔 모델 원본
 *    유니폼으로 되돌린다 — 기존 `applyVrmMaterialFx` 와 같은 비파괴 규약이다.
 *  - 저장 포맷은 kind/version 을 갖는 평면 JSON 이며, 파서는 손상 입력에 대해 절대 던지지 않는다.
 */

import {
  isStudioVrmMtoonMaterial,
  type StudioVrmMtoonBrand,
} from "./studio-vrm-mtoon-brand";

export const STUDIO_VRM_MTOON_CONTROLS_KIND = "toonspectrum.vrm-mtoon-controls" as const;
export const STUDIO_VRM_MTOON_CONTROLS_VERSION = 1 as const;

/** @pixiv/three-vrm-materials-mtoon 의 `MToonMaterialOutlineWidthMode` 문자열 값과 동일하다. */
export type StudioVrmMtoonOutlineWidthMode = "none" | "worldCoordinates" | "screenCoordinates";

export const STUDIO_VRM_MTOON_OUTLINE_WIDTH_MODES: readonly StudioVrmMtoonOutlineWidthMode[] =
  Object.freeze(["none", "worldCoordinates", "screenCoordinates"]);

export interface StudioVrmMtoonOutlineControls {
  readonly enabled: boolean;
  readonly mode: StudioVrmMtoonOutlineWidthMode;
  /** worldCoordinates 모드의 굵기(미터). 1.6 m 캐릭터에서 0.002~0.008 이 실용 범위. */
  readonly worldWidthMeters: number;
  /** screenCoordinates 모드의 굵기(뷰포트 높이 비율). 해상도가 변해도 선 굵기가 유지된다. */
  readonly screenWidthRatio: number;
  readonly color: string;
  /** 0 = 조명과 무관한 균일 아웃라인(선 추출에 최적), 1 = 베이스 컬러에 물드는 아웃라인. */
  readonly lightingMix: number;
}

export interface StudioVrmMtoonShadingControls {
  readonly enabled: boolean;
  readonly shadeColor: string;
  /** -1..1. 양수면 그림자가 밝은 쪽으로 번지고, 음수면 그림자 영역이 좁아진다. */
  readonly shadingShift: number;
  /** 0 = 부드러운 램프, 1 = 완전한 2톤 계단. */
  readonly toony: number;
}

export interface StudioVrmMtoonRimControls {
  readonly enabled: boolean;
  readonly color: string;
  readonly mix: number;
  readonly fresnelPower: number;
  readonly lift: number;
}

export interface StudioVrmMtoonControls {
  readonly kind: typeof STUDIO_VRM_MTOON_CONTROLS_KIND;
  readonly version: typeof STUDIO_VRM_MTOON_CONTROLS_VERSION;
  readonly outline: StudioVrmMtoonOutlineControls;
  readonly shading: StudioVrmMtoonShadingControls;
  readonly rim: StudioVrmMtoonRimControls;
}

export interface StudioVrmMtoonNumericLimit {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
}

export type StudioVrmMtoonLimitKey =
  | "worldWidthMeters"
  | "screenWidthRatio"
  | "lightingMix"
  | "shadingShift"
  | "toony"
  | "rimMix"
  | "rimFresnelPower"
  | "rimLift";

export const STUDIO_VRM_MTOON_LIMITS: Readonly<
  Record<StudioVrmMtoonLimitKey, StudioVrmMtoonNumericLimit>
> = Object.freeze({
    worldWidthMeters: { label: "외곽선 굵기(월드)", min: 0, max: 0.05, step: 0.0005, unit: "m" },
    screenWidthRatio: { label: "외곽선 굵기(화면)", min: 0, max: 0.05, step: 0.0002 },
    lightingMix: { label: "외곽선 조명 반영", min: 0, max: 1, step: 0.01 },
    shadingShift: { label: "그림자 경계 위치", min: -1, max: 1, step: 0.01 },
    toony: { label: "계단 강도", min: 0, max: 1, step: 0.01 },
    rimMix: { label: "림 강도", min: 0, max: 1, step: 0.01 },
    rimFresnelPower: { label: "림 프레넬", min: 0, max: 10, step: 0.1 },
    rimLift: { label: "림 리프트", min: 0, max: 1, step: 0.01 },
  });

export const DEFAULT_STUDIO_VRM_MTOON_CONTROLS: StudioVrmMtoonControls = Object.freeze({
  kind: STUDIO_VRM_MTOON_CONTROLS_KIND,
  version: STUDIO_VRM_MTOON_CONTROLS_VERSION,
  outline: Object.freeze({
    enabled: false,
    mode: "worldCoordinates",
    worldWidthMeters: 0.003,
    screenWidthRatio: 0.0025,
    color: "#141414",
    lightingMix: 0,
  }),
  shading: Object.freeze({
    enabled: false,
    shadeColor: "#8a9099",
    shadingShift: 0,
    toony: 0.9,
  }),
  rim: Object.freeze({
    enabled: false,
    color: "#ffffff",
    mix: 0,
    fresnelPower: 5,
    lift: 0,
  }),
});

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || FORBIDDEN_KEYS.has(key)) return {};
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  const nested = descriptor && "value" in descriptor ? descriptor.value : undefined;
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) return {};
  return nested as Record<string, unknown>;
}

function readValue(source: Record<string, unknown>, key: string): unknown {
  if (FORBIDDEN_KEYS.has(key)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clampNumber(value: unknown, limit: StudioVrmMtoonNumericLimit, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(limit.max, Math.max(limit.min, numeric));
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : fallback;
}

function normalizeMode(value: unknown, fallback: StudioVrmMtoonOutlineWidthMode) {
  return STUDIO_VRM_MTOON_OUTLINE_WIDTH_MODES.includes(value as StudioVrmMtoonOutlineWidthMode)
    ? (value as StudioVrmMtoonOutlineWidthMode)
    : fallback;
}

/** 어떤 입력이 와도 유효한 컨트롤을 돌려준다(던지지 않는다). */
export function sanitizeStudioVrmMtoonControls(raw: unknown): StudioVrmMtoonControls {
  const source = asRecord(raw);
  const outline = readRecord(source, "outline");
  const shading = readRecord(source, "shading");
  const rim = readRecord(source, "rim");
  const defaults = DEFAULT_STUDIO_VRM_MTOON_CONTROLS;

  return {
    kind: STUDIO_VRM_MTOON_CONTROLS_KIND,
    version: STUDIO_VRM_MTOON_CONTROLS_VERSION,
    outline: {
      enabled: readValue(outline, "enabled") === true,
      mode: normalizeMode(readValue(outline, "mode"), defaults.outline.mode),
      worldWidthMeters: clampNumber(
        readValue(outline, "worldWidthMeters"),
        STUDIO_VRM_MTOON_LIMITS.worldWidthMeters,
        defaults.outline.worldWidthMeters,
      ),
      screenWidthRatio: clampNumber(
        readValue(outline, "screenWidthRatio"),
        STUDIO_VRM_MTOON_LIMITS.screenWidthRatio,
        defaults.outline.screenWidthRatio,
      ),
      color: normalizeColor(readValue(outline, "color"), defaults.outline.color),
      lightingMix: clampNumber(
        readValue(outline, "lightingMix"),
        STUDIO_VRM_MTOON_LIMITS.lightingMix,
        defaults.outline.lightingMix,
      ),
    },
    shading: {
      enabled: readValue(shading, "enabled") === true,
      shadeColor: normalizeColor(readValue(shading, "shadeColor"), defaults.shading.shadeColor),
      shadingShift: clampNumber(
        readValue(shading, "shadingShift"),
        STUDIO_VRM_MTOON_LIMITS.shadingShift,
        defaults.shading.shadingShift,
      ),
      toony: clampNumber(
        readValue(shading, "toony"),
        STUDIO_VRM_MTOON_LIMITS.toony,
        defaults.shading.toony,
      ),
    },
    rim: {
      enabled: readValue(rim, "enabled") === true,
      color: normalizeColor(readValue(rim, "color"), defaults.rim.color),
      mix: clampNumber(readValue(rim, "mix"), STUDIO_VRM_MTOON_LIMITS.rimMix, defaults.rim.mix),
      fresnelPower: clampNumber(
        readValue(rim, "fresnelPower"),
        STUDIO_VRM_MTOON_LIMITS.rimFresnelPower,
        defaults.rim.fresnelPower,
      ),
      lift: clampNumber(
        readValue(rim, "lift"),
        STUDIO_VRM_MTOON_LIMITS.rimLift,
        defaults.rim.lift,
      ),
    },
  };
}

/** JSON 문자열도 받는다. 파싱 실패는 기본값으로 흡수한다. */
export function parseStudioVrmMtoonControls(raw: unknown): StudioVrmMtoonControls {
  if (typeof raw === "string") {
    try {
      return sanitizeStudioVrmMtoonControls(JSON.parse(raw));
    } catch {
      return sanitizeStudioVrmMtoonControls(undefined);
    }
  }
  return sanitizeStudioVrmMtoonControls(raw);
}

export function serializeStudioVrmMtoonControls(raw: unknown): string {
  return JSON.stringify(sanitizeStudioVrmMtoonControls(raw));
}

/**
 * MToon 은 아웃라인 굵기를 단일 `outlineWidthFactor` 로 갖고, 단위는 모드가 결정한다.
 * 모델 쪽은 모드별 값을 따로 들고 있다가(UI 에서 모드를 오갈 때 값이 사라지지 않게) 여기서 합친다.
 */
export function resolveStudioVrmMtoonOutlineWidthFactor(controls: StudioVrmMtoonControls): number {
  if (controls.outline.mode === "none") return 0;
  return controls.outline.mode === "screenCoordinates"
    ? controls.outline.screenWidthRatio
    : controls.outline.worldWidthMeters;
}

/* ── 재질 적용(구조적 타입) ───────────────────────────────────────────── */

/** THREE.Color 의 구조적 부분집합. */
export interface StudioVrmMtoonColorLike {
  setHex(hex: number): unknown;
  getHex(): number;
}

/**
 * @pixiv MToonMaterial 의 구조적 부분집합. 표준 재질에는 이 속성들이 없다.
 *
 * WebGPU 노드 포트(`MToonNodeMaterial`)는 같은 유니폼 이름을 쓰고 브랜드 플래그만 다르므로,
 * 아래 본문은 그대로 쓰고 판정만 `studio-vrm-mtoon-brand` 에 위임한다.
 */
export interface StudioVrmMtoonMaterialLike extends StudioVrmMtoonBrand {
  outlineWidthMode?: StudioVrmMtoonOutlineWidthMode;
  outlineWidthFactor?: number;
  outlineColorFactor?: StudioVrmMtoonColorLike;
  outlineLightingMixFactor?: number;
  shadeColorFactor?: StudioVrmMtoonColorLike;
  shadingShiftFactor?: number;
  shadingToonyFactor?: number;
  parametricRimColorFactor?: StudioVrmMtoonColorLike;
  rimLightingMixFactor?: number;
  parametricRimFresnelPowerFactor?: number;
  parametricRimLiftFactor?: number;
  needsUpdate?: boolean;
  userData?: Record<string, unknown>;
}

export const STUDIO_VRM_MTOON_ORIGINAL_KEY = "__studioVrmMtoonOriginal" as const;

/**
 * 아웃라인 적용 대상.
 * - `outline-capable`(기본): 저작자가 이미 아웃라인을 의도한 재질(원본 모드 ≠ none)에만 굵기를
 *   준다. 눈동자·하이라이트 재질에 검은 셸이 씌워져 홍채가 뭉개지는 사고를 막는다.
 * - `all`: 전 재질에 강제 적용.
 */
export type StudioVrmMtoonOutlineTargets = "outline-capable" | "all";

export interface StudioVrmMtoonApplyOptions {
  readonly outlineTargets?: StudioVrmMtoonOutlineTargets;
}

export interface StudioVrmMtoonApplyReport {
  readonly isMToon: boolean;
  readonly applied: readonly string[];
  /** 이 재질에 없는(= 이 three-vrm 버전이 노출하지 않는) 유니폼. */
  readonly unsupported: readonly string[];
  readonly outlineSkipped: boolean;
}

const EMPTY_REPORT: StudioVrmMtoonApplyReport = Object.freeze({
  isMToon: false,
  applied: Object.freeze([]),
  unsupported: Object.freeze([]),
  outlineSkipped: false,
});

interface MtoonOriginal {
  readonly outlineWidthMode?: StudioVrmMtoonOutlineWidthMode;
  readonly outlineWidthFactor?: number;
  readonly outlineColor?: number;
  readonly outlineLightingMixFactor?: number;
  readonly shadeColor?: number;
  readonly shadingShiftFactor?: number;
  readonly shadingToonyFactor?: number;
  readonly rimColor?: number;
  readonly rimLightingMixFactor?: number;
  readonly rimFresnelPower?: number;
  readonly rimLift?: number;
}

function hexToNumber(color: string): number {
  return Number.parseInt(color.slice(1), 16);
}

function isColorLike(value: unknown): value is StudioVrmMtoonColorLike {
  if (typeof value !== "object" || value === null) return false;
  const color = value as Record<string, unknown>;
  return typeof color.setHex === "function" && typeof color.getHex === "function";
}

function captureOriginal(material: StudioVrmMtoonMaterialLike): MtoonOriginal {
  // three 의 Material 은 항상 userData 를 갖지만, 구조적 타입이라 없을 수도 있다.
  // 캐시를 둘 곳이 없으면 원본이 첫 적용 이후 값으로 오염되므로 여기서 만들어 준다.
  if (!material.userData) material.userData = {};
  const userData = material.userData;
  if (userData) {
    const cached = userData[STUDIO_VRM_MTOON_ORIGINAL_KEY];
    if (typeof cached === "object" && cached !== null) return cached as MtoonOriginal;
  }
  const original: MtoonOriginal = {
    ...(material.outlineWidthMode === undefined ? {} : { outlineWidthMode: material.outlineWidthMode }),
    ...(typeof material.outlineWidthFactor === "number"
      ? { outlineWidthFactor: material.outlineWidthFactor }
      : {}),
    ...(isColorLike(material.outlineColorFactor)
      ? { outlineColor: material.outlineColorFactor.getHex() }
      : {}),
    ...(typeof material.outlineLightingMixFactor === "number"
      ? { outlineLightingMixFactor: material.outlineLightingMixFactor }
      : {}),
    ...(isColorLike(material.shadeColorFactor)
      ? { shadeColor: material.shadeColorFactor.getHex() }
      : {}),
    ...(typeof material.shadingShiftFactor === "number"
      ? { shadingShiftFactor: material.shadingShiftFactor }
      : {}),
    ...(typeof material.shadingToonyFactor === "number"
      ? { shadingToonyFactor: material.shadingToonyFactor }
      : {}),
    ...(isColorLike(material.parametricRimColorFactor)
      ? { rimColor: material.parametricRimColorFactor.getHex() }
      : {}),
    ...(typeof material.rimLightingMixFactor === "number"
      ? { rimLightingMixFactor: material.rimLightingMixFactor }
      : {}),
    ...(typeof material.parametricRimFresnelPowerFactor === "number"
      ? { rimFresnelPower: material.parametricRimFresnelPowerFactor }
      : {}),
    ...(typeof material.parametricRimLiftFactor === "number"
      ? { rimLift: material.parametricRimLiftFactor }
      : {}),
  };
  if (userData) userData[STUDIO_VRM_MTOON_ORIGINAL_KEY] = original;
  return original;
}

function setColor(
  color: StudioVrmMtoonColorLike | undefined,
  hex: number,
  field: string,
  applied: string[],
  unsupported: string[],
): void {
  if (!isColorLike(color)) {
    unsupported.push(field);
    return;
  }
  color.setHex(hex);
  applied.push(field);
}

/**
 * 컨트롤을 MToon 재질 하나에 적용한다. MToon 이 아니면 아무것도 하지 않는다.
 * 그룹이 꺼져 있으면 최초 1 회 캐시한 원본으로 되돌린다.
 */
export function applyStudioVrmMtoonControls(
  material: unknown,
  controls: StudioVrmMtoonControls,
  options: StudioVrmMtoonApplyOptions = {},
): StudioVrmMtoonApplyReport {
  if (typeof material !== "object" || material === null) return EMPTY_REPORT;
  const target = material as StudioVrmMtoonMaterialLike;
  if (!isStudioVrmMtoonMaterial(target)) return EMPTY_REPORT;

  const safe = sanitizeStudioVrmMtoonControls(controls);
  const original = captureOriginal(target);
  const applied: string[] = [];
  const unsupported: string[] = [];
  let outlineSkipped = false;

  // ── 아웃라인 ──
  const outlineCapable =
    (options.outlineTargets ?? "outline-capable") === "all" ||
    (original.outlineWidthMode !== undefined && original.outlineWidthMode !== "none");
  if (safe.outline.enabled && outlineCapable) {
    if (target.outlineWidthMode === undefined) {
      unsupported.push("outlineWidthMode");
    } else {
      target.outlineWidthMode = safe.outline.mode;
      applied.push("outlineWidthMode");
    }
    if (typeof target.outlineWidthFactor === "number") {
      target.outlineWidthFactor = resolveStudioVrmMtoonOutlineWidthFactor(safe);
      applied.push("outlineWidthFactor");
    } else {
      unsupported.push("outlineWidthFactor");
    }
    setColor(
      target.outlineColorFactor,
      hexToNumber(safe.outline.color),
      "outlineColorFactor",
      applied,
      unsupported,
    );
    if (typeof target.outlineLightingMixFactor === "number") {
      target.outlineLightingMixFactor = safe.outline.lightingMix;
      applied.push("outlineLightingMixFactor");
    } else {
      unsupported.push("outlineLightingMixFactor");
    }
  } else {
    if (safe.outline.enabled) outlineSkipped = true;
    if (original.outlineWidthMode !== undefined) target.outlineWidthMode = original.outlineWidthMode;
    if (original.outlineWidthFactor !== undefined) {
      target.outlineWidthFactor = original.outlineWidthFactor;
    }
    if (original.outlineColor !== undefined && isColorLike(target.outlineColorFactor)) {
      target.outlineColorFactor.setHex(original.outlineColor);
    }
    if (original.outlineLightingMixFactor !== undefined) {
      target.outlineLightingMixFactor = original.outlineLightingMixFactor;
    }
  }

  // ── 셰이딩(그림자) ──
  if (safe.shading.enabled) {
    setColor(
      target.shadeColorFactor,
      hexToNumber(safe.shading.shadeColor),
      "shadeColorFactor",
      applied,
      unsupported,
    );
    if (typeof target.shadingShiftFactor === "number") {
      target.shadingShiftFactor = safe.shading.shadingShift;
      applied.push("shadingShiftFactor");
    } else {
      unsupported.push("shadingShiftFactor");
    }
    if (typeof target.shadingToonyFactor === "number") {
      target.shadingToonyFactor = safe.shading.toony;
      applied.push("shadingToonyFactor");
    } else {
      unsupported.push("shadingToonyFactor");
    }
  } else {
    if (original.shadeColor !== undefined && isColorLike(target.shadeColorFactor)) {
      target.shadeColorFactor.setHex(original.shadeColor);
    }
    if (original.shadingShiftFactor !== undefined) {
      target.shadingShiftFactor = original.shadingShiftFactor;
    }
    if (original.shadingToonyFactor !== undefined) {
      target.shadingToonyFactor = original.shadingToonyFactor;
    }
  }

  // ── 림 라이트 ──
  if (safe.rim.enabled) {
    setColor(
      target.parametricRimColorFactor,
      hexToNumber(safe.rim.color),
      "parametricRimColorFactor",
      applied,
      unsupported,
    );
    if (typeof target.rimLightingMixFactor === "number") {
      target.rimLightingMixFactor = safe.rim.mix;
      applied.push("rimLightingMixFactor");
    } else {
      unsupported.push("rimLightingMixFactor");
    }
    if (typeof target.parametricRimFresnelPowerFactor === "number") {
      target.parametricRimFresnelPowerFactor = safe.rim.fresnelPower;
      applied.push("parametricRimFresnelPowerFactor");
    } else {
      unsupported.push("parametricRimFresnelPowerFactor");
    }
    if (typeof target.parametricRimLiftFactor === "number") {
      target.parametricRimLiftFactor = safe.rim.lift;
      applied.push("parametricRimLiftFactor");
    } else {
      unsupported.push("parametricRimLiftFactor");
    }
  } else {
    if (original.rimColor !== undefined && isColorLike(target.parametricRimColorFactor)) {
      target.parametricRimColorFactor.setHex(original.rimColor);
    }
    if (original.rimLightingMixFactor !== undefined) {
      target.rimLightingMixFactor = original.rimLightingMixFactor;
    }
    if (original.rimFresnelPower !== undefined) {
      target.parametricRimFresnelPowerFactor = original.rimFresnelPower;
    }
    if (original.rimLift !== undefined) target.parametricRimLiftFactor = original.rimLift;
  }

  target.needsUpdate = true;
  return { isMToon: true, applied, unsupported, outlineSkipped };
}

/** 캐시된 원본 유니폼으로 되돌린다. 캐시가 없으면(한 번도 적용 안 함) false. */
export function resetStudioVrmMtoonControls(material: unknown): boolean {
  if (typeof material !== "object" || material === null) return false;
  const target = material as StudioVrmMtoonMaterialLike;
  if (!isStudioVrmMtoonMaterial(target)) return false;
  const cached = target.userData?.[STUDIO_VRM_MTOON_ORIGINAL_KEY];
  if (typeof cached !== "object" || cached === null) return false;
  const original = cached as MtoonOriginal;

  if (original.outlineWidthMode !== undefined) target.outlineWidthMode = original.outlineWidthMode;
  if (original.outlineWidthFactor !== undefined) {
    target.outlineWidthFactor = original.outlineWidthFactor;
  }
  if (original.outlineColor !== undefined && isColorLike(target.outlineColorFactor)) {
    target.outlineColorFactor.setHex(original.outlineColor);
  }
  if (original.outlineLightingMixFactor !== undefined) {
    target.outlineLightingMixFactor = original.outlineLightingMixFactor;
  }
  if (original.shadeColor !== undefined && isColorLike(target.shadeColorFactor)) {
    target.shadeColorFactor.setHex(original.shadeColor);
  }
  if (original.shadingShiftFactor !== undefined) {
    target.shadingShiftFactor = original.shadingShiftFactor;
  }
  if (original.shadingToonyFactor !== undefined) {
    target.shadingToonyFactor = original.shadingToonyFactor;
  }
  if (original.rimColor !== undefined && isColorLike(target.parametricRimColorFactor)) {
    target.parametricRimColorFactor.setHex(original.rimColor);
  }
  if (original.rimLightingMixFactor !== undefined) {
    target.rimLightingMixFactor = original.rimLightingMixFactor;
  }
  if (original.rimFresnelPower !== undefined) {
    target.parametricRimFresnelPowerFactor = original.rimFresnelPower;
  }
  if (original.rimLift !== undefined) target.parametricRimLiftFactor = original.rimLift;
  target.needsUpdate = true;
  return true;
}

export interface StudioVrmMtoonSceneApplyReport {
  readonly materials: number;
  readonly mtoonMaterials: number;
  readonly appliedFields: number;
  readonly outlineSkipped: number;
}

/** 씬 순회로 모은 재질 목록에 한 번에 적용한다(비 MToon 은 자동으로 건너뛴다). */
export function applyStudioVrmMtoonControlsToMaterials(
  materials: Iterable<unknown>,
  controls: StudioVrmMtoonControls,
  options: StudioVrmMtoonApplyOptions = {},
): StudioVrmMtoonSceneApplyReport {
  let count = 0;
  let mtoonMaterials = 0;
  let appliedFields = 0;
  let outlineSkipped = 0;
  for (const material of materials) {
    count += 1;
    const report = applyStudioVrmMtoonControls(material, controls, options);
    if (!report.isMToon) continue;
    mtoonMaterials += 1;
    appliedFields += report.applied.length;
    if (report.outlineSkipped) outlineSkipped += 1;
  }
  return { materials: count, mtoonMaterials, appliedFields, outlineSkipped };
}
