/**
 * Studio Filter Pack — 상단 "필터" 메뉴 확장 카탈로그.
 *
 * 기존 5개 필터(가우시안/모션 블러·HSB·명도대비·커브)와 똑같은 등록 패턴을 따른다:
 * 다이얼로그 드래프트 → 비파괴 문서 필드 패치(Partial<ImageFilterFields>) 컴파일.
 * 대부분의 신규 필터는 이미 라이브인 픽셀 엔진 필드(blurFx/stylize/detail/grain/light/
 * pixelate/chromatic/inkThreshold/duotone/noise)에 매핑되어 즉시 미리보기·적용이 동작한다.
 *
 * 글리치/비네트는 기존 필드로 표현할 수 없어 이 모듈이 순수 픽셀 엔진
 * (applyGlitchFx/applyVignetteFx + normalize/isIdentity/Konva 래퍼)을 직접 제공한다 —
 * studio-grain.ts와 동일한 구조라 studio-konva-filters.ts 레지스트리에 그대로 부착된다.
 * 모든 엔진은 순수·결정적(랜덤은 전부 hash2 시드 해시), 가장자리 안전, 알파 보존이다.
 * Konva/DOM 의존 없음 — 다이얼로그와 단위 테스트가 공유한다.
 */

import {
  normalizeStudioFieldIrisBlurOptions,
  normalizeStudioLensBlurOptions,
  normalizeStudioSelectiveGaussianBlurOptions,
  normalizeStudioTiltShiftBlurOptions,
} from "../studio-advanced-blur-filters";
import { normalizeColorToAlpha } from "../studio-color-to-alpha";
import { hash2 } from "../studio-grain";
import { normalizeLineArtCleanup } from "../studio-line-cleanup";
import {
  normalizeStudioDifferenceOfGaussiansOptions,
  normalizeStudioDustScratchesOptions,
  normalizeStudioTileableBlurOptions,
} from "../studio-professional-filter-kernels";
import {
  normalizeStudioEdgeAwareDenoiseOptions,
  normalizeStudioJpegArtifactReductionOptions,
  normalizeStudioScreentoneRemovalOptions,
} from "../studio-tone-artifact-filter-kernels";

import {
  STUDIO_FILTER_PACK_KINDS,
  STUDIO_FILTER_PACK_LABELS,
  type StudioFilterPackKind,
} from "./studio-filter-pack-registry";
import {
  isIdentityStudioFilterUnionWave,
  normalizeStudioFilterUnionWave,
  type StudioFilterUnionWave,
  type StudioFilterUnionWaveKind,
} from "./studio-filter-union-wave";

import type { ImageFilterFields } from "../render/studio-konva-filter-fields";
import type { StudioImageDataLike } from "../studio-filters";

// ---------------------------------------------------------------------------
// 공통 유틸
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님(NaN/Infinity/비숫자)은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// clampTo 후 정수로 반올림(슬라이더 step 1 파라미터용).
function clampToInt(raw: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampTo(raw, min, max, fallback));
}

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

// 결정적 시드 허용 범위 — studio-grain과 동일한 0..9999.
const PACK_SEED_MIN = 0;
const PACK_SEED_MAX = 9999;

// ---------------------------------------------------------------------------
// 글리치 엔진 — 시드 기반 가로 조각(row-slice) 오프셋 + RGB 채널 분리.
// ---------------------------------------------------------------------------

export type StudioGlitchFx = {
  intensity: number; // 0..100 세기(0=항등) — 조각 최대 이동 거리(폭 대비 최대 25%)
  slices: number; // 1..24 가로 조각 수(높이를 이 개수로 등분)
  split: number; // 0..12 px RGB 채널 분리(r은 +, b는 - 방향)
  seed: number; // 0..9999 결정적 시드(같은 시드=같은 조각 배치)
};

/** 항등(효과 없음) — intensity 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_GLITCH_FX: StudioGlitchFx = { intensity: 0, slices: 8, split: 4, seed: 1337 };

export const GLITCH_INTENSITY_RANGE = { min: 0, max: 100, step: 1 } as const;
export const GLITCH_SLICES_RANGE = { min: 1, max: 24, step: 1 } as const;
export const GLITCH_SPLIT_RANGE = { min: 0, max: 12, step: 1 } as const;

/** 과거 저장본/외부 입력 안전장치 — 범위 클램프·정수화, 무효 값은 기본값. */
export function normalizeGlitchFx(g?: Partial<StudioGlitchFx> | null): StudioGlitchFx {
  const src = g && typeof g === "object" ? g : {};
  return {
    intensity: clampTo(
      src.intensity,
      GLITCH_INTENSITY_RANGE.min,
      GLITCH_INTENSITY_RANGE.max,
      DEFAULT_GLITCH_FX.intensity,
    ),
    slices: Math.floor(
      clampTo(src.slices, GLITCH_SLICES_RANGE.min, GLITCH_SLICES_RANGE.max, DEFAULT_GLITCH_FX.slices),
    ),
    split: Math.floor(
      clampTo(src.split, GLITCH_SPLIT_RANGE.min, GLITCH_SPLIT_RANGE.max, DEFAULT_GLITCH_FX.split),
    ),
    seed: Math.floor(clampTo(src.seed, PACK_SEED_MIN, PACK_SEED_MAX, DEFAULT_GLITCH_FX.seed)),
  };
}

/** intensity가 0 이하 — 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityGlitchFx(g: StudioGlitchFx): boolean {
  return g.intensity <= 0;
}

// 가로 좌표를 [0,width)로 래핑(글리치 조각은 화면 밖으로 나가면 반대편에서 이어진다).
function wrapX(x: number, width: number): number {
  const wrapped = x % width;
  return wrapped < 0 ? wrapped + width : wrapped;
}

/**
 * 글리치 제자리 적용 — 항등(intensity<=0)이면 no-op.
 *
 * 높이를 slices개 가로 조각으로 등분하고, 조각 s마다 결정적 해시로
 *   활성 여부  hash2(s,13,seed) >= 0.3 (약 70% 조각만 이동 — 전형적 글리치 리듬)
 *   이동 거리 (hash2(s,7,seed)-0.5)*2 * maxShift, maxShift = intensity/100 * width * 0.25
 * 를 뽑아 그 조각의 모든 행을 가로로 밀어낸다(래핑 샘플링 — 가장자리 안전).
 * split px만큼 r채널은 +방향, b채널은 -방향에서 추가로 읽어 RGB 분리를 만든다.
 * 알파는 g채널(기준 이동)과 함께 움직여 투명 영역도 조각과 함께 밀린다.
 * Math.random 없음 — 같은 입력=같은 출력(결정적).
 */
export function applyGlitchFx(img: StudioImageDataLike, g: StudioGlitchFx): void {
  if (isIdentityGlitchFx(g)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  const src = new Uint8ClampedArray(data); // 원본 스냅샷(이동 읽기용)
  const slices = Math.max(1, Math.min(GLITCH_SLICES_RANGE.max, Math.floor(g.slices)));
  const split = Math.max(0, Math.min(GLITCH_SPLIT_RANGE.max, Math.floor(g.split)));
  const maxShift = Math.round((g.intensity / 100) * width * 0.25);

  // 조각별 오프셋 미리 계산(조각 수 ≤ 24라 할당은 가볍다).
  const offsets = new Int32Array(slices);
  for (let s = 0; s < slices; s++) {
    const active = hash2(s, 13, g.seed) >= 0.3; // 일부 조각은 제자리(리듬)
    offsets[s] = active ? Math.round((hash2(s, 7, g.seed) - 0.5) * 2 * maxShift) : 0;
  }

  for (let y = 0; y < height; y++) {
    // 행 → 조각 인덱스(마지막 행도 slices-1 안쪽으로).
    const s = Math.min(slices - 1, Math.floor((y * slices) / height));
    const off = offsets[s]!;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const di = (row + x) * 4;
      const baseX = wrapX(x + off, width);
      const rX = wrapX(x + off + split, width);
      const bX = wrapX(x + off - split, width);
      const baseI = (row + baseX) * 4;
      data[di] = src[(row + rX) * 4]!;
      data[di + 1] = src[baseI + 1]!;
      data[di + 2] = src[(row + bX) * 4 + 2]!;
      data[di + 3] = src[baseI + 3]!; // 알파는 기준 이동과 함께(조각이 통째로 밀린다)
    }
  }
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 glitchIntensity/glitchSlices/glitchSplit/glitchSeed를
 * 읽어 normalizeGlitchFx로 안전 변환 후 applyGlitchFx. 항등이거나 attrs가 비면 no-op.
 */
export function glitchFxKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike,
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const fx = normalizeGlitchFx({
    intensity: attrNumber(attrs.glitchIntensity),
    slices: attrNumber(attrs.glitchSlices),
    split: attrNumber(attrs.glitchSplit),
    seed: attrNumber(attrs.glitchSeed),
  });
  if (isIdentityGlitchFx(fx)) return;
  applyGlitchFx(imageData, fx);
}

// ---------------------------------------------------------------------------
// 비네트 엔진 — 가장자리를 부드럽게 어둡게(어둡기/크기/둥글기/페더).
// ---------------------------------------------------------------------------

export type StudioVignetteFx = {
  darkness: number; // 0..100 가장자리 어둡기(0=항등)
  size: number; // 0..100 밝은 중앙 영역 크기(클수록 비네트가 가장자리로 밀린다)
  roundness: number; // 0..100 모양(100=타원, 0=사각형에 가깝게)
  feather: number; // 0..100 경계 부드러움(0=급격, 100=아주 완만)
};

/** 항등(효과 없음) — darkness 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_VIGNETTE_FX: StudioVignetteFx = {
  darkness: 0,
  size: 45,
  roundness: 100,
  feather: 60,
};

export const VIGNETTE_DARKNESS_RANGE = { min: 0, max: 100, step: 1 } as const;
export const VIGNETTE_SIZE_RANGE = { min: 0, max: 100, step: 1 } as const;
export const VIGNETTE_ROUNDNESS_RANGE = { min: 0, max: 100, step: 1 } as const;
export const VIGNETTE_FEATHER_RANGE = { min: 0, max: 100, step: 1 } as const;

/** 과거 저장본/외부 입력 안전장치 — 범위 클램프, 무효 값은 기본값. */
export function normalizeVignetteFx(v?: Partial<StudioVignetteFx> | null): StudioVignetteFx {
  const src = v && typeof v === "object" ? v : {};
  return {
    darkness: clampTo(src.darkness, 0, 100, DEFAULT_VIGNETTE_FX.darkness),
    size: clampTo(src.size, 0, 100, DEFAULT_VIGNETTE_FX.size),
    roundness: clampTo(src.roundness, 0, 100, DEFAULT_VIGNETTE_FX.roundness),
    feather: clampTo(src.feather, 0, 100, DEFAULT_VIGNETTE_FX.feather),
  };
}

/** darkness가 0 이하 — 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityVignetteFx(v: StudioVignetteFx): boolean {
  return v.darkness <= 0;
}

/**
 * 비네트 제자리 적용 — 항등(darkness<=0)이면 no-op.
 *
 * 픽셀 중심을 [-1,1] 정규 좌표(nx,ny)로 놓고 두 거리
 *   타원 거리 dE = sqrt(nx²+ny²), 사각 거리 dR = max(|nx|,|ny|)
 * 를 roundness로 보간해 d를 만든다(100=타원, 0=사각). d가
 *   inner = size/100*1.1 … outer = inner + 0.08 + feather/100*1.4
 * 구간을 smoothstep으로 지나며 r/g/b에 (1 - s*darkness/100)을 곱한다.
 * 알파는 건드리지 않는다(straight-alpha 버퍼에서 순수 감광). 단일 패스·할당 없음·결정적.
 */
export function applyVignetteFx(img: StudioImageDataLike, v: StudioVignetteFx): void {
  if (isIdentityVignetteFx(v)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  const halfW = width / 2;
  const halfH = height / 2;
  const round = clampTo(v.roundness, 0, 100, DEFAULT_VIGNETTE_FX.roundness) / 100;
  const dark = clampTo(v.darkness, 0, 100, 0) / 100;
  const inner = (clampTo(v.size, 0, 100, DEFAULT_VIGNETTE_FX.size) / 100) * 1.1;
  const outer = inner + 0.08 + (clampTo(v.feather, 0, 100, DEFAULT_VIGNETTE_FX.feather) / 100) * 1.4;
  const invSpan = 1 / (outer - inner); // outer는 항상 inner + 0.08 이상이라 0 나눗셈 없음

  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5 - halfH) / halfH;
    const ay = Math.abs(ny);
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - halfW) / halfW;
      const ax = Math.abs(nx);
      const dE = Math.sqrt(nx * nx + ny * ny);
      const dR = ax > ay ? ax : ay;
      const d = dR + (dE - dR) * round;
      let t = (d - inner) * invSpan;
      if (t <= 0) continue; // 밝은 중앙 — 원본 유지
      if (t > 1) t = 1;
      const s = t * t * (3 - 2 * t); // smoothstep
      const factor = 1 - s * dark;
      const i = (row + x) * 4;
      data[i] = data[i]! * factor;
      data[i + 1] = data[i + 1]! * factor;
      data[i + 2] = data[i + 2]! * factor;
    }
  }
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 vignetteDarkness/vignetteSize/vignetteRoundness/
 * vignetteFeather를 읽어 normalizeVignetteFx로 안전 변환 후 applyVignetteFx.
 */
export function vignetteFxKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike,
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const fx = normalizeVignetteFx({
    darkness: attrNumber(attrs.vignetteDarkness),
    size: attrNumber(attrs.vignetteSize),
    roundness: attrNumber(attrs.vignetteRoundness),
    feather: attrNumber(attrs.vignetteFeather),
  });
  if (isIdentityVignetteFx(fx)) return;
  applyVignetteFx(imageData, fx);
}

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// 필터 팩 카탈로그 — 다이얼로그가 데이터 기반으로 컨트롤을 그리는 파라미터 스키마.
// ---------------------------------------------------------------------------

// 종류 목록과 라벨은 엔진이 없는 레지스트리가 단일 소스다 — 상단 메뉴처럼 첫 청크에 있는
// 모듈이 "무슨 필터가 있는지"만 알기 위해 이 파일(픽셀 엔진 전체)을 끌어오지 않게 하려는
// 분리다. 아래 스키마(STUDIO_FILTER_PACK_DEFS)는 계속 여기서 살고, 계약 테스트가 두 라벨을
// 대조해 다이얼로그와 메뉴가 다른 이름을 보이는 상황을 막는다.
export { STUDIO_FILTER_PACK_KINDS, STUDIO_FILTER_PACK_LABELS };
export type { StudioFilterPackKind };

const PACK_KIND_SET: ReadonlySet<string> = new Set(STUDIO_FILTER_PACK_KINDS);

export function isStudioFilterPackKind(kind: string): kind is StudioFilterPackKind {
  return PACK_KIND_SET.has(kind);
}

/** 다이얼로그 드래프트의 값 가방 — 숫자 슬라이더 값 또는 헥스 색상 문자열. */
export type StudioFilterPackValues = Record<string, number | string>;

export type StudioFilterPackParam =
  | {
      key: string;
      label: string;
      control: "slider";
      min: number;
      max: number;
      step?: number;
      suffix?: string;
    }
  | { key: string; label: string; control: "color" };

/** 새 필터가 기존 엔진 필드 + 글리치/비네트 확장 필드로 내보내는 패치. */
export type StudioFilterPackPatch = Partial<ImageFilterFields> & {
  glitchFx?: StudioGlitchFx;
  vignetteFx?: StudioVignetteFx;
  filterUnionWave?: StudioFilterUnionWave;
};

export interface StudioFilterPackDef {
  kind: StudioFilterPackKind;
  label: string;
  params: readonly StudioFilterPackParam[];
  defaults: Readonly<StudioFilterPackValues>;
  /** 현재 이미지의 비파괴 필드를 다이얼로그 값으로 되읽기(다시 열기 패리티). 없으면 기본값. */
  fromImage?: (image: ImageFilterFields) => Partial<StudioFilterPackValues> | null;
  /** 정규화된 값 → 비파괴 문서 필드 패치. */
  toPatch: (values: StudioFilterPackValues) => StudioFilterPackPatch;
}

// 슬라이더 파라미터 헬퍼 — 정의를 짧게 유지.
function slider(
  key: string,
  label: string,
  min: number,
  max: number,
  suffix?: string,
  step = 1,
): StudioFilterPackParam {
  return suffix === undefined
    ? { key, label, control: "slider", min, max, step }
    : { key, label, control: "slider", min, max, step, suffix };
}

function unionWaveDef(
  kind: StudioFilterUnionWaveKind,
  label: string,
  params: readonly StudioFilterPackParam[],
  defaults: Readonly<StudioFilterPackValues>,
): StudioFilterPackDef {
  return {
    kind,
    label,
    params,
    defaults,
    fromImage: (image) => {
      const normalized = normalizeStudioFilterUnionWave(image.filterUnionWave);
      if (
        !normalized ||
        normalized.kind !== kind ||
        isIdentityStudioFilterUnionWave(normalized)
      ) {
        return null;
      }
      const values: StudioFilterPackValues = {};
      for (const param of params) {
        const value = normalized[param.key as keyof StudioFilterUnionWave];
        if (typeof value === "number") values[param.key] = value;
      }
      return values;
    },
    toPatch: (values) => {
      const numberValue = (key: string): number | undefined =>
        typeof values[key] === "number" ? values[key] : undefined;
      const normalized = normalizeStudioFilterUnionWave({
        kind,
        amount: numberValue("amount"),
        scale: numberValue("scale"),
        detail: numberValue("detail"),
        seed: numberValue("seed"),
        centerX: numberValue("centerX"),
        centerY: numberValue("centerY"),
        angle: numberValue("angle"),
      });
      return normalized ? { filterUnionWave: normalized } : {};
    },
  };
}

// stylize 필드 되읽기 — 지정 타입이고 strength>0일 때만 값 반환.
function stylizeFrom(
  image: ImageFilterFields,
  type: "emboss" | "solarize" | "oilPaint",
): { strength: number; detail: number } | null {
  const st = image.stylize;
  if (!st || st.type !== type) return null;
  if (typeof st.strength !== "number" || !Number.isFinite(st.strength) || st.strength <= 0) return null;
  const detail = typeof st.detail === "number" && Number.isFinite(st.detail) ? st.detail : 3;
  return { strength: st.strength, detail };
}

// blurFx 필드 되읽기 — 지정 타입이고 strength>0일 때만.
function blurFxFrom(
  image: ImageFilterFields,
  type: "spin" | "zoom",
): { strength: number; radius: number } | null {
  const bf = image.blurFx;
  if (!bf || bf.type !== type) return null;
  if (typeof bf.strength !== "number" || !Number.isFinite(bf.strength) || bf.strength <= 0) return null;
  const radius = typeof bf.radius === "number" && Number.isFinite(bf.radius) ? bf.radius : 12;
  return { strength: bf.strength, radius };
}

// 솔라라이즈 임계값 ↔ stylize.detail 변환(엔진: threshold = 128 - (detail-3)*10, 64..192 클램프).
const SOLARIZE_THRESHOLD_RANGE = { min: 68, max: 148, step: 10 } as const;
function solarizeDetailFromThreshold(threshold: number): number {
  return clampToInt(3 + (128 - threshold) / 10, 1, 10, 3);
}
function solarizeThresholdFromDetail(detail: number): number {
  return clampToInt(
    128 - (detail - 3) * 10,
    SOLARIZE_THRESHOLD_RANGE.min,
    SOLARIZE_THRESHOLD_RANGE.max,
    128,
  );
}

export const STUDIO_FILTER_PACK_DEFS: Readonly<
  Record<StudioFilterPackKind, StudioFilterPackDef>
> = {
  mosaic: {
    kind: "mosaic",
    label: "모자이크 / 픽셀화",
    params: [slider("cell", "셀 크기", 2, 40, "px")],
    defaults: { cell: 8 },
    fromImage: (image) =>
      typeof image.pixelate === "number" && Number.isFinite(image.pixelate) && image.pixelate >= 2
        ? { cell: image.pixelate }
        : null,
    toPatch: (values) => ({ pixelate: clampToInt(values.cell, 2, 40, 8) }),
  },
  "radial-blur": {
    kind: "radial-blur",
    label: "방사형 블러",
    params: [slider("strength", "세기", 1, 100, "%"), slider("angle", "회전 각도", 1, 40, "°")],
    defaults: { strength: 60, angle: 12 },
    fromImage: (image) => {
      const bf = blurFxFrom(image, "spin");
      return bf ? { strength: bf.strength, angle: bf.radius } : null;
    },
    toPatch: (values) => ({
      blurFx: {
        type: "spin",
        strength: clampToInt(values.strength, 1, 100, 60),
        radius: clampToInt(values.angle, 1, 40, 12),
        angle: 0,
      },
    }),
  },
  "zoom-blur": {
    kind: "zoom-blur",
    label: "줌 블러",
    params: [slider("strength", "세기", 1, 100, "%"), slider("amount", "줌 거리", 1, 40, "%")],
    defaults: { strength: 60, amount: 16 },
    fromImage: (image) => {
      const bf = blurFxFrom(image, "zoom");
      return bf ? { strength: bf.strength, amount: bf.radius } : null;
    },
    toPatch: (values) => ({
      blurFx: {
        type: "zoom",
        strength: clampToInt(values.strength, 1, 100, 60),
        radius: clampToInt(values.amount, 1, 40, 16),
        angle: 0,
      },
      }),
  },
  "lens-blur": {
    kind: "lens-blur",
    label: "렌즈 블러",
    params: [
      slider("radius", "반경", 0.25, 18, "px", 0.25),
      slider("sampleCount", "품질 샘플", 5, 64),
      slider("apertureBlades", "조리개 날", 3, 12),
      slider("apertureRotation", "조리개 회전", -180, 180, "°"),
    ],
    defaults: { radius: 4, sampleCount: 21, apertureBlades: 6, apertureRotation: 0 },
    fromImage: (image) => {
      if (!image.lensBlur) return null;
      const blur = normalizeStudioLensBlurOptions(image.lensBlur);
      return {
        radius: blur.radius,
        sampleCount: blur.sampleCount,
        apertureBlades: blur.apertureBlades,
        apertureRotation: blur.apertureRotationRadians * 180 / Math.PI,
      };
    },
    toPatch: (values) => ({
      lensBlur: normalizeStudioLensBlurOptions({
        radius: clampTo(values.radius, 0.25, 18, 4),
        sampleCount: clampToInt(values.sampleCount, 5, 64, 21),
        apertureBlades: clampToInt(values.apertureBlades, 3, 12, 6),
        apertureRotationRadians:
          clampTo(values.apertureRotation, -180, 180, 0) * Math.PI / 180,
      }),
    }),
  },
  "field-iris-blur": {
    kind: "field-iris-blur",
    label: "영역 초점 블러",
    params: [
      slider("focusCenterX", "초점 X", 0, 100, "%"),
      slider("focusCenterY", "초점 Y", 0, 100, "%"),
      slider("focusRadius", "초점 반경", 0, 141.4, "%", 0.1),
      slider("feather", "페더", 0.1, 141.4, "%", 0.1),
      slider("maximumBlurRadius", "최대 블러", 0.25, 18, "px", 0.25),
      slider("sampleCount", "품질 샘플", 5, 64),
      slider("apertureBlades", "조리개 날", 3, 12),
    ],
    defaults: {
      focusCenterX: 50,
      focusCenterY: 50,
      focusRadius: 16,
      feather: 24,
      maximumBlurRadius: 7,
      sampleCount: 21,
      apertureBlades: 8,
    },
    fromImage: (image) => {
      if (!image.fieldIrisBlur) return null;
      const blur = normalizeStudioFieldIrisBlurOptions(image.fieldIrisBlur);
      return {
        focusCenterX: blur.focusCenterX * 100,
        focusCenterY: blur.focusCenterY * 100,
        focusRadius: blur.focusRadius * 100,
        feather: blur.feather * 100,
        maximumBlurRadius: blur.maximumBlurRadius,
        sampleCount: blur.sampleCount,
        apertureBlades: blur.apertureBlades,
      };
    },
    toPatch: (values) => ({
      fieldIrisBlur: normalizeStudioFieldIrisBlurOptions({
        focusCenterX: clampTo(values.focusCenterX, 0, 100, 50) / 100,
        focusCenterY: clampTo(values.focusCenterY, 0, 100, 50) / 100,
        focusRadius: clampTo(values.focusRadius, 0, 141.4, 16) / 100,
        feather: clampTo(values.feather, 0.1, 141.4, 24) / 100,
        maximumBlurRadius: clampTo(values.maximumBlurRadius, 0.25, 18, 7),
        sampleCount: clampToInt(values.sampleCount, 5, 64, 21),
        apertureBlades: clampToInt(values.apertureBlades, 3, 12, 8),
      }),
    }),
  },
  "tilt-shift-blur": {
    kind: "tilt-shift-blur",
    label: "틸트 시프트 블러",
    params: [
      slider("axis", "초점 축", -180, 180, "°"),
      slider("focusWidth", "초점 폭", 0, 282.8, "%", 0.1),
      slider("feather", "페더", 0.1, 141.4, "%", 0.1),
      slider("maximumBlurRadius", "최대 블러", 0.25, 18, "px", 0.25),
      slider("sampleCount", "품질 샘플", 5, 64),
    ],
    defaults: {
      axis: 0,
      focusWidth: 20,
      feather: 22,
      maximumBlurRadius: 7,
      sampleCount: 19,
    },
    fromImage: (image) => {
      if (!image.tiltShiftBlur) return null;
      const blur = normalizeStudioTiltShiftBlurOptions(image.tiltShiftBlur);
      return {
        axis: blur.axisRadians * 180 / Math.PI,
        focusWidth: blur.focusWidth * 100,
        feather: blur.feather * 100,
        maximumBlurRadius: blur.maximumBlurRadius,
        sampleCount: blur.sampleCount,
      };
    },
    toPatch: (values) => ({
      tiltShiftBlur: normalizeStudioTiltShiftBlurOptions({
        axisRadians: clampTo(values.axis, -180, 180, 0) * Math.PI / 180,
        focusWidth: clampTo(values.focusWidth, 0, 282.8, 20) / 100,
        feather: clampTo(values.feather, 0.1, 141.4, 22) / 100,
        maximumBlurRadius: clampTo(values.maximumBlurRadius, 0.25, 18, 7),
        sampleCount: clampToInt(values.sampleCount, 5, 64, 19),
      }),
    }),
  },
  "selective-gaussian-blur": {
    kind: "selective-gaussian-blur",
    label: "선택적 가우시안 블러",
    params: [
      slider("radius", "반경", 1, 10, "px"),
      slider("spatialSigma", "공간 시그마", 0.1, 20, undefined, 0.1),
      slider("edgeThreshold", "경계 임계", 0, 255),
      slider("edgeSoftness", "경계 부드러움", 0, 2, undefined, 0.05),
    ],
    defaults: { radius: 3, spatialSigma: 2, edgeThreshold: 20, edgeSoftness: 0.35 },
    fromImage: (image) => {
      if (!image.selectiveGaussianBlur) return null;
      const blur = normalizeStudioSelectiveGaussianBlurOptions(image.selectiveGaussianBlur);
      return {
        radius: blur.radius,
        spatialSigma: blur.spatialSigma,
        edgeThreshold: blur.edgeThreshold,
        edgeSoftness: blur.edgeSoftness,
      };
    },
    toPatch: (values) => ({
      selectiveGaussianBlur: normalizeStudioSelectiveGaussianBlurOptions({
        radius: clampToInt(values.radius, 1, 10, 3),
        spatialSigma: clampTo(values.spatialSigma, 0.1, 20, 2),
        edgeThreshold: clampTo(values.edgeThreshold, 0, 255, 20),
        edgeSoftness: clampTo(values.edgeSoftness, 0, 2, 0.35),
      }),
    }),
  },
  "tileable-blur": {
    kind: "tileable-blur",
    label: "이음매 없는 블러",
    params: [
      slider("radius", "랩 반경", 1, 20, "px"),
      slider("sigma", "가우시안 시그마", 0.1, 20, undefined, 0.1),
      slider("strength", "혼합 강도", 0, 100, "%"),
    ],
    defaults: { radius: 5, sigma: 2.2, strength: 100 },
    fromImage: (image) => {
      if (!image.tileableBlur) return null;
      const blur = normalizeStudioTileableBlurOptions(image.tileableBlur);
      return {
        radius: blur.radius,
        sigma: blur.sigma,
        strength: blur.strength * 100,
      };
    },
    toPatch: (values) => ({
      tileableBlur: normalizeStudioTileableBlurOptions({
        radius: clampToInt(values.radius, 1, 20, 5),
        sigma: clampTo(values.sigma, 0.1, 20, 2.2),
        strength: clampTo(values.strength, 0, 100, 100) / 100,
      }),
    }),
  },
  "chromatic-aberration": {
    kind: "chromatic-aberration",
    label: "색수차",
    params: [slider("offset", "오프셋", 1, 12, "px")],
    defaults: { offset: 4 },
    fromImage: (image) =>
      typeof image.chromatic === "number" && Number.isFinite(image.chromatic) && image.chromatic > 0
        ? { offset: image.chromatic }
        : null,
    toPatch: (values) => ({ chromatic: clampToInt(values.offset, 1, 12, 4) }),
  },
  glitch: {
    kind: "glitch",
    label: "글리치",
    params: [
      slider("intensity", "강도", 1, 100, "%"),
      slider("slices", "조각 수", GLITCH_SLICES_RANGE.min, GLITCH_SLICES_RANGE.max),
      slider("split", "색 분리", GLITCH_SPLIT_RANGE.min, GLITCH_SPLIT_RANGE.max, "px"),
      slider("seed", "시드", PACK_SEED_MIN, PACK_SEED_MAX),
    ],
    defaults: { intensity: 60, slices: 8, split: 4, seed: 1337 },
    fromImage: (image) => {
      const fx = (image as StudioFilterPackPatch).glitchFx;
      if (!fx) return null;
      const normalized = normalizeGlitchFx(fx);
      return isIdentityGlitchFx(normalized)
        ? null
        : {
            intensity: normalized.intensity,
            slices: normalized.slices,
            split: normalized.split,
            seed: normalized.seed,
          };
    },
    toPatch: (values) => ({
      glitchFx: normalizeGlitchFx({
        intensity: clampToInt(values.intensity, 1, 100, 60),
        slices: clampToInt(values.slices, GLITCH_SLICES_RANGE.min, GLITCH_SLICES_RANGE.max, 8),
        split: clampToInt(values.split, GLITCH_SPLIT_RANGE.min, GLITCH_SPLIT_RANGE.max, 4),
        seed: clampToInt(values.seed, PACK_SEED_MIN, PACK_SEED_MAX, 1337),
      }),
    }),
  },
  scanline: {
    kind: "scanline",
    label: "스캔라인 (CRT)",
    params: [slider("darkness", "어둡기", 1, 100, "%"), slider("spacing", "줄 간격", 1, 8, "px")],
    defaults: { darkness: 45, spacing: 2 },
    fromImage: (image) => {
      const gr = image.grain;
      if (!gr || gr.type !== "scanline") return null;
      if (typeof gr.amount !== "number" || !Number.isFinite(gr.amount) || gr.amount <= 0) return null;
      return {
        darkness: gr.amount,
        spacing: typeof gr.size === "number" && Number.isFinite(gr.size) ? gr.size : 2,
      };
    },
    toPatch: (values) => ({
      grain: {
        type: "scanline",
        amount: clampToInt(values.darkness, 1, 100, 45),
        size: clampToInt(values.spacing, 1, 8, 2),
        seed: 1,
      },
    }),
  },
  vignette: {
    kind: "vignette",
    label: "비네트",
    params: [
      slider("darkness", "어둡기", 1, 100, "%"),
      slider("size", "크기", VIGNETTE_SIZE_RANGE.min, VIGNETTE_SIZE_RANGE.max, "%"),
      slider("roundness", "둥글기", VIGNETTE_ROUNDNESS_RANGE.min, VIGNETTE_ROUNDNESS_RANGE.max, "%"),
      slider("feather", "페더", VIGNETTE_FEATHER_RANGE.min, VIGNETTE_FEATHER_RANGE.max, "%"),
    ],
    defaults: { darkness: 55, size: 45, roundness: 100, feather: 60 },
    fromImage: (image) => {
      const fx = (image as StudioFilterPackPatch).vignetteFx;
      if (!fx) return null;
      const normalized = normalizeVignetteFx(fx);
      return isIdentityVignetteFx(normalized)
        ? null
        : {
            darkness: normalized.darkness,
            size: normalized.size,
            roundness: normalized.roundness,
            feather: normalized.feather,
          };
    },
    toPatch: (values) => ({
      vignetteFx: normalizeVignetteFx({
        darkness: clampToInt(values.darkness, 1, 100, 55),
        size: clampToInt(values.size, 0, 100, 45),
        roundness: clampToInt(values.roundness, 0, 100, 100),
        feather: clampToInt(values.feather, 0, 100, 60),
      }),
    }),
  },
  "lens-flare": {
    kind: "lens-flare",
    label: "렌즈 플레어",
    params: [
      slider("intensity", "밝기", 1, 100, "%"),
      slider("x", "중심 X", 0, 100, "%"),
      slider("y", "중심 Y", 0, 100, "%"),
      slider("hue", "빛 색상", 0, 360, "°"),
    ],
    defaults: { intensity: 60, x: 30, y: 30, hue: 45 },
    fromImage: (image) => {
      const lt = image.light;
      if (!lt || lt.type !== "lensFlare") return null;
      if (typeof lt.intensity !== "number" || !Number.isFinite(lt.intensity) || lt.intensity <= 0) {
        return null;
      }
      return { intensity: lt.intensity, x: lt.x, y: lt.y, hue: lt.hue };
    },
    toPatch: (values) => ({
      light: {
        type: "lensFlare",
        intensity: clampToInt(values.intensity, 1, 100, 60),
        x: clampToInt(values.x, 0, 100, 30),
        y: clampToInt(values.y, 0, 100, 30),
        hue: clampToInt(values.hue, 0, 360, 45),
      },
    }),
  },
  emboss: {
    kind: "emboss",
    label: "엠보스",
    params: [slider("depth", "깊이", 1, 10), slider("mix", "혼합", 1, 100, "%")],
    defaults: { depth: 3, mix: 100 },
    fromImage: (image) => {
      const st = stylizeFrom(image, "emboss");
      return st ? { depth: st.detail, mix: st.strength } : null;
    },
    toPatch: (values) => ({
      stylize: {
        type: "emboss",
        strength: clampToInt(values.mix, 1, 100, 100),
        detail: clampToInt(values.depth, 1, 10, 3),
      },
    }),
  },
  solarize: {
    kind: "solarize",
    label: "솔라라이즈",
    params: [
      slider(
        "threshold",
        "임계값",
        SOLARIZE_THRESHOLD_RANGE.min,
        SOLARIZE_THRESHOLD_RANGE.max,
        undefined,
        SOLARIZE_THRESHOLD_RANGE.step,
      ),
      slider("strength", "강도", 1, 100, "%"),
    ],
    defaults: { threshold: 128, strength: 100 },
    fromImage: (image) => {
      const st = stylizeFrom(image, "solarize");
      return st
        ? { threshold: solarizeThresholdFromDetail(st.detail), strength: st.strength }
        : null;
    },
    toPatch: (values) => ({
      stylize: {
        type: "solarize",
        strength: clampToInt(values.strength, 1, 100, 100),
        detail: solarizeDetailFromThreshold(
          clampToInt(values.threshold, SOLARIZE_THRESHOLD_RANGE.min, SOLARIZE_THRESHOLD_RANGE.max, 128),
        ),
      },
    }),
  },
  threshold: {
    kind: "threshold",
    label: "흑백 이진화",
    params: [slider("level", "레벨", 1, 255)],
    defaults: { level: 128 },
    fromImage: (image) =>
      typeof image.inkThreshold === "number" &&
      Number.isFinite(image.inkThreshold) &&
      image.inkThreshold > 0
        ? { level: clampToInt(image.inkThreshold * 255, 1, 255, 128) }
        : null,
    toPatch: (values) => ({ inkThreshold: clampToInt(values.level, 1, 255, 128) / 255 }),
  },
  "oil-paint": {
    kind: "oil-paint",
    label: "유화",
    params: [slider("radius", "붓 반경", 1, 5, "px"), slider("strength", "강도", 1, 100, "%")],
    defaults: { radius: 3, strength: 100 },
    fromImage: (image) => {
      const st = stylizeFrom(image, "oilPaint");
      return st ? { radius: Math.min(5, st.detail), strength: st.strength } : null;
    },
    toPatch: (values) => ({
      stylize: {
        type: "oilPaint",
        strength: clampToInt(values.strength, 1, 100, 100),
        detail: clampToInt(values.radius, 1, 5, 3),
      },
    }),
  },
  "surface-blur": {
    kind: "surface-blur",
    label: "표면 블러",
    params: [slider("radius", "반경", 1, 10, "px"), slider("strength", "강도", 1, 100, "%")],
    defaults: { radius: 3, strength: 70 },
    fromImage: (image) => {
      const dt = image.detail;
      if (!dt || dt.type !== "median") return null;
      if (typeof dt.amount !== "number" || !Number.isFinite(dt.amount) || dt.amount <= 0) return null;
      return {
        radius: typeof dt.radius === "number" && Number.isFinite(dt.radius) ? dt.radius : 3,
        strength: dt.amount,
      };
    },
    toPatch: (values) => ({
      detail: {
        type: "median",
        amount: clampToInt(values.strength, 1, 100, 70),
        radius: clampToInt(values.radius, 1, 10, 3),
      },
    }),
  },
  "line-cleanup": {
    kind: "line-cleanup",
    label: "스케치 선화 정리",
    params: [
      slider("threshold", "이진화 임계", 0, 100, "%"),
      slider("strength", "선명도", 0, 100, "%"),
    ],
    defaults: { threshold: 60, strength: 50 },
    fromImage: (image) => {
      if (!image.lineCleanup) return null;
      const cleanup = normalizeLineArtCleanup(image.lineCleanup);
      return {
        threshold: cleanup.threshold * 100,
        strength: cleanup.strength * 100,
      };
    },
    toPatch: (values) => ({
      lineCleanup: normalizeLineArtCleanup({
        threshold: clampTo(values.threshold, 0, 100, 60) / 100,
        strength: clampTo(values.strength, 0, 100, 50) / 100,
      }),
    }),
  },
  "screentone-removal": {
    kind: "screentone-removal",
    label: "스크린톤 제거",
    params: [
      slider("radius", "탐색 반경", 1, 3, "px"),
      slider("strength", "제거 강도", 0, 100, "%"),
      slider("inkLumaThreshold", "먹선 보호", 0, 160),
    ],
    defaults: { radius: 2, strength: 88, inkLumaThreshold: 72 },
    fromImage: (image) => {
      if (!image.screentoneRemoval) return null;
      const tone = normalizeStudioScreentoneRemovalOptions(image.screentoneRemoval);
      return {
        radius: tone.radius,
        strength: tone.strength * 100,
        inkLumaThreshold: tone.inkLumaThreshold,
      };
    },
    toPatch: (values) => ({
      screentoneRemoval: normalizeStudioScreentoneRemovalOptions({
        radius: clampToInt(values.radius, 1, 3, 2),
        strength: clampTo(values.strength, 0, 100, 88) / 100,
        inkLumaThreshold: clampTo(values.inkLumaThreshold, 0, 160, 72),
      }),
    }),
  },
  "jpeg-artifact-reduction": {
    kind: "jpeg-artifact-reduction",
    label: "JPEG 압축 깨짐 제거",
    params: [
      slider("deblockStrength", "블록 제거", 0, 100, "%"),
      slider("deringStrength", "링잉 제거", 0, 100, "%"),
      slider("boundaryThreshold", "블록 임계", 1, 64),
      slider("protectedEdgeThreshold", "경계 보호", 32, 224),
      slider("ringingThreshold", "링잉 임계", 1, 96),
      slider("inkLumaThreshold", "먹선 보호", 0, 160),
    ],
    defaults: {
      deblockStrength: 72,
      deringStrength: 45,
      boundaryThreshold: 6,
      protectedEdgeThreshold: 88,
      ringingThreshold: 18,
      inkLumaThreshold: 64,
    },
    fromImage: (image) => {
      if (!image.jpegArtifactReduction) return null;
      const jpeg = normalizeStudioJpegArtifactReductionOptions(image.jpegArtifactReduction);
      return {
        deblockStrength: jpeg.deblockStrength * 100,
        deringStrength: jpeg.deringStrength * 100,
        boundaryThreshold: jpeg.boundaryThreshold,
        protectedEdgeThreshold: jpeg.protectedEdgeThreshold,
        ringingThreshold: jpeg.ringingThreshold,
        inkLumaThreshold: jpeg.inkLumaThreshold,
      };
    },
    toPatch: (values) => ({
      jpegArtifactReduction: normalizeStudioJpegArtifactReductionOptions({
        deblockStrength: clampTo(values.deblockStrength, 0, 100, 72) / 100,
        deringStrength: clampTo(values.deringStrength, 0, 100, 45) / 100,
        boundaryThreshold: clampTo(values.boundaryThreshold, 1, 64, 6),
        protectedEdgeThreshold: clampTo(values.protectedEdgeThreshold, 32, 224, 88),
        ringingThreshold: clampTo(values.ringingThreshold, 1, 96, 18),
        inkLumaThreshold: clampTo(values.inkLumaThreshold, 0, 160, 64),
      }),
    }),
  },
  "edge-aware-denoise": {
    kind: "edge-aware-denoise",
    label: "윤곽 보존 노이즈 제거",
    params: [
      slider("radius", "탐색 반경", 1, 3, "px"),
      slider("strength", "노이즈 제거", 0, 100, "%"),
      slider("rangeThreshold", "색 경계 보호", 4, 192),
    ],
    defaults: { radius: 1, strength: 78, rangeThreshold: 72 },
    fromImage: (image) => {
      if (!image.edgeAwareDenoise) return null;
      const denoise = normalizeStudioEdgeAwareDenoiseOptions(image.edgeAwareDenoise);
      return {
        radius: denoise.radius,
        strength: denoise.strength * 100,
        rangeThreshold: denoise.rangeThreshold,
      };
    },
    toPatch: (values) => ({
      edgeAwareDenoise: normalizeStudioEdgeAwareDenoiseOptions({
        radius: clampToInt(values.radius, 1, 3, 1),
        strength: clampTo(values.strength, 0, 100, 78) / 100,
        rangeThreshold: clampTo(values.rangeThreshold, 4, 192, 72),
      }),
    }),
  },
  "dust-scratches": {
    kind: "dust-scratches",
    label: "먼지와 스크래치 제거",
    params: [
      slider("radius", "결함 탐색 반경", 1, 5, "px"),
      slider("threshold", "결함 임계값", 0, 255),
      slider("strength", "복원 강도", 0, 100, "%"),
    ],
    defaults: { radius: 2, threshold: 24, strength: 100 },
    fromImage: (image) => {
      if (!image.dustScratches) return null;
      const cleanup = normalizeStudioDustScratchesOptions(image.dustScratches);
      return {
        radius: cleanup.radius,
        threshold: cleanup.threshold,
        strength: cleanup.strength * 100,
      };
    },
    toPatch: (values) => ({
      dustScratches: normalizeStudioDustScratchesOptions({
        radius: clampToInt(values.radius, 1, 5, 2),
        threshold: clampTo(values.threshold, 0, 255, 24),
        strength: clampTo(values.strength, 0, 100, 100) / 100,
      }),
    }),
  },
  "difference-of-gaussians": {
    kind: "difference-of-gaussians",
    label: "가우시안 차분 선화",
    params: [
      slider("smallSigma", "미세 시그마", 0.25, 6, undefined, 0.25),
      slider("largeSigma", "대형 시그마", 0.35, 12, undefined, 0.05),
      slider("threshold", "경계 임계값", 0, 64, undefined, 0.5),
      slider("strength", "선 농도", 0, 32, undefined, 0.5),
    ],
    defaults: { smallSigma: 0.8, largeSigma: 2, threshold: 1.5, strength: 12 },
    fromImage: (image) => {
      if (!image.differenceOfGaussians) return null;
      const dog = normalizeStudioDifferenceOfGaussiansOptions(image.differenceOfGaussians);
      return {
        smallSigma: dog.smallSigma,
        largeSigma: dog.largeSigma,
        threshold: dog.threshold,
        strength: dog.strength,
      };
    },
    toPatch: (values) => ({
      differenceOfGaussians: normalizeStudioDifferenceOfGaussiansOptions({
        smallSigma: clampTo(values.smallSigma, 0.25, 6, 0.8),
        largeSigma: clampTo(values.largeSigma, 0.35, 12, 2),
        threshold: clampTo(values.threshold, 0, 64, 1.5),
        strength: clampTo(values.strength, 0, 32, 12),
      }),
    }),
  },
  "color-to-alpha": {
    kind: "color-to-alpha",
    label: "색상 투명화",
    params: [
      { key: "keyColor", label: "투명화할 배경색", control: "color" },
      slider("strength", "투명화 강도", 0, 100, "%"),
    ],
    defaults: { keyColor: "#ffffff", strength: 85 },
    fromImage: (image) => {
      if (!image.colorToAlpha) return null;
      const value = normalizeColorToAlpha(image.colorToAlpha);
      return { keyColor: value.keyColor, strength: value.strength };
    },
    toPatch: (values) => ({
      colorToAlpha: normalizeColorToAlpha({
        keyColor: isHexColor(values.keyColor) ? values.keyColor : "#ffffff",
        strength: clampTo(values.strength, 0, 100, 85),
      }),
    }),
  },
  duotone: {
    kind: "duotone",
    label: "세피아 / 듀오톤",
    params: [
      { key: "shadow", label: "어두운 영역 색", control: "color" },
      { key: "highlight", label: "밝은 영역 색", control: "color" },
    ],
    defaults: { shadow: "#2b1d0e", highlight: "#ffe9c9" },
    fromImage: (image) =>
      isHexColor(image.duotoneShadow) && isHexColor(image.duotoneHighlight)
        ? { shadow: image.duotoneShadow, highlight: image.duotoneHighlight }
        : null,
    toPatch: (values) => ({
      duotoneShadow: isHexColor(values.shadow) ? values.shadow : "#2b1d0e",
      duotoneHighlight: isHexColor(values.highlight) ? values.highlight : "#ffe9c9",
    }),
  },
  "noise-add": {
    kind: "noise-add",
    label: "노이즈 추가",
    params: [slider("amount", "강도", 1, 100, "%"), slider("seed", "시드", PACK_SEED_MIN, PACK_SEED_MAX)],
    defaults: { amount: 25, seed: 1337 },
    fromImage: (image) =>
      typeof image.noise === "number" && Number.isFinite(image.noise) && image.noise > 0
        ? {
            amount: image.noise,
            seed:
              typeof image.noiseSeed === "number" && Number.isFinite(image.noiseSeed)
                ? clampToInt(image.noiseSeed, PACK_SEED_MIN, PACK_SEED_MAX, 1337)
                : 1337,
          }
        : null,
    toPatch: (values) => ({
      noise: clampToInt(values.amount, 1, 100, 25),
      noiseSeed: clampToInt(values.seed, PACK_SEED_MIN, PACK_SEED_MAX, 1337),
    }),
  },
  "wave-warp": unionWaveDef(
    "wave-warp",
    "물결 왜곡",
    [
      slider("amount", "진폭", 1, 100, "%"),
      slider("scale", "파장", 4, 120, "px"),
      slider("angle", "위상", -180, 180, "°"),
    ],
    { amount: 42, scale: 28, angle: 0 },
  ),
  "ripple-warp": unionWaveDef(
    "ripple-warp",
    "동심원 물결",
    [
      slider("amount", "진폭", 1, 100, "%"),
      slider("scale", "파장", 4, 120, "px"),
      slider("centerX", "중심 X", 0, 100, "%"),
      slider("centerY", "중심 Y", 0, 100, "%"),
      slider("angle", "위상", -180, 180, "°"),
    ],
    { amount: 38, scale: 22, centerX: 50, centerY: 50, angle: 0 },
  ),
  fisheye: unionWaveDef(
    "fisheye",
    "어안 렌즈",
    [
      slider("amount", "곡률", -100, 100, "%"),
      slider("centerX", "중심 X", 0, 100, "%"),
      slider("centerY", "중심 Y", 0, 100, "%"),
    ],
    { amount: 52, centerX: 50, centerY: 50 },
  ),
  twirl: unionWaveDef(
    "twirl",
    "소용돌이",
    [
      slider("amount", "회전", -100, 100, "%"),
      slider("centerX", "중심 X", 0, 100, "%"),
      slider("centerY", "중심 Y", 0, 100, "%"),
    ],
    { amount: 46, centerX: 50, centerY: 50 },
  ),
  "pinch-bloat": unionWaveDef(
    "pinch-bloat",
    "오므리기 / 부풀리기",
    [
      slider("amount", "수축 / 팽창", -100, 100, "%"),
      slider("centerX", "중심 X", 0, 100, "%"),
      slider("centerY", "중심 Y", 0, 100, "%"),
    ],
    { amount: 44, centerX: 50, centerY: 50 },
  ),
  "lens-distortion": unionWaveDef(
    "lens-distortion",
    "렌즈 왜곡 보정",
    [
      slider("amount", "배럴 / 핀쿠션", -100, 100, "%"),
      slider("scale", "광학 배율", 50, 150, "%"),
      slider("centerX", "광학 중심 X", 0, 100, "%"),
      slider("centerY", "광학 중심 Y", 0, 100, "%"),
    ],
    { amount: 34, scale: 100, centerX: 50, centerY: 50 },
  ),
  "film-grain-pro": unionWaveDef(
    "film-grain-pro",
    "시네마 필름 그레인",
    [
      slider("amount", "입자 강도", 1, 100, "%"),
      slider("scale", "입자 크기", 1, 6, "px"),
      slider("seed", "시드", PACK_SEED_MIN, PACK_SEED_MAX),
    ],
    { amount: 34, scale: 1, seed: 1337 },
  ),
  "salt-pepper": unionWaveDef(
    "salt-pepper",
    "소금·후추 노이즈",
    [
      slider("amount", "밀도", 1, 100, "%"),
      slider("seed", "시드", PACK_SEED_MIN, PACK_SEED_MAX),
    ],
    { amount: 22, seed: 7331 },
  ),
  "rgb-noise": unionWaveDef(
    "rgb-noise",
    "RGB 채널 노이즈",
    [
      slider("amount", "채널 강도", 1, 100, "%"),
      slider("scale", "입자 크기", 1, 8, "px"),
      slider("seed", "시드", PACK_SEED_MIN, PACK_SEED_MAX),
    ],
    { amount: 30, scale: 1, seed: 2048 },
  ),
  "perlin-texture": unionWaveDef(
    "perlin-texture",
    "프랙탈 밸류 텍스처",
    [
      slider("amount", "혼합", 1, 100, "%"),
      slider("scale", "기본 스케일", 4, 120, "px"),
      slider("detail", "옥타브", 51, 255),
      slider("seed", "시드", PACK_SEED_MIN, PACK_SEED_MAX),
    ],
    { amount: 42, scale: 32, detail: 153, seed: 404 },
  ),
  pointillize: unionWaveDef(
    "pointillize",
    "점묘화",
    [
      slider("amount", "점 혼합", 1, 100, "%"),
      slider("scale", "점 간격", 3, 32, "px"),
      slider("seed", "배치 시드", PACK_SEED_MIN, PACK_SEED_MAX),
    ],
    { amount: 86, scale: 9, seed: 1886 },
  ),
  "stained-glass": unionWaveDef(
    "stained-glass",
    "스테인드글라스",
    [
      slider("amount", "색면 혼합", 1, 100, "%"),
      slider("scale", "조각 크기", 4, 40, "px"),
      slider("detail", "납선 두께", 0, 255),
      slider("seed", "분할 시드", PACK_SEED_MIN, PACK_SEED_MAX),
    ],
    { amount: 88, scale: 12, detail: 96, seed: 1440 },
  ),
  "poster-edges": unionWaveDef(
    "poster-edges",
    "포스터 엣지",
    [
      slider("amount", "효과 강도", 1, 100, "%"),
      slider("scale", "색상 단계", 2, 12),
      slider("detail", "경계 감도", 1, 255),
    ],
    { amount: 82, scale: 6, detail: 92 },
  ),
  photocopy: unionWaveDef(
    "photocopy",
    "복사기 효과",
    [
      slider("amount", "복사 강도", 1, 100, "%"),
      slider("scale", "국소 반경", 1, 5, "px"),
      slider("detail", "용지 임계값", 1, 254),
    ],
    { amount: 94, scale: 2, detail: 148 },
  ),
  "normal-map": unionWaveDef(
    "normal-map",
    "노멀 맵 변환",
    [
      slider("amount", "변환 강도", 1, 100, "%"),
      slider("scale", "샘플 반경", 1, 4, "px"),
      slider("detail", "표면 깊이", 1, 255),
    ],
    { amount: 100, scale: 1, detail: 110 },
  ),
  "god-rays": unionWaveDef(
    "god-rays",
    "빛줄기",
    [
      slider("amount", "광선 강도", 1, 100, "%"),
      slider("scale", "샘플 수", 2, 10),
      slider("detail", "발광 임계값", 0, 255),
      slider("centerX", "광원 X", 0, 100, "%"),
      slider("centerY", "광원 Y", 0, 100, "%"),
    ],
    { amount: 68, scale: 7, detail: 152, centerX: 28, centerY: 20 },
  ),
  "polar-coordinates": unionWaveDef(
    "polar-coordinates",
    "극좌표 변환",
    [
      slider("amount", "변환 강도", 0, 100, "%"),
      slider("centerX", "중심 X", 0, 100, "%"),
      slider("centerY", "중심 Y", 0, 100, "%"),
    ],
    { amount: 100, centerX: 50, centerY: 50 },
  ),
};

/** 상단 메뉴 등록 순서 카탈로그 — studio-main-menu-groups가 이 배열을 그대로 항목화한다. */
export const STUDIO_FILTER_PACK_MENU: readonly { kind: StudioFilterPackKind; label: string }[] =
  STUDIO_FILTER_PACK_KINDS.map((kind) => ({ kind, label: STUDIO_FILTER_PACK_DEFS[kind].label }));

// 파라미터 스키마에 맞춰 한 값을 정규화(숫자는 범위 클램프+step 반올림, 색상은 헥스 검증).
function normalizeParamValue(
  param: StudioFilterPackParam,
  raw: unknown,
  fallback: number | string,
): number | string {
  if (param.control === "color") {
    return isHexColor(raw) ? raw : (fallback as string);
  }
  const step = param.step ?? 1;
  const clamped = clampTo(raw, param.min, param.max, fallback as number);
  if (step <= 0) return clamped;
  // step 격자로 반올림 후 다시 클램프(148처럼 min+step*k가 max를 넘지 않게).
  const snapped = param.min + Math.round((clamped - param.min) / step) * step;
  // 0.1 같은 10진 step은 IEEE-754 연산에서 30.000000000000004처럼 보일 수 있다.
  // 다이얼로그 재열기·직렬화 값은 사람이 고른 격자값과 정확히 같도록 안정화한다.
  const stable = Math.round(snapped * 10_000_000_000) / 10_000_000_000;
  return Math.min(param.max, Math.max(param.min, stable));
}

/** 값 가방 전체를 스키마로 정규화 — 누락/무효 키는 기본값으로 채운다. */
export function normalizeStudioFilterPackValues(
  kind: StudioFilterPackKind,
  values?: StudioFilterPackValues | null,
): StudioFilterPackValues {
  const def = STUDIO_FILTER_PACK_DEFS[kind];
  const src = values && typeof values === "object" ? values : {};
  const out: StudioFilterPackValues = {};
  for (const param of def.params) {
    out[param.key] = normalizeParamValue(param, src[param.key], def.defaults[param.key]!);
  }
  return out;
}

/** 다이얼로그 초기값 — 현재 이미지 필드 되읽기(fromImage)가 있으면 그 값, 아니면 기본값. */
export function createStudioFilterPackValues(
  kind: StudioFilterPackKind,
  image: ImageFilterFields,
): StudioFilterPackValues {
  const def = STUDIO_FILTER_PACK_DEFS[kind];
  const merged: StudioFilterPackValues = { ...def.defaults };
  const current = def.fromImage?.(image) ?? null;
  if (current) {
    for (const [key, value] of Object.entries(current)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return normalizeStudioFilterPackValues(kind, merged);
}

/** 다이얼로그 값 → 비파괴 문서 필드 패치(항상 스키마 정규화를 거친다). */
export function studioFilterPackValuesToPatch(
  kind: StudioFilterPackKind,
  values: StudioFilterPackValues,
): StudioFilterPackPatch {
  return STUDIO_FILTER_PACK_DEFS[kind].toPatch(normalizeStudioFilterPackValues(kind, values));
}
