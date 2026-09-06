/**
 * Studio Color Range — 포토샵 "선택 > 색상 범위(Select > Color Range)" 순수 코어.
 *
 * 마술봉(studio-magic-wand.ts)이 "클릭 지점과 이어진(연결된) 비슷한 색"을 선택한다면, 색상 범위는
 * 이미지 **전체**에서 샘플 색과 비슷한 픽셀을 연결 여부와 무관하게(비연속) 모두 선택한다.
 *
 * 파이프라인(마술봉과 동일한 계약을 그대로 따른다):
 *   1. buildColorRangeMask      — RGBA 버퍼 → 픽셀당 0..255 소프트 커버리지 마스크(순수).
 *   2. colorRangeMaskRegions    — 마스크를 4-연결 컴포넌트로 나누고, 컴포넌트마다 마술봉의
 *      traceMaskContours 로 윤곽 폴리곤(MagicWandRegion)을 추적한다(중복 구현 없음 — 재사용).
 *   3. applyColorRangeMaskToSelection — region 들을 applyMagicWandRegionToSelection 과 동일한
 *      규약으로 PixelSelection 에 결합한다(add/subtract 는 순차 결합, intersect 는 마스크 단계에서
 *      기존 선택으로 픽셀을 걸러낸 뒤 새 선택으로 대체 — intersectSelectionWithPolygon 의
 *      순차 교집합 함정을 피하는 정확한 의미론).
 *
 * 거리 척도: **redmean** 가중 RGB 거리(√((2+r̄/256)Δr² + 4Δg² + (2+(255-r̄)/256)Δb²)).
 *   순수 유클리드 RGB 는 사람 눈의 채널별 민감도(초록 > 빨강 > 파랑)를 무시해 비슷해 "보이는"
 *   색을 놓치거나 다른 색을 과도하게 잡는다. CIELAB ΔE 는 더 정확하지만 색공간 변환(감마 해제 +
 *   행렬 + 세제곱근)이 픽셀마다 필요해 이 스캔 루프에는 과하다. redmean 은 변환 없이 지각 근사를
 *   얻는 표준 절충안이라 채택했다. √(9)=3 으로 나눠 흑↔백 최대 거리가 255 가 되도록 정규화해
 *   fuzziness 슬라이더(0..200)와 같은 "채널 스케일" 단위로 맞춘다.
 *
 * 소프트 엣지(포토샵 fuzziness 의미론): 거리 d ≤ fuzziness/2 → 완전 선택(255),
 *   d ≥ fuzziness → 미선택(0), 그 사이는 선형 감쇠. fuzziness 0 은 정확히 일치하는 색만.
 *   PixelSelection 은 벡터(폴리곤) 형식이라 소프트 알파를 그대로 저장할 수 없다 — 벡터 변환 시
 *   커버리지 50%(COLOR_RANGE_REGION_THRESHOLD)에서 이진화하고, 부드러운 가장자리는 기존
 *   featherPx 규약이 담당한다(정직한 근사, 마술봉의 이진 BFS 마스크와 동일한 손실 수준).
 *
 * DOM 의존성 없음 — 전부 결정적 순수 함수(손으로 만든 Uint8ClampedArray 로 유닛 테스트 가능).
 * 캔버스/이미지 로딩 오케스트레이션은 studio-color-range-browser.ts 가 담당한다
 * (studio-magic-wand-browser.ts 와 동일한 분리).
 */
import {
  MAGIC_WAND_MAX_LOOPS,
  applyMagicWandRegionToSelection,
  traceMaskContours,
  type MagicWandRegion,
} from "./studio-magic-wand";
import {
  isSelectionUsable,
  pointInSelection,
  type PixelSelection,
  type SelectionCombineMode,
} from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/** fuzziness 슬라이더 범위 — 포토샵과 동일한 0..200. 정규화 redmean 거리(0..255 채널 스케일) 단위. */
export const COLOR_RANGE_FUZZINESS_RANGE = { min: 0, max: 200, step: 1 } as const;
/** fuzziness 기본값 — 포토샵 기본값과 동일(40). */
export const COLOR_RANGE_FUZZINESS_DEFAULT = 40;
/** 패널에 보관할 수 있는 최대 샘플 색 수 — UI 폭주 방지(초과 시 호출자가 가장 오래된 것을 버린다). */
export const COLOR_RANGE_MAX_SAMPLES = 8;
/** 소프트 마스크 → 이진 region 변환 문턱(0..255) — 커버리지 50%. */
export const COLOR_RANGE_REGION_THRESHOLD = 128;
/**
 * 한 번의 적용에서 유지할 최대 비연속 region 수 — 스크린톤처럼 매치 컴포넌트가 폭발하는 병적
 * 입력 방어. 마술봉의 루프 상한과 같은 값을 공유해 두 도구의 체감 한계가 일치한다.
 */
export const COLOR_RANGE_MAX_REGIONS = MAGIC_WAND_MAX_LOOPS;

/** 샘플 색 — 0..255 RGB. 알파는 샘플링 시점에 이미 불투명 픽셀로 걸러졌다고 가정한다. */
export type ColorRangeSample = { r: number; g: number; b: number };

/** 소프트 선택 마스크 — 픽셀당 0(미선택)..255(완전 선택). 스캔 해상도 기준(원본과 다를 수 있음). */
export type ColorRangeMask = {
  width: number;
  height: number;
  /** 길이 width*height. 인덱스 y*width+x. */
  alpha: Uint8ClampedArray;
};

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼
// ---------------------------------------------------------------------------

function clampChannel(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** 샘플 배열 위생 처리 — NaN/범위 밖 채널을 클램프하고 최대 개수를 자른다(불변). */
export function sanitizeColorRangeSamples(samples: readonly ColorRangeSample[]): ColorRangeSample[] {
  return samples
    .slice(0, COLOR_RANGE_MAX_SAMPLES)
    .map((s) => ({ r: clampChannel(s.r), g: clampChannel(s.g), b: clampChannel(s.b) }));
}

/**
 * 정규화 redmean 거리 — 0(동일) .. 255(흑↔백). 파일 상단 주석의 채택 근거 참고.
 * √9=3 정규화: 최악(Δr=Δg=Δb=255, r̄=127.5)에서 가중 합이 (2.498+4+2.498)·255² ≈ 9·255² 이므로
 * 3으로 나누면 상한이 255 채널 스케일에 정확히 맞는다.
 */
export function colorRangeSampleDistance(
  r: number,
  g: number,
  b: number,
  sample: ColorRangeSample,
): number {
  const rbar = (r + sample.r) / 2;
  const dr = r - sample.r;
  const dg = g - sample.g;
  const db = b - sample.b;
  return Math.sqrt((2 + rbar / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rbar) / 256) * db * db) / 3;
}

/**
 * 거리 → 커버리지(0..1). 포토샵 소프트 엣지: d ≤ f/2 완전 선택, f 에서 0 으로 선형 감쇠.
 * f=0 은 정확 일치만(감쇠 밴드 없음).
 */
function coverageForDistance(d: number, fuzziness: number): number {
  if (fuzziness <= 0) return d === 0 ? 1 : 0;
  const half = fuzziness / 2;
  if (d <= half) return 1;
  if (d >= fuzziness) return 0;
  return (fuzziness - d) / half;
}

// ---------------------------------------------------------------------------
// (1) RGBA 버퍼 → 소프트 마스크
// ---------------------------------------------------------------------------

/**
 * 이미지 전체를 한 번 훑어 샘플 색들과의 유사도로 소프트 선택 마스크를 만든다(비연속 — BFS 없음).
 *
 * - 여러 샘플: 픽셀마다 "가장 가까운 샘플" 기준(= 커버리지 max) — 샘플들의 합집합 의미론.
 * - 픽셀 알파: 커버리지에 a/255 를 곱한다 — 완전 투명 픽셀(RGB 가 무의미)은 절대 선택되지 않고,
 *   반투명 픽셀은 비례해서 약하게 선택된다(정직한 근사, 주석으로 명시).
 * - opts.antiAlias(기본 true): false 면 커버리지 50% 문턱에서 이진화한 하드 엣지 마스크를 만든다.
 * - samples 가 비면 전부 0 인 마스크(선택할 것 없음 신호).
 *
 * 결정적 순수 함수 — 같은 입력이면 항상 같은 마스크.
 */
export function buildColorRangeMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  samples: readonly ColorRangeSample[],
  fuzziness: number = COLOR_RANGE_FUZZINESS_DEFAULT,
  opts?: { antiAlias?: boolean },
): ColorRangeMask {
  const width = Math.max(0, Math.floor(w));
  const height = Math.max(0, Math.floor(h));
  const alpha = new Uint8ClampedArray(width * height);
  const clean = sanitizeColorRangeSamples(samples);
  if (clean.length === 0 || width === 0 || height === 0 || data.length < width * height * 4) {
    return { width, height, alpha };
  }
  const f = Math.min(
    COLOR_RANGE_FUZZINESS_RANGE.max,
    Math.max(COLOR_RANGE_FUZZINESS_RANGE.min, Number.isFinite(fuzziness) ? fuzziness : 0),
  );
  const antiAlias = opts?.antiAlias ?? true;
  for (let p = 0; p < width * height; p++) {
    const idx = p * 4;
    const a = data[idx + 3]!;
    if (a === 0) continue;
    const r = data[idx]!;
    const g = data[idx + 1]!;
    const b = data[idx + 2]!;
    let dMin = Infinity;
    for (const s of clean) {
      const d = colorRangeSampleDistance(r, g, b, s);
      if (d < dMin) dMin = d;
      if (dMin === 0) break;
    }
    const coverage = coverageForDistance(dMin, f) * (a / 255);
    alpha[p] = antiAlias ? Math.round(coverage * 255) : coverage >= 0.5 ? 255 : 0;
  }
  return { width, height, alpha };
}

/**
 * 마스크 좌우/상하 반전(불변) — 원본(비반전) 픽셀로 만든 마스크를 표시 좌표계로 옮길 때 쓴다.
 * 색 유사도는 공간과 무관하므로 "반전된 이미지를 스캔한 결과"와 정확히 같다. 둘 다 false 면
 * 원본을 그대로 반환한다(flipMagicWandRegion 과 동일 규약).
 */
export function flipColorRangeMask(mask: ColorRangeMask, flipX: boolean, flipY: boolean): ColorRangeMask {
  if (!flipX && !flipY) return mask;
  const { width, height } = mask;
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const sy = flipY ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const sx = flipX ? width - 1 - x : x;
      alpha[y * width + x] = mask.alpha[sy * width + sx]!;
    }
  }
  return { width, height, alpha };
}

// ---------------------------------------------------------------------------
// (2) 소프트 마스크 → 비연속 region 폴리곤(마술봉 추적기 재사용)
// ---------------------------------------------------------------------------

type MaskComponent = {
  /** 첫 발견 픽셀 인덱스 — 결정적 동률 타이브레이크 겸 추적 시드. */
  seed: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** 이진화된 마스크의 4-연결 컴포넌트 라벨링(스택 BFS) — 결정적(스캔 순서 고정). */
function labelComponents(bin: Uint8Array, w: number, h: number): { labels: Int32Array; components: MaskComponent[] } {
  const labels = new Int32Array(w * h); // 0 = 미라벨
  const components: MaskComponent[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (bin[start] !== 1 || labels[start] !== 0) continue;
    const label = components.length + 1;
    const comp: MaskComponent = {
      seed: start,
      area: 0,
      minX: start % w,
      minY: (start / w) | 0,
      maxX: start % w,
      maxY: (start / w) | 0,
    };
    stack.length = 0;
    stack.push(start);
    labels[start] = label;
    while (stack.length > 0) {
      const pos = stack.pop()!;
      const px = pos % w;
      const py = (pos / w) | 0;
      comp.area++;
      if (px < comp.minX) comp.minX = px;
      if (py < comp.minY) comp.minY = py;
      if (px > comp.maxX) comp.maxX = px;
      if (py > comp.maxY) comp.maxY = py;
      if (px > 0 && bin[pos - 1] === 1 && labels[pos - 1] === 0) {
        labels[pos - 1] = label;
        stack.push(pos - 1);
      }
      if (px < w - 1 && bin[pos + 1] === 1 && labels[pos + 1] === 0) {
        labels[pos + 1] = label;
        stack.push(pos + 1);
      }
      if (py > 0 && bin[pos - w] === 1 && labels[pos - w] === 0) {
        labels[pos - w] = label;
        stack.push(pos - w);
      }
      if (py < h - 1 && bin[pos + w] === 1 && labels[pos + w] === 0) {
        labels[pos + w] = label;
        stack.push(pos + w);
      }
    }
    components.push(comp);
  }
  return { labels, components };
}

/**
 * 소프트 마스크 → 비연속 MagicWandRegion 배열.
 *
 * 컴포넌트마다 bbox 로 잘라낸 서브마스크(해당 컴포넌트 픽셀만 포함)를 마술봉의
 * traceMaskContours 에 넣고, 결과 폴리곤(잘라낸 영역 기준 0..1)을 전체 이미지 0..1 로 재사상한다
 * — 추적 비용이 컴포넌트 bbox 합에 비례해 전면 재스캔보다 훨씬 싸고, 추적기 재구현이 없다.
 *
 * region 수는 면적 내림차순(동률이면 발견 순서) 상위 maxRegions 개로 캡한다 — 마술봉의
 * MAGIC_WAND_MAX_LOOPS 방어와 동일한 취지의 병적 입력 방어.
 */
export function colorRangeMaskRegions(
  mask: ColorRangeMask,
  opts?: { threshold?: number; maxRegions?: number },
): MagicWandRegion[] {
  const { width: w, height: h, alpha } = mask;
  if (w <= 0 || h <= 0 || alpha.length < w * h) return [];
  const threshold = Math.min(255, Math.max(1, Math.round(opts?.threshold ?? COLOR_RANGE_REGION_THRESHOLD)));
  const maxRegions = Math.max(1, Math.floor(opts?.maxRegions ?? COLOR_RANGE_MAX_REGIONS));

  const bin = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) bin[p] = alpha[p]! >= threshold ? 1 : 0;

  const { labels, components } = labelComponents(bin, w, h);
  if (components.length === 0) return [];

  const kept = components
    .map((comp, order) => ({ comp, order, label: order + 1 }))
    .sort((a, b) => b.comp.area - a.comp.area || a.comp.seed - b.comp.seed)
    .slice(0, maxRegions);

  const regions: MagicWandRegion[] = [];
  for (const { comp, label } of kept) {
    const bx = comp.minX;
    const by = comp.minY;
    const bw = comp.maxX - comp.minX + 1;
    const bh = comp.maxY - comp.minY + 1;
    // 이 컴포넌트 픽셀만 담은 crop 마스크 — bbox 안에 겹쳐 들어온 다른 컴포넌트는 제외한다.
    const sub = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        sub[y * bw + x] = labels[(by + y) * w + (bx + x)] === label ? 1 : 0;
      }
    }
    const seedX = (comp.seed % w) - bx;
    const seedY = ((comp.seed / w) | 0) - by;
    const local = traceMaskContours(sub, bw, bh, seedX, seedY);
    if (local.outer.length < 3) continue;
    const remap = (pts: { x: number; y: number }[]) =>
      pts.map((p) => ({ x: (bx + p.x * bw) / w, y: (by + p.y * bh) / h }));
    regions.push({ outer: remap(local.outer), holes: local.holes.map(remap) });
  }
  return regions;
}

// ---------------------------------------------------------------------------
// (3) region 결합 — 마술봉과 동일한 PixelSelection 규약
// ---------------------------------------------------------------------------

/**
 * add/subtract 전용 순차 결합 — region 마다 applyMagicWandRegionToSelection 을 그대로 접는다
 * (outer 는 mode, holes 는 반대 mode — 마술봉의 도넛 규약 재사용).
 * intersect 는 순차 적용하면 "sel ∩ r1 ∩ r2"(대부분 공집합)가 되므로 여기 넣지 않는다 —
 * applyColorRangeMaskToSelection 이 마스크 단계에서 올바른 "sel ∩ (r1 ∪ r2 ∪ …)"를 만든다.
 */
export function applyColorRangeRegionsToSelection(
  sel: PixelSelection | null,
  regions: readonly MagicWandRegion[],
  mode: Exclude<SelectionCombineMode, "intersect">,
): PixelSelection | null {
  let next = sel;
  for (const region of regions) {
    next = applyMagicWandRegionToSelection(next, region, mode);
  }
  return next;
}

/**
 * 색상 범위 마스크를 현재 PixelSelection 에 결합한다 — 페이지가 부르는 단일 진입점.
 *
 * - add/subtract: colorRangeMaskRegions → 순차 결합. 매치가 없으면 sel 을 그대로 반환(변화 없음).
 * - intersect: 기존 선택이 없으면 null(빈 선택 — intersectSelectionWithPolygon 과 동일 규약).
 *   있으면 마스크 픽셀을 pointInSelection(픽셀 중심) 으로 걸러낸 뒤, 남은 픽셀만으로 region 을
 *   추적해 **새 선택으로 대체**한다(featherPx 는 기존 값 유지). 픽셀 단위 교집합이라 기존
 *   intersectSelectionWithPolygon 의 bbox 근사보다 정확하다.
 * - opts.aspect: 요소 height/width — 브러시 서브패스 원형 판정 보정(pointInSelection 과 동일 규약).
 */
export function applyColorRangeMaskToSelection(
  sel: PixelSelection | null,
  mask: ColorRangeMask,
  mode: SelectionCombineMode,
  opts?: { threshold?: number; maxRegions?: number; aspect?: number },
): PixelSelection | null {
  const regionOpts = { threshold: opts?.threshold, maxRegions: opts?.maxRegions };
  if (mode !== "intersect") {
    const regions = colorRangeMaskRegions(mask, regionOpts);
    if (regions.length === 0) return sel;
    return applyColorRangeRegionsToSelection(sel, regions, mode);
  }
  if (!isSelectionUsable(sel)) return null;
  const { width: w, height: h } = mask;
  if (w <= 0 || h <= 0) return null;
  const filtered = new Uint8ClampedArray(mask.alpha.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (mask.alpha[p] === 0) continue;
      const center = { x: (x + 0.5) / w, y: (y + 0.5) / h };
      if (pointInSelection(sel, center, { aspect: opts?.aspect })) filtered[p] = mask.alpha[p]!;
    }
  }
  const regions = colorRangeMaskRegions({ width: w, height: h, alpha: filtered }, regionOpts);
  if (regions.length === 0) return null;
  const replaced = applyColorRangeRegionsToSelection(null, regions, "add");
  if (!replaced) return null;
  return { ...replaced, featherPx: sel!.featherPx };
}

/** 마스크에 선택된(문턱 이상) 픽셀이 하나라도 있는지 — 패널/페이지의 "매치 없음" 안내용. */
export function colorRangeMaskHasMatches(mask: ColorRangeMask, threshold = COLOR_RANGE_REGION_THRESHOLD): boolean {
  for (let p = 0; p < mask.alpha.length; p++) {
    if (mask.alpha[p]! >= threshold) return true;
  }
  return false;
}
