/**
 * Studio Tone Curve Engine
 * 포토샵 "곡선(Curves)" 보정 — 입력 0..255 → 출력 0..255 제어점을 구간 선형보간해
 * 256칸 LUT로 미리 구워 r/g/b 채널에 한 번에 적용한다(알파 보존).
 * 마스터(RGB) 곡선 위에 r/g/b 개별 채널 곡선을 얹는 채널 편집도 지원한다
 * (하위호환: 기존 저장본의 curve(CurvePoint[])는 그대로 마스터, 채널 곡선은 별도 필드).
 * 곡선 에디터용 헬퍼(점 추가/이동/삭제, flat↔점 변환)와 프리셋, Konva 필터까지 한 모듈에 모았다.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 제어점 타입·기본 곡선
// ---------------------------------------------------------------------------

/** 곡선 제어점 — x=입력 휘도 0..255, y=출력 휘도 0..255. */
export type CurvePoint = { x: number; y: number };

/** 항등(보정 없음) 곡선 — 좌하단(0,0)에서 우상단(255,255)으로 직선. */
export const DEFAULT_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

/**
 * Shared authoring ceiling for one tone-curve channel. Sixteen points preserve precise artwork
 * control while keeping a master + RGB channel snapshot inside the immutable 2 KiB asset contract.
 */
export const STUDIO_CURVE_MAX_CONTROL_POINTS = 16;

const AXIS_MIN = 0;
const AXIS_MAX = 255;

/** 0..255 정수로 반올림·클램프. */
function clampAxis(value: number): number {
  if (value < AXIS_MIN) return AXIS_MIN;
  if (value > AXIS_MAX) return AXIS_MAX;
  return Math.round(value);
}

/** 새 DEFAULT_CURVE 복제본(공유 배열 변형 방지). */
function defaultCurveCopy(): CurvePoint[] {
  return DEFAULT_CURVE.map((p) => ({ x: p.x, y: p.y }));
}

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

/**
 * 외부 입력/저장본 안전장치 — 다음을 보장한 새 점 배열을 반환한다.
 *   1) 각 점의 x·y가 유한 숫자 → 0..255로 클램프(반올림)
 *   2) x 기준 오름차순 정렬
 *   3) x 중복 제거(정렬 후 같은 x는 뒤 값이 우선)
 *   4) 첫 점 x=0·마지막 점 x=255 강제(없으면 끝점 추가, 끝 y는 가장 가까운 점 y로)
 *   5) 최소 2점
 * 점이 하나도 유효하지 않으면 DEFAULT_CURVE.
 */
export function normalizeCurve(points?: CurvePoint[] | null): CurvePoint[] {
  if (!Array.isArray(points)) return defaultCurveCopy();

  // 1) 유한 숫자만 받아 클램프.
  const clamped: CurvePoint[] = [];
  for (const p of points) {
    if (!p || typeof p !== "object") continue;
    const { x, y } = p;
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (typeof y !== "number" || !Number.isFinite(y)) continue;
    clamped.push({ x: clampAxis(x), y: clampAxis(y) });
  }
  if (clamped.length === 0) return defaultCurveCopy();

  // 2) x 오름차순 정렬(동률은 원래 순서 유지 — 뒤 값이 우선되도록 3)에서 덮어쓴다).
  clamped.sort((a, b) => a.x - b.x);

  // 3) x 중복 제거 — 같은 x는 뒤 값 우선.
  const deduped: CurvePoint[] = [];
  for (const p of clamped) {
    const last = deduped[deduped.length - 1];
    if (last && last.x === p.x) {
      last.y = p.y;
    } else {
      deduped.push(p);
    }
  }

  // 4) 첫 점 x=0·마지막 점 x=255 강제.
  if (deduped[0]!.x !== AXIS_MIN) {
    deduped.unshift({ x: AXIS_MIN, y: deduped[0]!.y });
  }
  const tail = deduped[deduped.length - 1]!;
  if (tail.x !== AXIS_MAX) {
    deduped.push({ x: AXIS_MAX, y: tail.y });
  }

  // 5) 최소 2점(끝점 강제로 항상 충족되지만 방어적으로).
  if (deduped.length < 2) return defaultCurveCopy();
  return deduped;
}

/** 정규화 후 LUT가 항등(모든 i에서 LUT[i]===i)인지 — 즉 픽셀을 건드리지 않는 곡선인지. */
export function isIdentityCurve(points: CurvePoint[]): boolean {
  const lut = buildCurveLut(points);
  for (let i = 0; i < 256; i++) {
    if (lut[i] !== i) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// LUT 빌드·적용
// ---------------------------------------------------------------------------

/**
 * 256칸 톤 LUT. 입력 점을 normalizeCurve로 정리한 뒤, 각 입력 i에 대해
 * i를 감싸는 구간 [p_a, p_b](p_a.x<=i<=p_b.x)를 찾아 선형보간한다.
 *   y = p_a.y + (p_b.y - p_a.y) * (i - p_a.x) / (p_b.x - p_a.x)
 * 첫 점 이전·마지막 점 이후는 끝점 y로 평탄 클램프.
 * Uint8ClampedArray가 반올림·0..255 클램프를 함께 처리한다.
 */
export function buildCurveLut(points: CurvePoint[]): Uint8ClampedArray {
  const pts = normalizeCurve(points);
  const lut = new Uint8ClampedArray(256);

  let seg = 0; // 현재 구간 시작 인덱스(i가 증가하므로 앞으로만 전진).
  for (let i = 0; i < 256; i++) {
    // i가 다음 점을 넘어서면 구간을 전진. 마지막 구간(seg=last-1)에서는 멈춘다.
    while (seg < pts.length - 2 && i > pts[seg + 1]!.x) {
      seg++;
    }
    const a = pts[seg]!;
    const b = pts[seg + 1]!;
    if (i <= a.x) {
      lut[i] = a.y; // 첫 점 이전 평탄 클램프(정규화로 a.x=0이면 i===0에서만).
    } else if (i >= b.x) {
      lut[i] = b.y; // 마지막 점 이후 평탄 클램프.
    } else {
      const span = b.x - a.x; // 정규화로 x 중복이 없어 span>=1.
      lut[i] = a.y + ((b.y - a.y) * (i - a.x)) / span;
    }
  }
  return lut;
}

/**
 * 곡선 보정 제자리 적용 — 항등이면 no-op. LUT를 한 번만 구워 r/g/b에 매핑하고
 * 알파(+3)는 보존한다.
 */
export function applyCurve(img: StudioImageDataLike, points: CurvePoint[]): void {
  if (isIdentityCurve(points)) return;
  const lut = buildCurveLut(points);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]!]!;
    data[i + 1] = lut[data[i + 1]!]!;
    data[i + 2] = lut[data[i + 2]!]!;
  }
}

// ---------------------------------------------------------------------------
// 채널별(R/G/B) 곡선 — 포토샵 커브의 채널 드롭다운처럼 마스터(RGB) 위에
// 개별 채널 곡선을 얹는다. 하위호환: 기존 저장본의 curve(CurvePoint[])는 그대로
// 마스터 곡선이고, 채널 곡선은 별도 필드(curveCh)로만 추가된다(없으면 항등).
// ---------------------------------------------------------------------------

/** 보정 채널 — master=R·G·B 세 채널 동일 적용, r/g/b=개별 채널. */
export type ToneChannel = "master" | "r" | "g" | "b";

/** r/g/b 개별 채널 키(마스터 제외). */
export type RgbChannelKey = "r" | "g" | "b";

/** 채널 선택 세그먼트 정의 — 커브/레벨 패널이 공유한다(표시 순서·라벨·툴팁). */
export const TONE_CHANNELS: { id: ToneChannel; label: string; tip: string }[] = [
  { id: "master", label: "RGB", tip: "R·G·B 세 채널에 똑같이 적용되는 마스터 조정입니다." },
  { id: "r", label: "R", tip: "빨강 채널만 조정합니다." },
  { id: "g", label: "G", tip: "초록 채널만 조정합니다." },
  { id: "b", label: "B", tip: "파랑 채널만 조정합니다." },
];

/** r/g/b 개별 채널 곡선 묶음 — 누락 채널은 항등(마스터 곡선은 기존 curve 필드). */
export type CurveRgbChannels = { r?: CurvePoint[]; g?: CurvePoint[]; b?: CurvePoint[] };

/** 채널 곡선 묶음 안전장치 — 각 채널을 normalizeCurve로 정리(누락/무효 채널은 항등). */
export function normalizeCurveChannels(
  channels?: CurveRgbChannels | null
): Record<RgbChannelKey, CurvePoint[]> {
  const src = channels && typeof channels === "object" ? channels : undefined;
  return {
    r: normalizeCurve(src?.r),
    g: normalizeCurve(src?.g),
    b: normalizeCurve(src?.b),
  };
}

/** r/g/b 채널 곡선이 전부 항등(픽셀 불변)인지. */
export function isIdentityCurveChannels(channels?: CurveRgbChannels | null): boolean {
  const ch = normalizeCurveChannels(channels);
  return isIdentityCurve(ch.r) && isIdentityCurve(ch.g) && isIdentityCurve(ch.b);
}

/**
 * LUT 합성 순수함수 — first 적용 후 second를 적용하는 것과 같은 단일 256칸 LUT.
 *   out[i] = second[first[i]]
 * 입력은 변형하지 않는다. 커브·레벨의 채널 합성이 함께 재사용한다.
 */
export function composeLuts(first: Uint8ClampedArray, second: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    out[i] = second[first[i]!]!;
  }
  return out;
}

/**
 * 채널별 최종 LUT — 각 채널에 "채널 곡선 → 마스터 곡선" 순으로 합성한다
 * (개별 채널 곡선을 먼저 통과시키고 마스터(RGB) 곡선을 그 위에 얹는다:
 *  final[i] = master[channel[i]]).
 * 채널 곡선이 항등이면 그 채널은 마스터 LUT를 그대로 공유한다(추가 비용 없음).
 */
export function buildCurveChannelLuts(
  master: CurvePoint[],
  channels?: CurveRgbChannels | null
): Record<RgbChannelKey, Uint8ClampedArray> {
  const masterLut = buildCurveLut(master);
  const ch = normalizeCurveChannels(channels);
  const lutFor = (points: CurvePoint[]): Uint8ClampedArray =>
    isIdentityCurve(points) ? masterLut : composeLuts(buildCurveLut(points), masterLut);
  return { r: lutFor(ch.r), g: lutFor(ch.g), b: lutFor(ch.b) };
}

/**
 * 마스터+채널 곡선 제자리 적용 — 전부 항등이면 no-op. 채널별 LUT를 한 번만 구워
 * r/g/b 각각에 매핑하고 알파(+3)는 보존한다.
 */
export function applyCurveChannels(
  img: StudioImageDataLike,
  master: CurvePoint[],
  channels?: CurveRgbChannels | null
): void {
  if (isIdentityCurve(master) && isIdentityCurveChannels(channels)) return;
  const luts = buildCurveChannelLuts(master, channels);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = luts.r[data[i]!]!;
    data[i + 1] = luts.g[data[i + 1]!]!;
    data[i + 2] = luts.b[data[i + 2]!]!;
  }
}

// ---------------------------------------------------------------------------
// 웹툰 톤 곡선 프리셋 — 첫 항목은 항등, 나머지는 자주 쓰는 곡선 모양.
// 모든 points는 normalizeCurve를 통과(범위 안, 끝점 0/255, x 오름차순).
// ---------------------------------------------------------------------------

export type CurvePreset = { id: string; label: string; tip: string; points: CurvePoint[] };

export const CURVE_PRESETS: CurvePreset[] = [
  {
    id: "linear",
    label: "기본",
    tip: "보정 없는 항등 곡선.",
    points: defaultCurveCopy(),
  },
  {
    id: "contrast-s",
    label: "대비 S",
    tip: "어둠은 더 어둡게, 빛은 더 밝게 — S자 곡선으로 대비를 키웁니다.",
    points: [
      { x: 0, y: 0 },
      { x: 64, y: 48 },
      { x: 192, y: 208 },
      { x: 255, y: 255 },
    ],
  },
  {
    id: "fade-s",
    label: "역 S",
    tip: "중간톤을 평탄하게 눌러 대비를 낮추고 부드럽게 만듭니다.",
    points: [
      { x: 0, y: 0 },
      { x: 64, y: 80 },
      { x: 192, y: 176 },
      { x: 255, y: 255 },
    ],
  },
  {
    id: "brighten",
    label: "밝게",
    tip: "중간톤을 끌어올려 전체를 화사하게 띄웁니다.",
    points: [
      { x: 0, y: 0 },
      { x: 128, y: 160 },
      { x: 255, y: 255 },
    ],
  },
  {
    id: "darken",
    label: "어둡게",
    tip: "중간톤을 끌어내려 차분하고 무겁게 가라앉힙니다.",
    points: [
      { x: 0, y: 0 },
      { x: 128, y: 96 },
      { x: 255, y: 255 },
    ],
  },
  {
    id: "film-fade",
    label: "필름 페이드",
    tip: "검정을 들어올리고 흰점을 눌러 빛바랜 필름 톤에 약한 S를 더합니다.",
    points: [
      { x: 0, y: 24 },
      { x: 64, y: 78 },
      { x: 192, y: 198 },
      { x: 255, y: 235 },
    ],
  },
  {
    id: "hard-contrast",
    label: "강한 대비",
    tip: "S자를 더 깊게 꺾어 잉크처럼 강렬한 대비를 만듭니다.",
    points: [
      { x: 0, y: 0 },
      { x: 56, y: 24 },
      { x: 200, y: 232 },
      { x: 255, y: 255 },
    ],
  },
  {
    id: "negative",
    label: "네거티브",
    tip: "입력을 뒤집어 명암을 반전한 음화 효과.",
    points: [
      { x: 0, y: 255 },
      { x: 255, y: 0 },
    ],
  },
  {
    id: "bright-highlight",
    label: "밝은 하이라이트",
    tip: "어둠은 유지한 채 밝은 영역만 더 빛나게 끌어올립니다.",
    points: [
      { x: 0, y: 0 },
      { x: 128, y: 132 },
      { x: 200, y: 232 },
      { x: 255, y: 255 },
    ],
  },
];

// ---------------------------------------------------------------------------
// 곡선 에디터 헬퍼 — 전부 새 배열을 반환하고 입력은 변형하지 않는다(불변).
// ---------------------------------------------------------------------------

// 같은 x로 간주하는 허용 오차 — 점 간격이 이 값 이하면 "같은 위치"로 본다.
const SAME_X_EPS = 2;

/**
 * 정렬 위치에 점을 삽입. x·y는 0..255로 클램프하며, 이미 거의 같은 x
 * (|Δx|<=SAME_X_EPS)에 점이 있으면 그 점의 y를 새 값으로 대체한다.
 * 끝점(x=0/255)과 겹치면 끝점 y만 갱신한다.
 */
export function addCurvePoint(points: CurvePoint[], x: number, y: number): CurvePoint[] {
  const base = normalizeCurve(points);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return base;
  const cx = clampAxis(x);
  const cy = clampAxis(y);

  // 거의 같은 x가 있으면 대체(가장 가까운 한 점).
  const replaceIndex = base.findIndex((p) => Math.abs(p.x - cx) <= SAME_X_EPS);
  if (replaceIndex !== -1) {
    const next = base.map((p) => ({ x: p.x, y: p.y }));
    // 끝점이면 x는 고정(0/255), y만 갱신. 중간점이면 y만 갱신(x는 기존 유지).
    next[replaceIndex] = { x: next[replaceIndex]!.x, y: cy };
    return normalizeCurve(next);
  }

  // Never silently truncate or replace a different authored point at the persistence boundary.
  if (base.length >= STUDIO_CURVE_MAX_CONTROL_POINTS) return base;

  const next = base.map((p) => ({ x: p.x, y: p.y }));
  next.push({ x: cx, y: cy });
  return normalizeCurve(next);
}

/**
 * index 점을 (x,y)로 이동. y는 0..255 클램프.
 * 끝점(첫/마지막)은 x를 고정(원래 x 유지)하고 y만 옮긴다.
 * 중간점은 x를 양 이웃 사이(이웃과 1 이상 간격)로 클램프한다.
 * index가 범위를 벗어나거나 값이 무효면 정규화본을 그대로 반환.
 */
export function moveCurvePoint(points: CurvePoint[], index: number, x: number, y: number): CurvePoint[] {
  const base = normalizeCurve(points);
  if (!Number.isInteger(index) || index < 0 || index >= base.length) return base;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return base;

  const next = base.map((p) => ({ x: p.x, y: p.y }));
  const cy = clampAxis(y);
  const isFirst = index === 0;
  const isLast = index === next.length - 1;

  if (isFirst || isLast) {
    // 끝점: x 고정, y만 이동.
    next[index] = { x: next[index]!.x, y: cy };
    return normalizeCurve(next);
  }

  // 중간점: 양 이웃 사이로 x 클램프(겹치지 않게 1 마진).
  const lowerX = next[index - 1]!.x + 1;
  const upperX = next[index + 1]!.x - 1;
  let cx = clampAxis(x);
  if (cx < lowerX) cx = lowerX;
  if (cx > upperX) cx = upperX;
  next[index] = { x: cx, y: cy };
  return normalizeCurve(next);
}

/**
 * index 점을 제거. 끝점(첫/마지막)은 제거할 수 없어 정규화본을 그대로 반환한다.
 * index가 범위를 벗어나도 그대로 반환.
 */
export function removeCurvePoint(points: CurvePoint[], index: number): CurvePoint[] {
  const base = normalizeCurve(points);
  if (!Number.isInteger(index) || index <= 0 || index >= base.length - 1) return base;
  const next = base.filter((_, i) => i !== index);
  return normalizeCurve(next);
}

// ---------------------------------------------------------------------------
// flat 배열 변환 — Konva Line points 등과 호환(평탄한 number[]).
// ---------------------------------------------------------------------------

/** 점 배열 → [x0,y0,x1,y1,...] 평탄 배열. */
export function curveToFlat(points: CurvePoint[]): number[] {
  const flat: number[] = [];
  for (const p of normalizeCurve(points)) {
    flat.push(p.x, p.y);
  }
  return flat;
}

/** [x0,y0,x1,y1,...] 평탄 배열 → 점 배열(쌍으로 묶어 normalize). 홀수 꼬리는 버린다. */
export function flatToCurve(flat: number[]): CurvePoint[] {
  if (!Array.isArray(flat)) return defaultCurveCopy();
  const points: CurvePoint[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    points.push({ x: flat[i]!, y: flat[i + 1]! });
  }
  return normalizeCurve(points);
}

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 node.attrs.curvePoints(마스터)와
// curvePointsR/G/B(채널)를 flat number[]로 부착.
// attrs는 외부 입력이므로 flatToCurve로 안전 변환, 항등/무효면 no-op(throw 금지).
// ---------------------------------------------------------------------------

/** attrs 평탄 배열 → 곡선. 배열이 아니거나 유효 숫자가 2개 미만이면 null(=곡선 없음). */
function attrFlatCurve(value: unknown): CurvePoint[] | null {
  if (!Array.isArray(value)) return null;
  // 숫자만 추려 안전하게 변환(무효 원소가 섞여도 throw 없이 무시).
  const numeric: number[] = [];
  for (const v of value) {
    if (typeof v === "number" && Number.isFinite(v)) numeric.push(v);
  }
  if (numeric.length < 2) return null;
  return flatToCurve(numeric);
}

/**
 * Konva 필터 함수 — node(`this`).attrs.curvePoints(마스터, 평탄 number[])와
 * curvePointsR/G/B(채널, 평탄 number[])를 읽어 채널 합성 LUT로 적용한다.
 * attrs 누락·전부 무효·전부 항등이면 no-op.
 */
export function curveKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const master = attrFlatCurve(attrs.curvePoints) ?? defaultCurveCopy();
  const channels: CurveRgbChannels = {};
  const r = attrFlatCurve(attrs.curvePointsR);
  if (r) channels.r = r;
  const g = attrFlatCurve(attrs.curvePointsG);
  if (g) channels.g = g;
  const b = attrFlatCurve(attrs.curvePointsB);
  if (b) channels.b = b;
  if (isIdentityCurve(master) && isIdentityCurveChannels(channels)) return;
  applyCurveChannels(imageData, master, channels);
}
