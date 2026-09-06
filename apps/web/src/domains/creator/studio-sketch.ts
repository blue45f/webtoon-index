/**
 * Studio Sketch / Manga-Ink Engine
 * 포토샵 "스케치(Sketch)" 묶음 — 앱에 없던 흑백 잉크화(망가 펜선) 계열 효과를 모았다.
 *   photocopy:  국소 기울기가 큰 곳을 어두운 잉크로, 평탄한 곳은 흰 바탕으로 보내는 2계조 복사기 톤.
 *   crosshatch: 원본 휘도가 어두울수록 대각 해치선을 촘촘히 깐다(아주 어두우면 교차 방향 한 겹 추가).
 *   stamp:      살짝 박스 블러한 휘도를 임계값으로 잘라 순수 흑/백 도장(잉크 스탬프)을 찍는다.
 *   mezzotint:  고정 4x4 베이어 행렬로 휘도를 순서적 디더링해 흑/백 점 입자(메조틴트)를 만든다.
 * 이웃 읽기는 전부 원본 스냅샷(src)에서 하고, 샘플 좌표는 [0,w-1]/[0,h-1]로 클램프하며
 *   비유한 좌표는 0으로 고정한다(NaN이 Uint8ClampedArray를 0으로 뭉개는 버그 방지).
 * 잉크값(흑/백/회색)을 계산한 뒤 t=strength/100로 원본과 블렌드하되, 잉크는 고정 톤으로 끌어당기는
 *   성격이라 기여를 (alpha/255)로 스케일해 완전 투명(alpha 0) 픽셀은 건드리지 않는다(헤일로 방지).
 *   알파(+3)는 절대 쓰지 않는다(보존).
 * Math.random·Date 없음 — 해치/도트/임계는 모두 좌표·휘도의 결정적 함수라 같은 입력은 항상 같은 출력.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

import { clampCoord, lumaAt } from "./studio-pixel-utils";

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type SketchType = "photocopy" | "crosshatch" | "stamp" | "mezzotint";

export type Sketch = {
  type: SketchType; // 효과 종류(포토카피/크로스해치/스탬프/메조틴트)
  strength: number; // 0..100 세기(0이면 항등; 잉크 결과를 원본과 블렌드하는 비율)
  detail: number; // 1..10 임계값/해치 간격/도트 크기/선 두께
};

/** 항등(효과 없음) — strength 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_SKETCH: Sketch = { type: "photocopy", strength: 0, detail: 3 };

/** 세기 슬라이더 한 칸 범위 — 0..100, 1 단위(0=항등). */
export const SKETCH_STRENGTH_RANGE = { min: 0, max: 100, step: 1 } as const;
/** 디테일 슬라이더 한 칸 범위 — 1..10, 1 단위(임계/해치 간격/도트 크기/선 두께). */
export const SKETCH_DETAIL_RANGE = { min: 1, max: 10, step: 1 } as const;

/** 효과 종류 선택지 — UI 라디오/세그먼트용 라벨. */
export const SKETCH_TYPES: { id: SketchType; label: string }[] = [
  { id: "photocopy", label: "포토카피" },
  { id: "crosshatch", label: "크로스해치" },
  { id: "stamp", label: "스탬프" },
  { id: "mezzotint", label: "메조틴트" },
];

// 유효 SketchType 집합(외부 입력 검증용).
const SKETCH_TYPE_SET = new Set<SketchType>(SKETCH_TYPES.map((t) => t.id));

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님(NaN/Infinity/비숫자)은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// type은 유효 SketchType만 인정, 그 외(누락/오타/숫자)는 기본값.
function normalizeType(raw: unknown): SketchType {
  return typeof raw === "string" && SKETCH_TYPE_SET.has(raw as SketchType) ? (raw as SketchType) : DEFAULT_SKETCH.type;
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖은 각 범위로 클램프. type은 유효 SketchType(아니면 기본 "photocopy"),
 * detail은 1..10 정수로 내림(임계·해치 간격·도트 크기가 정수라야 안정적).
 */
export function normalizeSketch(s?: Partial<Sketch> | null): Sketch {
  const src = s && typeof s === "object" ? s : {};
  return {
    type: normalizeType(src.type),
    strength: clampTo(src.strength, SKETCH_STRENGTH_RANGE.min, SKETCH_STRENGTH_RANGE.max, DEFAULT_SKETCH.strength),
    detail: Math.floor(clampTo(src.detail, SKETCH_DETAIL_RANGE.min, SKETCH_DETAIL_RANGE.max, DEFAULT_SKETCH.detail)),
  };
}

/** strength<=0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentitySketch(s: Sketch): boolean {
  return s.strength <= 0;
}

// ---------------------------------------------------------------------------
// 잉크 블렌드 유틸 — 좌표·휘도 헬퍼는 studio-pixel-utils 공유.
// ---------------------------------------------------------------------------

// 한 픽셀 i를 잉크 톤(ink, 0..255 회색)으로 alpha-scaled 블렌드한다.
// a = (src 알파/255)*t 라서 완전 투명(alpha 0) 픽셀은 기여 0 → 원본 RGB 유지(헤일로 방지).
// 잉크는 흑/백/회색 고정 톤으로 끌어당기는 성격이므로 이 알파 스케일이 필수다.
function blendInk(data: Uint8ClampedArray, src: Uint8ClampedArray, i: number, ink: number, t: number): void {
  const a = (src[i + 3]! / 255) * t;
  data[i] = src[i]! + (ink - src[i]!) * a;
  data[i + 1] = src[i + 1]! + (ink - src[i + 1]!) * a;
  data[i + 2] = src[i + 2]! + (ink - src[i + 2]!) * a;
}

// ---------------------------------------------------------------------------
// 적용 — 종류별 잉크화(원본 스냅샷에서 읽어 제자리 기록, strength 블렌드, 알파 보존)
// ---------------------------------------------------------------------------

/**
 * 스케치 제자리 적용 — 항등(strength<=0)이면 no-op. 종류별로 분기한다.
 *
 *   photocopy:  평활 휘도 소벨 기울기 크기로 잉크 농도를 정해 평탄=흰 바탕, 윤곽=검은 잉크의 2계조 톤.
 *   crosshatch: 휘도가 어두울수록 대각 해치선을 촘촘히, 아주 어두우면 교차 방향까지 깐다.
 *   stamp:      박스 블러한 휘도를 임계값으로 잘라 순수 흑/백 도장.
 *   mezzotint:  고정 4x4 베이어 행렬로 휘도를 순서 디더링해 흑/백 점 입자.
 *
 * 모든 잉크값은 t=strength/100로 원본과 블렌드하되 (alpha/255)로 기여를 스케일해
 * 완전 투명 영역은 그대로 둔다(헤일로 방지). r/g/b만 변형하고 알파(+3)는 보존(결정적).
 */
export function applySketch(img: StudioImageDataLike, s: Sketch): void {
  if (isIdentitySketch(s)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  // 비유한(NaN/Infinity) strength·detail은 안전값으로 — Math.round(NaN)=NaN이 잉크값을 NaN으로 만들어
  // RGB를 0으로 오염시키는 것을 막는다(정규화 안 거친 직접 applySketch 호출 방어).
  const t = Number.isFinite(s.strength) ? Math.min(1, Math.max(0, s.strength / 100)) : 0; // 블렌드 비율 0..1
  const detail = Number.isFinite(s.detail) ? Math.max(1, Math.round(s.detail)) : DEFAULT_SKETCH.detail; // 안전 정수(>=1)

  switch (s.type) {
    case "photocopy":
      applyPhotocopy(data, width, height, detail, t);
      break;
    case "crosshatch":
      applyCrosshatch(data, width, height, detail, t);
      break;
    case "stamp":
      applyStamp(data, width, height, detail, t);
      break;
    case "mezzotint":
      applyMezzotint(data, width, height, detail, t);
      break;
  }
}

// 포토카피 소벨 입력용 — 3x3 박스 평활 휘도 평면. 원본 휘도의 한 픽셀짜리 스페클(점 노이즈)이
// 그대로 잉크 점으로 튀는 것을 막고, 실제 경계의 선은 유지한다(평면 1회 계산이라 더 빠르기도 하다).
function smoothedLumaPlane(src: Uint8ClampedArray, width: number, height: number): Float32Array {
  const n = width * height;
  const luma = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    luma[p] = 0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!;
  }
  const out = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const ym = clampCoord(y - 1, height) * width;
    const y0 = y * width;
    const yp = clampCoord(y + 1, height) * width;
    for (let x = 0; x < width; x++) {
      const xm = clampCoord(x - 1, width);
      const xp = clampCoord(x + 1, width);
      out[y0 + x] =
        (luma[ym + xm]! +
          luma[ym + x]! +
          luma[ym + xp]! +
          luma[y0 + xm]! +
          luma[y0 + x]! +
          luma[y0 + xp]! +
          luma[yp + xm]! +
          luma[yp + x]! +
          luma[yp + xp]!) /
        9;
    }
  }
  return out;
}

// 평활 휘도 평면에서의 소벨 기울기 크기(거리 1 3x3).
function sobelOnPlane(
  plane: Float32Array,
  width: number,
  xm: number,
  x: number,
  xp: number,
  ymRow: number,
  yRow: number,
  ypRow: number
): number {
  const tl = plane[ymRow + xm]!;
  const tc = plane[ymRow + x]!;
  const tr = plane[ymRow + xp]!;
  const ml = plane[yRow + xm]!;
  const mr = plane[yRow + xp]!;
  const bl = plane[ypRow + xm]!;
  const bc = plane[ypRow + x]!;
  const br = plane[ypRow + xp]!;
  const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
  const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
  return Math.sqrt(gx * gx + gy * gy);
}

/**
 * 포토카피 — 3x3 평활 휘도 평면 위 거리 1 소벨 기울기 크기로 잉크 농도를 정한다.
 * 평활 덕에 한 픽셀 스페클 노이즈는 잉크 점으로 튀지 않고 실제 윤곽선만 살아난다.
 * 기울기가 임계(thr) 이상이면 검은 잉크(0), 그 아래면 부드럽게 흰 바탕(255)으로 가는 2계조 톤.
 * detail이 클수록 thr이 낮아져(선 두께↑) 더 약한 경계도 잉크로 살아난다.
 * 평탄 영역은 기울기 0 → 흰 바탕. 잉크는 alpha-scaled 블렌드라 투명 영역은 보존.
 */
function applyPhotocopy(data: Uint8ClampedArray, width: number, height: number, detail: number, t: number): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷(알파·블렌드 기준)
  const plane = smoothedLumaPlane(src, width, height); // 평활 휘도(스페클 억제)
  // detail 1..10 → 잉크 임계 약 200..40(낮을수록 가는 선도 잉크로). 선폭/문턱.
  const thr = 220 - detail * 18;
  // thr 위 soft 구간 폭(2계조지만 경계 한 칸은 회색으로 부드럽게).
  const soft = 40;
  for (let y = 0; y < height; y++) {
    const ymRow = clampCoord(y - 1, height) * width;
    const yRow = y * width;
    const ypRow = clampCoord(y + 1, height) * width;
    for (let x = 0; x < width; x++) {
      const xm = clampCoord(x - 1, width);
      const xp = clampCoord(x + 1, width);
      // 평활 평면 소벨 기울기 크기(거리 1 3x3 이웃).
      const mag = sobelOnPlane(plane, width, xm, x, xp, ymRow, yRow, ypRow);
      // 잉크값: mag가 thr 이상이면 0(검정), thr-soft 이하면 255(흰 바탕), 사이는 선형.
      let ink: number;
      if (mag >= thr) ink = 0;
      else if (mag <= thr - soft) ink = 255;
      else ink = 255 * (1 - (mag - (thr - soft)) / soft);
      const i = (yRow + x) * 4;
      blendInk(data, src, i, ink, t);
    }
  }
}

// 크로스해치 잉크 농도(검정에 가까운 정도) — 임계 단계. 어두울수록 위 단계까지 켜진다.
// 각 단계는 휘도(0..255) 상한이다(휘도가 이 값 이하면 해당 해치층이 켜짐).
const HATCH_L1 = 200; // 1차(/ 방향) 해치 시작 휘도
const HATCH_L2 = 120; // 2차(\ 교차 방향) 해치 추가 휘도
const HATCH_L3 = 55; // 3차(가는 격자 보강) 추가 휘도

/**
 * 크로스해치 — 원본 휘도가 어두울수록 대각 해치선을 촘촘히 깐다(망가 톤).
 * 휘도 ≤ L1: 1차 '/' 방향 해치선 위에서 검정. 휘도 ≤ L2: '\' 교차 방향 한 겹 더.
 * 휘도 ≤ L3: 격자 보강선까지(가장 어두운 영역). 그 외 픽셀은 흰 바탕(255).
 * 선 위치는 ((x+y) % spacing)/((x-y) % spacing) 같은 결정적 정수 테스트로만 결정 — 랜덤 없음.
 * detail이 클수록 spacing이 넓어 성긴 해치. 잉크는 alpha-scaled 블렌드라 투명 영역 보존.
 */
function applyCrosshatch(data: Uint8ClampedArray, width: number, height: number, detail: number, t: number): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷(휘도 읽기용)
  const spacing = detail + 2; // 해치 간격(px). detail 1=3px ~ 10=12px.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = lumaAt(src, width, x, y);
      // 결정적 대각선 테스트 — 음수 모듈로 방지 위해 폭+높이 오프셋을 더한다.
      const diagA = (x + y) % spacing === 0; // '/' 방향선
      const diagB = (x - y + width + height) % spacing === 0; // '\' 교차선
      // 격자 보강(가장 어두운 단계) — 두 대각의 절반 위상.
      const half = Math.max(1, Math.floor(spacing / 2));
      const diagC = (x + y + half) % spacing === 0;
      // 휘도 단계에 따라 어느 해치층이 잉크가 되는지 결정.
      let isInk = false;
      if (lum <= HATCH_L1 && diagA) isInk = true;
      if (lum <= HATCH_L2 && diagB) isInk = true;
      if (lum <= HATCH_L3 && diagC) isInk = true;
      // 잉크 픽셀만 검정으로, 나머지는 흰 바탕으로 끌어당긴다(2계조).
      const ink = isInk ? 0 : 255;
      blendInk(data, src, i, ink, t);
    }
  }
}

/**
 * 스탬프 — 3x3 박스 블러로 휘도를 부드럽게 한 뒤 임계값(level)으로 잘라
 * 순수 흑(0)/백(255) 2계조 도장을 찍는다. detail이 클수록 임계가 높아져 더 많은 영역이 잉크.
 * 블러는 점 노이즈로 인한 잘린 가장자리 거칠기를 줄인다. 잉크는 alpha-scaled 블렌드라 투명 영역 보존.
 */
function applyStamp(data: Uint8ClampedArray, width: number, height: number, detail: number, t: number): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷(이웃 읽기용)
  // detail 1..10 → 임계 약 96..168(높을수록 잉크가 더 넓게 남음).
  const level = 88 + detail * 8;
  for (let y = 0; y < height; y++) {
    const ym = clampCoord(y - 1, height);
    const yp = clampCoord(y + 1, height);
    for (let x = 0; x < width; x++) {
      const xm = clampCoord(x - 1, width);
      const xp = clampCoord(x + 1, width);
      // 3x3 박스 블러 휘도 평균(거리 1, 가장자리 클램프).
      const sum =
        lumaAt(src, width, xm, ym) +
        lumaAt(src, width, x, ym) +
        lumaAt(src, width, xp, ym) +
        lumaAt(src, width, xm, y) +
        lumaAt(src, width, x, y) +
        lumaAt(src, width, xp, y) +
        lumaAt(src, width, xm, yp) +
        lumaAt(src, width, x, yp) +
        lumaAt(src, width, xp, yp);
      const blur = sum / 9;
      // 임계 미만은 검정 잉크, 이상은 흰 바탕(하드 2계조 도장).
      const ink = blur < level ? 0 : 255;
      const i = (y * width + x) * 4;
      blendInk(data, src, i, ink, t);
    }
  }
}

// 메조틴트 4x4 베이어(ordered dither) 행렬 — 0..15 임계 인덱스(고정·결정적).
// 휘도를 (행렬값+0.5)/16 임계와 비교해 흑/백을 결정하는 순서 디더링의 표준 행렬.
const BAYER_4X4: number[][] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * 메조틴트 — 고정 4x4 베이어 행렬로 휘도를 순서 디더링해 흑/백 점 입자를 만든다.
 * detail은 셀(점) 크기 — 좌표를 detail로 나눠 양자화하면 점 입자가 굵어진다.
 * 휘도/255 > (베이어값+0.5)/16 이면 흰 바탕(255), 아니면 검은 점(0). 완전 결정적.
 * 잉크는 alpha-scaled 블렌드라 투명 영역은 보존. 알파(+3)는 그대로.
 */
function applyMezzotint(data: Uint8ClampedArray, width: number, height: number, detail: number, t: number): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷(휘도 읽기용)
  const cell = detail; // 점(셀) 크기 — detail 클수록 굵은 입자
  for (let y = 0; y < height; y++) {
    // 셀 단위로 양자화한 베이어 행 인덱스(0..3).
    const by = Math.floor(y / cell) & 3;
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / cell) & 3;
      const lum = lumaAt(src, width, x, y) / 255; // 0..1
      // 베이어 임계(0..1) — (값+0.5)/16 로 0과 255 양끝이 안전하게 처리됨.
      const threshold = (BAYER_4X4[by]![bx]! + 0.5) / 16;
      // 휘도가 임계보다 밝으면 흰 바탕, 아니면 검은 점.
      const ink = lum > threshold ? 255 : 0;
      const i = (y * width + x) * 4;
      blendInk(data, src, i, ink, t);
    }
  }
}

// ---------------------------------------------------------------------------
// 스케치 프리셋 — 첫 항목 없음(빈 프리셋 없이 바로 효과). 자주 쓰는 잉크화 조합.
// 모든 value는 normalizeSketch를 통과(strength 0..100, detail 1..10, type 유효).
// ---------------------------------------------------------------------------

export type SketchPreset = { id: string; label: string; tip: string; value: Sketch };

export const SKETCH_PRESETS: SketchPreset[] = [
  {
    id: "photocopy",
    label: "포토카피",
    tip: "윤곽만 검은 잉크로 남기고 평면은 하얗게 날려 복사기 톤을 만듭니다.",
    value: normalizeSketch({ type: "photocopy", strength: 100, detail: 4 }),
  },
  {
    id: "hatch-light",
    label: "크로스해치(연한)",
    tip: "성긴 대각 해치선으로 은은한 펜 음영을 넣습니다.",
    value: normalizeSketch({ type: "crosshatch", strength: 80, detail: 6 }),
  },
  {
    id: "hatch-dense",
    label: "진한 해치",
    tip: "촘촘한 교차 해치로 어두운 면을 강하게 채운 망가 톤을 냅니다.",
    value: normalizeSketch({ type: "crosshatch", strength: 100, detail: 2 }),
  },
  {
    id: "stamp",
    label: "스탬프",
    tip: "흑백 2계조 도장으로 강렬한 실루엣 잉크 스탬프를 찍습니다.",
    value: normalizeSketch({ type: "stamp", strength: 100, detail: 5 }),
  },
  {
    id: "mezzotint",
    label: "메조틴트",
    tip: "규칙적인 흑백 점 입자로 동판화 같은 메조틴트 질감을 더합니다.",
    value: normalizeSketch({ type: "mezzotint", strength: 90, detail: 2 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeSketch로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 skType(string)과
 * skStrength·skDetail(각 number)을 읽어 normalizeSketch로 안전 변환 후 applySketch.
 * 항등(strength 0)이거나 attrs가 비면 no-op.
 */
export function sketchKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const s = normalizeSketch({
    type: typeof attrs.skType === "string" ? (attrs.skType as SketchType) : undefined,
    strength: attrNumber(attrs.skStrength),
    detail: attrNumber(attrs.skDetail),
  });
  if (isIdentitySketch(s)) return;
  applySketch(imageData, s);
}
