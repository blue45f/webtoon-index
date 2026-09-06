/**
 * Studio Stylize Engine
 * 포토샵 "스타일화(Stylize)" 필터 묶음 — 앱에 없던 회화·외곽선 계열 효과를 모았다.
 *   emboss:    3x3 방향성 엠보스 커널을 휘도에 걸어 128 회색 기준 양각(릴리프)을 낸다.
 *   findEdges: 소벨(Sobel) 기울기 크기를 구해 밝은 바탕에 어두운 외곽선을 그린다(라인아트 추출).
 *   solarize:  임계값보다 큰 채널만 부분 반전해 포토샵 솔라리제이션 톤 반전을 만든다.
 *   oilPaint:  (detail) 반경 이웃에서 휘도를 N개 빈으로 묶고 빈도^6 소프트 가중 평균색으로 칠한다(유화·쿠와하라).
 * 이웃 읽기는 전부 원본 스냅샷(src)에서 하고, 샘플 좌표는 [0,w-1]/[0,h-1]로 클램프하며
 *   비유한 좌표는 0으로 고정한다(NaN이 Uint8ClampedArray를 0으로 뭉개는 버그 방지).
 * 결과는 t=strength/100로 원본과 블렌드한다. 빛을 더하는 항은 alpha/255로 스케일해
 *   완전 투명(alpha 0) 픽셀은 건드리지 않는다. 알파(+3)는 절대 쓰지 않는다(보존).
 * Math.random·Date 없음 — 같은 입력은 항상 같은 출력(결정적). 유화 동률 빈은 자연 평균으로 안정.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 */

import { clampCoord, lumaAt, sobelMagnitude } from "./studio-pixel-utils";

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type StylizeType = "emboss" | "findEdges" | "solarize" | "oilPaint";

export type Stylize = {
  type: StylizeType; // 효과 종류(엠보스/외곽선/솔라리제이션/유화)
  strength: number; // 0..100 세기(0이면 항등; 결과를 원본과 블렌드하는 비율)
  detail: number; // 1..10 커널 스케일/유화 반경/솔라리제이션 임계 폭
};

/** 항등(효과 없음) — strength 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_STYLIZE: Stylize = { type: "emboss", strength: 0, detail: 3 };

/** 세기 슬라이더 한 칸 범위 — 0..100, 1 단위(0=항등). */
export const STYLIZE_STRENGTH_RANGE = { min: 0, max: 100, step: 1 } as const;
/** 디테일 슬라이더 한 칸 범위 — 1..10, 1 단위(커널 거리/유화 반경/솔라리 임계 폭). */
export const STYLIZE_DETAIL_RANGE = { min: 1, max: 10, step: 1 } as const;

/** 효과 종류 선택지 — UI 라디오/세그먼트용 라벨. */
export const STYLIZE_TYPES: { id: StylizeType; label: string }[] = [
  { id: "emboss", label: "엠보스" },
  { id: "findEdges", label: "외곽선" },
  { id: "solarize", label: "솔라리제이션" },
  { id: "oilPaint", label: "유화" },
];

// 유효 StylizeType 집합(외부 입력 검증용).
const STYLIZE_TYPE_SET = new Set<StylizeType>(STYLIZE_TYPES.map((t) => t.id));

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님(NaN/Infinity/비숫자)은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// type은 유효 StylizeType만 인정, 그 외(누락/오타/숫자)는 기본값.
function normalizeType(raw: unknown): StylizeType {
  return typeof raw === "string" && STYLIZE_TYPE_SET.has(raw as StylizeType)
    ? (raw as StylizeType)
    : DEFAULT_STYLIZE.type;
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖은 각 범위로 클램프. type은 유효 StylizeType(아니면 기본 "emboss"),
 * detail은 1..10 정수로 내림(커널 거리·반경이 정수라야 안정적).
 */
export function normalizeStylize(s?: Partial<Stylize> | null): Stylize {
  const src = s && typeof s === "object" ? s : {};
  return {
    type: normalizeType(src.type),
    strength: clampTo(src.strength, STYLIZE_STRENGTH_RANGE.min, STYLIZE_STRENGTH_RANGE.max, DEFAULT_STYLIZE.strength),
    detail: Math.floor(clampTo(src.detail, STYLIZE_DETAIL_RANGE.min, STYLIZE_DETAIL_RANGE.max, DEFAULT_STYLIZE.detail)),
  };
}

/** strength<=0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityStylize(s: Stylize): boolean {
  return s.strength <= 0;
}

// ---------------------------------------------------------------------------
// 블렌드 유틸 — alpha-scaled 채널 블렌드(좌표·휘도 헬퍼는 studio-pixel-utils 공유).
// ---------------------------------------------------------------------------

// 픽셀 i의 r/g/b를 채널별 목표값(tr,tg,tb)으로 alpha-scaled 블렌드한다.
// a = (base 알파/255)*t — 완전 투명(alpha 0) 픽셀은 기여 0 → 원본 RGB 유지(헤일로 방지).
// base는 읽기·쓰기 같은 배열일 수도(solarize), 스냅샷 src를 base로 줄 수도(emboss 등) 있다.
function blendRgbInto(
  data: Uint8ClampedArray,
  base: Uint8ClampedArray,
  i: number,
  tr: number,
  tg: number,
  tb: number,
  t: number
): void {
  const a = (base[i + 3]! / 255) * t;
  data[i] = base[i]! + (tr - base[i]!) * a;
  data[i + 1] = base[i + 1]! + (tg - base[i + 1]!) * a;
  data[i + 2] = base[i + 2]! + (tb - base[i + 2]!) * a;
}

// 단일 회색값 v를 r/g/b 세 채널에 동일하게 alpha-scaled 블렌드(릴리프·외곽선 등 회색 톤 효과용).
function blendGrayInto(data: Uint8ClampedArray, src: Uint8ClampedArray, i: number, v: number, t: number): void {
  blendRgbInto(data, src, i, v, v, v, t);
}

// ---------------------------------------------------------------------------
// 적용 — 종류별 스타일화(원본 스냅샷에서 읽어 제자리 기록, strength 블렌드, 알파 보존)
// ---------------------------------------------------------------------------

/**
 * 스타일화 제자리 적용 — 항등(strength<=0)이면 no-op. 종류별로 분기한다.
 *
 *   emboss:    방향성 엠보스 커널(휘도)을 128 기준 양각으로 → r/g/b 동일 회색 릴리프.
 *   findEdges: 소벨 기울기 크기 → out = 255 - clamp(mag), 밝은 바탕에 어두운 외곽선.
 *   solarize:  채널값 > 임계값이면 255-값으로 반전(부분 톤 반전).
 *   oilPaint:  detail 반경 이웃 휘도를 N빈 히스토그램으로 묶어 빈도^6 소프트 가중 평균색으로 칠함.
 *
 * 결과는 t=strength/100로 원본과 채널별 블렌드(final = orig*(1-t) + styl*t).
 * emboss는 회색 양각을 더하는 성격이라 (alpha/255)로 기여를 스케일해 투명 영역 헤일로를 막는다.
 * 모든 종류가 r/g/b만 변형하고 알파(+3)는 보존한다. 같은 입력=같은 출력(결정적).
 */
export function applyStylize(img: StudioImageDataLike, s: Stylize): void {
  if (isIdentityStylize(s)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  const t = Math.min(1, Math.max(0, s.strength / 100)); // 블렌드 비율 0..1
  const detail = Math.max(1, Math.round(s.detail)); // 안전 정수 디테일(>=1)

  switch (s.type) {
    case "emboss":
      applyEmboss(data, width, height, detail, t);
      break;
    case "findEdges":
      applyFindEdges(data, width, height, detail, t);
      break;
    case "solarize":
      applySolarize(data, width, height, detail, t);
      break;
    case "oilPaint":
      applyOilPaint(data, width, height, detail, t);
      break;
  }
}

// emboss 방향성 3x3 커널(좌상 음수 ~ 우하 양수) — 빛이 좌상에서 드는 양각.
// 합이 0(제로섬)이라 평탄 영역은 중립 회색(128)으로 수렴하고, 경사면(엣지)에서만 명암이 갈린다.
const EMBOSS_KERNEL: number[][] = [
  [-2, -1, 0],
  [-1, 0, 1],
  [0, 1, 2],
];

/**
 * 엠보스 — detail만큼 떨어진 이웃 휘도에 방향성 커널을 적용하고 128을 더해 회색 양각을 만든다.
 * 결과 v는 r=g=b로 같게 칠한 릴리프. 각 픽셀 기여는 (alpha/255)로 스케일해
 * 투명 영역(alpha 0)은 원본 그대로 두어 헤일로가 생기지 않게 한다. 알파(+3)는 보존.
 */
function applyEmboss(data: Uint8ClampedArray, width: number, height: number, detail: number, t: number): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷(이웃 읽기용)
  const d = detail; // 이웃 샘플 거리(detail 클수록 굵은 양각)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 커널 합산(휘도). 좌표는 detail 거리만큼 벌려 샘플(가장자리 클램프).
      let acc = 0;
      for (let ky = 0; ky < 3; ky++) {
        const sy = clampCoord(y + (ky - 1) * d, height);
        for (let kx = 0; kx < 3; kx++) {
          const w = EMBOSS_KERNEL[ky]![kx]!;
          if (w === 0) continue;
          const sx = clampCoord(x + (kx - 1) * d, width);
          acc += w * lumaAt(src, width, sx, sy);
        }
      }
      const v = acc + 128; // 128 회색 기준 양각(Uint8ClampedArray가 0..255 클램프)
      const i = (y * width + x) * 4;
      // 투명 픽셀은 효과를 더하지 않는다 — 알파 비율로 블렌드 강도를 줄인다.
      blendGrayInto(data, src, i, v, t);
    }
  }
}

/**
 * 외곽선 — 소벨 Gx/Gy 기울기 크기를 휘도로 구해 out = 255 - clamp(mag)로 반전한다.
 * 평탄 영역은 밝게(흰 바탕), 윤곽은 어둡게(검은 선) — 라인아트 추출에 적합.
 * detail은 소벨 샘플 거리를 벌려 더 굵은 외곽선을 낸다. 알파(+3)는 보존.
 */
function applyFindEdges(data: Uint8ClampedArray, width: number, height: number, detail: number, t: number): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷
  const d = detail; // 소벨 샘플 거리
  for (let y = 0; y < height; y++) {
    const ym = clampCoord(y - d, height);
    const yp = clampCoord(y + d, height);
    for (let x = 0; x < width; x++) {
      const xm = clampCoord(x - d, width);
      const xp = clampCoord(x + d, width);
      // 소벨 기울기 크기(거리 d 3x3 이웃).
      const mag = sobelMagnitude(src, width, xm, x, xp, ym, y, yp);
      const v = 255 - mag; // 밝은 바탕에 어두운 선(Uint8ClampedArray가 0..255 클램프)
      const i = (y * width + x) * 4;
      // 투명 픽셀(alpha 0)은 흰 바탕(v=255)으로 새지 않도록 알파 비율로 블렌드 강도를 줄인다(헤일로 방지).
      blendGrayInto(data, src, i, v, t);
    }
  }
}

/**
 * 솔라리제이션 — 임계값보다 큰 채널만 255-값으로 반전한다(포토샵 톤 반전).
 * 임계값 = 128 - (detail-3)*spread 로 detail이 클수록 임계가 낮아져 더 많은 톤이 뒤집힌다.
 * 이웃 의존이 없어 스냅샷이 필요 없고, 결과는 t로 원본과 블렌드. 알파(+3)는 보존.
 */
function applySolarize(data: Uint8ClampedArray, width: number, height: number, detail: number, t: number): void {
  // detail 3을 중앙(128)으로, 1당 약 10씩 임계를 옮긴다 → 64..192로 안전 클램프.
  const spread = 10;
  const threshold = Math.min(192, Math.max(64, 128 - (detail - 3) * spread));
  const n = width * height;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    // 임계 초과 채널만 반전, 이하 채널은 유지 → 부분 반전(솔라리제이션).
    const sr = r > threshold ? 255 - r : r;
    const sg = g > threshold ? 255 - g : g;
    const sb = b > threshold ? 255 - b : b;
    // 투명 픽셀은 톤 반전을 적용하지 않는다(알파 비율로 블렌드 강도 조절).
    blendRgbInto(data, data, i, sr, sg, sb, t);
  }
}

// 유화 휘도 양자화 빈 수(고정) — 이웃 휘도를 이 개수로 묶어 최빈 빈을 찾는다.
const OIL_BINS = 8;
// 유화 반경 상한 — detail이 커도 이웃 윈도가 과하게 커지지 않게(속도) 캡.
const OIL_MAX_RADIUS = 5;
// 유화 빈 소프트 가중 지수 — (count/maxCount)^N 가중 평균. N이 클수록 최빈 빈 위주(하드)이고,
// 유한 N은 최빈 빈이 픽셀 간에 뒤바뀔 때 색이 계단으로 튀는 밴딩 윤곽을 부드럽게 잇는다.
const OIL_HARDNESS = 6;

/**
 * 유화 — 각 픽셀의 (detail) 반경 이웃에서 휘도를 OIL_BINS개 빈으로 묶어 히스토그램을 만들고,
 * 빈별 평균색을 (count/maxCount)^OIL_HARDNESS 가중으로 섞어 칠한다(표준 GPU oil-paint 방식).
 * 최빈 빈이 지배하되 근소한 2위 빈도 조금 섞여, 이웃 픽셀 간 최빈 빈이 뒤바뀌는 경계에서
 * 색이 계단으로 튀던 밴딩 윤곽이 사라진다(하드 argmax의 상위호환 — 동률도 자연 평균).
 * 쿠와하라/유화 느낌의 평탄화. 반경은 min(detail, OIL_MAX_RADIUS)로 캡(캐시당 1회 실행).
 * 결과는 t로 원본과 블렌드하고 알파(+3)는 보존. 같은 입력=같은 출력(결정적).
 */
function applyOilPaint(data: Uint8ClampedArray, width: number, height: number, detail: number, t: number): void {
  const src = new Uint8ClampedArray(data); // 원본 스냅샷(이웃 읽기용)
  const radius = Math.min(OIL_MAX_RADIUS, Math.max(1, detail)); // 이웃 반경(캡)
  // 빈별 누적: 개수·r합·g합·b합(픽셀마다 0으로 리셋해 재사용).
  const count = new Int32Array(OIL_BINS);
  const sumR = new Float64Array(OIL_BINS);
  const sumG = new Float64Array(OIL_BINS);
  const sumB = new Float64Array(OIL_BINS);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 빈 버퍼 초기화.
      count.fill(0);
      sumR.fill(0);
      sumG.fill(0);
      sumB.fill(0);
      // (radius) 반경 정사각 이웃을 훑어 빈에 누적(가장자리 클램프).
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = clampCoord(y + dy, height);
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = clampCoord(x + dx, width);
          const si = (sy * width + sx) * 4;
          const r = src[si]!;
          const g = src[si + 1]!;
          const b = src[si + 2]!;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          // 휘도(0..255)를 0..OIL_BINS-1 빈으로 양자화.
          let bin = Math.floor((lum / 256) * OIL_BINS);
          if (bin < 0) bin = 0;
          else if (bin >= OIL_BINS) bin = OIL_BINS - 1;
          count[bin]!++;
          sumR[bin]! += r;
          sumG[bin]! += g;
          sumB[bin]! += b;
        }
      }
      // 최빈 빈 개수(가중 정규화 기준).
      let maxCount = 0;
      for (let k = 0; k < OIL_BINS; k++) {
        if (count[k]! > maxCount) maxCount = count[k]!;
      }
      // (count/maxCount)^OIL_HARDNESS 소프트 가중으로 빈 평균색을 섞는다.
      let wSum = 0;
      let or = 0;
      let og = 0;
      let ob = 0;
      for (let k = 0; k < OIL_BINS; k++) {
        const ck = count[k]!;
        if (ck <= 0) continue;
        const ratio = ck / maxCount;
        const w = ratio ** OIL_HARDNESS;
        wSum += w;
        const inv = w / ck;
        or += sumR[k]! * inv;
        og += sumG[k]! * inv;
        ob += sumB[k]! * inv;
      }
      const invW = wSum > 0 ? 1 / wSum : 0; // 0 나눗셈 방지(이론상 항상 >0)
      const i = (y * width + x) * 4;
      // 투명 픽셀은 평탄화를 적용하지 않는다(알파 비율로 블렌드 강도 조절).
      blendRgbInto(data, src, i, or * invW, og * invW, ob * invW, t);
    }
  }
}

// ---------------------------------------------------------------------------
// 스타일화 프리셋 — 첫 항목 없음(빈 프리셋 없이 바로 효과). 자주 쓰는 스타일화 조합.
// 모든 value는 normalizeStylize를 통과(strength 0..100, detail 1..10, type 유효).
// ---------------------------------------------------------------------------

export type StylizePreset = { id: string; label: string; tip: string; value: Stylize };

export const STYLIZE_PRESETS: StylizePreset[] = [
  {
    id: "emboss",
    label: "엠보스",
    tip: "방향성 양각으로 금속 부조 같은 입체 질감을 냅니다.",
    value: normalizeStylize({ type: "emboss", strength: 80, detail: 2 }),
  },
  {
    id: "lineart",
    label: "라인아트",
    tip: "강한 외곽선 추출로 밝은 바탕에 검은 윤곽선만 남깁니다.",
    value: normalizeStylize({ type: "findEdges", strength: 100, detail: 1 }),
  },
  {
    id: "solar",
    label: "솔라리",
    tip: "밝은 톤을 부분 반전해 몽환적인 솔라리제이션 색조를 만듭니다.",
    value: normalizeStylize({ type: "solarize", strength: 75, detail: 4 }),
  },
  {
    id: "oil",
    label: "유화",
    tip: "이웃 색을 뭉쳐 붓 터치 같은 유화 질감으로 평탄화합니다.",
    value: normalizeStylize({ type: "oilPaint", strength: 85, detail: 3 }),
  },
  {
    id: "oil-strong",
    label: "강한 유화",
    tip: "넓은 반경으로 색을 크게 뭉쳐 두껍고 거친 유화 느낌을 냅니다.",
    value: normalizeStylize({ type: "oilPaint", strength: 100, detail: 6 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeStylize로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 stType(string)과
 * stStrength·stDetail(각 number)을 읽어 normalizeStylize로 안전 변환 후 applyStylize.
 * 항등(strength 0)이거나 attrs가 비면 no-op.
 */
export function stylizeKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const s = normalizeStylize({
    type: typeof attrs.stType === "string" ? (attrs.stType as StylizeType) : undefined,
    strength: attrNumber(attrs.stStrength),
    detail: attrNumber(attrs.stDetail),
  });
  if (isIdentityStylize(s)) return;
  applyStylize(imageData, s);
}
