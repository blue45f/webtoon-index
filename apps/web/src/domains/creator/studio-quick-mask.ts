/**
 * Studio Quick Mask — 포토샵식 퀵 마스크(Q) 순수 코어.
 *
 * 개념: 픽셀 선택(PixelSelection — 폴리곤/브러시 서브패스 벡터 모델, studio-selection-tools.ts)을
 * 잠시 "칠할 수 있는 알파 래스터"(Uint8ClampedArray, 0=비선택 · 255=선택)로 전환해 브러시/지우개로
 * 자유롭게 다듬은 뒤, 마칠 때 다시 앱 네이티브 선택 형식으로 되돌린다 — Photoshop Quick Mask(Q)와
 * 동일한 워크플로. 진입=selectionToMask, 편집=applyMaskDab/applyMaskStrokeDabs/invertMask,
 * 종료=maskToSelection. 틴트 표시는 buildQuickMaskTintPixels(ImageData 픽셀)로 만든다.
 *
 * 재사용(기하 코드 중복 금지 원칙):
 *  - 래스터→선택 윤곽 추적은 마술봉 경로의 traceMaskContours/applyMagicWandRegionToSelection을
 *    그대로 쓴다(studio-magic-wand.ts — 마칭스퀘어류 경계 추적을 두 벌 만들지 않는다). 이 모듈이
 *    추가로 하는 일은 "분리된 연결 성분(4방향) 라벨링"뿐이다 — 마술봉은 클릭 지점 성분 1개만
 *    다루지만 퀵 마스크 종료 시점 마스크는 성분이 여러 개일 수 있다.
 *  - 선택→래스터는 pointInSelection 픽셀 중심 샘플링으로 만든다 — studio-selection-tools.ts의
 *    문서화된 불변식("pointInSelection이 래스터와 동일한 '마지막 덮는 서브패스' 규칙을 수식으로
 *    구현")을 그대로 이용하므로 캔버스(DOM) 없이도 rasterizeSelectionMask 경로와 의미가 일치한다.
 *  - 페더 blur: 프로젝트에 **공개된** 단일 채널 블러 유틸이 없어(studio-image-blur.ts의 boxBlurRgb는
 *    RGBA 스트라이드 전용, studio-blur.ts/studio-detail.ts의 단일 채널 boxBlur는 비공개) 소형
 *    분리형 박스블러를 여기에 둔다 — 3회 반복 박스블러 ≈ 가우시안, CSS blur(N px)(σ≈N/2)와
 *    반경 축을 맞춘다(featherQuickMaskAlpha 참고).
 *
 * 좌표 규약: 마스크 래스터는 **표시(디스플레이) 방향** 기준이다 — PixelSelection 서브패스가 이미
 * 표시 공간 정규화(0..1) 좌표라서, 퀵 마스크 세션(선택↔마스크 왕복 + 오버레이 표시)에는 원본 픽셀
 * 좌표계로의 되반전(flip)이 전혀 필요 없다. flipX/flipY 옵션은 원본 픽셀 공간 마스크가 필요한 다른
 * 호출자(예: PSD 마스크 경로와의 정합)를 위해서만 제공한다. featherScale은 buildSelectionMaskPlan과
 * 같은 축(표시 px→마스크 디바이스 px 환산 배율 = 마스크폭 ÷ 요소 표시폭)이다.
 *
 * 정직한 근사(문서화): PixelSelection의 페더는 전역 스칼라 1개뿐이므로, 경도 낮은 브러시로 부위마다
 * 다르게 만든 소프트 엣지는 종료 시 "평균 밴드폭 하나"(estimateQuickMaskFeatherDevicePx)로 근사된다.
 * 또한 이진화 문턱(기본 128) 미만 알파만 있는 초미세 얼룩은 선택으로 살아남지 못한다(마술봉의
 * MIN_SELECTION_SUBPATH_AREA 문턱과 동일 규약).
 *
 * DOM 의존성 0 · 전부 결정적(랜덤/Date 없음) — node 환경에서 그대로 유닛 테스트한다. 마스크 편집
 * 함수(applyMaskDab/applyMaskStrokeDabs)는 핫패스 규약대로 버퍼를 제자리(in-place)에서 수정하고
 * 더티 렉트를 돌려준다 — 프레임당 새 배열 할당 없음, React 상태 갱신은 호출부가 스트로크당 1회만.
 */
import {
  applyMagicWandRegionToSelection,
  flipMagicWandRegion,
  flipNormalizedPoint,
  MAGIC_WAND_MAX_LOOPS,
  MAGIC_WAND_TRACE_MAX_DIM,
  traceMaskContours,
  type MagicWandRegion,
} from "./studio-magic-wand";
import {
  isSelectionUsable,
  pointInSelection,
  SELECTION_FEATHER_RANGE,
  selectionBoundsNorm,
  type PixelSelection,
} from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// (A) 타입 · 상수 — 브러시 파라미터는 레이어 마스크(LAYER_MASK_BRUSH_*)와 동일 관례
//     (표시 px 기준 반경, 자연/디바이스 px 환산은 호출부 책임).
// ---------------------------------------------------------------------------

/** 퀵 마스크 브러시 모드 — paint=선택 추가(알파 상승), erase=선택 제거(알파 하강). */
export type QuickMaskBrushMode = "paint" | "erase";

export const QUICK_MASK_BRUSH_RADIUS_RANGE = { min: 6, max: 240, step: 1 } as const;
export const QUICK_MASK_BRUSH_RADIUS_DEFAULT = 48;
export const QUICK_MASK_BRUSH_HARDNESS_RANGE = { min: 0, max: 1, step: 0.05 } as const;
export const QUICK_MASK_BRUSH_HARDNESS_DEFAULT = 0.7;
export const QUICK_MASK_BRUSH_OPACITY_RANGE = { min: 0.05, max: 1, step: 0.05 } as const;
export const QUICK_MASK_BRUSH_OPACITY_DEFAULT = 1;

/** 틴트 기본값 — Photoshop Quick Mask 관례(빨강 50%, 비선택 영역을 덮는다). */
export const QUICK_MASK_TINT_COLOR_DEFAULT = "#ff0000";
export const QUICK_MASK_TINT_OPACITY_RANGE = { min: 0.1, max: 0.9, step: 0.05 } as const;
export const QUICK_MASK_TINT_OPACITY_DEFAULT = 0.5;
/** 패널 스와치 프리셋 — 빨간 그림 위에서도 보이도록 보색 계열 대안 포함. */
export const QUICK_MASK_TINT_PRESETS: { id: string; color: string; label: string }[] = [
  { id: "red", color: QUICK_MASK_TINT_COLOR_DEFAULT, label: "빨강" },
  { id: "green", color: "#22c55e", label: "초록" },
  { id: "blue", color: "#3b82f6", label: "파랑" },
];

/** 마스크→선택 이진화 문턱(알파 0..255) — 페더 밴드의 50% 지점이 원래 경계와 일치한다. */
export const QUICK_MASK_SELECTION_THRESHOLD = 128;
/** 퀵 마스크 래스터 해상도 상한(긴 변 px) — 마술봉 추적 상한과 동일 값(체감 일치). */
export const QUICK_MASK_MAX_DIM = MAGIC_WAND_TRACE_MAX_DIM;
/** 디바이스 px 환산 후 페더 상한 — rasterizeSelectionMask의 MAX_DEVICE_FEATHER_PX와 동일 관례. */
const QUICK_MASK_MAX_FEATHER_PX = 250;
/** 소프트 밴드 판정 범위(12.5%~87.5%) — 페더 폭 추정용. */
const SOFT_BAND_LOW = 32;
const SOFT_BAND_HIGH = 223;
/** 12.5–87.5% 밴드폭 ≈ 2.3σ ≈ 1.15×blur px(σ≈blur/2) — 추정치 역산 계수. */
const SOFT_BAND_PER_FEATHER_PX = 1.15;

/** 마스크 디바이스 px 좌표(픽셀 중심 관례 — 정수+0.5 권장이나 임의 실수 허용).
 * heal-clone/smudge 선례대로 다른 브러시 도구의 좌표 타입을 재사용하지 않고 독립 정의한다. */
export type QuickMaskDevicePoint = { x: number; y: number };

/** 브러시 도장(dab) 1개 — 좌표·반경은 마스크 디바이스 px. */
export type QuickMaskDab = {
  x: number;
  y: number;
  radius: number;
  /** 0..1 — 1=하드 원, 0=중심만 진한 최대 소프트(smoothstep 감쇠). */
  hardness: number;
  /** 0..1 — 도장 1회가 목표값(255 또는 0)으로 끌어당기는 비율. */
  opacity: number;
  mode: QuickMaskBrushMode;
};

/** 편집이 닿은 마스크 영역(포함 범위, 디바이스 px) — 호출부의 틴트 부분 갱신 최적화용. */
export type QuickMaskDirtyRect = { x0: number; y0: number; x1: number; y1: number };

// ---------------------------------------------------------------------------
// (B) 내부 수치 헬퍼
// ---------------------------------------------------------------------------

function clamp01(v: number, fallback = 0): number {
  if (!Number.isFinite(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function sanitizeDim(v: number): number | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.max(1, Math.round(v));
}

function sanitizeFeatherScale(v: number | undefined): number {
  return Number.isFinite(v) && v! > 0 ? v! : 1;
}

function unionDirtyRect(a: QuickMaskDirtyRect | null, b: QuickMaskDirtyRect | null): QuickMaskDirtyRect | null {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** #rgb / #rrggbb 파서 — 실패 시 null(호출부가 기본 빨강으로 폴백). 순수. */
function parseQuickMaskHexColor(input: string | undefined): { r: number; g: number; b: number } | null {
  if (typeof input !== "string") return null;
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(input);
  if (m3) {
    return {
      r: Number.parseInt(m3[1]! + m3[1]!, 16),
      g: Number.parseInt(m3[2]! + m3[2]!, 16),
      b: Number.parseInt(m3[3]! + m3[3]!, 16),
    };
  }
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(input);
  if (m6) {
    return {
      r: Number.parseInt(m6[1]!, 16),
      g: Number.parseInt(m6[2]!, 16),
      b: Number.parseInt(m6[3]!, 16),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// (C) 래스터 해상도 — 자연 해상도를 추적 상한(긴 변 640px)으로 다운스케일
// ---------------------------------------------------------------------------

/** 퀵 마스크 세션 래스터 크기 — 종횡비 유지, 긴 변을 maxDim으로 캡(마술봉 스캔과 동일 관례). */
export function quickMaskRasterSize(
  naturalW: number,
  naturalH: number,
  maxDim = QUICK_MASK_MAX_DIM
): { width: number; height: number } {
  const w = Number.isFinite(naturalW) && naturalW > 0 ? naturalW : 1;
  const h = Number.isFinite(naturalH) && naturalH > 0 ? naturalH : 1;
  const cap = Number.isFinite(maxDim) && maxDim > 0 ? maxDim : QUICK_MASK_MAX_DIM;
  const scale = Math.min(1, cap / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// ---------------------------------------------------------------------------
// (D) 페더 — 소형 분리형 박스블러(단일 채널, 3회 반복 ≈ 가우시안)
// ---------------------------------------------------------------------------

function boxBlurAlphaH(src: Float32Array, dst: Float32Array, width: number, height: number, r: number): void {
  const win = 2 * r + 1;
  const inv = 1 / win;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      const sx = k < 0 ? 0 : k >= width ? width - 1 : k;
      sum += src[row + sx]!;
    }
    dst[row] = sum * inv;
    for (let x = 1; x < width; x++) {
      const addX = x + r >= width ? width - 1 : x + r;
      const subX = x - r - 1 < 0 ? 0 : x - r - 1;
      sum += src[row + addX]! - src[row + subX]!;
      dst[row + x] = sum * inv;
    }
  }
}

function boxBlurAlphaV(src: Float32Array, dst: Float32Array, width: number, height: number, r: number): void {
  const win = 2 * r + 1;
  const inv = 1 / win;
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      const sy = k < 0 ? 0 : k >= height ? height - 1 : k;
      sum += src[sy * width + x]!;
    }
    dst[x] = sum * inv;
    for (let y = 1; y < height; y++) {
      const addY = y + r >= height ? height - 1 : y + r;
      const subY = y - r - 1 < 0 ? 0 : y - r - 1;
      sum += src[addY * width + x]! - src[subY * width + x]!;
      dst[y * width + x] = sum * inv;
    }
  }
}

/**
 * 마스크 알파를 제자리에서 페더링한다 — CSS blur(N px)와 σ 축을 맞춘 근사:
 * blur(N)=가우시안 σ≈N/2, 반복 박스블러(3회, 반경 r)는 σ²≈r(r+1)→σ≈r 이므로 r=round(N/2).
 * 표본 좌표는 가장자리 클램프(boxBlurRgb와 동일) — 반경보다 작은 이미지도 안전하다. 결정적.
 */
export function featherQuickMaskAlpha(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  featherPx: number
): void {
  const w = sanitizeDim(width);
  const h = sanitizeDim(height);
  if (!w || !h || mask.length !== w * h) return;
  const f = Number.isFinite(featherPx) ? Math.min(QUICK_MASK_MAX_FEATHER_PX, featherPx) : 0;
  if (f <= 0) return;
  const r = Math.max(1, Math.round(f / 2));
  const a = new Float32Array(mask.length);
  const b = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) a[i] = mask[i]!;
  for (let iter = 0; iter < 3; iter++) {
    boxBlurAlphaH(a, b, w, h, r);
    boxBlurAlphaV(b, a, w, h, r);
  }
  for (let i = 0; i < mask.length; i++) mask[i] = Math.round(a[i]!);
}

// ---------------------------------------------------------------------------
// (E) 선택 → 마스크 (퀵 마스크 진입)
// ---------------------------------------------------------------------------

/**
 * PixelSelection → 알파 마스크(Uint8ClampedArray, w*h, 0=비선택 · 255=선택).
 * 픽셀 중심(+0.5) 샘플링에 pointInSelection을 그대로 써서 캔버스 래스터 경로와 의미가 일치한다
 * (브러시 서브패스의 정원 판정은 aspect=h/w — 디바이스 px 기준 원). 페더는 표시 px 값을
 * featherScale로 디바이스 px 환산 후 featherQuickMaskAlpha로 근사한다.
 * 잘못된 크기는 길이 0 배열, 쓸 수 없는 선택은 전부 0 마스크를 반환한다(예외 없음).
 */
export function selectionToMask(
  sel: PixelSelection | null,
  width: number,
  height: number,
  opts?: { featherScale?: number; flipX?: boolean; flipY?: boolean }
): Uint8ClampedArray {
  const w = sanitizeDim(width);
  const h = sanitizeDim(height);
  if (!w || !h) return new Uint8ClampedArray(0);
  const mask = new Uint8ClampedArray(w * h);
  if (!isSelectionUsable(sel)) return mask;

  const aspect = h / w;
  const flipX = !!opts?.flipX;
  const flipY = !!opts?.flipY;

  // add 서브패스 bbox 밖은 항상 0(빼기는 영역을 넓히지 못한다) — 반전·flip 요청 시에는 전체 샘플.
  let x0 = 0;
  let y0 = 0;
  let x1 = w - 1;
  let y1 = h - 1;
  if (!sel!.invert && !flipX && !flipY) {
    const bounds = selectionBoundsNorm(sel);
    if (!bounds) return mask;
    x0 = Math.max(0, Math.floor(bounds.x * w) - 1);
    y0 = Math.max(0, Math.floor(bounds.y * h) - 1);
    x1 = Math.min(w - 1, Math.ceil((bounds.x + bounds.w) * w) + 1);
    y1 = Math.min(h - 1, Math.ceil((bounds.y + bounds.h) * h) + 1);
  }
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const p = flipNormalizedPoint({ x: (px + 0.5) / w, y: (py + 0.5) / h }, flipX, flipY);
      if (pointInSelection(sel, p, { aspect })) mask[py * w + px] = 255;
    }
  }

  const featherScale = sanitizeFeatherScale(opts?.featherScale);
  const featherDevicePx = Math.min(
    QUICK_MASK_MAX_FEATHER_PX,
    Math.max(0, Math.round((sel!.featherPx ?? 0) * featherScale))
  );
  if (featherDevicePx > 0) featherQuickMaskAlpha(mask, w, h, featherDevicePx);
  return mask;
}

// ---------------------------------------------------------------------------
// (F) 마스크 편집 — 결정적 소프트 브러시(제자리 수정 + 더티 렉트)
// ---------------------------------------------------------------------------

/**
 * 도장 1개를 마스크에 찍는다 — 반경 안 감쇠는 [0, hardness×반경]에서 1, 그 밖은 smoothstep으로
 * 0까지. paint는 a+(255-a)s(source-over 점근), erase는 a(1-s)(destination-out 점근) —
 * studio-layer-mask.ts의 reveal/conceal 합성 의미와 동일해 "덧칠할수록 진해지는" 감쇠를 공식
 * 자체에서 얻는다. 범위 밖·퇴화 입력은 조용히 null(버퍼 불변). 반환은 실제로 값이 바뀐 경우의
 * 클립된 더티 렉트. Uint8ClampedArray 대입이 클램프+반올림을 보장하므로 결정적이다.
 */
export function applyMaskDab(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  dab: QuickMaskDab
): QuickMaskDirtyRect | null {
  const w = sanitizeDim(width);
  const h = sanitizeDim(height);
  if (!w || !h || mask.length !== w * h) return null;
  const radius = Number.isFinite(dab.radius) ? dab.radius : 0;
  const opacity = clamp01(dab.opacity);
  const hardness = clamp01(dab.hardness, 1);
  if (!Number.isFinite(dab.x) || !Number.isFinite(dab.y) || radius <= 0 || opacity <= 0) return null;

  const x0 = Math.max(0, Math.floor(dab.x - radius));
  const y0 = Math.max(0, Math.floor(dab.y - radius));
  const x1 = Math.min(w - 1, Math.ceil(dab.x + radius));
  const y1 = Math.min(h - 1, Math.ceil(dab.y + radius));
  if (x0 > x1 || y0 > y1) return null;

  const inner = radius * hardness;
  const fall = Math.max(radius - inner, 1e-6);
  let changed = false;
  for (let py = y0; py <= y1; py++) {
    const cy = py + 0.5 - dab.y;
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5 - dab.x;
      const d = Math.hypot(cx, cy);
      if (d >= radius) continue;
      let t = 1;
      if (d > inner) {
        const u = (radius - d) / fall;
        t = u * u * (3 - 2 * u);
      }
      const s = opacity * t;
      if (s <= 0) continue;
      const idx = py * w + px;
      const a = mask[idx]!;
      mask[idx] = dab.mode === "paint" ? a + (255 - a) * s : a * (1 - s);
      if (mask[idx] !== a) changed = true;
    }
  }
  return changed ? { x0, y0, x1, y1 } : null;
}

/** 스트로크 굽기 옵션 — spacingPx 미지정 시 반경의 35%(최소 1px) 간격으로 도장을 찍는다. */
export type QuickMaskStrokeOptions = {
  radius: number;
  hardness: number;
  opacity: number;
  mode: QuickMaskBrushMode;
  spacingPx?: number;
};

/**
 * 폴리라인 궤적을 따라 고정 간격으로 도장을 찍는다 — 포인터 이벤트 밀도가 아니라 기하 거리
 * 기준이라 손 속도와 무관하게 결정적이다(핫패스 계약의 "스탬프 브러시 결정성" 관례). 세그먼트를
 * 넘어가는 잔여 거리(carry)를 이어 붙여 간격이 궤적 전체에서 균일하다. 반환은 합쳐진 더티 렉트.
 */
export function applyMaskStrokeDabs(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  points: readonly QuickMaskDevicePoint[],
  opts: QuickMaskStrokeOptions
): QuickMaskDirtyRect | null {
  if (points.length === 0) return null;
  const radius = Number.isFinite(opts.radius) ? opts.radius : 0;
  if (radius <= 0) return null;
  const rawSpacing = opts.spacingPx;
  const spacing = Number.isFinite(rawSpacing) && rawSpacing! > 0 ? rawSpacing! : Math.max(1, radius * 0.35);
  const dabBase = { radius, hardness: opts.hardness, opacity: opts.opacity, mode: opts.mode } as const;

  let dirty: QuickMaskDirtyRect | null = null;
  const first = points[0]!;
  dirty = unionDirtyRect(dirty, applyMaskDab(mask, width, height, { ...dabBase, x: first.x, y: first.y }));
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(segLen) || segLen <= 0) continue;
    let dist = spacing - carry;
    while (dist <= segLen) {
      const t = dist / segLen;
      dirty = unionDirtyRect(
        dirty,
        applyMaskDab(mask, width, height, {
          ...dabBase,
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        })
      );
      dist += spacing;
    }
    carry = segLen - (dist - spacing);
  }
  return dirty;
}

/** 마스크 반전 — 새 버퍼(255-α). 세션 "반전" 버튼용(핫패스 아님이라 불변 스타일). */
export function invertMask(mask: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = 255 - mask[i]!;
  return out;
}

// ---------------------------------------------------------------------------
// (G) 마스크 → 선택 (퀵 마스크 종료)
// ---------------------------------------------------------------------------

/**
 * 소프트 밴드폭으로 페더(디바이스 px)를 추정한다 — 직선 엣지에서 소프트 픽셀 수 ≈ 밴드폭 × 엣지
 * 길이, 이진 경계 인접쌍 수 ≈ 엣지 길이이므로 비율이 곧 밴드폭이고, 이를 blur px로 역산한다
 * (SOFT_BAND_PER_FEATHER_PX). 하드 마스크(소프트 픽셀 0) 또는 경계 없음이면 0. 결정적.
 */
export function estimateQuickMaskFeatherDevicePx(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = QUICK_MASK_SELECTION_THRESHOLD
): number {
  const w = sanitizeDim(width);
  const h = sanitizeDim(height);
  if (!w || !h || mask.length !== w * h) return 0;
  let soft = 0;
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i]!;
    if (a >= SOFT_BAND_LOW && a <= SOFT_BAND_HIGH) soft++;
  }
  if (soft === 0) return 0;
  let edges = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const fg = mask[row + x]! >= threshold;
      if (x + 1 < w && fg !== (mask[row + x + 1]! >= threshold)) edges++;
      if (y + 1 < h && fg !== (mask[row + w + x]! >= threshold)) edges++;
    }
  }
  if (edges === 0) return 0;
  return Math.max(0, soft / edges / SOFT_BAND_PER_FEATHER_PX);
}

export type QuickMaskToSelectionOptions = {
  /** 이진화 문턱(1..255, 기본 128). */
  threshold?: number;
  /** 표시 px→디바이스 px 환산 배율(selectionToMask와 동일 축) — featherPx 복원 시 나눠 준다. */
  featherScale?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** 유지할 최대 분리 영역 수(면적 상위) — 병적 마스크 폭주 방지. 기본 MAGIC_WAND_MAX_LOOPS. */
  maxRegions?: number;
};

export type TraceMaskRegionsOptions = {
  /** 이진화 문턱(1..255, 기본 128). */
  threshold?: number;
  /** 유지할 최대 분리 영역 수(면적 상위) — 병적 마스크 폭주 방지. 기본 MAGIC_WAND_MAX_LOOPS. */
  maxRegions?: number;
};

/**
 * 알파 마스크 → 분리 영역(외곽 1 + 구멍 n)의 배열. 이진화(≥threshold) 후 4방향 연결 성분을
 * 라벨링하고, 성분마다 마술봉과 동일한 traceMaskContours로 윤곽을 뽑는다 — 마술봉은 클릭 지점
 * 성분 1개만 다루지만 마스크 전체에는 성분이 여러 개일 수 있어서 이 라벨링 층이 필요하다.
 *
 * 반환 순서 계약(결정적, 두 호출자가 함께 의존한다):
 *  - 영역은 **시드 픽셀(성분의 첫 전경 픽셀)의 래스터 스캔 순서** 오름차순이다. 어떤 성분이 다른
 *    성분의 구멍 안에 들어 있으면 감싸는 쪽의 최상단 행이 항상 더 위이므로, 이 순서는 곧
 *    "감싸는 영역이 감싸이는 영역보다 먼저"를 보장한다 — 서브패스를 순서대로 add/subtract로
 *    접을 때(마지막 서브패스가 이긴다는 PixelSelection 규약) 섬이 구멍에 먹히지 않는다.
 *  - 성분 수가 maxRegions를 넘으면 면적 상위만 남기되(동률은 시드 오름차순) 반환 순서는 다시
 *    스캔 순서로 되돌린다.
 * 선택할 것이 없거나 크기가 안 맞으면 빈 배열.
 */
export function traceMaskRegions(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: TraceMaskRegionsOptions
): MagicWandRegion[] {
  const w = sanitizeDim(width);
  const h = sanitizeDim(height);
  if (!w || !h || mask.length !== w * h) return [];
  const rawThreshold = opts?.threshold;
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold! >= 1 && rawThreshold! <= 255
      ? Math.round(rawThreshold!)
      : QUICK_MASK_SELECTION_THRESHOLD;

  // 1) 연결 성분(4방향) 라벨링 — scanFloodRegionMask와 동일한 스택 순회(재귀 없음, 결정적 스캔 순서).
  //    (아래 2~3단계와 함께 traceMaskRegions 안에 있다 — maskToSelection과 레이어 알파→선택 경로가
  //     같은 구현을 나눠 쓴다.)
  const labels = new Int32Array(w * h);
  const seeds: number[] = [];
  const areas: number[] = [];
  const stack: number[] = [];
  for (let pos = 0; pos < labels.length; pos++) {
    if (mask[pos]! < threshold || labels[pos] !== 0) continue;
    const id = seeds.length + 1;
    seeds.push(pos);
    let area = 0;
    labels[pos] = id;
    stack.push(pos);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      area++;
      const px = cur % w;
      const py = (cur / w) | 0;
      if (px > 0 && labels[cur - 1] === 0 && mask[cur - 1]! >= threshold) {
        labels[cur - 1] = id;
        stack.push(cur - 1);
      }
      if (px < w - 1 && labels[cur + 1] === 0 && mask[cur + 1]! >= threshold) {
        labels[cur + 1] = id;
        stack.push(cur + 1);
      }
      if (py > 0 && labels[cur - w] === 0 && mask[cur - w]! >= threshold) {
        labels[cur - w] = id;
        stack.push(cur - w);
      }
      if (py < h - 1 && labels[cur + w] === 0 && mask[cur + w]! >= threshold) {
        labels[cur + w] = id;
        stack.push(cur + w);
      }
    }
    areas.push(area);
  }
  if (seeds.length === 0) return [];

  // 2) 영역 수 상한 — 면적 상위만 유지(타이브레이크는 시드 오름차순 = 스캔 순서, 결정적).
  //    최종 반환 순서는 스캔 순서를 유지한다(감싸는 영역 우선 규약 — 위 docstring 참고).
  const rawMax = opts?.maxRegions;
  const maxRegions =
    Number.isFinite(rawMax) && rawMax! >= 1 ? Math.round(rawMax!) : MAGIC_WAND_MAX_LOOPS;
  let keep: number[];
  if (seeds.length > maxRegions) {
    keep = seeds
      .map((_, i) => i + 1)
      .sort((a, b) => areas[b - 1]! - areas[a - 1]! || seeds[a - 1]! - seeds[b - 1]!)
      .slice(0, maxRegions)
      .sort((a, b) => seeds[a - 1]! - seeds[b - 1]!);
  } else {
    keep = seeds.map((_, i) => i + 1);
  }

  // 3) 성분별 윤곽 추적(마술봉과 동일 코드).
  const scratch = new Uint8Array(w * h);
  const regions: MagicWandRegion[] = [];
  for (const id of keep) {
    for (let i = 0; i < scratch.length; i++) scratch[i] = labels[i] === id ? 1 : 0;
    const seed = seeds[id - 1]!;
    const region = traceMaskContours(scratch, w, h, seed % w, (seed / w) | 0);
    if (region.outer.length >= 3) regions.push(region);
  }
  return regions;
}

/**
 * 알파 마스크 → PixelSelection. traceMaskRegions로 분리 영역을 뽑고 마술봉과 동일한
 * applyMagicWandRegionToSelection("add", 구멍은 subtract)으로 순서대로 접어 넣는다.
 * 소프트 엣지는 전역 featherPx 하나로 근사 복원한다(모듈 docstring의 정직한 근사).
 * 선택할 것이 없으면 null(빈 선택). 크기 불일치·퇴화 입력도 null.
 */
export function maskToSelection(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: QuickMaskToSelectionOptions
): PixelSelection | null {
  const w = sanitizeDim(width);
  const h = sanitizeDim(height);
  if (!w || !h || mask.length !== w * h) return null;
  const rawThreshold = opts?.threshold;
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold! >= 1 && rawThreshold! <= 255
      ? Math.round(rawThreshold!)
      : QUICK_MASK_SELECTION_THRESHOLD;

  const regions = traceMaskRegions(mask, w, h, { threshold, maxRegions: opts?.maxRegions });
  if (regions.length === 0) return null;

  const flipX = !!opts?.flipX;
  const flipY = !!opts?.flipY;
  let sel: PixelSelection | null = null;
  for (const region of regions) {
    sel = applyMagicWandRegionToSelection(sel, flipMagicWandRegion(region, flipX, flipY), "add");
  }
  if (!sel || !isSelectionUsable(sel)) return null;

  // 소프트 엣지 → 균일 페더(표시 px) 근사 복원.
  const featherScale = sanitizeFeatherScale(opts?.featherScale);
  const featherDevice = estimateQuickMaskFeatherDevicePx(mask, w, h, threshold);
  const featherPx = Math.min(
    SELECTION_FEATHER_RANGE.max,
    Math.max(SELECTION_FEATHER_RANGE.min, Math.round(featherDevice / featherScale))
  );
  return { ...sel, featherPx };
}

// ---------------------------------------------------------------------------
// (H) 틴트 표시 — ImageData 픽셀 생성 + 진행 중 스트로크 미리보기 색
// ---------------------------------------------------------------------------

export type QuickMaskTintOptions = {
  /** #rgb/#rrggbb — 파싱 실패 시 기본 빨강. */
  color?: string;
  /** 0..1 표시 불투명도(기본 0.5). */
  opacity?: number;
  /** true면 선택 영역을 칠한다(기본 false = Photoshop처럼 비선택(보호) 영역을 칠함). */
  tintSelected?: boolean;
};

/**
 * 마스크 → RGBA 틴트 픽셀(w*h*4, ImageData용). 알파 = (비)선택 커버리지 × 표시 불투명도.
 * 호출부는 이 버퍼를 오프스크린 캔버스에 putImageData 하고 Konva Image로 요소 크기에 맞춰
 * 늘려 그린다(StudioQuickMaskOverlay). 순수 — 캔버스 의존 없음.
 */
export function buildQuickMaskTintPixels(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: QuickMaskTintOptions
): Uint8ClampedArray {
  const w = sanitizeDim(width);
  const h = sanitizeDim(height);
  if (!w || !h || mask.length !== w * h) return new Uint8ClampedArray(0);
  const rgb =
    parseQuickMaskHexColor(opts?.color) ?? parseQuickMaskHexColor(QUICK_MASK_TINT_COLOR_DEFAULT)!;
  const opacity = clamp01(opts?.opacity ?? QUICK_MASK_TINT_OPACITY_DEFAULT, QUICK_MASK_TINT_OPACITY_DEFAULT);
  const tintSelected = !!opts?.tintSelected;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = mask[i]!;
    const coverage = tintSelected ? a : 255 - a;
    const o = i * 4;
    out[o] = rgb.r;
    out[o + 1] = rgb.g;
    out[o + 2] = rgb.b;
    out[o + 3] = coverage * opacity;
  }
  return out;
}

/**
 * 진행 중 스트로크 미리보기 색 — StudioLayerMaskOverlay의 STROKE_COLORS 관례(모드가 결과를
 * 암시하는 색). paint(선택 추가=틴트 걷힘)는 흰색 계열, erase(선택 제거=틴트 덮임)는 틴트색.
 */
export function quickMaskStrokePreviewColor(
  mode: QuickMaskBrushMode,
  tintColor: string,
  tintOpacity: number
): string {
  if (mode === "paint") return "rgba(255,255,255,0.55)";
  const rgb =
    parseQuickMaskHexColor(tintColor) ?? parseQuickMaskHexColor(QUICK_MASK_TINT_COLOR_DEFAULT)!;
  const raw = Number.isFinite(tintOpacity) ? tintOpacity : QUICK_MASK_TINT_OPACITY_DEFAULT;
  const alpha = Math.min(0.9, Math.max(0.15, raw));
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}
