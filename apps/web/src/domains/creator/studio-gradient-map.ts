/**
 * Studio Gradient Map Engine
 * 포토샵 "그라디언트 맵(Gradient Map)" 보정 — 각 픽셀의 휘도(0..1)를 여러 색 스톱으로 이뤄진
 * 그라디언트에 대응시켜 색을 갈아끼운다(듀오톤의 확장판: 2색 보간을 N색 다단 보간으로).
 * 256칸 색 LUT(RGB)를 미리 구워 r/g/b를 한 번에 매핑하고 알파는 보존한다.
 * 항등에 가까운 흑→백 매핑이어도 결과는 흑백화이므로 듀오톤처럼 "항상 적용"한다.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 색 유틸 — #rrggbb 한정 파싱/직렬화(모듈 자급자족, studio-filters에서는 타입만 가져온다)
// ---------------------------------------------------------------------------

// #rgb / #rrggbb 허용 정규식.
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAX_GRADIENT_STOPS = 1024;

/** 0..255 정수로 반올림·클램프 후 2자리 소문자 헥스. */
function channelHex(v: number): string {
  const n = Math.min(255, Math.max(0, Math.round(v)));
  return n.toString(16).padStart(2, "0");
}

/** {r,g,b}(0..255) → "#rrggbb" 소문자. */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`;
}

/**
 * 색 문자열 정규화 — #rgb는 #rrggbb로 확장하고 소문자로 맞춘다.
 * 유효하지 않은 입력은 null(스톱 거르기에 사용).
 */
function normalizeColor(v: unknown): string | null {
  if (typeof v !== "string" || !HEX_RE.test(v)) return null;
  const body = v.slice(1).toLowerCase();
  if (body.length === 3) {
    const r = body[0]!;
    const g = body[1]!;
    const b = body[2]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return `#${body}`;
}

/** "#rrggbb"(정규화된 값) → {r,g,b} 0..255. 실패 시 검정 폴백. */
function hexChannels(hex: string): { r: number; g: number; b: number } {
  const norm = normalizeColor(hex);
  if (!norm) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
  };
}

// ---------------------------------------------------------------------------
// 타입·기본값
// ---------------------------------------------------------------------------

/** 그라디언트 색 스톱 — pos 0..1(위치), color #rrggbb. */
export type GradientStop = { pos: number; color: string };

/** 그라디언트 맵 — 색 스톱 2개 이상(pos 오름차순). */
export type GradientMap = { stops: GradientStop[] };

/** 항등에 가까운 흑→백 흑백 매핑 — [{0,#000000},{1,#ffffff}]. */
export const DEFAULT_GRADIENT_MAP: GradientMap = {
  stops: [
    { pos: 0, color: "#000000" },
    { pos: 1, color: "#ffffff" },
  ],
};

/** 새 DEFAULT_GRADIENT_MAP 복제본(공유 배열/객체 변형 방지). */
function defaultMapCopy(): GradientMap {
  return { stops: DEFAULT_GRADIENT_MAP.stops.map((s) => ({ pos: s.pos, color: s.color })) };
}

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

/**
 * 외부 입력/저장본 안전장치 — 다음을 보장한 새 그라디언트 맵을 반환한다.
 *   1) pos가 유한 숫자·color가 유효 헥스인 스톱만 채택(pos는 0..1 클램프, color 정규화)
 *   2) pos 기준 오름차순 정렬(동률은 안정적으로 원래 순서 유지)
 *   3) 유효 스톱이 2개 미만이면 DEFAULT(흑→백)
 *   4) 양끝 pos를 0·1로 강제 — 첫 스톱 pos>0이면 0으로, 마지막 스톱 pos<1이면 1로 당긴다
 * (색은 정규화만 하고 보간하지 않으므로 LUT가 끝을 정확히 잡는다.)
 */
export function normalizeGradientMap(g?: Partial<GradientMap> | null): GradientMap {
  const rawStops = g && typeof g === "object" && Array.isArray(g.stops) ? g.stops : null;
  if (!rawStops) return defaultMapCopy();

  // 1) 유효 스톱만 채택.
  const valid: GradientStop[] = [];
  for (let i = 0; i < Math.min(rawStops.length, MAX_GRADIENT_STOPS); i++) {
    const s = rawStops[i];
    if (!s || typeof s !== "object") continue;
    const pos = (s as GradientStop).pos;
    const color = normalizeColor((s as GradientStop).color);
    if (typeof pos !== "number" || !Number.isFinite(pos) || color === null) continue;
    valid.push({ pos: Math.min(1, Math.max(0, pos)), color });
  }

  // 3) 최소 2 스톱 보장(없으면 기본).
  if (valid.length < 2) return defaultMapCopy();

  // 2) pos 오름차순 안정 정렬.
  const sorted = valid
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.pos - b.s.pos || a.i - b.i)
    .map((e) => e.s);

  // 4) 양끝 pos를 0/1로 강제(끝 스톱 위치만 당김, 색은 유지).
  sorted[0] = { pos: 0, color: sorted[0]!.color };
  sorted[sorted.length - 1] = { pos: 1, color: sorted[sorted.length - 1]!.color };

  return { stops: sorted };
}

/** 흑→백 2-스톱(=흑백 변환)과 동일한지 — DEFAULT_GRADIENT_MAP과 같은 매핑인지. */
export function isDefaultGradientMap(g: GradientMap): boolean {
  if (!g || !Array.isArray(g.stops) || g.stops.length !== 2) return false;
  const [a, b] = g.stops;
  return (
    a!.pos === 0 &&
    normalizeColor(a!.color) === "#000000" &&
    b!.pos === 1 &&
    normalizeColor(b!.color) === "#ffffff"
  );
}

// ---------------------------------------------------------------------------
// LUT 빌드·적용
// ---------------------------------------------------------------------------

/**
 * 256칸 색 LUT(RGB) — 휘도 i(0..255)를 t=i/255로 보고, 그 t를 둘러싼 두 스톱 사이를
 * 선형보간한 색을 LUT[i*3..i*3+2]에 채운다. g는 정규화된 맵을 가정한다(양끝 0/1).
 *   LUT[0] = 첫 스톱 색, LUT[255] = 마지막 스톱 색.
 * Uint8ClampedArray가 반올림·0..255 클램프를 함께 처리한다.
 */
export function buildGradientLut(g: GradientMap): Uint8ClampedArray {
  const map = normalizeGradientMap(g);
  const stops = map.stops;
  const n = stops.length;
  // 각 스톱 색을 채널로 미리 풀어둔다.
  const cols = stops.map((s) => hexChannels(s.color));

  const lut = new Uint8ClampedArray(256 * 3);
  let seg = 0; // 현재 구간 시작 스톱 인덱스(휘도가 단조 증가하므로 앞으로만 전진).
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // t를 포함하는 구간 [seg, seg+1] 찾기(stops[seg+1].pos >= t).
    while (seg < n - 2 && t > stops[seg + 1]!.pos) seg++;
    const p0 = stops[seg]!.pos;
    const p1 = stops[seg + 1]!.pos;
    const c0 = cols[seg]!;
    const c1 = cols[seg + 1]!;
    const span = p1 - p0;
    // 구간 내 보간 비율(폭 0인 중복 스톱은 뒤 색 채택).
    let f = span > 0 ? (t - p0) / span : 1;
    if (f < 0) f = 0;
    else if (f > 1) f = 1;
    const o = i * 3;
    lut[o] = c0.r + (c1.r - c0.r) * f;
    lut[o + 1] = c0.g + (c1.g - c0.g) * f;
    lut[o + 2] = c0.b + (c1.b - c0.b) * f;
  }
  return lut;
}

/**
 * 그라디언트 맵 제자리 적용 — 각 픽셀 휘도 t=(0.299r+0.587g+0.114b)/255를
 * 0..255 인덱스로 바꿔 LUT에서 색을 조회, r/g/b를 대체한다. 알파(+3)는 보존.
 * 항등(흑→백)이어도 흑백화이므로 항상 적용한다(no-op 분기 없음).
 */
export function applyGradientMap(img: StudioImageDataLike, g: GradientMap): void {
  const lut = buildGradientLut(g);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    // 휘도는 0..255 — 반올림해 LUT 인덱스로.
    let idx = Math.round(lum);
    if (idx < 0) idx = 0;
    else if (idx > 255) idx = 255;
    const o = idx * 3;
    data[i] = lut[o]!;
    data[i + 1] = lut[o + 1]!;
    data[i + 2] = lut[o + 2]!;
  }
}

// ---------------------------------------------------------------------------
// 웹툰 색감 프리셋 — 첫 항목은 흑백(DEFAULT), 나머지는 자주 쓰는 그라디언트 맵.
// 모든 map은 normalizeGradientMap을 통과(양끝 0/1, 색 정규화, 2+ 스톱).
// ---------------------------------------------------------------------------

export type GradientMapPreset = { id: string; label: string; tip: string; map: GradientMap };

export const GRADIENT_MAP_PRESETS: GradientMapPreset[] = [
  {
    id: "mono",
    label: "흑백",
    tip: "휘도를 그대로 검정→흰색에 대응시키는 기본 흑백 변환입니다.",
    map: normalizeGradientMap(DEFAULT_GRADIENT_MAP),
  },
  {
    id: "sepia",
    label: "세피아",
    tip: "어둠은 짙은 갈색, 빛은 따뜻한 크림색으로 물들이는 고전 세피아 톤.",
    map: normalizeGradientMap({
      stops: [
        { pos: 0, color: "#1a0f00" },
        { pos: 1, color: "#fff1cf" },
      ],
    }),
  },
  {
    id: "teal-orange",
    label: "시네마 틸오렌지",
    tip: "그림자는 청록, 중간톤은 탁한 청록, 하이라이트는 주황으로 가는 블록버스터 룩.",
    map: normalizeGradientMap({
      stops: [
        { pos: 0, color: "#06243a" },
        { pos: 0.5, color: "#3a6b7a" },
        { pos: 1, color: "#ffb066" },
      ],
    }),
  },
  {
    id: "cyberpunk",
    label: "사이버펑크",
    tip: "보라→청록→핑크로 흐르는 네온 사이버펑크 색감.",
    map: normalizeGradientMap({
      stops: [
        { pos: 0, color: "#2a0a4a" },
        { pos: 0.5, color: "#15c6c6" },
        { pos: 1, color: "#ff2fb0" },
      ],
    }),
  },
  {
    id: "sunset",
    label: "석양",
    tip: "검정→자주→주황→노랑으로 타오르는 해질녘 4색 그라디언트.",
    map: normalizeGradientMap({
      stops: [
        { pos: 0, color: "#000000" },
        { pos: 0.35, color: "#5a1a4a" },
        { pos: 0.7, color: "#e0662a" },
        { pos: 1, color: "#ffe07a" },
      ],
    }),
  },
  {
    id: "gold",
    label: "골드",
    tip: "어둠은 짙은 갈색, 빛은 금빛으로 빛나는 황금 듀오톤.",
    map: normalizeGradientMap({
      stops: [
        { pos: 0, color: "#1c1200" },
        { pos: 0.5, color: "#9c6b1a" },
        { pos: 1, color: "#ffe9a3" },
      ],
    }),
  },
  {
    id: "ice-blue",
    label: "아이스블루",
    tip: "남청→하늘색→흰색으로 식어가는 서늘한 얼음 색감.",
    map: normalizeGradientMap({
      stops: [
        { pos: 0, color: "#06183a" },
        { pos: 0.5, color: "#4a8fd6" },
        { pos: 1, color: "#eaf6ff" },
      ],
    }),
  },
  {
    id: "duotone-pink",
    label: "듀오톤 핑크",
    tip: "어둠은 짙은 자주, 빛은 부드러운 분홍으로 물드는 핑크 듀오톤.",
    map: normalizeGradientMap({
      stops: [
        { pos: 0, color: "#2a0820" },
        { pos: 1, color: "#ffc2dd" },
      ],
    }),
  },
];

// ---------------------------------------------------------------------------
// flat 배열 변환 — 저장/Konva attrs용 평탄 number[].
// [pos0, r0,g0,b0,  pos1, r1,g1,b1, ...] — 스톱당 4개, 가변 길이(4의 배수).
// ---------------------------------------------------------------------------

/** 그라디언트 맵 → [pos, r, g, b, ...] 평탄 배열(스톱당 4개, 색은 0..255). */
export function gradientMapToFlat(g: GradientMap): number[] {
  const map = normalizeGradientMap(g);
  const flat: number[] = [];
  for (const s of map.stops) {
    const c = hexChannels(s.color);
    flat.push(s.pos, c.r, c.g, c.b);
  }
  return flat;
}

/** [pos, r, g, b, ...] 평탄 배열 → 그라디언트 맵(4개씩 묶어 normalize). 4의 배수 꼬리 밖은 버린다. */
export function flatToGradientMap(flat: number[]): GradientMap {
  if (!Array.isArray(flat)) return defaultMapCopy();
  const stops: GradientStop[] = [];
  const limit = Math.min(flat.length, MAX_GRADIENT_STOPS * 4);
  for (let i = 0; i + 3 < limit; i += 4) {
    const pos = flat[i]!;
    const r = flat[i + 1]!;
    const g = flat[i + 2]!;
    const b = flat[i + 3]!;
    // 숫자가 아니면 normalizeGradientMap이 걸러내도록 둔다(color는 항상 유효 헥스로 직렬화).
    if (
      typeof r !== "number" ||
      typeof g !== "number" ||
      typeof b !== "number" ||
      !Number.isFinite(r) ||
      !Number.isFinite(g) ||
      !Number.isFinite(b)
    ) {
      continue;
    }
    stops.push({ pos, color: rgbToHex(r, g, b) });
  }
  return normalizeGradientMap({ stops });
}

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 node.attrs.gradientMap(flat number[])로 부착.
// attrs는 외부 입력이므로 flatToGradientMap으로 안전 변환, 누락/무효(2 스톱 미만)면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs.gradientMap(평탄 number[])를
 * flatToGradientMap → applyGradientMap. attrs 누락·gradientMap 무효·유효 스톱 2개 미만이면 no-op.
 */
export function gradientMapKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const flat = attrs.gradientMap;
  if (!Array.isArray(flat)) return;
  // 스톱(4칸) 경계를 보존하며 유효 튜플만 채택한다. 무효 원소만 빼서 배열을
  // 당기면 뒤 스톱의 pos/r/g/b 의미가 바뀌어 엉뚱한 색이 적용될 수 있다.
  const numeric: number[] = [];
  const limit = Math.min(flat.length, MAX_GRADIENT_STOPS * 4);
  for (let i = 0; i + 3 < limit; i += 4) {
    const tuple = flat.slice(i, i + 4);
    if (tuple.every((v) => typeof v === "number" && Number.isFinite(v))) {
      numeric.push(...(tuple as number[]));
    }
  }
  // 스톱 하나당 4개 — 2 스톱 미만(8개 미만)이면 적용하지 않는다.
  if (numeric.length < 8) return;
  applyGradientMap(imageData, flatToGradientMap(numeric));
}
