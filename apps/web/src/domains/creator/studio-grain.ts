/**
 * Studio Grain / Texture Engine
 * 포토샵 "필름 그레인(Grain)/텍스처(Texture)" 오버레이 —
 *   film:       픽셀별 결정적 노이즈를 휘도에 가산해 거친 필름 입자를 입힌다.
 *               chroma>0이면 채널별 독립 시드 노이즈를 비율 혼합해 컬러 입자를 낸다.
 *   paper:      큰 블록의 저주파 얼룩(약한 대비)을 곱해 종이결을 흉내 낸다.
 *   scanline:   가로 주사선을 번갈아 어둡게 눌러 CRT/모니터 라인을 낸다.
 *   halftoneDot: 격자 점 패턴을 약하게 곱해 인쇄 도트 질감을 더한다.
 * 노이즈는 전부 픽셀 좌표(x,y)+seed의 결정적 해시(hash2)로 만든다 — Math.random 없음.
 * 같은 입력은 항상 같은 출력이라 재현·테스트 가능하다(알파 보존).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type GrainType = "film" | "paper" | "scanline" | "halftoneDot";

export type Grain = {
  type: GrainType; // 질감 종류(필름/종이/주사선/도트)
  amount: number; // 0..100 세기(0이면 항등)
  size: number; // 1..8 거칠기/주기(클수록 굵은 입자·넓은 주기)
  seed: number; // 0..9999 결정적 노이즈 시드(같은 시드=같은 노이즈)
  /**
   * 0..100 크로마(색) 노이즈 비율 — film 전용. 0/누락이면 기존 휘도 단일 노이즈와
   * 바이트 동일(항등 보존). >0이면 채널별 독립 시드(seed + ch·37)의 종형 노이즈를
   * 휘도 노이즈와 비율 혼합해 컬러 필름 입자를 낸다(여전히 결정적).
   */
  chroma?: number;
};

/** 항등(효과 없음) — amount 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_GRAIN: Grain = { type: "film", amount: 0, size: 1, seed: 1 };

/** 세기 슬라이더 한 칸 범위 — 0..100, 1 단위. */
export const GRAIN_AMOUNT_RANGE = { min: 0, max: 100, step: 1 } as const;
/** 거칠기/주기 슬라이더 한 칸 범위 — 1..8, 1 단위. */
export const GRAIN_SIZE_RANGE = { min: 1, max: 8, step: 1 } as const;
/** 크로마(색 노이즈) 슬라이더 한 칸 범위 — 0..100, 1 단위(film 전용, 0=기존 휘도 노이즈). */
export const GRAIN_CHROMA_RANGE = { min: 0, max: 100, step: 1 } as const;

// seed 허용 범위(슬라이더 노출은 안 하지만 normalize·검증에 사용).
const GRAIN_SEED_MIN = 0;
const GRAIN_SEED_MAX = 9999;

/** 질감 종류 선택지 — UI 라디오/세그먼트용 라벨. */
export const GRAIN_TYPES: { id: GrainType; label: string }[] = [
  { id: "film", label: "필름" },
  { id: "paper", label: "종이" },
  { id: "scanline", label: "주사선" },
  { id: "halftoneDot", label: "도트" },
];

// 유효 GrainType 집합(외부 입력 검증용).
const GRAIN_TYPE_SET = new Set<GrainType>(GRAIN_TYPES.map((t) => t.id));

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님은 fallback. seed는 정수로 내림.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// type은 유효 GrainType만 인정, 그 외(누락/오타/숫자)는 기본값.
function normalizeType(raw: unknown): GrainType {
  return typeof raw === "string" && GRAIN_TYPE_SET.has(raw as GrainType) ? (raw as GrainType) : DEFAULT_GRAIN.type;
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖은 각 범위로 클램프. type은 유효 GrainType(아니면 기본 "film"),
 * seed는 0..9999 정수로 내림(소수 시드도 안정적으로 양자화).
 * chroma는 0..100 클램프하되 0(항등)이면 키 자체를 생략한다 — 과거 저장본과
 * 캐시 키(JSON 직렬화)가 바이트 동일하게 유지된다(의도적 변경 2026-07-24).
 */
export function normalizeGrain(g?: Partial<Grain> | null): Grain {
  const src = g && typeof g === "object" ? g : {};
  const chroma = clampTo(src.chroma, GRAIN_CHROMA_RANGE.min, GRAIN_CHROMA_RANGE.max, 0);
  return {
    type: normalizeType(src.type),
    amount: clampTo(src.amount, GRAIN_AMOUNT_RANGE.min, GRAIN_AMOUNT_RANGE.max, DEFAULT_GRAIN.amount),
    size: clampTo(src.size, GRAIN_SIZE_RANGE.min, GRAIN_SIZE_RANGE.max, DEFAULT_GRAIN.size),
    seed: Math.floor(clampTo(src.seed, GRAIN_SEED_MIN, GRAIN_SEED_MAX, DEFAULT_GRAIN.seed)),
    ...(chroma > 0 ? { chroma } : {}),
  };
}

/** amount가 0 이하 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityGrain(g: Grain): boolean {
  return g.amount <= 0;
}

// ---------------------------------------------------------------------------
// 결정적 해시 — 픽셀 좌표(x,y)+seed → 0..1 의사난수(Math.random 대체)
// ---------------------------------------------------------------------------

/**
 * 좌표·시드 결정적 해시 — 정수 비트 믹싱(xorshift류)으로 0..1 사이 값을 만든다.
 * 같은 (x,y,seed)는 항상 같은 값을 반환하므로 그레인 노이즈가 재현·테스트 가능하다.
 * x,y,seed는 내부에서 정수로 내림되며(>>>0로 32비트 부호 없는 처리), Math.random을 쓰지 않는다.
 */
export function hash2(x: number, y: number, seed: number): number {
  // 입력을 32비트 부호 없는 정수로 고정(소수·음수도 안정적으로 흡수).
  let h = (Math.floor(x) | 0) >>> 0;
  h = (h * 374761393 + (Math.floor(y) | 0) * 668265263) >>> 0; // 좌표 결합
  h = (h ^ ((Math.floor(seed) | 0) * 2246822519)) >>> 0; // 시드 섞기
  // 비트 확산(finalizer) — 인접 좌표끼리도 값이 충분히 흩어지게 한다.
  h ^= h >>> 13;
  h = (h * 1274126177) >>> 0;
  h ^= h >>> 16;
  // 0..1 정규화(2^32로 나눔).
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// 적용 — 종류별 질감 오버레이(제자리 변형, Uint8ClampedArray가 0..255 클램프)
// ---------------------------------------------------------------------------

/**
 * 그레인/텍스처 제자리 적용 — 항등(amount 0)이면 no-op. 종류별로 분기한다.
 *
 *   film:       각 픽셀에 종형(해시 3합 Irwin-Hall) 휘도 노이즈를 톤 반응 가중과 함께 r/g/b에 가산.
 *               size로 노이즈 블록 크기를 키워(좌표를 size로 양자화) 굵은 입자를 낸다.
 *   paper:      size*8 크기의 큰 블록마다 결정적 얼룩값을 뽑아 약한 대비(±)로 곱한다.
 *               저주파라 넓게 번지는 종이결처럼 보인다.
 *   scanline:   y % (2*size) < size 인 행을 amount 비례로 어둡게 눌러 주사선을 낸다.
 *   halftoneDot: size 간격 격자에서 셀 중심에 가까운 점은 어둡게(amount 비례) 곱한다.
 *
 * 모든 종류가 r/g/b만 변형하고 알파(+3)는 보존한다. 같은 입력=같은 출력(결정적).
 */
export function applyGrain(img: StudioImageDataLike, g: Grain): void {
  if (isIdentityGrain(g)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  switch (g.type) {
    case "film":
      applyFilm(data, width, height, g);
      break;
    case "paper":
      applyPaper(data, width, height, g);
      break;
    case "scanline":
      applyScanline(data, width, height, g);
      break;
    case "halftoneDot":
      applyHalftoneDot(data, width, height, g);
      break;
  }
}

// 필름 그레인 분포 정규화 — Irwin-Hall(합성 3회) 종형 노이즈의 표준편차를
// 기존 균등 분포와 동일(0.289·span)하게 맞추는 계수: std(IH3 중심) = 0.5 → 0.577배.
const FILM_BELL_SCALE = 0.577;
// 필름 그레인 톤 반응 바닥 — 섀도/하이라이트에서도 이 비율만큼은 입자가 남는다.
const FILM_TONE_FLOOR = 0.35;
// 크로마 채널 시드 간격 — 채널 ch(r=1, g=2, b=3)마다 seed + ch·37의 독립 노이즈 필드.
// 휘도 필드(seed, +101, +211)와 세 채널 필드(+37/+74/+111 및 각각의 +101/+211)가
// 어떤 시드 오프셋도 겹치지 않아 네 필드가 서로 독립이다.
const FILM_CHROMA_SEED_STRIDE = 37;

/**
 * 필름 그레인 — 픽셀(또는 size 블록)별 결정적 노이즈를 휘도에 가산.
 * 분포: 독립 해시 3개 합(Irwin-Hall) — 균등 분포 대신 종형(가우시안 근사) 입자라
 *   실제 필름처럼 잔입자가 많고 튀는 입자는 드물다(표준편차는 기존 균등과 동일하게 정규화).
 * 톤 반응: 실제 필름 입자는 중간톤에서 가장 굵게 보인다 — 픽셀 휘도의 midWeight
 *   (0.35 + 0.65·(1-|2L/255-1|))를 곱해 순흑/순백에서 입자가 과하게 끼지 않는다.
 * 크로마(chroma>0): 채널별 독립 시드(seed + ch·FILM_CHROMA_SEED_STRIDE)의 종형 노이즈를
 *   휘도 노이즈와 (1-m)·luma + m·ch 비율로 혼합해 컬러 입자를 낸다. chroma 0/누락이면
 *   기존 휘도 단일 경로를 그대로 타서 바이트 동일(항등 보존, 의도적 변경 2026-07-24).
 * 같은 (블록,seed,chroma)는 항상 같은 노이즈(결정적, Math.random 없음).
 */
function applyFilm(data: Uint8ClampedArray, width: number, height: number, g: Grain): void {
  const span = g.amount * 2.55; // 0..255 진폭(amount 비례)
  const block = g.size; // 노이즈 블록 크기(size가 클수록 굵은 입자)
  // 크로마 혼합 비율 0..1 — normalize를 안 거친 직접 호출도 안전하게 클램프.
  const rawChroma = typeof g.chroma === "number" && Number.isFinite(g.chroma) ? g.chroma : 0;
  const mix = Math.min(100, Math.max(0, rawChroma)) / 100;
  for (let y = 0; y < height; y++) {
    const by = Math.floor(y / block); // 블록 좌표로 양자화
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / block);
      // 종형(가우시안 근사) 중심 노이즈 — 해시 3개 합 - 1.5 ∈ [-1.5, 1.5], 종 모양 밀도.
      const bell = hash2(bx, by, g.seed) + hash2(bx, by, g.seed + 101) + hash2(bx, by, g.seed + 211) - 1.5;
      const noise = bell * span * FILM_BELL_SCALE;
      const i = (y * width + x) * 4;
      // 필름 톤 반응 — 중간톤에서 최대, 순흑/순백으로 갈수록 바닥(FILM_TONE_FLOOR)까지 감쇠.
      const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      const tone = FILM_TONE_FLOOR + (1 - FILM_TONE_FLOOR) * (1 - Math.abs((2 * lum) / 255 - 1));
      if (mix <= 0) {
        // 기존 휘도 단일 경로 — chroma 0/누락 문서는 이 분기라 결과가 바이트 동일하다.
        const n = noise * tone;
        data[i] = data[i]! + n;
        data[i + 1] = data[i + 1]! + n;
        data[i + 2] = data[i + 2]! + n;
        continue;
      }
      // 채널 분리 경로 — r/g/b 각각 독립 시드의 종형 노이즈를 휘도 노이즈와 비율 혼합.
      for (let ch = 0; ch < 3; ch++) {
        const chSeed = g.seed + (ch + 1) * FILM_CHROMA_SEED_STRIDE;
        const chBell = hash2(bx, by, chSeed) + hash2(bx, by, chSeed + 101) + hash2(bx, by, chSeed + 211) - 1.5;
        const n = ((1 - mix) * bell + mix * chBell) * span * FILM_BELL_SCALE * tone;
        data[i + ch] = data[i + ch]! + n;
      }
    }
  }
}

/**
 * 종이결 — size*8 크기의 큰 블록마다 결정적 얼룩값을 뽑아 약한 대비로 곱한다.
 * factor = 1 + (hash2-0.5)*2*strength, strength = amount/100*0.25(최대 ±25%).
 * 저주파(큰 블록)라 넓게 번지는 종이 질감처럼 보인다.
 */
function applyPaper(data: Uint8ClampedArray, width: number, height: number, g: Grain): void {
  const blob = g.size * 8; // 저주파 얼룩 블록 크기
  const strength = (g.amount / 100) * 0.25; // 최대 ±25% 대비
  for (let y = 0; y < height; y++) {
    const by = Math.floor(y / blob);
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / blob);
      const factor = 1 + (hash2(bx, by, g.seed) - 0.5) * 2 * strength;
      const i = (y * width + x) * 4;
      data[i] = data[i]! * factor;
      data[i + 1] = data[i + 1]! * factor;
      data[i + 2] = data[i + 2]! * factor;
    }
  }
}

/**
 * 주사선 — y % (2*size) < size 인 행을 amount 비례로 어둡게 누른다.
 * factor = 1 - amount/100*0.6 (amount=100에서 어두운 행이 0.4배). CRT/모니터 라인.
 */
function applyScanline(data: Uint8ClampedArray, width: number, height: number, g: Grain): void {
  const period = 2 * g.size; // 한 주기(어두운 줄 + 밝은 줄)
  const darkFactor = 1 - (g.amount / 100) * 0.6; // 어두운 행 배율
  for (let y = 0; y < height; y++) {
    // 주기 전반부(< size)만 어둡게.
    if (y % period >= g.size) continue;
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = row + x * 4;
      data[i] = data[i]! * darkFactor;
      data[i + 1] = data[i + 1]! * darkFactor;
      data[i + 2] = data[i + 2]! * darkFactor;
    }
  }
}

/**
 * 인쇄 도트 — size 간격 격자에서 셀 중심에 가까운 점은 어둡게 곱한다.
 * 셀 중심 반경(반 셀)보다 가까우면 factor = 1 - amount/100*0.5, 아니면 1(원본).
 * 약한 격자 점 패턴으로 망점 인쇄 질감을 흉내 낸다.
 */
function applyHalftoneDot(data: Uint8ClampedArray, width: number, height: number, g: Grain): void {
  const cell = g.size + 1; // 점 간격(size 1=2px 간격, 너무 촘촘하지 않게 +1)
  const half = cell / 2;
  const dotFactor = 1 - (g.amount / 100) * 0.5; // 점 위치 배율
  // 점 반경²(셀 중심 부근만 어둡게). 반 셀의 60% 이내.
  const radius = half * 0.6;
  const radiusSq = radius * radius;
  for (let y = 0; y < height; y++) {
    // 셀 내부 세로 거리(중심 기준).
    const dy = (y % cell) - half + 0.5;
    for (let x = 0; x < width; x++) {
      const dx = (x % cell) - half + 0.5;
      // 셀 중심에서 먼 픽셀은 원본 유지.
      if (dx * dx + dy * dy > radiusSq) continue;
      const i = (y * width + x) * 4;
      data[i] = data[i]! * dotFactor;
      data[i + 1] = data[i + 1]! * dotFactor;
      data[i + 2] = data[i + 2]! * dotFactor;
    }
  }
}

// ---------------------------------------------------------------------------
// 웹툰 질감 프리셋 — 첫 항목 없음(빈 프리셋 없이 바로 효과). 자주 쓰는 그레인 조합.
// 모든 value는 normalizeGrain을 통과(amount 0..100, size 1..8, seed 0..9999, type 유효).
// ---------------------------------------------------------------------------

export type GrainPreset = { id: string; label: string; tip: string; value: Grain };

export const GRAIN_PRESETS: GrainPreset[] = [
  {
    id: "film-grain",
    label: "필름 그레인",
    tip: "고운 필름 입자를 더해 아날로그 질감을 입힙니다.",
    value: normalizeGrain({ type: "film", amount: 30, size: 1, seed: 7 }),
  },
  {
    id: "film-rough",
    label: "거친 필름",
    tip: "굵고 강한 입자로 거친 고감도 필름 느낌을 냅니다.",
    value: normalizeGrain({ type: "film", amount: 60, size: 3, seed: 11 }),
  },
  {
    id: "old-paper",
    label: "오래된 종이",
    tip: "은은한 얼룩으로 낡은 종이결 위에 인쇄한 듯한 질감을 더합니다.",
    value: normalizeGrain({ type: "paper", amount: 40, size: 4, seed: 23 }),
  },
  {
    id: "crt",
    label: "CRT",
    tip: "가로 주사선을 넣어 브라운관 모니터 화면을 흉내 냅니다.",
    value: normalizeGrain({ type: "scanline", amount: 50, size: 2, seed: 1 }),
  },
  {
    id: "vintage-dot",
    label: "빈티지 도트",
    tip: "약한 망점 격자로 빈티지 인쇄물의 도트 질감을 냅니다.",
    value: normalizeGrain({ type: "halftoneDot", amount: 35, size: 3, seed: 5 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeGrain으로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 grainType(string)과
 * grainAmount·grainSize·grainSeed·grainChroma(각 number)를 읽어
 * normalizeGrain으로 안전 변환 후 applyGrain. 항등(amount 0)이거나 attrs가 비면 no-op.
 */
export function grainKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const g = normalizeGrain({
    type: typeof attrs.grainType === "string" ? (attrs.grainType as GrainType) : undefined,
    amount: attrNumber(attrs.grainAmount),
    size: attrNumber(attrs.grainSize),
    seed: attrNumber(attrs.grainSeed),
    chroma: attrNumber(attrs.grainChroma),
  });
  if (isIdentityGrain(g)) return;
  applyGrain(imageData, g);
}
