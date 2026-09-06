/**
 * Studio High-Bit — 최종 8비트 양자화 디더링.
 *
 * 고비트로 합성해도 화면·PNG 출력은 결국 8비트다. 완만한 그라데이션(하늘, 볼터치, 에어브러시
 * 번짐)에서 순수 반올림은 **같은 값이 수십 px 이어지는 평탄역 + 딱 떨어지는 계단**을 만든다.
 * 이것이 밴딩이다. 양자화 직전에 1 LSB 미만의 결정적 잡음을 더하면 계단 경계가 픽셀 단위로
 * 흩어져, 국소 평균이 참값을 따라간다(= 눈에는 연속으로 보인다). 정보량은 늘지 않지만 오차의
 * **공간 분포**가 바뀐다.
 *
 * 모드:
 *   - `"ordered"`   : Bayer 8×8 정렬 디더. 가장 싸고 완전 결정적. 규칙적 격자 패턴이 보인다.
 *   - `"blue-noise"`: R2 저불일치(low-discrepancy) 수열 기반. 격자 패턴 없이 고주파에 치우친
 *                     분포 — 정지 화면에서 가장 자연스럽다. 좌표 함수라 메모리 0, O(1).
 *   - `"triangular"`: TPDF 해시 잡음(±1 LSB). 오차와 신호의 상관을 완전히 끊는다(오디오 디더
 *                     표준). 가장 매끄럽지만 잡음이 약간 더 눈에 띈다.
 *
 * 결정성 계약: 모든 모드는 (seed, x, y, channel) 의 순수 함수다. `Math.random` 금지 —
 * 같은 문서를 다시 내보내면 바이트가 동일해야 한다(협업 CRDT·리플레이·회귀 스냅샷 전제).
 */

import { clampStudioHighBitUnit } from "./studio-highbit-transfer";

import type { StudioHighBitQuantizer } from "./studio-highbit-buffer";

export type StudioHighBitDitherMode = "none" | "ordered" | "blue-noise" | "triangular";

export const STUDIO_HIGHBIT_DITHER_MODES: readonly StudioHighBitDitherMode[] = Object.freeze([
  "none",
  "ordered",
  "blue-noise",
  "triangular",
]);

export const STUDIO_HIGHBIT_BAYER_EDGE = 8;

/** Bayer 8×8 (0..63). 재귀 정의 M2n = [[4M, 4M+2], [4M+3, 4M+1]] 로 생성한다. */
export const STUDIO_HIGHBIT_BAYER_8: Uint8Array = (() => {
  let matrix = [0];
  let edge = 1;
  while (edge < STUDIO_HIGHBIT_BAYER_EDGE) {
    const next = new Array<number>(edge * edge * 4);
    for (let y = 0; y < edge; y += 1) {
      for (let x = 0; x < edge; x += 1) {
        const value = matrix[y * edge + x]! * 4;
        next[y * edge * 2 + x] = value;
        next[y * edge * 2 + x + edge] = value + 2;
        next[(y + edge) * edge * 2 + x] = value + 3;
        next[(y + edge) * edge * 2 + x + edge] = value + 1;
      }
    }
    matrix = next;
    edge *= 2;
  }
  return Uint8Array.from(matrix);
})();

/** R2 저불일치 수열의 두 무리수 증분(plastic number 유래). */
const R2_ALPHA_X = 0.7548776662466927;
const R2_ALPHA_Y = 0.5698402909980532;
/** 채널·시드 상관을 끊는 무리수 오프셋(황금비·√2 소수부). */
const CHANNEL_STRIDE = 0.6180339887498949;
const SEED_STRIDE = 0.4142135623730951;

function fract(value: number): number {
  return value - Math.floor(value);
}

/** 정수 해시 → [0,1). 결정적이고 시드·좌표·채널에 균등 반응한다. */
export function studioHighBitDitherHash(
  seed: number,
  x: number,
  y: number,
  channel: number
): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (channel | 0) ^ (seed | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * 양자화 직전에 더할 오프셋(출력 LSB 단위).
 * `ordered`/`blue-noise` 는 [-0.5, 0.5), `triangular` 은 (-1, 1) 범위다.
 */
export function studioHighBitDitherOffset(
  mode: StudioHighBitDitherMode,
  seed: number,
  x: number,
  y: number,
  channel: number
): number {
  switch (mode) {
    case "none":
      return 0;
    case "ordered": {
      const shift = (seed | 0) & (STUDIO_HIGHBIT_BAYER_EDGE - 1);
      const bx = (((x | 0) + shift) % STUDIO_HIGHBIT_BAYER_EDGE + STUDIO_HIGHBIT_BAYER_EDGE)
        % STUDIO_HIGHBIT_BAYER_EDGE;
      const by = (((y | 0) + channel + shift) % STUDIO_HIGHBIT_BAYER_EDGE
        + STUDIO_HIGHBIT_BAYER_EDGE) % STUDIO_HIGHBIT_BAYER_EDGE;
      const cell = STUDIO_HIGHBIT_BAYER_8[by * STUDIO_HIGHBIT_BAYER_EDGE + bx]!;
      return (cell + 0.5) / (STUDIO_HIGHBIT_BAYER_EDGE * STUDIO_HIGHBIT_BAYER_EDGE) - 0.5;
    }
    case "blue-noise":
      return fract(
        x * R2_ALPHA_X + y * R2_ALPHA_Y + channel * CHANNEL_STRIDE + (seed | 0) * SEED_STRIDE
      ) - 0.5;
    case "triangular": {
      const first = studioHighBitDitherHash(seed, x, y, channel);
      const second = studioHighBitDitherHash(seed ^ 0x9e3779b9, x, y, channel);
      return first - second;
    }
  }
}

export interface StudioHighBitDitherOptions {
  readonly mode?: StudioHighBitDitherMode;
  readonly seed?: number;
  /** 출력 최대 코드(8비트 = 255). */
  readonly levels?: number;
  /** 알파 채널(3)에도 디더를 적용할지. 기본 false — 알파 잡음은 마스크 경계를 갉아먹는다. */
  readonly ditherAlpha?: boolean;
}

/**
 * `studioHighBitSurfaceToBytes` 에 주입할 양자화기를 만든다.
 * 부호화(0..1) 값 × levels 에 LSB 미만 오프셋을 더하고 반올림·클램프한다.
 */
export function createStudioHighBitDitherQuantizer(
  options: StudioHighBitDitherOptions = {}
): StudioHighBitQuantizer {
  const mode = options.mode ?? "blue-noise";
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed!) : 0;
  const levels = Number.isFinite(options.levels) ? Math.max(1, Math.trunc(options.levels!)) : 255;
  const ditherAlpha = options.ditherAlpha ?? false;
  return (encoded, x, y, channel) => {
    const scaled = clampStudioHighBitUnit(encoded) * levels;
    // 이미 정확히 표현 가능한 코드(평면 채움, 순백/순흑, 알파 0/1)는 건드리지 않는다.
    // 디더는 "표현 불가능한 중간값"을 흩는 도구지, 확정값에 잡음을 얹는 도구가 아니다.
    const exact = Math.round(scaled);
    if (Math.abs(scaled - exact) < 1e-9) return Math.max(0, Math.min(levels, exact));
    const skip = mode === "none" || (channel === 3 && !ditherAlpha);
    const offset = skip ? 0 : studioHighBitDitherOffset(mode, seed, x, y, channel);
    return Math.max(0, Math.min(levels, Math.round(scaled + offset)));
  };
}

// ---------------------------------------------------------------------------
// 밴딩 계측 — "줄었다"를 말이 아니라 숫자로 증명하기 위한 도구
// ---------------------------------------------------------------------------

export interface StudioHighBitBandingReport {
  /** 사용된 서로 다른 출력 코드 수. */
  readonly distinctLevels: number;
  /** 같은 코드가 연속으로 이어진 최대 길이 = 평탄역 폭. 밴딩의 1차 지표(작을수록 좋다). */
  readonly longestRun: number;
  /** 인접 픽셀 값이 바뀌는 횟수. 디더링하면 **늘어난다**(계단 하나를 잘게 흩는 것이 목적). */
  readonly transitionCount: number;
  /** 박스 저역통과 후 참값 대비 평균 절대오차(코드 단위). 눈이 보는 밝기 오차에 대응한다. */
  readonly meanAbsoluteLowPassError: number;
  readonly maxAbsoluteLowPassError: number;
}

function boxFilter(values: ArrayLike<number>, window: number): Float64Array {
  const length = values.length;
  const out = new Float64Array(length);
  const half = Math.max(0, Math.floor(window / 2));
  for (let index = 0; index < length; index += 1) {
    const from = Math.max(0, index - half);
    const to = Math.min(length - 1, index + half);
    let sum = 0;
    for (let k = from; k <= to; k += 1) sum += values[k]!;
    out[index] = sum / (to - from + 1);
  }
  return out;
}

/**
 * 1차원 스캔라인의 밴딩을 계측한다.
 * `reference` 는 양자화 이전의 이상적 연속값(0..levels 실수)이며, 두 신호를 같은 박스 필터로
 * 저역통과시켜 비교한다(경계 효과를 동일하게 받도록).
 */
export function measureStudioHighBitBanding(
  actual: ArrayLike<number>,
  reference: ArrayLike<number>,
  window = 16
): StudioHighBitBandingReport {
  if (actual.length === 0 || actual.length !== reference.length) {
    throw new Error("밴딩 계측: actual/reference 길이가 같아야 하고 비어 있으면 안 됩니다.");
  }
  const distinct = new Set<number>();
  let longestRun = 1;
  let currentRun = 1;
  let transitions = 0;
  distinct.add(actual[0]!);
  for (let index = 1; index < actual.length; index += 1) {
    distinct.add(actual[index]!);
    if (actual[index] === actual[index - 1]) {
      currentRun += 1;
      if (currentRun > longestRun) longestRun = currentRun;
    } else {
      currentRun = 1;
      transitions += 1;
    }
  }
  const actualLowPass = boxFilter(actual, window);
  const referenceLowPass = boxFilter(reference, window);
  let sum = 0;
  let maximum = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const error = Math.abs(actualLowPass[index]! - referenceLowPass[index]!);
    sum += error;
    if (error > maximum) maximum = error;
  }
  return {
    distinctLevels: distinct.size,
    longestRun,
    transitionCount: transitions,
    meanAbsoluteLowPassError: sum / actual.length,
    maxAbsoluteLowPassError: maximum,
  };
}
