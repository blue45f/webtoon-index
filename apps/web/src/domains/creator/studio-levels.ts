/**
 * Studio Levels / Tone Engine
 * 포토샵 "레벨(Levels)" 보정 — 입력 검정·흰점, 중간톤 감마, 출력 하한·상한을
 * 256칸 LUT로 미리 구워 r/g/b 채널에 한 번에 적용한다(알파 보존).
 * 마스터(RGB) 레벨 위에 r/g/b 개별 채널 레벨을 얹는 채널 편집도 지원한다
 * (하위호환: 기존 저장본의 levels* 스칼라는 그대로 마스터, 채널 레벨은 별도 필드).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import { composeLuts, type RgbChannelKey } from "./studio-curves";

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type LevelsParams = {
  blackPoint: number; // 0..254 입력 검정점
  whitePoint: number; // 1..255 입력 흰점(>blackPoint)
  gamma: number; // 0.1..9.9 중간톤(1=중립, >1 밝게, <1 어둡게)
  outBlack: number; // 0..255 출력 하한
  outWhite: number; // 0..255 출력 상한
};

/** 항등(보정 없음) 레벨 — 입력 0..255, 감마 1, 출력 0..255. */
export const DEFAULT_LEVELS: LevelsParams = {
  blackPoint: 0,
  whitePoint: 255,
  gamma: 1,
  outBlack: 0,
  outWhite: 255,
};

export const LEVELS_RANGES: Record<keyof LevelsParams, { min: number; max: number; step: number }> = {
  blackPoint: { min: 0, max: 254, step: 1 },
  whitePoint: { min: 1, max: 255, step: 1 },
  gamma: { min: 0.1, max: 9.9, step: 0.1 },
  outBlack: { min: 0, max: 255, step: 1 },
  outWhite: { min: 0, max: 255, step: 1 },
};

const LEVELS_KEYS = Object.keys(DEFAULT_LEVELS) as (keyof LevelsParams)[];

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖은 LEVELS_RANGES로 클램프. 마지막에 whitePoint>blackPoint를 보장하며,
 * 클램프 후에도 흰점이 검정점 이하면 입력 한 쌍을 기본(0/255)으로 복원한다.
 */
export function normalizeLevels(p?: Partial<LevelsParams> | null): LevelsParams {
  const out: LevelsParams = { ...DEFAULT_LEVELS };
  if (p && typeof p === "object") {
    for (const key of LEVELS_KEYS) {
      const raw = p[key];
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      const range = LEVELS_RANGES[key];
      out[key] = Math.min(range.max, Math.max(range.min, raw));
    }
  }
  // 흰점이 검정점보다 위라는 불변식 보장 — 깨지면 입력 한 쌍만 항등으로 되돌린다.
  if (out.whitePoint <= out.blackPoint) {
    out.blackPoint = DEFAULT_LEVELS.blackPoint;
    out.whitePoint = DEFAULT_LEVELS.whitePoint;
  }
  return out;
}

/** 입력 0..255 + 감마 1 + 출력 0..255 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityLevels(p: LevelsParams): boolean {
  return (
    p.blackPoint === 0 &&
    p.whitePoint === 255 &&
    p.gamma === 1 &&
    p.outBlack === 0 &&
    p.outWhite === 255
  );
}

// ---------------------------------------------------------------------------
// LUT 빌드·적용
// ---------------------------------------------------------------------------

/**
 * 256칸 톤 LUT. 각 입력값 i에 대해:
 *   t = (i - blackPoint) / max(1, whitePoint - blackPoint)  → 0..1 클램프
 *   t = pow(t, 1/gamma)                                      → 중간톤 감마
 *   out = outBlack + t * (outWhite - outBlack)               → 출력 매핑
 * Uint8ClampedArray가 반올림·0..255 클램프를 함께 처리한다.
 */
export function buildLevelsLut(p: LevelsParams): Uint8ClampedArray {
  const safe = normalizeLevels(p);
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, safe.whitePoint - safe.blackPoint);
  const invGamma = 1 / safe.gamma;
  const outSpan = safe.outWhite - safe.outBlack;
  for (let i = 0; i < 256; i++) {
    let t = (i - safe.blackPoint) / span;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    t = Math.pow(t, invGamma);
    lut[i] = Math.round(safe.outBlack + t * outSpan);
  }
  return lut;
}

/**
 * 레벨 보정 제자리 적용 — 항등이면 no-op. LUT를 한 번만 구워 r/g/b에 매핑하고
 * 알파(+3)는 보존한다.
 */
export function applyLevels(img: StudioImageDataLike, p: LevelsParams): void {
  const safe = normalizeLevels(p);
  if (isIdentityLevels(safe)) return;
  const lut = buildLevelsLut(safe);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]!]!;
    data[i + 1] = lut[data[i + 1]!]!;
    data[i + 2] = lut[data[i + 2]!]!;
  }
}

// ---------------------------------------------------------------------------
// 채널별(R/G/B) 레벨 — 포토샵 레벨의 채널 드롭다운처럼 마스터(RGB) 위에
// 개별 채널 레벨을 얹는다. 하위호환: 기존 저장본의 levels* 스칼라는 그대로
// 마스터이고, 채널 레벨은 별도 필드(levelsCh)로만 추가된다(없으면 항등).
// ---------------------------------------------------------------------------

/** r/g/b 개별 채널 레벨 묶음 — 누락 채널은 항등(마스터는 기존 levels* 필드). */
export type LevelsRgbChannels = {
  r?: Partial<LevelsParams>;
  g?: Partial<LevelsParams>;
  b?: Partial<LevelsParams>;
};

/** 채널 레벨 묶음 안전장치 — 각 채널을 normalizeLevels로 정리(누락/무효 채널은 항등). */
export function normalizeLevelsChannels(
  channels?: LevelsRgbChannels | null
): Record<RgbChannelKey, LevelsParams> {
  const src = channels && typeof channels === "object" ? channels : undefined;
  return {
    r: normalizeLevels(src?.r),
    g: normalizeLevels(src?.g),
    b: normalizeLevels(src?.b),
  };
}

/** r/g/b 채널 레벨이 전부 항등(픽셀 불변)인지. */
export function isIdentityLevelsChannels(channels?: LevelsRgbChannels | null): boolean {
  const ch = normalizeLevelsChannels(channels);
  return isIdentityLevels(ch.r) && isIdentityLevels(ch.g) && isIdentityLevels(ch.b);
}

/** LevelsParams → [blackPoint, whitePoint, gamma, outBlack, outWhite] 평탄 5칸(Konva attrs 직렬화용). */
export function levelsToFlat(p?: Partial<LevelsParams> | null): number[] {
  const n = normalizeLevels(p);
  return [n.blackPoint, n.whitePoint, n.gamma, n.outBlack, n.outWhite];
}

/** 평탄 5칸 → LevelsParams(normalizeLevels 통과). 배열 아님/길이 부족/무효 값은 항등 쪽으로. */
export function flatToLevels(flat: unknown): LevelsParams {
  if (!Array.isArray(flat)) return { ...DEFAULT_LEVELS };
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  return normalizeLevels({
    blackPoint: num(flat[0]),
    whitePoint: num(flat[1]),
    gamma: num(flat[2]),
    outBlack: num(flat[3]),
    outWhite: num(flat[4]),
  });
}

/**
 * 채널별 최종 LUT — 각 채널에 "채널 레벨 → 마스터 레벨" 순으로 composeLuts 합성
 * (커브와 동일 규칙: final[i] = master[channel[i]]).
 * 채널 레벨이 항등이면 그 채널은 마스터 LUT를 그대로 공유한다(추가 비용 없음).
 */
export function buildChannelLevelsLuts(
  master?: Partial<LevelsParams> | null,
  channels?: LevelsRgbChannels | null
): Record<RgbChannelKey, Uint8ClampedArray> {
  const m = normalizeLevels(master);
  const masterLut = buildLevelsLut(m);
  const ch = normalizeLevelsChannels(channels);
  const lutFor = (p: LevelsParams): Uint8ClampedArray =>
    isIdentityLevels(p) ? masterLut : composeLuts(buildLevelsLut(p), masterLut);
  return { r: lutFor(ch.r), g: lutFor(ch.g), b: lutFor(ch.b) };
}

/**
 * 마스터+채널 레벨 제자리 적용 — 전부 항등이면 no-op. 채널별 LUT를 한 번만 구워
 * r/g/b 각각에 매핑하고 알파(+3)는 보존한다.
 */
export function applyLevelsChannels(
  img: StudioImageDataLike,
  master?: Partial<LevelsParams> | null,
  channels?: LevelsRgbChannels | null
): void {
  const m = normalizeLevels(master);
  if (isIdentityLevels(m) && isIdentityLevelsChannels(channels)) return;
  const luts = buildChannelLevelsLuts(m, channels);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = luts.r[data[i]!]!;
    data[i + 1] = luts.g[data[i + 1]!]!;
    data[i + 2] = luts.b[data[i + 2]!]!;
  }
}

// ---------------------------------------------------------------------------
// 웹툰 색보정 프리셋 — 첫 항목은 항등, 나머지는 자주 쓰는 톤 조합.
// 모든 params는 normalizeLevels를 통과(범위 안, whitePoint>blackPoint).
// ---------------------------------------------------------------------------

export type LevelsPreset = { id: string; label: string; tip: string; params: LevelsParams };

export const LEVELS_PRESETS: LevelsPreset[] = [
  {
    id: "identity",
    label: "기본",
    tip: "보정 없는 원본 톤.",
    params: { ...DEFAULT_LEVELS },
  },
  {
    id: "contrast",
    label: "대비 강화",
    tip: "입력 폭을 좁혀 검정과 흰색을 또렷하게 끌어올립니다.",
    params: normalizeLevels({ blackPoint: 20, whitePoint: 235 }),
  },
  {
    id: "soft",
    label: "부드럽게",
    tip: "출력 폭을 줄여 새까만·새하얀 영역을 눌러 부드러운 톤을 만듭니다.",
    params: normalizeLevels({ outBlack: 25, outWhite: 230 }),
  },
  {
    id: "black-crush",
    label: "블랙 크러시",
    tip: "검정점을 끌어올려 어두운 디테일을 짙게 뭉갭니다.",
    params: normalizeLevels({ blackPoint: 45 }),
  },
  {
    id: "white-blow",
    label: "화이트 블로우",
    tip: "흰점을 끌어내려 밝은 영역을 하얗게 날립니다.",
    params: normalizeLevels({ whitePoint: 210 }),
  },
  {
    id: "high-key",
    label: "하이키",
    tip: "감마와 출력 하한을 올려 밝고 화사한 분위기로 띄웁니다.",
    params: normalizeLevels({ gamma: 1.4, outBlack: 35, outWhite: 255 }),
  },
  {
    id: "low-key",
    label: "로우키",
    tip: "감마를 낮추고 흰점을 눌러 어둡고 무거운 톤을 만듭니다.",
    params: normalizeLevels({ gamma: 0.7, outWhite: 235 }),
  },
  {
    id: "sharp-print",
    label: "선명 인쇄",
    tip: "검정과 흰색을 동시에 조여 인쇄용 또렷한 대비를 냅니다.",
    params: normalizeLevels({ blackPoint: 15, whitePoint: 240 }),
  },
  {
    id: "faded",
    label: "빛바램",
    tip: "출력 폭을 줄이고 감마를 살짝 올려 빛바랜 필름 톤을 냅니다.",
    params: normalizeLevels({ outBlack: 30, outWhite: 225, gamma: 1.1 }),
  },
  {
    id: "heavy-ink",
    label: "강한 잉크",
    tip: "입력 폭을 크게 좁혀 잉크가 진하게 번진 듯한 강한 대비를 만듭니다.",
    params: normalizeLevels({ blackPoint: 60, whitePoint: 200 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 konva.Filters.Levels로 부착.
// attrs는 외부 입력이므로 normalizeLevels로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 마스터 5개 레벨 값과
 * 채널 레벨(levelsR/levelsG/levelsB — 평탄 5칸)을 읽어 채널 합성 LUT로 적용한다.
 * 전부 항등이거나 attrs가 비면 no-op.
 */
export function levelsKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const params = normalizeLevels({
    blackPoint: attrNumber(attrs.levelsBlack),
    whitePoint: attrNumber(attrs.levelsWhite),
    gamma: attrNumber(attrs.levelsGamma),
    outBlack: attrNumber(attrs.levelsOutBlack),
    outWhite: attrNumber(attrs.levelsOutWhite),
  });
  const channels: LevelsRgbChannels = {};
  if (Array.isArray(attrs.levelsR)) channels.r = flatToLevels(attrs.levelsR);
  if (Array.isArray(attrs.levelsG)) channels.g = flatToLevels(attrs.levelsG);
  if (Array.isArray(attrs.levelsB)) channels.b = flatToLevels(attrs.levelsB);
  if (isIdentityLevels(params) && isIdentityLevelsChannels(channels)) return;
  applyLevelsChannels(imageData, params, channels);
}
