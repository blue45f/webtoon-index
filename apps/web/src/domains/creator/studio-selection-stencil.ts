/**
 * Studio Selection Stencil — "선택 = 그리기 스텐실" 순수 코어.
 *
 * 포토샵/CSP의 기본 규칙: **픽셀 선택이 살아 있는 동안 모든 칠하기는 선택 영역 안으로만 들어간다.**
 * 브러시·지우개·스탬프 dab이 선택 밖으로 나가면 그 부분은 아예 그려지지 않고, 페더 경계에서는
 * 선택 알파만큼만 옅게 얹힌다. 이 모듈은 그 규칙의 **기하/수치 부분만** 순수하게 담는다 —
 * 실제 합성(canvas2d dab 표면·WebGL/WebGPU 라이브 잉크·Konva 커밋 렌더)은 각 런타임이 하되,
 * "얼마나 칠할 수 있는가(coverage 0..1)"는 전부 이 모듈 한 곳에서 계산해 CPU/GPU 결과가 갈리지
 * 않게 한다.
 *
 * 왜 별도 모듈인가:
 *  - studio-selection-tools.ts의 마스크 경로(buildSelectionMaskPlan → rasterizeSelectionMask)는
 *    **캔버스(DOM) 팩토리 주입**이 필요하고 "원본 자연 해상도 1장"을 만든다 — 커밋 타임 편집
 *    (밝기/삭제/추출/변형)에 맞는 축이다. 스트로크 클리핑은 프레임마다 수십~수백 dab을 판정해야
 *    해서 DOM 없이 즉시 샘플 가능한 **작은 알파 필드 + 아핀 변환**이 필요하다.
 *  - 래스터화 자체는 studio-quick-mask.ts의 selectionToMask를 그대로 재사용한다(픽셀 중심
 *    pointInSelection 샘플링 + 박스블러 페더 + 반전). 같은 규약을 두 벌 만들지 않는다.
 *
 * 좌표 3계층(studio-selection-tools.ts의 규약을 그대로 승계):
 *   1. 문서 px       — Konva 스테이지 논리 좌표. dab/스트로크 점이 사는 공간.
 *   2. 정규화 u,v    — 이미지 요소의 비회전 로컬 박스 0..1. 선택 서브패스의 저장 공간이며
 *                      **표시(디스플레이) 방향** 기준이다(요소 flip은 이미 반영된 좌표 — 그래서
 *                      스텐실에는 flipX/flipY 되반전이 필요 없다. 퀵 마스크와 동일한 판단).
 *   3. 스텐실 텍셀   — u*width. 텍셀 i의 중심 = (i+0.5)/width (마스크 래스터와 같은 픽셀 중심 규약).
 *
 * 샘플링 규약(CPU/GPU 패리티의 핵심):
 *   - 필드 안(0≤u,v≤1)은 **bilinear + clamp-to-edge**. GPU의 linear/clamp 샘플러와 같은 식이라
 *     같은 텍스처를 올리면 셰이더 결과가 CPU 결과와 (부동소수 오차 범위에서) 일치한다.
 *   - 필드 밖은 보간하지 않고 `outsideAlpha`를 그대로 쓴다 — 정규화 박스가 선택의 우주이므로
 *     반전 선택이면 밖은 전부 선택됨(255), 아니면 전부 비선택(0)이 **정확한** 답이다.
 *
 * 정직한 근사(문서화):
 *   - 스텐실 해상도는 긴 변 SELECTION_STENCIL_MAX_DIM(기본 640, 마술봉/퀵 마스크와 같은 축)으로
 *     캡한다. 4000px 요소에서 텍셀 1개 ≈ 문서 6px이며 bilinear가 그 폭의 램프로 읽힌다 —
 *     하드 엣지 선택에서 경계가 최대 반 텍셀 부드러워진다. 필요하면 maxDim으로 올린다.
 *   - dab 판정은 스텐실 텍셀 격자를 직접 훑어(정확) min/max/평균을 낸다. 다만 텍셀 수가
 *     STENCIL_DAB_SCAN_BUDGET을 넘는 거대 dab은 결정적 stride 서브샘플링으로 떨어뜨린다.
 *
 * DOM 의존성 0 · 전부 결정적(랜덤/Date 없음) — node 환경에서 그대로 유닛 테스트한다.
 */
import { selectionToMask } from "./studio-quick-mask";
import {
  canvasPointToNormalized,
  isSelectionUsable,
  selectionBoundsNorm,
  type PixelSelection,
  type SelectionFrame,
  type SelPoint,
} from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// (A) 상수
// ---------------------------------------------------------------------------

/** 스텐실 알파 필드 긴 변 상한(텍셀) — MAGIC_WAND_TRACE_MAX_DIM/QUICK_MASK_MAX_DIM과 같은 값. */
export const SELECTION_STENCIL_MAX_DIM = 640;
/** 스텐실 알파 필드 긴 변 하한 — 지나치게 작은 필드는 경계가 뭉개져 클리핑이 의미를 잃는다. */
export const SELECTION_STENCIL_MIN_DIM = 8;
/** 0/1로 취급할 커버리지 여유 — 1/255(알파 1스텝)보다 살짝 크게 잡아 반올림 잡음을 흡수한다. */
export const SELECTION_STENCIL_EPSILON = 1.5 / 255;
/** 폴리라인 클리핑 기본 문턱 — 마스크→선택 이진화(128/255)와 같은 "절반" 규약. */
export const SELECTION_STENCIL_HIT_THRESHOLD = 0.5;
/** dab 1개 판정에 훑을 텍셀 수 상한 — 넘으면 결정적 stride로 서브샘플링한다. */
export const STENCIL_DAB_SCAN_BUDGET = 4096;
/** 폴리라인 경계 교차점 이분 탐색 반복 수 — 12회면 세그먼트 길이의 1/4096까지 좁힌다. */
export const STENCIL_CROSSING_REFINE_STEPS = 12;

// ---------------------------------------------------------------------------
// (B) 타입
// ---------------------------------------------------------------------------

/** 문서 px 축 정렬 사각형. */
export type StencilRect = { x: number; y: number; w: number; h: number };

/**
 * 그리기 스텐실 — "이 문서 좌표를 얼마나 칠할 수 있는가"를 답하는 불변 서술자.
 * **null 스텐실 = 클리핑 없음(어디든 칠할 수 있음)** 이다. "아무 데도 못 칠함"이 아니다 —
 * 런타임이 이 규약을 뒤집으면 선택이 없을 때 그림이 통째로 사라진다.
 */
export type SelectionStencil = {
  /** 알파 필드 크기(텍셀). */
  readonly width: number;
  readonly height: number;
  /** width*height, 255 = 완전히 칠할 수 있음, 0 = 완전히 막힘. */
  readonly alpha: Uint8ClampedArray;
  /** 정규화 박스를 문서 좌표에 놓는 요소 프레임(회전 포함). */
  readonly frame: SelectionFrame;
  /** 정규화 박스 밖의 커버리지(0..255) — 반전 선택이면 255, 아니면 0. */
  readonly outsideAlpha: number;
  /** 칠할 수 있는 영역의 문서 좌표 AABB(페더 여유 포함). null = 무한(반전 선택). */
  readonly boundsPx: StencilRect | null;
  /** 캐시 동일성 키 — 같은 키면 같은 스텐실을 재사용해도 된다(프레임마다 재빌드 금지). */
  readonly key: string;
};

/** dab 1개의 스텐실 통과 등급. */
export type StencilDabClass = "outside" | "partial" | "inside";

/** dab 1개의 스텐실 판정 결과 — 등급 + 평균/최소/최대 커버리지(0..1). */
export type StencilDabVerdict = {
  readonly kind: StencilDabClass;
  readonly coverage: number;
  readonly minCoverage: number;
  readonly maxCoverage: number;
};

/** dab 알파맵 배치 — 텍셀(0,0) 중심의 문서 좌표와 텍셀당 문서 px 간격. */
export type StencilAlphaMapLayout = {
  readonly originX: number;
  readonly originY: number;
  /** 기본 1 — 알파맵 1텍셀 = 문서 1px. */
  readonly stepX?: number;
  readonly stepY?: number;
};

/** 스텐실을 통과한 폴리라인 조각(문서 좌표) — 점 1개면 "선택 안에서의 탭". */
export type StencilPolylineSpan = {
  readonly points: SelPoint[];
  /** 원본 배열에서 이 조각이 시작/끝나는 세그먼트 인덱스(경계 보간점은 포함하지 않는 범위). */
  readonly startIndex: number;
  readonly endIndex: number;
};

/** GPU 유니폼용 문서→텍셀 아핀 — tx = a·x + b·y + e, ty = c·x + d·y + f. */
export type StencilTexelTransform = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
  readonly width: number;
  readonly height: number;
};

// ---------------------------------------------------------------------------
// (C) 내부 헬퍼
// ---------------------------------------------------------------------------

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 프레임의 유효 폭/높이(0·NaN 방어) — 좌표 변환이 발산하지 않게 한다. */
function frameSize(frame: SelectionFrame): { w: number; h: number } {
  const w = Number.isFinite(frame.width) && frame.width !== 0 ? Math.abs(frame.width) : 1;
  const h = Number.isFinite(frame.height) && frame.height !== 0 ? Math.abs(frame.height) : 1;
  return { w, h };
}

/** 32비트 롤링 해시(FNV-1a 변형) — 키 생성 전용, 암호학적 의미 없음. */
function hashNumber(seed: number, value: number): number {
  const v = Number.isFinite(value) ? Math.round(value * 4096) : 0;
  let h = (seed ^ v) >>> 0;
  h = Math.imul(h, 16777619) >>> 0;
  return h;
}

// ---------------------------------------------------------------------------
// (D) 스텐실 빌드
// ---------------------------------------------------------------------------

export type BuildSelectionStencilOptions = {
  /** 알파 필드 긴 변 상한(텍셀). 기본 SELECTION_STENCIL_MAX_DIM, [MIN_DIM, 2048]로 클램프. */
  maxDim?: number;
};

/**
 * 스텐실 캐시 키 — 선택 기하·페더·반전 + 프레임 배치 + 해상도에서 유도한다.
 * 같은 키면 알파 필드가 픽셀 단위로 같다(결정적). 점 좌표까지 해시에 넣으므로 서브패스를
 * 한 점만 옮겨도 키가 바뀐다. 프레임은 소수 4자리 수준으로 양자화해 미세 떨림에 반응하지 않는다.
 */
export function selectionStencilKey(
  sel: PixelSelection | null,
  frame: SelectionFrame,
  maxDim = SELECTION_STENCIL_MAX_DIM
): string {
  if (!isSelectionUsable(sel)) return "none";
  let h = 2166136261 >>> 0;
  h = hashNumber(h, sel!.featherPx);
  h = hashNumber(h, sel!.invert ? 1 : 0);
  h = hashNumber(h, sel!.subpaths.length);
  for (const sp of sel!.subpaths) {
    h = hashNumber(h, sp.mode === "add" ? 1 : sp.mode === "subtract" ? 2 : 3);
    h = hashNumber(h, sp.kind === "brush" ? sp.radius : -1);
    h = hashNumber(h, sp.points.length);
    for (const p of sp.points) {
      h = hashNumber(h, p.x);
      h = hashNumber(h, p.y);
    }
  }
  const fx = Math.round(finite(frame.x, 0) * 16) / 16;
  const fy = Math.round(finite(frame.y, 0) * 16) / 16;
  const fw = Math.round(finite(frame.width, 1) * 16) / 16;
  const fh = Math.round(finite(frame.height, 1) * 16) / 16;
  const rot = Math.round(finite(frame.rotation ?? 0, 0) * 16) / 16;
  return `${h.toString(36)}:${fx},${fy},${fw},${fh},${rot}:${Math.round(maxDim)}`;
}

/**
 * PixelSelection + 요소 프레임 → 그리기 스텐실.
 *
 * 반환 null = **클리핑 없음**(선택이 없거나 쓸 수 없음, 또는 프레임이 퇴화). 런타임은 null을
 * "제한 없이 그린다"로 해석해야 한다.
 *
 * 필드는 요소의 **표시 크기**(frame.width×height)를 종횡비 유지로 maxDim까지 캡한 해상도로
 * 만든다 — 클리핑이 일어나는 공간이 문서 px이라서 자연 해상도가 아니라 표시 해상도가 기준이다.
 * 페더는 selectionToMask의 featherScale 축(필드폭 ÷ 요소 표시폭)으로 넘긴다.
 */
export function buildSelectionStencil(
  sel: PixelSelection | null,
  frame: SelectionFrame,
  opts?: BuildSelectionStencilOptions
): SelectionStencil | null {
  if (!isSelectionUsable(sel)) return null;
  if (!Number.isFinite(frame.x) || !Number.isFinite(frame.y)) return null;
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height)) return null;
  if (frame.width === 0 || frame.height === 0) return null;

  const rawMax = opts?.maxDim;
  const maxDim = Math.round(
    Number.isFinite(rawMax) ? Math.min(2048, Math.max(SELECTION_STENCIL_MIN_DIM, rawMax!)) : SELECTION_STENCIL_MAX_DIM
  );
  const { w: frameW, h: frameH } = frameSize(frame);
  const scale = Math.min(1, maxDim / Math.max(frameW, frameH));
  const width = Math.max(SELECTION_STENCIL_MIN_DIM, Math.min(maxDim, Math.round(frameW * scale)));
  const height = Math.max(SELECTION_STENCIL_MIN_DIM, Math.min(maxDim, Math.round(frameH * scale)));

  // 표시 px → 필드 텍셀 환산 배율(buildSelectionMaskPlan/selectionToMask와 같은 축).
  const featherScale = width / frameW;
  const alpha = selectionToMask(sel, width, height, { featherScale });
  if (alpha.length !== width * height) return null;

  const outsideAlpha = sel!.invert ? 255 : 0;
  return {
    width,
    height,
    alpha,
    frame: {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      rotation: frame.rotation ?? 0,
    },
    outsideAlpha,
    boundsPx: stencilDocumentBounds(sel, frame),
    key: selectionStencilKey(sel, frame, maxDim),
  };
}

/**
 * 선택의 문서 좌표 AABB — 정규화 bbox 네 모서리를 프레임으로 되돌려 축 정렬 박스를 만들고
 * 페더(표시 px = 문서 px 축)만큼 부풀린다. 반전 선택은 요소 밖까지 선택되므로 null(무한).
 */
function stencilDocumentBounds(sel: PixelSelection | null, frame: SelectionFrame): StencilRect | null {
  if (!sel || sel.invert) return null;
  const bounds = selectionBoundsNorm(sel);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;
  const theta = ((frame.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const corners: SelPoint[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const lx = c.x * frame.width;
    const ly = c.y * frame.height;
    const x = frame.x + lx * cos - ly * sin;
    const y = frame.y + lx * sin + ly * cos;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  // 페더는 경계 바깥으로도 번지므로 반경만큼 여유를 준다(+1px 텍셀 반올림 여유).
  const pad = Math.max(0, finite(sel.featherPx, 0)) + 1;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

// ---------------------------------------------------------------------------
// (E) 샘플링
// ---------------------------------------------------------------------------

/** 텍셀 안전 읽기 — clamp-to-edge(GPU 샘플러 addressMode와 동일). */
function texelAt(stencil: SelectionStencil, tx: number, ty: number): number {
  const cx = tx < 0 ? 0 : tx >= stencil.width ? stencil.width - 1 : tx;
  const cy = ty < 0 ? 0 : ty >= stencil.height ? stencil.height - 1 : ty;
  return stencil.alpha[cy * stencil.width + cx]!;
}

/**
 * 정규화 좌표의 커버리지(0..1). 박스 안은 bilinear + clamp-to-edge, 박스 밖은 outsideAlpha.
 * 비유한 입력은 박스 밖으로 취급한다.
 */
export function stencilCoverageAtNorm(stencil: SelectionStencil, u: number, v: number): number {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return stencil.outsideAlpha / 255;
  if (u < 0 || u > 1 || v < 0 || v > 1) return stencil.outsideAlpha / 255;
  const fx = u * stencil.width - 0.5;
  const fy = v * stencil.height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const a00 = texelAt(stencil, x0, y0);
  const a10 = texelAt(stencil, x0 + 1, y0);
  const a01 = texelAt(stencil, x0, y0 + 1);
  const a11 = texelAt(stencil, x0 + 1, y0 + 1);
  const top = a00 + (a10 - a00) * tx;
  const bottom = a01 + (a11 - a01) * tx;
  return clamp01((top + (bottom - top) * ty) / 255);
}

/** 문서 좌표의 커버리지(0..1) — 요소 회전을 역변환해 정규화로 옮긴 뒤 샘플한다. */
export function stencilCoverageAt(stencil: SelectionStencil, x: number, y: number): number {
  const p = canvasPointToNormalized(x, y, stencil.frame);
  return stencilCoverageAtNorm(stencil, p.x, p.y);
}

/** GPU 유니폼용 문서→텍셀 아핀. 셰이더는 uv = (tx/width, ty/height)로 나눠 쓴다. */
export function stencilTexelTransform(stencil: SelectionStencil): StencilTexelTransform {
  const theta = ((stencil.frame.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const w = Number.isFinite(stencil.frame.width) && stencil.frame.width !== 0 ? stencil.frame.width : 1;
  const h = Number.isFinite(stencil.frame.height) && stencil.frame.height !== 0 ? stencil.frame.height : 1;
  const a = (cos * stencil.width) / w;
  const b = (sin * stencil.width) / w;
  const c = (-sin * stencil.height) / h;
  const d = (cos * stencil.height) / h;
  return {
    a,
    b,
    c,
    d,
    e: -(a * stencil.frame.x + b * stencil.frame.y),
    f: -(c * stencil.frame.x + d * stencil.frame.y),
    width: stencil.width,
    height: stencil.height,
  };
}

// ---------------------------------------------------------------------------
// (F) dab 판정 — 텍셀 격자 직접 훑기(정확) + 등급화
// ---------------------------------------------------------------------------

/** 문서 좌표 원(dab)이 AABB와 겹치는지 — 정확한 원/사각 교차 판정. */
function discIntersectsRect(x: number, y: number, radius: number, rect: StencilRect): boolean {
  const nx = x < rect.x ? rect.x : x > rect.x + rect.w ? rect.x + rect.w : x;
  const ny = y < rect.y ? rect.y : y > rect.y + rect.h ? rect.y + rect.h : y;
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * dab 1개의 스텐실 통과 판정 — dab 원이 덮는 스텐실 텍셀을 직접 훑어 min/max/평균을 낸다.
 *  - "outside": 원 안 어디에도 칠할 수 없음(런타임은 dab 자체를 건너뛴다).
 *  - "inside" : 원 전체가 완전 통과(마스킹 합성을 생략해도 결과가 같다 — 핫패스 최적화 근거).
 *  - "partial": 경계/페더에 걸침(런타임이 per-pixel로 스텐실 알파를 곱해야 한다).
 * 반환 coverage는 원 안 텍셀 평균(0..1) — per-pixel 마스킹이 불가능한 경로(예: Konva Line 한 획)
 * 에서 알파를 스칼라로 깎는 근사에 쓴다.
 */
export function classifyStencilDab(
  stencil: SelectionStencil,
  x: number,
  y: number,
  radius: number
): StencilDabVerdict {
  const outside = clamp01(stencil.outsideAlpha / 255);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0) {
    // 퇴화 dab은 중심 한 점으로 판정한다(반경 0 = 점).
    const c = Number.isFinite(x) && Number.isFinite(y) ? stencilCoverageAt(stencil, x, y) : outside;
    return verdictFrom(c, c, c);
  }
  if (stencil.boundsPx && !discIntersectsRect(x, y, radius, stencil.boundsPx)) {
    return { kind: "outside", coverage: 0, minCoverage: 0, maxCoverage: 0 };
  }

  const { w: frameW, h: frameH } = frameSize(stencil.frame);
  const center = canvasPointToNormalized(x, y, stencil.frame);
  // 회전은 거리를 보존하므로, 문서 반경 r은 정규화 공간에서 (r/frameW, r/frameH) 반축 타원이 된다.
  const ru = radius / frameW;
  const rv = radius / frameH;
  let i0 = Math.floor((center.x - ru) * stencil.width - 0.5);
  let i1 = Math.ceil((center.x + ru) * stencil.width - 0.5);
  let j0 = Math.floor((center.y - rv) * stencil.height - 0.5);
  let j1 = Math.ceil((center.y + rv) * stencil.height - 0.5);
  if (!Number.isFinite(i0) || !Number.isFinite(i1) || !Number.isFinite(j0) || !Number.isFinite(j1)) {
    const c = stencilCoverageAtNorm(stencil, center.x, center.y);
    return verdictFrom(c, c, c);
  }
  // 필드 밖 텍셀도 outsideAlpha로 통계에 넣되, 범위 자체는 유한하게 제한한다.
  i0 = Math.max(i0, -1);
  j0 = Math.max(j0, -1);
  i1 = Math.min(i1, stencil.width);
  j1 = Math.min(j1, stencil.height);

  const cols = i1 - i0 + 1;
  const rows = j1 - j0 + 1;
  const stride = Math.max(1, Math.ceil(Math.sqrt((cols * rows) / STENCIL_DAB_SCAN_BUDGET)));
  const rSq = radius * radius;
  let sum = 0;
  let count = 0;
  let min = 1;
  let max = 0;
  for (let j = j0; j <= j1; j += stride) {
    const v = (j + 0.5) / stencil.height;
    const dyDoc = (v - center.y) * frameH;
    for (let i = i0; i <= i1; i += stride) {
      const u = (i + 0.5) / stencil.width;
      const dxDoc = (u - center.x) * frameW;
      if (dxDoc * dxDoc + dyDoc * dyDoc > rSq) continue;
      const raw =
        i < 0 || i >= stencil.width || j < 0 || j >= stencil.height
          ? stencil.outsideAlpha
          : stencil.alpha[j * stencil.width + i]!;
      const c = raw / 255;
      sum += c;
      count += 1;
      if (c < min) min = c;
      if (c > max) max = c;
    }
  }
  if (count === 0) {
    // 반경이 텍셀보다 작아 격자에 안 걸린 경우 — 중심 한 점 샘플로 대체(결정적 폴백).
    const c = stencilCoverageAtNorm(stencil, center.x, center.y);
    return verdictFrom(c, c, c);
  }
  return verdictFrom(sum / count, min, max);
}

function verdictFrom(coverage: number, min: number, max: number): StencilDabVerdict {
  const c = clamp01(coverage);
  const lo = clamp01(min);
  const hi = clamp01(max);
  const kind: StencilDabClass =
    hi <= SELECTION_STENCIL_EPSILON ? "outside" : lo >= 1 - SELECTION_STENCIL_EPSILON ? "inside" : "partial";
  return { kind, coverage: kind === "outside" ? 0 : c, minCoverage: lo, maxCoverage: hi };
}

/** classifyStencilDab의 평균 커버리지만 필요한 호출부용 얇은 래퍼. */
export function stencilDabCoverage(
  stencil: SelectionStencil,
  x: number,
  y: number,
  radius: number
): number {
  return classifyStencilDab(stencil, x, y, radius).coverage;
}

// ---------------------------------------------------------------------------
// (G) dab 알파맵 per-pixel 마스킹 — "정확한" 클리핑 경로
// ---------------------------------------------------------------------------

/** applyStencilToDabAlphaMap 결과 — 얼마나 남았는지(업로드 생략 판단용). */
export type StencilAlphaMapResult = {
  /** 값이 실제로 바뀐 텍셀 수. */
  readonly changed: number;
  /** 마스킹 후 남은 최대 알파(0..255). 0이면 이 dab은 아무것도 그리지 않는다. */
  readonly maxAlpha: number;
};

/**
 * dab 알파맵(0..255)을 스텐실 커버리지로 **제자리** 곱한다 — 브러시 팁 알파맵
 * (studio-brush-tip-stamp의 buildStudioBrushTipAlphaMap 등)과 같은 표현을 그대로 받는다.
 * 페더 경계에서 부분 알파가 자연스럽게 남는 것이 이 경로의 존재 이유다(스칼라 근사와 다르다).
 * 핫패스 규약대로 새 배열을 만들지 않고 버퍼를 수정하며, 남은 최대 알파를 돌려준다.
 */
export function applyStencilToDabAlphaMap(
  alphaMap: Uint8ClampedArray,
  width: number,
  height: number,
  layout: StencilAlphaMapLayout,
  stencil: SelectionStencil
): StencilAlphaMapResult {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || alphaMap.length !== w * h) {
    return { changed: 0, maxAlpha: 0 };
  }
  const stepX = Number.isFinite(layout.stepX) && layout.stepX !== 0 ? layout.stepX! : 1;
  const stepY = Number.isFinite(layout.stepY) && layout.stepY !== 0 ? layout.stepY! : 1;
  const originX = finite(layout.originX, 0);
  const originY = finite(layout.originY, 0);
  let changed = 0;
  let maxAlpha = 0;
  for (let j = 0; j < h; j += 1) {
    const docY = originY + j * stepY;
    for (let i = 0; i < w; i += 1) {
      const idx = j * w + i;
      const before = alphaMap[idx]!;
      if (before === 0) continue;
      const coverage = stencilCoverageAt(stencil, originX + i * stepX, docY);
      const next = before * coverage;
      alphaMap[idx] = next;
      const after = alphaMap[idx]!;
      if (after !== before) changed += 1;
      if (after > maxAlpha) maxAlpha = after;
    }
  }
  return { changed, maxAlpha };
}

// ---------------------------------------------------------------------------
// (H) 폴리라인 클리핑 — 벡터(Konva Line) 경로용
// ---------------------------------------------------------------------------

export type ClipStrokePolylineOptions = {
  /** 안/밖 판정 문턱(0..1). 기본 SELECTION_STENCIL_HIT_THRESHOLD. */
  threshold?: number;
  /** 경계 교차점 이분 탐색 반복 수. 기본 STENCIL_CROSSING_REFINE_STEPS. */
  refineSteps?: number;
  /**
   * 세그먼트 내부 탐침 간격(문서 px). 기본 = 스텐실 텍셀 1개의 문서 px 크기 —
   * 스텐실이 표현할 수 있는 가장 가는 영역보다 촘촘하므로 놓치는 구간이 없다.
   */
  sampleStepPx?: number;
};

/** 세그먼트 1개를 쪼갤 최대 탐침 수 — 병적으로 긴 세그먼트에서도 비용이 유한하다. */
export const STENCIL_MAX_SEGMENT_SAMPLES = 1024;

/** 두 점 사이 선형 보간. */
function lerpPoint(a: SelPoint, b: SelPoint, t: number): SelPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * 세그먼트 [a,b] 위에서 커버리지가 문턱을 넘나드는 지점을 이분 탐색으로 찾는다.
 * 고정 반복 수라 결정적이며, 반환 t는 항상 (0,1) 열린 구간 안이다.
 */
function findCrossingT(
  stencil: SelectionStencil,
  a: SelPoint,
  b: SelPoint,
  insideAtA: boolean,
  threshold: number,
  steps: number
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < steps; i += 1) {
    const mid = (lo + hi) / 2;
    const p = lerpPoint(a, b, mid);
    const inside = stencilCoverageAt(stencil, p.x, p.y) >= threshold;
    if (inside === insideAtA) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 스텐실 텍셀 1개의 문서 px 크기(짧은 쪽) — 기본 탐침 간격. */
function defaultSampleStepPx(stencil: SelectionStencil): number {
  const { w, h } = frameSize(stencil.frame);
  return Math.max(0.25, Math.min(w / stencil.width, h / stencil.height));
}

/**
 * 스트로크 폴리라인(문서 좌표)을 스텐실로 잘라 "선택 안" 조각들만 남긴다.
 * per-pixel 마스킹이 불가능한 벡터 렌더(Konva Line 한 획 = 한 노드) 경로에서, 한 획을
 * 여러 획으로 쪼개 선택 밖 구간을 애초에 만들지 않기 위한 순수 기하다.
 *
 * 세그먼트는 **꼭짓점만 보지 않는다** — 긴 직선 하나가 선택을 관통해도 양 끝이 모두 밖이면
 * 꼭짓점 판정만으로는 통째로 버려진다. 그래서 세그먼트를 sampleStepPx(기본 = 스텐실 텍셀
 * 크기) 간격 탐침으로 훑고, 상태가 바뀐 탐침 구간 안에서만 이분 탐색으로 교차점을 좁힌다
 * (고정 반복 → 결정적). 페더가 있으면 문턱(기본 0.5)이 곧 경계라서 마스크→선택 이진화
 * (128/255)와 같은 자리에서 끊긴다.
 *
 * 반환 조각의 startIndex/endIndex는 그 조각이 품은 **원본 꼭짓점 인덱스 범위**다(교차 보간점은
 * 세지 않는다). 조각이 세그먼트 하나 안에서 시작하고 끝나면 startIndex > endIndex인 빈 범위가
 * 될 수 있다 — 필압 등 per-point 부수 데이터를 옮길 때 이 관례를 확인해야 한다.
 * 점이 1개뿐인 입력(탭)은 안이면 그 점 1개짜리 조각, 밖이면 빈 배열을 돌려준다.
 */
export function clipStrokePolylineToStencil(
  points: readonly SelPoint[],
  stencil: SelectionStencil,
  opts?: ClipStrokePolylineOptions
): StencilPolylineSpan[] {
  if (points.length === 0) return [];
  const threshold = clamp01(
    finite(opts?.threshold ?? SELECTION_STENCIL_HIT_THRESHOLD, SELECTION_STENCIL_HIT_THRESHOLD)
  );
  const rawSteps = opts?.refineSteps;
  const steps = Number.isFinite(rawSteps)
    ? Math.max(1, Math.min(24, Math.round(rawSteps!)))
    : STENCIL_CROSSING_REFINE_STEPS;
  const rawStep = opts?.sampleStepPx;
  const sampleStepPx =
    Number.isFinite(rawStep) && rawStep! > 0 ? rawStep! : defaultSampleStepPx(stencil);

  const spans: StencilPolylineSpan[] = [];
  let current: SelPoint[] | null = null;
  let spanStart = 0;
  let spanEnd = -1;
  const closeSpan = (endIndex: number): void => {
    if (current && current.length > 0) spans.push({ points: current, startIndex: spanStart, endIndex });
    current = null;
  };

  let inside = stencilCoverageAt(stencil, points[0]!.x, points[0]!.y) >= threshold;
  if (inside) {
    current = [points[0]!];
    spanStart = 0;
    spanEnd = 0;
  }
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const subdivisions = Number.isFinite(length)
      ? Math.max(1, Math.min(STENCIL_MAX_SEGMENT_SAMPLES, Math.ceil(length / sampleStepPx)))
      : 1;
    let prevT = 0;
    for (let s = 1; s <= subdivisions; s += 1) {
      const t = s / subdivisions;
      const probe = s === subdivisions ? b : lerpPoint(a, b, t);
      const probeInside = stencilCoverageAt(stencil, probe.x, probe.y) >= threshold;
      if (probeInside !== inside) {
        const from = lerpPoint(a, b, prevT);
        const local = findCrossingT(stencil, from, probe, inside, threshold, steps);
        const crossing = lerpPoint(a, b, prevT + (t - prevT) * local);
        if (inside) {
          current?.push(crossing);
          closeSpan(spanEnd);
        } else {
          current = [crossing];
          spanStart = i;
          spanEnd = i - 1;
        }
        inside = probeInside;
      }
      if (s === subdivisions && inside && current) {
        current.push(b);
        spanEnd = i;
      }
      prevT = t;
    }
  }
  closeSpan(spanEnd);
  return spans;
}
