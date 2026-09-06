/**
 * Studio Detail / Frequency Engine
 * 포토샵 "디테일/주파수(Detail/Frequency)" 도구 묶음 — 앱의 거친 전역 샤픈 숫자보다 풍부한 질감/노이즈 도구.
 *   highPass:     원본에서 박스블러(저주파)를 빼 고주파만 128 회색 위에 남긴다(주파수 분리 디테일).
 *   median:       (radius) 이웃의 채널별 중앙값으로 치환해 스페클(점 노이즈)을 지우되 엣지는 보존한다.
 *   smartSharpen: 언샤프 마스크(src + (src-blur)*k)를 걸되, 고주파 크기 |src-blur|가 임계값을 넘는
 *                 엣지에서만 적용해 평탄한 노이즈는 증폭하지 않는다(엣지 인식 샤픈).
 * 이웃/블러 읽기는 전부 원본 스냅샷(src)에서 하고, 샘플 좌표는 [0,w-1]/[0,h-1]로 클램프하며
 *   비유한 좌표는 0으로 고정한다(NaN이 Uint8ClampedArray를 0으로 뭉개는 버그 방지).
 * 결과는 t=amount/100로 원본과 채널별 블렌드한다. 고정 톤(128 회색)으로 미는 highPass는 alpha/255로
 *   기여를 스케일해 완전 투명(alpha 0) 픽셀은 건드리지 않는다(헤일로 방지). 알파(+3)는 절대 쓰지 않는다(보존).
 * Math.random·Date 없음 — 같은 입력은 항상 같은 출력(결정적).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type DetailType = "highPass" | "median" | "smartSharpen";

export type Detail = {
  type: DetailType; // 도구 종류(하이패스/미디언/스마트 샤픈)
  amount: number; // 0..100 세기(0이면 항등; 결과를 원본과 블렌드하는 비율)
  radius: number; // 1..10 블러/이웃 반경(px) — 클수록 넓은 주파수 분리·이웃
};

/** 항등(효과 없음) — amount 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_DETAIL: Detail = { type: "smartSharpen", amount: 0, radius: 2 };

/** 세기 슬라이더 한 칸 범위 — 0..100, 1 단위(0=항등). */
export const DETAIL_AMOUNT_RANGE = { min: 0, max: 100, step: 1 } as const;
/** 반경 슬라이더 한 칸 범위 — 1..10, 1 단위(블러/이웃 반경 px). */
export const DETAIL_RADIUS_RANGE = { min: 1, max: 10, step: 1 } as const;

/** 도구 종류 선택지 — UI 라디오/세그먼트용 라벨. */
export const DETAIL_TYPES: { id: DetailType; label: string }[] = [
  { id: "highPass", label: "하이패스" },
  { id: "median", label: "미디언" },
  { id: "smartSharpen", label: "스마트 샤픈" },
];

// 유효 DetailType 집합(외부 입력 검증용).
const DETAIL_TYPE_SET = new Set<DetailType>(DETAIL_TYPES.map((t) => t.id));

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님(NaN/Infinity/비숫자)은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// type은 유효 DetailType만 인정, 그 외(누락/오타/숫자)는 기본값.
function normalizeType(raw: unknown): DetailType {
  return typeof raw === "string" && DETAIL_TYPE_SET.has(raw as DetailType) ? (raw as DetailType) : DEFAULT_DETAIL.type;
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖은 각 범위로 클램프. type은 유효 DetailType(아니면 기본 "smartSharpen"),
 * radius는 1..10 정수로 내림(블러/이웃 반경이 정수라야 안정적).
 */
export function normalizeDetail(d?: Partial<Detail> | null): Detail {
  const src = d && typeof d === "object" ? d : {};
  return {
    type: normalizeType(src.type),
    amount: clampTo(src.amount, DETAIL_AMOUNT_RANGE.min, DETAIL_AMOUNT_RANGE.max, DEFAULT_DETAIL.amount),
    radius: Math.floor(clampTo(src.radius, DETAIL_RADIUS_RANGE.min, DETAIL_RADIUS_RANGE.max, DEFAULT_DETAIL.radius)),
  };
}

/** amount<=0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityDetail(d: Detail): boolean {
  return d.amount <= 0;
}

// ---------------------------------------------------------------------------
// 좌표 유틸·분리형 박스블러 — 스냅샷 읽기를 공유한다(가장자리 클램프, 비유한 좌표 0 고정).
// ---------------------------------------------------------------------------

// 좌표를 [0, n-1]로 클램프. 비유한(NaN/±Infinity)은 0으로 고정해
// Math.floor(NaN) 인덱싱이 데이터(특히 알파)를 0으로 뭉개는 버그를 막는다.
function clampCoord(v: number, n: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  const max = n - 1;
  return v > max ? max : v;
}

/**
 * 분리형 박스블러 — 반경 radius(좌우/상하 각 radius칸, 창 크기 2r+1)의 평균을 r/g/b에 낸다.
 * 가로 패스 → 세로 패스 2단으로 분리해 O(n·r) 대신 사실상 O(n)에 가깝게 처리한다.
 * 알파(+3)는 블러하지 않고 보존(고주파 계산은 색상 채널만 의미가 있다).
 * 가장자리는 좌표 클램프(엣지 픽셀 반복)로 채운다 — Number.isFinite 가드로 OOB 인덱싱이 없다.
 * 반환은 새 Float32Array(길이 = data.length, 알파 슬롯은 원본 알파 복사)로, 호출부가 src와 함께 쓴다.
 */
function boxBlur(src: Uint8ClampedArray, width: number, height: number, radius: number): Float32Array {
  const r = Math.max(0, Math.floor(radius));
  const out = new Float32Array(src.length);
  if (r === 0) {
    // 반경 0이면 블러 없음 — 원본을 그대로 복사(고주파=0).
    for (let i = 0; i < src.length; i++) out[i] = src[i]!;
    return out;
  }
  const inv = 1 / (2 * r + 1); // 창 평균 정규화 계수
  const tmp = new Float32Array(src.length); // 가로 패스 중간 버퍼

  // 가로 패스: 각 행에서 좌우 radius 평균(가장자리 클램프).
  for (let y = 0; y < height; y++) {
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let k = -r; k <= r; k++) {
        const sx = clampCoord(x + k, width);
        const si = rowBase + sx * 4;
        sr += src[si]!;
        sg += src[si + 1]!;
        sb += src[si + 2]!;
      }
      const oi = rowBase + x * 4;
      tmp[oi] = sr * inv;
      tmp[oi + 1] = sg * inv;
      tmp[oi + 2] = sb * inv;
      tmp[oi + 3] = src[oi + 3]!; // 알파 보존(블러 안 함)
    }
  }

  // 세로 패스: 가로 결과(tmp)에서 상하 radius 평균(가장자리 클램프).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let k = -r; k <= r; k++) {
        const sy = clampCoord(y + k, height);
        const si = (sy * width + x) * 4;
        sr += tmp[si]!;
        sg += tmp[si + 1]!;
        sb += tmp[si + 2]!;
      }
      const oi = (y * width + x) * 4;
      out[oi] = sr * inv;
      out[oi + 1] = sg * inv;
      out[oi + 2] = sb * inv;
      out[oi + 3] = src[oi + 3]!; // 알파 보존
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 적용 — 종류별 디테일(원본 스냅샷에서 읽어 제자리 기록, amount 블렌드, 알파 보존)
// ---------------------------------------------------------------------------

/**
 * 디테일 제자리 적용 — 항등(amount<=0)이면 no-op. 종류별로 분기한다.
 *
 *   highPass:     out = 128 + (src - boxBlur(src, radius)); 평탄 영역은 ~128 회색(주파수 분리 디테일).
 *   median:       (radius) 이웃의 채널별 중앙값으로 치환(스페클 제거, 엣지 보존).
 *   smartSharpen: 언샤프 마스크(src + (src-blur)*k), |src-blur|가 임계값 초과인 엣지에서만(엣지 인식).
 *
 * 결과는 t=amount/100로 원본과 채널별 블렌드(final = orig*(1-t) + styl*t).
 * highPass는 고정 회색(128)으로 미는 성격이라 (alpha/255)로 기여를 스케일해 투명 영역 헤일로를 막는다.
 * 모든 종류가 r/g/b만 변형하고 알파(+3)는 보존한다. 같은 입력=같은 출력(결정적).
 */
export function applyDetail(img: StudioImageDataLike, d: Detail): void {
  if (isIdentityDetail(d)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  // 비유한(NaN/Infinity) amount·radius는 안전값으로 — Math.round(NaN)=NaN이 median/highPass를 통해
  // RGB를 0으로 오염(검은 픽셀)시키는 것을 막는다(정규화 안 거친 직접 applyDetail 호출 방어).
  const t = Number.isFinite(d.amount) ? Math.min(1, Math.max(0, d.amount / 100)) : 0; // 블렌드 비율 0..1
  const radius = Number.isFinite(d.radius) ? Math.max(1, Math.round(d.radius)) : DEFAULT_DETAIL.radius; // 안전 정수 반경(>=1)

  switch (d.type) {
    case "highPass":
      applyHighPass(data, width, height, radius, t);
      break;
    case "median":
      applyMedian(data, width, height, radius, t);
      break;
    case "smartSharpen":
      applySmartSharpen(data, width, height, radius, t);
      break;
  }
}

/**
 * 하이패스 — 원본에서 박스블러(저주파)를 빼 고주파만 128 회색 위에 남긴다(out = 128 + src - blur).
 * 평탄 영역은 src≈blur라 ~128 중립 회색으로 수렴하고, 엣지/질감에서만 명암이 갈린다(주파수 분리).
 * 결과 v를 t로 원본과 블렌드하되, 고정 회색으로 미는 항이라 (alpha/255)로 기여를 스케일해
 * 완전 투명(alpha 0) 픽셀은 원본 그대로 둔다(헤일로 방지). 알파(+3)는 보존.
 */
function applyHighPass(data: Uint8ClampedArray, width: number, height: number, radius: number, t: number): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷
  const blur = boxBlur(src, width, height, radius); // 저주파(블러)
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    // 고주파 = 원본 - 저주파, 128 회색 기준으로 올린다.
    const hr = 128 + (src[i]! - blur[i]!);
    const hg = 128 + (src[i + 1]! - blur[i + 1]!);
    const hb = 128 + (src[i + 2]! - blur[i + 2]!);
    // 투명 픽셀은 회색으로 새지 않도록 알파 비율로 블렌드 강도를 줄인다(헤일로 방지).
    const a = (src[i + 3]! / 255) * t;
    data[i] = src[i]! + (hr - src[i]!) * a;
    data[i + 1] = src[i + 1]! + (hg - src[i + 1]!) * a;
    data[i + 2] = src[i + 2]! + (hb - src[i + 2]!) * a;
  }
}

// Keep the existing radius cap and exact channel-wise median semantics.
const MEDIAN_MAX_RADIUS = 3;
const MEDIAN_CHANNEL_BINS = 256;
const MEDIAN_COARSE_BINS = 16;

/** Exact order statistic for byte samples; the second tier bounds lookup to 32 bins. */
function medianHistogramValue(
  histogram: Uint16Array,
  coarse: Uint16Array,
  channel: number,
  middle: number,
): number {
  const coarseOffset = channel * MEDIAN_COARSE_BINS;
  let group = 0;
  while (group < MEDIAN_COARSE_BINS - 1 && middle >= coarse[coarseOffset + group]!) {
    middle -= coarse[coarseOffset + group]!;
    group += 1;
  }
  const offset = channel * MEDIAN_CHANNEL_BINS;
  let value = group * MEDIAN_COARSE_BINS;
  const last = value + MEDIAN_COARSE_BINS - 1;
  while (value < last && middle >= histogram[offset + value]!) {
    middle -= histogram[offset + value]!;
    value += 1;
  }
  return value;
}

/**
 * Exact median with a horizontally sliding histogram. The old implementation sorted three
 * neighbourhood arrays for every pixel, causing multi-megapixel surface-blur operations to
 * outlive their Worker deadline. A byte histogram selects the same middle value without sorting.
 * Clamped edge samples, radius cap, original-source reads and alpha-scaled blending are unchanged.
 * Auxiliary histogram memory is fixed (1,632 bytes), independent of image size and repeated use.
 */
function applyMedian(data: Uint8ClampedArray, width: number, height: number, radius: number, t: number): void {
  if (width <= 0 || height <= 0) return;
  const src = new Uint8ClampedArray(data);
  const r = Math.min(MEDIAN_MAX_RADIUS, Math.max(1, radius));
  const middle = ((r * 2 + 1) ** 2) >> 1;
  const histogram = new Uint16Array(3 * MEDIAN_CHANNEL_BINS);
  const coarse = new Uint16Array(3 * MEDIAN_COARSE_BINS);
  const updateSample = (index: number, delta: 1 | -1): void => {
    for (let channel = 0; channel < 3; channel++) {
      const value = src[index + channel]!;
      const bin = channel * MEDIAN_CHANNEL_BINS + value;
      const group = channel * MEDIAN_COARSE_BINS + (value >> 4);
      histogram[bin] = histogram[bin]! + delta;
      coarse[group] = coarse[group]! + delta;
    }
  };
  for (let y = 0; y < height; y++) {
    histogram.fill(0);
    coarse.fill(0);
    // Initial x=0 window includes repeated clamped-edge samples, exactly as the sorted reference.
    for (let dy = -r; dy <= r; dy++) {
      const row = clampCoord(y + dy, height) * width;
      for (let dx = -r; dx <= r; dx++) {
        updateSample((row + clampCoord(dx, width)) * 4, 1);
      }
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = (src[i + 3]! / 255) * t;
      if (a !== 0) {
        for (let channel = 0; channel < 3; channel++) {
          const median = medianHistogramValue(histogram, coarse, channel, middle);
          data[i + channel] = src[i + channel]! + (median - src[i + channel]!) * a;
        }
      }
      if (x + 1 < width) {
        const removeX = clampCoord(x - r, width);
        const addX = clampCoord(x + r + 1, width);
        for (let dy = -r; dy <= r; dy++) {
          const row = clampCoord(y + dy, height) * width;
          updateSample((row + removeX) * 4, -1);
          updateSample((row + addX) * 4, 1);
        }
      }
    }
  }
}

// 스마트 샤픈 엣지 임계값 — |src-blur| 고주파 크기가 이 값 이하면 평탄/노이즈로 보고 증폭하지 않는다.
const SMART_SHARPEN_THRESHOLD = 6;
// 스마트 샤픈 최대 증폭 계수 — amount 100에서 (src-blur)에 곱하는 k의 상한.
const SMART_SHARPEN_MAX_K = 1.5;

// 소프트 엣지 게이트 — |hi| ≤ thr → 0, ≥ 2·thr → 1, 사이는 smoothstep.
// 임계 경계에서 증폭이 0↔1로 튀며 생기던 헤일로/팝핑 아티팩트를 부드러운 램프로 없앤다.
function smartSharpenGate(hiAbs: number): number {
  const t = (hiAbs - SMART_SHARPEN_THRESHOLD) / SMART_SHARPEN_THRESHOLD;
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * 스마트 샤픈 — 언샤프 마스크(src + (src-blur)*k)로 엣지 대비를 키우되, 엣지 인식으로 노이즈는 보존한다.
 * 고주파 크기 hi=|src-blur|에 소프트 게이트(smoothstep, thr..2·thr)를 곱해 가산 — 임계 이하 평탄
 * 노이즈는 증폭하지 않고, 임계 부근에서 증폭이 갑자기 켜지며 생기는 헤일로 경계도 없다.
 * k는 (amount/100)*SMART_SHARPEN_MAX_K로 세기에 비례.
 * 결과는 0..255로 클램프(Uint8ClampedArray)되고 알파(+3)는 보존. 같은 입력=같은 출력(결정적).
 * 엣지에선 샤픈값이 원본과 달라지므로 (alpha/255)로 기여를 스케일해 완전 투명(alpha 0) 픽셀은
 * 원본 RGB 그대로 둔다(헤일로 방지). 균일/평탄 영역은 sr≈src라 본래 변화가 없다.
 */
function applySmartSharpen(data: Uint8ClampedArray, width: number, height: number, radius: number, t: number): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷
  const blur = boxBlur(src, width, height, radius); // 저주파(블러)
  const k = t * SMART_SHARPEN_MAX_K; // 증폭 계수(amount 비례)
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    // 채널별 고주파(src-blur). 소프트 게이트 가중 언샤프 가산.
    const hiR = src[i]! - blur[i]!;
    const hiG = src[i + 1]! - blur[i + 1]!;
    const hiB = src[i + 2]! - blur[i + 2]!;
    const sr = src[i]! + hiR * k * smartSharpenGate(Math.abs(hiR));
    const sg = src[i + 1]! + hiG * k * smartSharpenGate(Math.abs(hiG));
    const sb = src[i + 2]! + hiB * k * smartSharpenGate(Math.abs(hiB));
    // 투명 픽셀은 샤픈값으로 새지 않도록 알파 비율로 블렌드 강도를 줄인다(헤일로 방지).
    const a = (src[i + 3]! / 255) * t;
    data[i] = src[i]! + (sr - src[i]!) * a;
    data[i + 1] = src[i + 1]! + (sg - src[i + 1]!) * a;
    data[i + 2] = src[i + 2]! + (sb - src[i + 2]!) * a;
  }
}

// ---------------------------------------------------------------------------
// 디테일 프리셋 — 첫 항목 없음(빈 프리셋 없이 바로 효과). 자주 쓰는 디테일/주파수 조합.
// 모든 value는 normalizeDetail을 통과(amount 0..100, radius 1..10, type 유효).
// ---------------------------------------------------------------------------

export type DetailPreset = { id: string; label: string; tip: string; value: Detail };

export const DETAIL_PRESETS: DetailPreset[] = [
  {
    id: "highpass-texture",
    label: "하이패스 질감",
    tip: "고주파만 회색 위에 남겨 피부·옷감 질감을 또렷하게 끌어올립니다.",
    value: normalizeDetail({ type: "highPass", amount: 60, radius: 3 }),
  },
  {
    id: "median-soft",
    label: "미디언 약",
    tip: "작은 반경의 중앙값으로 미세한 점 노이즈만 살짝 다듬습니다.",
    value: normalizeDetail({ type: "median", amount: 50, radius: 1 }),
  },
  {
    id: "median-strong",
    label: "미디언 강",
    tip: "넓은 반경의 중앙값으로 거친 노이즈를 강하게 제거하면서 엣지는 지킵니다.",
    value: normalizeDetail({ type: "median", amount: 100, radius: 3 }),
  },
  {
    id: "smart-sharpen",
    label: "스마트 샤픈",
    tip: "엣지만 골라 또렷하게 — 평탄한 노이즈는 키우지 않는 선명화입니다.",
    value: normalizeDetail({ type: "smartSharpen", amount: 60, radius: 2 }),
  },
  {
    id: "smart-sharpen-strong",
    label: "강한 샤픈",
    tip: "넓은 반경과 강한 세기로 윤곽 대비를 크게 키워 또렷한 컷을 만듭니다.",
    value: normalizeDetail({ type: "smartSharpen", amount: 100, radius: 4 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeDetail로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 dtType(string)과
 * dtAmount·dtRadius(각 number)를 읽어 normalizeDetail로 안전 변환 후 applyDetail.
 * 항등(amount 0)이거나 attrs가 비면 no-op.
 */
export function detailKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const d = normalizeDetail({
    type: typeof attrs.dtType === "string" ? (attrs.dtType as DetailType) : undefined,
    amount: attrNumber(attrs.dtAmount),
    radius: attrNumber(attrs.dtRadius),
  });
  if (isIdentityDetail(d)) return;
  applyDetail(imageData, d);
}
