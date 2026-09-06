/**
 * Studio Ink Wash Material Engine
 *
 * 수묵화/번짐 종이 재질 효과. 기존 `studio-grain`의 단순 종이 노이즈나 `oilPaint`의
 * 이웃 평탄화와 달리, 원본의 어두운 톤을 안료 밀도로 바꾼 뒤 다음 순서로 합성한다.
 *
 *   1. 휘도가 낮은 픽셀에서 안료 밀도(pigment density)를 추출한다.
 *   2. 밀도를 분리형 박스 블러로 확산해 젖은 종이 위의 번짐 범위를 만든다.
 *   3. 확산된 안료가 밝은 이웃으로 넘어가는 부분에 edgeBleed를 더하고, 안쪽에는
 *      약한 농도 고임(pooling)을 더한다.
 *   4. edgeDarkening이 켜져 있으면 확산 밀도를 습윤 필드로 보고 안료를 마르는 쪽으로
 *      실제로 이송해 가장자리 링(wet edge)을 만든다.
 *   5. 종이 높이맵의 *골*에 안료가 더 남도록 정착시키고(granulation), 같은 높이맵으로
 *      종이 명암을 흔든 뒤 종이색과 먹색을 보간한다.
 *   6. 결과를 원본과 strength만큼 블렌드한다. 블렌드에는 원본 알파를 곱해 투명 경계의
 *      RGB 헤일로를 막고, 알파 채널 자체는 절대 변경하지 않는다.
 *
 * 4·5단계의 물리는 `studio-paper-texture`의 순수 CPU 참조 구현에 있다(Curtis et al. 1997
 * 얕은 물 모델의 edge darkening / granulation 항목). 이 파일은 그 커널을 래스터 필터
 * 파이프라인에 접합하기만 한다.
 *
 * 전체는 물리 유체 시뮬레이션이 아니며, 실시간 캔버스 필터에 적합한 O(width*height) 근사다.
 * Math.random/DOM/Konva에 의존하지 않아 같은 입력·설정·seed는 항상 같은 결과를 낸다.
 */

import { hexToRgb } from "../studio-filters";

import {
  DEFAULT_PAPER_GRAIN_KIND,
  accumulateEdgeDarkening,
  createPaperGranulationGain,
  createPaperHeightField,
  normalizePaperGrainKind,
  PAPER_REFERENCE_TILE,
  type PaperGrainKind,
  type PaperHeightField,
} from "./studio-paper-texture";

import type { StudioImageDataLike } from "../studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

/**
 * 수묵 번짐 재질 설정. 모든 퍼센트 값은 0..100 범위다.
 *
 * `paperKind`/`edgeDarkening`은 **선택 필드**로 두었다. 저장된 문서와 `STUDIO_LOOKS`의
 * inkWash 패치가 7키 객체로 이미 유통 중이라, 필수 키를 늘리면 그 값들이 normalize
 * round-trip에서 어긋난다. 키가 없으면 `DEFAULT_INK_WASH_PAPER_KIND` /
 * `DEFAULT_INK_WASH_EDGE_DARKENING`(=0, 항등)이 적용된다.
 */
export type InkWash = {
  strength: number; // 0..100, 0이면 항등
  spread: number; // 1..12 px, 안료 확산 반경
  edgeBleed: number; // 0..100, 밝은 이웃으로 스며드는 가장자리 안료
  granulation: number; // 0..100, 종이 골에 안료가 가라앉는 입자 침착
  paper: number; // 0..100, 따뜻한 종이색·요철 명암
  inkColor: string; // #rrggbb 안료색
  seed: number; // 0..9999 결정적 재질 시드
  paperKind?: PaperGrainKind; // 선택: 세목/중목/황목 종이 결
  edgeDarkening?: number; // 선택: 0..100, 마르며 가장자리로 몰리는 안료(0이면 항등)
};

/** 기본값은 항등(강도 0)이다. 나머지는 수묵화에 적당한 시작점으로 둔다. */
export const DEFAULT_INK_WASH: InkWash = {
  strength: 0,
  spread: 3,
  edgeBleed: 48,
  granulation: 38,
  paper: 46,
  inkColor: "#20282c",
  seed: 41,
};

/** `paperKind`가 없을 때 쓰는 종이 — 실물 수채 표준인 중목(cold-press). */
export const DEFAULT_INK_WASH_PAPER_KIND: PaperGrainKind = DEFAULT_PAPER_GRAIN_KIND;
/** `edgeDarkening`이 없을 때의 값. 0 = 기존 저장본과 픽셀 동일(항등). */
export const DEFAULT_INK_WASH_EDGE_DARKENING = 0;

export const INK_WASH_STRENGTH_RANGE = { min: 0, max: 100, step: 1 } as const;
export const INK_WASH_SPREAD_RANGE = { min: 1, max: 12, step: 1 } as const;
export const INK_WASH_EDGE_BLEED_RANGE = { min: 0, max: 100, step: 1 } as const;
export const INK_WASH_GRANULATION_RANGE = { min: 0, max: 100, step: 1 } as const;
export const INK_WASH_PAPER_RANGE = { min: 0, max: 100, step: 1 } as const;
export const INK_WASH_EDGE_DARKENING_RANGE = { min: 0, max: 100, step: 1 } as const;

const INK_WASH_SEED_MIN = 0;
const INK_WASH_SEED_MAX = 9999;
const HEX6_RE = /^#[0-9a-f]{6}$/i;
/** 종이 타일 한 변(px). seamless라 큰 캔버스에서 wrap 반복해도 이음선이 없다. */
const INK_WASH_PAPER_TILE = PAPER_REFERENCE_TILE;
/** 가장자리 어두워짐 건조 반복 횟수. 링 대비와 필터 비용의 절충점. */
const INK_WASH_EDGE_DARKENING_STEPS = 6;
/**
 * 습윤 프로파일 블러 반경 = spread * 이 배수(최대 24).
 *
 * 안료 확산용 `spread` 블러를 그대로 습윤 필드로 쓰면 워시 내부가 평평해져 그래디언트가
 * 0이 되고 링만 생긴 채 중심부가 밝아지지 않는다. 물웅덩이는 안료보다 훨씬 넓게 퍼지고
 * 접시처럼 완만하므로 더 넓은 블러가 실제 수막 두께에 가깝다. 반경보다 큰 워시의 중앙이
 * 여전히 평평한 것은 물리적으로 맞다 — 넓은 워시는 테두리만 진해진다.
 */
const INK_WASH_WET_PROFILE_SCALE = 3;
const INK_WASH_WET_PROFILE_MAX_RADIUS = 24;
/** 종이 요철 → 명암 진폭. (h-0.5)는 대략 ±0.35이므로 최대 ±8 정도로 흔든다. */
const INK_WASH_PAPER_SHADE_GAIN = 22;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

function normalizeInkColor(raw: unknown): string {
  return typeof raw === "string" && HEX6_RE.test(raw) ? raw.toLowerCase() : DEFAULT_INK_WASH.inkColor;
}

/**
 * 저장본·Konva attrs 등 외부 입력을 안전한 수묵 번짐 설정으로 정규화한다.
 * spread/seed는 픽셀 반경·해시 입력이라 내림해 정수화하고, 색은 #rrggbb만 받는다.
 *
 * 선택 필드(`paperKind`/`edgeDarkening`)는 **입력에 있을 때만** 출력에 넣는다.
 * 없는 키를 채워 넣으면 7키로 저장된 기존 문서·룩 패치가 `value === normalize(value)`
 * round-trip을 잃기 때문이다(적용 시점 기본값은 `applyInkWash`가 해석한다).
 */
export function normalizeInkWash(effect?: Partial<InkWash> | null): InkWash {
  const src = effect && typeof effect === "object" ? effect : {};
  const optional: Partial<InkWash> = {};
  if (src.paperKind !== undefined) optional.paperKind = normalizePaperGrainKind(src.paperKind);
  if (src.edgeDarkening !== undefined) {
    optional.edgeDarkening = clampTo(
      src.edgeDarkening,
      INK_WASH_EDGE_DARKENING_RANGE.min,
      INK_WASH_EDGE_DARKENING_RANGE.max,
      DEFAULT_INK_WASH_EDGE_DARKENING,
    );
  }
  return {
    ...optional,
    strength: clampTo(src.strength, INK_WASH_STRENGTH_RANGE.min, INK_WASH_STRENGTH_RANGE.max, DEFAULT_INK_WASH.strength),
    spread: Math.floor(clampTo(src.spread, INK_WASH_SPREAD_RANGE.min, INK_WASH_SPREAD_RANGE.max, DEFAULT_INK_WASH.spread)),
    edgeBleed: clampTo(
      src.edgeBleed,
      INK_WASH_EDGE_BLEED_RANGE.min,
      INK_WASH_EDGE_BLEED_RANGE.max,
      DEFAULT_INK_WASH.edgeBleed,
    ),
    granulation: clampTo(
      src.granulation,
      INK_WASH_GRANULATION_RANGE.min,
      INK_WASH_GRANULATION_RANGE.max,
      DEFAULT_INK_WASH.granulation,
    ),
    paper: clampTo(src.paper, INK_WASH_PAPER_RANGE.min, INK_WASH_PAPER_RANGE.max, DEFAULT_INK_WASH.paper),
    inkColor: normalizeInkColor(src.inkColor),
    seed: Math.floor(clampTo(src.seed, INK_WASH_SEED_MIN, INK_WASH_SEED_MAX, DEFAULT_INK_WASH.seed)),
  };
}

/** strength가 유한 양수가 아니면 픽셀을 건드리지 않는 항등 설정이다. */
export function isIdentityInkWash(effect: Pick<InkWash, "strength">): boolean {
  return !Number.isFinite(effect.strength) || effect.strength <= 0;
}

// ---------------------------------------------------------------------------
// 종이 결 타일 — seamless 절차 높이맵을 wrap 반복해 쓴다(캔버스 크기와 무관하게 O(타일)).
// ---------------------------------------------------------------------------

/**
 * (종류, seed)가 같으면 높이맵도 같으므로 작은 FIFO 캐시로 재생성을 피한다.
 * 캐시는 읽기 전용으로만 소비되고(가중치는 매번 새 버퍼), 관측 가능한 동작을 바꾸지 않는다.
 */
const PAPER_TILE_CACHE_LIMIT = 8;
const paperTileCache = new Map<string, PaperHeightField>();

function paperTile(kind: PaperGrainKind, seed: number): PaperHeightField {
  const key = `${kind}:${seed}`;
  const cached = paperTileCache.get(key);
  if (cached) return cached;
  const field = createPaperHeightField({
    kind,
    width: INK_WASH_PAPER_TILE,
    height: INK_WASH_PAPER_TILE,
    seed,
  });
  if (paperTileCache.size >= PAPER_TILE_CACHE_LIMIT) {
    const oldest = paperTileCache.keys().next();
    if (!oldest.done) paperTileCache.delete(oldest.value);
  }
  paperTileCache.set(key, field);
  return field;
}

/** 픽셀 좌표를 종이 타일 인덱스로 wrap 한다. 타일이 seamless라 반복 이음선이 없다. */
function paperTileIndex(x: number, y: number): number {
  return (y % INK_WASH_PAPER_TILE) * INK_WASH_PAPER_TILE + (x % INK_WASH_PAPER_TILE);
}

// ---------------------------------------------------------------------------
// 안료 확산 — scalar 분리형 박스 블러. r가 커져도 O(width*height)다.
// ---------------------------------------------------------------------------

function boxBlurScalar(source: Uint8Array, width: number, height: number, radius: number): Float32Array {
  const count = width * height;
  const temporary = new Float32Array(count);
  const output = new Float32Array(count);
  const window = radius * 2 + 1;
  const invWindow = 1 / window;

  // 가로 패스. 가장자리는 가장 가까운 픽셀로 clamp해 작은 이미지도 안전하다.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const sx = k < 0 ? 0 : k >= width ? width - 1 : k;
      sum += source[row + sx]!;
    }
    temporary[row] = sum * invWindow;
    for (let x = 1; x < width; x++) {
      const addX = x + radius >= width ? width - 1 : x + radius;
      const subtractX = x - radius - 1 < 0 ? 0 : x - radius - 1;
      sum += source[row + addX]! - source[row + subtractX]!;
      temporary[row + x] = sum * invWindow;
    }
  }

  // 세로 패스.
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const sy = k < 0 ? 0 : k >= height ? height - 1 : k;
      sum += temporary[sy * width + x]!;
    }
    output[x] = sum * invWindow;
    for (let y = 1; y < height; y++) {
      const addY = y + radius >= height ? height - 1 : y + radius;
      const subtractY = y - radius - 1 < 0 ? 0 : y - radius - 1;
      sum += temporary[addY * width + x]! - temporary[subtractY * width + x]!;
      output[y * width + x] = sum * invWindow;
    }
  }

  return output;
}

function clampUnit(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function clampByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : value;
}

function sourcePigment(data: Uint8ClampedArray, offset: number): number {
  const luma = 0.299 * data[offset]! + 0.587 * data[offset + 1]! + 0.114 * data[offset + 2]!;
  // 반투명 원본은 번짐 원료도 비례해 약해진다. RGB가 남아 있는 완전 투명 픽셀은 0이다.
  return (1 - luma / 255) * (data[offset + 3]! / 255);
}

function isUsableRaster(img: StudioImageDataLike): boolean {
  if (!Number.isSafeInteger(img.width) || !Number.isSafeInteger(img.height) || img.width <= 0 || img.height <= 0) {
    return false;
  }
  const pixels = img.width * img.height;
  return Number.isSafeInteger(pixels) && pixels <= Math.floor(img.data.length / 4);
}

// ---------------------------------------------------------------------------
// 적용 — 안료 밀도 → 확산/edge bleed → 종이/안료 합성
// ---------------------------------------------------------------------------

/** 확산 밀도와 원본 밀도를 합쳐 edgeBleed 이후의 안료량을 낸다. */
function resolveBleedPigment(original: number, diffused: number, bleedStrength: number): number {
  // 밖으로 번진 안료가 핵심이고, 안쪽 농도 고임은 약하게 보조한다.
  const outwardBleed = Math.max(0, diffused - original);
  const innerPooling = Math.max(0, original - diffused);
  return clampUnit(original + bleedStrength * (outwardBleed * 0.92 + innerPooling * 0.18));
}

/**
 * 수묵 번짐을 제자리 적용한다. 입력 알파는 완전히 보존한다.
 *
 * edgeBleed와 edgeDarkening이 모두 0이면 비싼 확산 버퍼를 만들지 않아 단순 먹/종이
 * 재질 변환만 수행한다. spread가 큰 경우도 슬라이딩 윈도 박스 블러 두 패스만 쓰므로
 * 반경에 비례해 느려지지 않는다.
 *
 * edgeDarkening은 확산 밀도를 습윤 필드로 삼아 안료를 실제로 이송하는 추가 패스라
 * (기본 6회 반복) 켜면 비용이 눈에 띄게 늘어난다. 기본값 0으로 옵트인이다.
 */
export function applyInkWash(img: StudioImageDataLike, input: InkWash): void {
  const effect = normalizeInkWash(input);
  if (isIdentityInkWash(effect) || !isUsableRaster(img)) return;

  const { data, width, height } = img;
  const count = width * height;
  const bleedStrength = effect.edgeBleed / 100;
  const paperStrength = effect.paper / 100;
  const granulationStrength = effect.granulation / 100;
  const edgeDarkeningStrength = (effect.edgeDarkening ?? DEFAULT_INK_WASH_EDGE_DARKENING) / 100;
  const applyStrength = effect.strength / 100;
  const ink = hexToRgb(effect.inkColor);

  // 확산 버퍼는 edgeBleed 또는 edgeDarkening이 필요로 할 때만 잡는다.
  let sourceDensity: Uint8Array | null = null;
  let diffusedDensity: Float32Array | null = null;
  if (bleedStrength > 0 || edgeDarkeningStrength > 0) {
    sourceDensity = new Uint8Array(count);
    for (let pixel = 0; pixel < count; pixel++) {
      sourceDensity[pixel] = Math.round(sourcePigment(data, pixel * 4) * 255);
    }
    diffusedDensity = boxBlurScalar(sourceDensity, width, height, effect.spread);
  }

  // 가장자리 어두워짐: 넓게 퍼진 습윤 프로파일을 만들고, 안료를 마르는 쪽으로 이송한다.
  let movedPigment: Float32Array | null = null;
  if (edgeDarkeningStrength > 0 && sourceDensity && diffusedDensity) {
    const wetRadius = Math.min(INK_WASH_WET_PROFILE_MAX_RADIUS, Math.max(1, effect.spread * INK_WASH_WET_PROFILE_SCALE));
    const wetProfile = boxBlurScalar(sourceDensity, width, height, wetRadius);
    let wetPeak = 0;
    for (let pixel = 0; pixel < count; pixel++) {
      if (wetProfile[pixel]! > wetPeak) wetPeak = wetProfile[pixel]!;
    }
    const pigmentField = new Float32Array(count);
    const wetField = new Float32Array(count);
    const wetScale = wetPeak > 0 ? 1 / wetPeak : 0;
    for (let pixel = 0; pixel < count; pixel++) {
      pigmentField[pixel] = resolveBleedPigment(
        sourceDensity[pixel]! / 255,
        diffusedDensity[pixel]! / 255,
        bleedStrength,
      );
      // 최고점을 1로 맞춰 옅은 워시도 짙은 워시와 같은 건조 곡선을 타게 한다.
      wetField[pixel] = clampUnit(wetProfile[pixel]! * wetScale);
    }
    movedPigment = accumulateEdgeDarkening(
      { pigment: pigmentField, wetness: wetField, width, height },
      { strength: edgeDarkeningStrength, steps: INK_WASH_EDGE_DARKENING_STEPS },
    );
  }

  // 종이 요철 높이맵 하나가 종이 명암과 안료 침착을 동시에 만든다(같은 종이니 같은 결).
  const needsPaperTile = paperStrength > 0 || granulationStrength > 0;
  const paper = needsPaperTile ? paperTile(effect.paperKind ?? DEFAULT_INK_WASH_PAPER_KIND, effect.seed) : null;
  const granulationGain
    = paper && granulationStrength > 0 ? createPaperGranulationGain(paper, { strength: granulationStrength }) : null;

  // 종이를 100%로 올려도 과도하게 노랗지 않게, 따뜻한 미색으로만 살짝 이동시킨다.
  const paperBaseR = 255 - 12 * paperStrength;
  const paperBaseG = 255 - 15 * paperStrength;
  const paperBaseB = 255 - 27 * paperStrength;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const tileIndex = paper ? paperTileIndex(x, y) : 0;
      let pigment: number;
      if (movedPigment) {
        pigment = clampUnit(movedPigment[pixel]!);
      } else if (sourceDensity && diffusedDensity) {
        pigment = resolveBleedPigment(sourceDensity[pixel]! / 255, diffusedDensity[pixel]! / 255, bleedStrength);
      } else {
        pigment = sourcePigment(data, offset);
      }

      if (granulationGain) {
        // 골(낮은 높이)일수록 gain이 커져 안료가 몰린다. 안료가 없는 흰 종이는 그대로다.
        pigment = clampUnit(pigment * (1 + granulationGain[tileIndex]!));
      }

      let paperShift = 0;
      if (paper && paperStrength > 0) {
        paperShift = (paper.values[tileIndex]! - 0.5) * paperStrength * INK_WASH_PAPER_SHADE_GAIN;
      }

      const paperR = clampByte(paperBaseR + paperShift * 0.86);
      const paperG = clampByte(paperBaseG + paperShift * 0.92);
      const paperB = clampByte(paperBaseB + paperShift * 1.08);
      const targetR = paperR + (ink.r - paperR) * pigment;
      const targetG = paperG + (ink.g - paperG) * pigment;
      const targetB = paperB + (ink.b - paperB) * pigment;

      // 알파는 읽기만 하고 절대 기록하지 않는다. 반투명 RGB의 과도한 종이색 헤일로도 막는다.
      const blend = applyStrength * (data[offset + 3]! / 255);
      data[offset] = data[offset]! + (targetR - data[offset]!) * blend;
      data[offset + 1] = data[offset + 1]! + (targetG - data[offset + 1]!) * blend;
      data[offset + 2] = data[offset + 2]! + (targetB - data[offset + 2]!) * blend;
    }
  }
}

// ---------------------------------------------------------------------------
// 웹툰 재질 프리셋
// ---------------------------------------------------------------------------

export type InkWashPreset = { id: string; label: string; tip: string; value: InkWash };

/**
 * 프리셋은 의도적으로 7키만 싣는다. `paperKind`/`edgeDarkening`을 넣어도
 * `studio-konva-filters.ts`의 attr 브리지가 아직 그 둘을 전달하지 않아 Konva 렌더에서
 * 조용히 사라진다. 브리지가 확장된 뒤 값을 채우는 것이 맞다.
 * granulation은 브리지를 그대로 타므로, 종이 골 침착 물리 교체는 즉시 프리셋에 반영된다.
 */
export const INK_WASH_PRESETS: InkWashPreset[] = [
  {
    id: "none",
    label: "없음",
    tip: "수묵 번짐을 적용하지 않는 원본.",
    value: normalizeInkWash(DEFAULT_INK_WASH),
  },
  {
    id: "sumi-e",
    label: "수묵화",
    tip: "검푸른 먹과 한지 결, 가장자리의 은은한 번짐을 더합니다.",
    value: normalizeInkWash({ strength: 86, spread: 3, edgeBleed: 56, granulation: 46, paper: 62, inkColor: "#20282c", seed: 41 }),
  },
  {
    id: "indigo-wash",
    label: "청묵",
    tip: "푸른 안료가 종이에 스며든 듯한 차분한 청묵 수채 질감.",
    value: normalizeInkWash({ strength: 78, spread: 4, edgeBleed: 65, granulation: 54, paper: 48, inkColor: "#264c70", seed: 112 }),
  },
  {
    id: "antique-sepia",
    label: "고서 세피아",
    tip: "갈색 잉크와 누런 종이결로 오래된 삽화·고서 무드를 만듭니다.",
    value: normalizeInkWash({ strength: 80, spread: 2, edgeBleed: 42, granulation: 35, paper: 80, inkColor: "#65432d", seed: 217 }),
  },
  {
    id: "vermilion-seal",
    label: "주인",
    tip: "진한 주홍 안료가 번진 도장·강조 컷 느낌을 만듭니다.",
    value: normalizeInkWash({ strength: 90, spread: 2, edgeBleed: 35, granulation: 60, paper: 32, inkColor: "#9c3f36", seed: 703 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 얇은 어댑터 — 핵심 효과 함수는 위의 순수 applyInkWash다.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva node attrs에서 `inkWash*` 값을 읽는 어댑터. attrs가 없거나 strength가 0이면 no-op다.
 * 이 함수도 DOM/Konva 런타임을 import하지 않아 Vitest에서 일반 객체로 호출할 수 있다.
 *
 * 접합 주의: `inkWashPaperKind`/`inkWashEdgeDarkening`는 여기서 읽지만, 현재
 * `studio-konva-filters.ts`의 attr 브리지가 7개 값만 복사하므로 Konva 경로로는 아직
 * 도달하지 않는다(그래서 `INK_WASH_PRESETS`도 두 값을 싣지 않는다 — 조용한 손실 방지).
 * 브리지에 두 줄이 추가되면 별도 변경 없이 바로 살아난다.
 */
export function inkWashKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  applyInkWash(
    imageData,
    normalizeInkWash({
      strength: attrNumber(attrs.inkWashStrength),
      spread: attrNumber(attrs.inkWashSpread),
      edgeBleed: attrNumber(attrs.inkWashEdgeBleed),
      granulation: attrNumber(attrs.inkWashGranulation),
      paper: attrNumber(attrs.inkWashPaper),
      inkColor: typeof attrs.inkWashColor === "string" ? attrs.inkWashColor : undefined,
      seed: attrNumber(attrs.inkWashSeed),
      paperKind: typeof attrs.inkWashPaperKind === "string" ? normalizePaperGrainKind(attrs.inkWashPaperKind) : undefined,
      edgeDarkening: attrNumber(attrs.inkWashEdgeDarkening),
    }),
  );
}
