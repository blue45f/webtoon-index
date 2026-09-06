/**
 * Studio Filter Mask — Krita/Photoshop 필터 마스크(비파괴 필터 체인의 부분 적용) 순수 코어.
 *
 * 개념: image 요소의 비파괴 필터 체인(밝기/커브/스마트 필터 등, studio-konva-filter-fields의
 * ImageFilterFields)이 만들어 낸 "필터 결과 픽셀"을, 요소-로컬 그레이스케일 마스크
 * (el.filterMaskSrc, PNG data URL)로 원본과 섞는다:
 *
 *   out = filtered × m + original × (1 − m)   (m = 마스크 커버리지 0..1)
 *
 * 흰색/불투명 = 필터 결과 그대로(m=1), 검정/투명 = 원본 그대로(m=0), 회색 = 선형 블렌드.
 * 마스크 자체는 el.src·필터 파라미터를 전혀 건드리지 않으므로 지우거나 다시 그려도 언제든
 * 전체 적용으로 돌아갈 수 있다(비파괴). el.maskSrc(레이어 마스크 — 가시성 알파를 자르는 축)와는
 * 독립된 축이다: 레이어 마스크는 "어디가 보이는가", 필터 마스크는 "어디에 보정이 걸리는가".
 *
 * 인코딩(중요 — studio-layer-mask.ts 와 동일 규약 + 관용 확장): 마스크 PNG 는 레이어 마스크와
 * 같은 "RGB 흰색 고정 + 알파 채널에 값" 인코딩을 표준으로 삼는다 — 그래야 마스크 페인팅 파이프
 * 라인(bakeLayerMaskStroke/createLayerMaskCanvas/invertLayerMaskAlpha)을 한 벌 그대로 재사용할
 * 수 있고, 썸네일도 검은 배경 위에 그대로 얹으면 된다(studio-layer-mask.ts 헤더 참고). 다만
 * 외부 유입 마스크(PSD 임포트 등)는 알파 255 에 값을 RGB 휘도로 담는 경우가 흔해, 커버리지는
 * m = luma × alpha / 255² 로 계산한다 — 흰색 고정 인코딩에서는 luma=255 라 m=alpha 그대로이고,
 * 휘도 인코딩에서는 alpha=255 라 m=luma 가 된다(SVG <mask> 가 luminance × alpha 를 곱연산하는
 * 것과 같은 규칙이라 두 관용을 모두 무손실로 수용한다). 휘도 계수는 Rec.709(0.2126/0.7152/
 * 0.0722) — 부동소수 곱합이지만 입력이 정수 픽셀이라 어느 런타임에서든 결정적이다.
 *
 * 좌표 규약: 마스크는 el.maskSrc 와 동일하게 요소-로컬, el.src 의 자연 해상도 기준으로 굽는다
 * (스트로크 좌표는 화면 반전이 걷힌 자연 픽셀 — bakeLayerMaskPaintStroke 관례 그대로). 반면
 * 블렌드 대상 버퍼는 표시 해상도(Worker 스냅샷 = el.width×height×density) 또는 Konva 캐시
 * 해상도(cachePad 포함 가능)라서, 샘플링은 "정규화 콘텐츠 좌표(0..1) + 양선형 보간 + 가장자리
 * 클램프"로 한다 — 해상도가 달라도 같은 룩이 나온다. 표시 버퍼는 반전(flipX/flipY)이 이미
 * 구워져 있으므로 샘플 시 마스크 쪽 u/v 를 뒤집고, Konva 테두리 캐시(cachePad)는 패딩 비율만큼
 * 콘텐츠 창을 되돌린 뒤 샘플한다(패딩 영역은 클램프 — 실루엣 밖으로 자란 테두리 픽셀은 가장
 * 가까운 마스크 가장자리 값을 따른다).
 *
 * studio-layer-mask.ts/studio-alpha-lock.ts 와 동일한 스타일: 전부 순수 함수, DOM/Konva/이미지
 * 로드 의존 0. 렌더 통합(디코드·캐시 키·커밋 경로)은 StudioKonvaImageNode.tsx 가 담당한다.
 */

import {
  isStudioFilterMaskSurfaceId,
  type StudioFilterMaskSurfaceId,
} from "@/shared/lib/studio-filter-mask-surface-contract";

// ---------------------------------------------------------------------------
// (A) 타입 · 술어(predicate) — studio-layer-mask.ts 의 can/has/shouldApply 3종 세트와 동일 관례.
// ---------------------------------------------------------------------------

/** StudioPage El의 최소 부분집합(이 모듈은 이 형태만 본다) — LayerMaskLike와 동일한 취지. */
export type FilterMaskLike = {
  type?: string;
  filterMaskSurfaceId?: StudioFilterMaskSurfaceId | string;
  filterMaskSrc?: string;
  filterMaskEnabled?: boolean;
};

/** 필터 마스크가 의미를 갖는 레이어인지 — 비파괴 필터 체인을 가질 수 있는 "image" 요소만. */
export function canFilterMask(el: FilterMaskLike): boolean {
  return el.type === "image";
}

/** 마스크 데이터가 있는지(켜짐/꺼짐과 무관 — "삭제"와 "비활성화"를 구분하기 위한 존재 술어). */
export function hasFilterMask(el: FilterMaskLike): boolean {
  return !!el.filterMaskSrc || isStudioFilterMaskSurfaceId(el.filterMaskSurfaceId);
}

/**
 * 유효 마스크 적용 여부 — image이고, inline 또는 immutable surface 마스크가 있고, enabled가
 * false가 아닐 때(undefined = 기본 켜짐). shouldApplyLayerMask와 동일한 3중 방어 패턴.
 * 미설정 문서는 항상 false → 기존 "필터 전체 적용" 동작이 바이트 단위로 동일하게 유지된다.
 */
export function shouldApplyFilterMask(el: FilterMaskLike): boolean {
  return canFilterMask(el) && hasFilterMask(el) && el.filterMaskEnabled !== false;
}

/**
 * 필터 결과 픽셀 캐시 키에 섞을 마스크 식별자 — shared surface는 불변 ID, legacy/local 마스크는
 * data URL 자체(내용이 곧 정체성 — el.src 를 키에 그대로 쓰는 기존 관례와 동일)를 사용한다.
 * 적용하지 않으면 빈 문자열이라 기존 키가 바뀌지 않는다.
 * imageFilterCacheKey(studio-konva-filter-fields.ts)는 이 모듈이 소유하지 않으므로, 마스크
 * 무효화가 필요한 캐시는 이 키를 별도로 함께 섞는다(StudioKonvaImageNode·ClipMaskGroup ck).
 */
export function filterMaskRenderKey(el: FilterMaskLike): string {
  if (!shouldApplyFilterMask(el)) return "";
  return isStudioFilterMaskSurfaceId(el.filterMaskSurfaceId)
    ? el.filterMaskSurfaceId
    : el.filterMaskSrc ?? "";
}

/** 마스크 초기 채움/브러시 방향 — studio-layer-mask.ts LayerMaskPaintMode와 구조 동일(호환).
 * 독립 정의 이유는 studio-layer-mask.ts 모듈 docstring의 타입 재사용 금지 선례와 동일하다. */
export type FilterMaskPaintMode = "reveal" | "conceal";

// ---------------------------------------------------------------------------
// (B) 브러시 파라미터 기본값·범위 — LAYER_MASK_BRUSH_* 와 동일 값/관례(표시 px 기준,
// 자연 px 환산은 호출부 책임). 마스크 페인팅 자체는 studio-layer-mask.ts 의 bake 계열을
// 그대로 재사용하므로 이 모듈은 UI 범위 상수만 소유한다.
// ---------------------------------------------------------------------------

export const FILTER_MASK_BRUSH_RADIUS_RANGE = { min: 6, max: 240, step: 1 } as const;
export const FILTER_MASK_BRUSH_RADIUS_DEFAULT = 48;
export const FILTER_MASK_BRUSH_HARDNESS_RANGE = { min: 0, max: 1, step: 0.05 } as const;
export const FILTER_MASK_BRUSH_HARDNESS_DEFAULT = 0.6;
export const FILTER_MASK_BRUSH_STRENGTH_RANGE = { min: 0.05, max: 1, step: 0.05 } as const;
export const FILTER_MASK_BRUSH_STRENGTH_DEFAULT = 1;

// ---------------------------------------------------------------------------
// (C) 커버리지 디코드 — RGBA → 단일 채널 0..255 맵(위 인코딩 규칙: m = luma×alpha/255).
// ---------------------------------------------------------------------------

export type FilterMaskCoverage = {
  readonly width: number;
  readonly height: number;
  /** 픽셀당 0..255 커버리지 — 255=필터 결과, 0=원본, 중간=선형 블렌드. */
  readonly data: Uint8ClampedArray;
};

/**
 * 디코드된 마스크 RGBA 픽셀에서 커버리지 맵을 만든다. 치수/버퍼 길이가 안 맞으면 null
 * (fail-closed — 호출부는 마스크 없이 기존 전체 적용으로 남는다). 순수·결정적.
 */
export function computeFilterMaskCoverage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): FilterMaskCoverage | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (rgba.length !== width * height * 4) return null;
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 1, p += 4) {
    // Rec.709 휘도 × 알파 — Uint8ClampedArray 대입이 반올림·클램프를 담당한다.
    const luma = 0.2126 * rgba[p]! + 0.7152 * rgba[p + 1]! + 0.0722 * rgba[p + 2]!;
    data[i] = (luma * rgba[p + 3]!) / 255;
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// (D) 샘플링 — 정규화 콘텐츠 좌표(0..1) 양선형 보간 + 가장자리 클램프.
// ---------------------------------------------------------------------------

/**
 * 커버리지 맵을 정규화 좌표(u,v ∈ 0..1)로 샘플한다 — 픽셀 중심 정렬 양선형 보간, 범위 밖은
 * 가장자리 클램프. 마스크 해상도 == 대상 해상도일 때 각 픽셀 중심 샘플은 원본 값을 그대로
 * 돌려준다(보간 손실 0). 반환은 0..255 부동소수(호출부가 /255 해 가중치로 쓴다). 순수.
 */
export function sampleFilterMaskCoverage(
  coverage: FilterMaskCoverage,
  u: number,
  v: number
): number {
  const { width, height, data } = coverage;
  const cu = Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 0;
  const cv = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  const x = cu * width - 0.5;
  const y = cv * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const cx0 = Math.min(width - 1, Math.max(0, x0));
  const cx1 = Math.min(width - 1, Math.max(0, x0 + 1));
  const cy0 = Math.min(height - 1, Math.max(0, y0));
  const cy1 = Math.min(height - 1, Math.max(0, y0 + 1));
  const top = data[cy0 * width + cx0]! * (1 - tx) + data[cy0 * width + cx1]! * tx;
  const bottom = data[cy1 * width + cx0]! * (1 - tx) + data[cy1 * width + cx1]! * tx;
  return top * (1 - ty) + bottom * ty;
}

/** 대상 버퍼 → 마스크 정규화 좌표 매핑 옵션(모두 선택 — 미지정은 항등 매핑). */
export type FilterMaskSampleTransform = {
  /** 대상 버퍼가 좌우 반전(el.flipped) 구운 표시 픽셀이면 true — 마스크 u를 거울 반전. */
  flipX?: boolean;
  /** 대상 버퍼가 상하 반전(el.flippedY) 구운 표시 픽셀이면 true — 마스크 v를 거울 반전. */
  flipY?: boolean;
  /** Konva cachePad 캔버스용 — 각 변에서 패딩이 차지하는 비율(cachePad/(el.width+2·cachePad)).
   * 0 이상 0.5 미만만 유효(그 외는 0 취급 — 콘텐츠 창이 뒤집히는 퇴화 방어). */
  padRatioX?: number;
  padRatioY?: number;
};

function clampPadRatio(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 0.5
    ? value
    : 0;
}

// ---------------------------------------------------------------------------
// (E) 블렌드 — out = filtered×m + original×(1−m) (RGBA 4채널 전부, 알파 포함 — 색상투명화
// 같은 알파 변형 필터도 마스크 밖에서는 원본 알파로 돌아가야 한다).
// ---------------------------------------------------------------------------

/**
 * target(필터 결과)을 제자리에서 원본 쪽으로 블렌드한다. original은 읽기만 한다(공유 스냅샷
 * 재사용 안전). 치수/버퍼 길이 불일치·퇴화 입력이면 아무것도 하지 않고 false(항등 fail-closed).
 * m=1 픽셀은 대입 자체를 건너뛰어(비트 동일 보장) 마스크가 전부 흰색이면 결과가 기존 필터
 * 출력과 완전히 같다. 순수·결정적.
 */
export function applyFilterMaskToPixels(input: {
  readonly target: Uint8ClampedArray;
  readonly original: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly coverage: FilterMaskCoverage;
  readonly transform?: FilterMaskSampleTransform;
}): boolean {
  const { target, original, width, height, coverage, transform } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return false;
  }
  const expected = width * height * 4;
  if (target.length !== expected || original.length !== expected) return false;
  const flipX = transform?.flipX === true;
  const flipY = transform?.flipY === true;
  const padX = clampPadRatio(transform?.padRatioX);
  const padY = clampPadRatio(transform?.padRatioY);
  const isDirect =
    !flipX
    && !flipY
    && padX === 0
    && padY === 0
    && coverage.width === width
    && coverage.height === height;

  if (isDirect) {
    const data = coverage.data;
    let p = 0;
    for (let i = 0; i < data.length; i += 1, p += 4) {
      const val = data[i]!;
      if (val === 255) continue;
      if (val === 0) {
        target[p] = original[p]!;
        target[p + 1] = original[p + 1]!;
        target[p + 2] = original[p + 2]!;
        target[p + 3] = original[p + 3]!;
      } else {
        const m = val / 255;
        const inv = 1 - m;
        target[p] = target[p]! * m + original[p]! * inv;
        target[p + 1] = target[p + 1]! * m + original[p + 1]! * inv;
        target[p + 2] = target[p + 2]! * m + original[p + 2]! * inv;
        target[p + 3] = target[p + 3]! * m + original[p + 3]! * inv;
      }
    }
    return true;
  }

  const spanX = 1 - 2 * padX;
  const spanY = 1 - 2 * padY;
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    let v = ((y + 0.5) / height - padY) / spanY;
    if (flipY) v = 1 - v;
    for (let x = 0; x < width; x += 1, p += 4) {
      let u = ((x + 0.5) / width - padX) / spanX;
      if (flipX) u = 1 - u;
      const m = sampleFilterMaskCoverage(coverage, u, v) / 255;
      if (m >= 1) continue; // 완전 커버 픽셀은 필터 결과 비트 그대로.
      const inv = 1 - m;
      target[p] = target[p]! * m + original[p]! * inv;
      target[p + 1] = target[p + 1]! * m + original[p + 1]! * inv;
      target[p + 2] = target[p + 2]! * m + original[p + 2]! * inv;
      target[p + 3] = target[p + 3]! * m + original[p + 3]! * inv;
    }
  }
  return true;
}

/**
 * 복사 버전 — filtered 사본에 블렌드를 적용해 돌려준다(입력 두 버퍼 모두 불변). 퇴화 입력이면
 * 블렌드 없는 filtered 사본(항등). Worker/GPU 커밋처럼 원본 결과 버퍼를 보존해야 하는 경로용.
 */
export function blendFilterMaskedPixels(input: {
  readonly filtered: Uint8ClampedArray;
  readonly original: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly coverage: FilterMaskCoverage;
  readonly transform?: FilterMaskSampleTransform;
}): Uint8ClampedArray {
  const out = new Uint8ClampedArray(input.filtered);
  applyFilterMaskToPixels({
    target: out,
    original: input.original,
    width: input.width,
    height: input.height,
    coverage: input.coverage,
    transform: input.transform,
  });
  return out;
}

// ---------------------------------------------------------------------------
// (F) Konva 폴백 경로 래핑 — Konva 내장 cache+filters 파이프라인은 같은 ImageData를 필터
// 배열 순서대로 제자리 변형한다. 원본은 첫 필터가 돌기 전의 그 버퍼뿐이므로, 맨 앞에 "원본
// 스냅샷" 필터를, 맨 뒤에 "마스크 블렌드" 필터를 끼워 넣으면 중간 체인을 전혀 몰라도 된다.
// 두 클로저는 스냅샷을 공유한다(한 draw 안에서 동기 순차 실행되는 Konva 계약에 의존).
// ---------------------------------------------------------------------------

/** Konva Filter가 받는 ImageData의 구조 부분집합(이 모듈은 Konva를 import하지 않는다). */
export type FilterMaskImageDataLike = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
};

export type FilterMaskKonvaFilterFn = (imageData: FilterMaskImageDataLike) => void;

/**
 * 필터 배열을 [스냅샷, ...원본 체인, 블렌드]로 감싼다. 빈 체인은 빈 배열 그대로(마스킹할
 * 필터 결과 자체가 없음 — 마스크는 가시성이 아니라 "보정 적용 범위"만 다룬다). 스냅샷과
 * 블렌드의 치수가 어긋나면(방어) 블렌드를 건너뛰어 기존 필터 결과를 그대로 둔다.
 */
export function wrapKonvaFiltersWithFilterMask(
  filters: readonly FilterMaskKonvaFilterFn[],
  coverage: FilterMaskCoverage,
  transform?: FilterMaskSampleTransform
): FilterMaskKonvaFilterFn[] {
  if (filters.length === 0) return [];
  let original: Uint8ClampedArray | null = null;
  let originalWidth = 0;
  let originalHeight = 0;
  const captureOriginal: FilterMaskKonvaFilterFn = (imageData) => {
    original = new Uint8ClampedArray(imageData.data);
    originalWidth = imageData.width;
    originalHeight = imageData.height;
  };
  const blendMasked: FilterMaskKonvaFilterFn = (imageData) => {
    if (
      !original
      || imageData.width !== originalWidth
      || imageData.height !== originalHeight
    ) {
      return;
    }
    applyFilterMaskToPixels({
      target: imageData.data,
      original,
      width: imageData.width,
      height: imageData.height,
      coverage,
      transform,
    });
  };
  return [captureOriginal, ...filters, blendMasked];
}
