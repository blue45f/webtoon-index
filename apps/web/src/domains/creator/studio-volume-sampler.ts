/**
 * Studio Volume — 결정적(seeded) 무상태 샘플러
 *
 * Math.random / Date.now 를 쓰지 않는다. 모든 난수는 **키 해시**로 만든다:
 *
 *     u = hash(seed, key0, key1, ..., counter) / 2^32
 *
 * 순차 스트림(LCG 상태를 물고 다니는 방식)이 아니라 무상태 해시를 쓰는 이유가 렌더러 설계의
 * 핵심 제약이다. 빈 공간 스킵(occupancy)이 켜지면 마칭이 **평가하는 스텝 수 자체가 달라진다**.
 * 순차 스트림이라면 스킵된 스텝만큼 스트림이 밀려 그림자 레이의 난수가 전부 바뀌고, "스킵 결과 ==
 * 나이브 결과" 라는 계약이 성립할 수 없다. 스텝 인덱스 k 를 **키로** 넣으면 스킵 여부와 무관하게
 * 같은 k 는 항상 같은 난수를 받는다 → 두 경로가 비트 단위로 같은 이미지를 만든다.
 *
 * 해시는 PCG 의 output permutation(Jarzynski & Olano, "Hash Functions for GPU Rendering")이라
 * WGSL 로 그대로 이식된다(studio-volume-wgsl.ts 가 동일 상수를 쓴다).
 */

/** 스텝 지터 차원 인덱스(키 충돌 방지용 상수). */
export const STUDIO_VOLUME_DIM_STEP_JITTER = 0;
/** 픽셀 내 서브샘플 오프셋 차원. */
export const STUDIO_VOLUME_DIM_PIXEL_X = 1;
export const STUDIO_VOLUME_DIM_PIXEL_Y = 2;
/** 그림자 레이(비율 추적) 서브스트림 기준 차원. */
export const STUDIO_VOLUME_DIM_SHADOW = 3;

const PCG_MULTIPLIER = 747796405;
const PCG_INCREMENT = 2891336453;
const PCG_OUTPUT_MULTIPLIER = 277803737;
const U32_SCALE = 1 / 4294967296;

/** PCG output-permuted 32비트 해시. 입력/출력 모두 부호 없는 32비트로 취급한다. */
export function studioVolumeHashU32(value: number): number {
  const state = (Math.imul(value >>> 0, PCG_MULTIPLIER) + PCG_INCREMENT) >>> 0;
  const shifted = ((state >>> ((state >>> 28) + 4)) ^ state) >>> 0;
  const word = Math.imul(shifted, PCG_OUTPUT_MULTIPLIER) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** 키 여러 개를 순차 해시로 섞는다(순서 의존적 — 차원 상수를 반드시 함께 넣을 것). */
export function studioVolumeHashKeys(seed: number, ...keys: readonly number[]): number {
  let h = studioVolumeHashU32(seed >>> 0);
  for (let i = 0; i < keys.length; i += 1) {
    h = studioVolumeHashU32((h ^ (keys[i] >>> 0)) >>> 0);
  }
  return h >>> 0;
}

/** [0, 1) 균등 난수. 2^-32 격자라 부동소수 반올림으로도 1 에 도달하지 않는다. */
export function studioVolumeHashFloat(seed: number, ...keys: readonly number[]): number {
  return studioVolumeHashKeys(seed, ...keys) * U32_SCALE;
}

/**
 * 키로 고정된 서브스트림. 같은 키로 만들면 항상 같은 수열을 낸다(전역 상태 없음).
 * 비율 추적처럼 길이를 미리 알 수 없는 소비자에게 준다.
 */
export interface StudioVolumeSampler {
  /** 다음 [0,1) 난수. */
  next(): number;
  /** 소비한 난수 개수. */
  readonly drawn: number;
  /** 카운터를 0 으로 되돌린다(같은 수열 재생). */
  reset(): void;
  /**
   * 같은 인스턴스를 새 키로 재사용한다(카운터도 0 으로). 픽셀×스텝×광원마다 샘플러를 새로
   * 할당하면 GC 압력이 커지므로, 참조 렌더러 핫패스는 이 메서드로 인스턴스를 돌려쓴다.
   * 결과 수열은 `createStudioVolumeSampler(seed, ...keys)` 와 **정확히 동일**하다.
   */
  rekey(seed: number, ...keys: readonly number[]): void;
}

class HashSampler implements StudioVolumeSampler {
  private counter = 0;
  private base: number;

  constructor(base: number) {
    this.base = base >>> 0;
  }

  next(): number {
    this.counter += 1;
    return studioVolumeHashU32((this.base ^ studioVolumeHashU32(this.counter)) >>> 0) * U32_SCALE;
  }

  get drawn(): number {
    return this.counter;
  }

  reset(): void {
    this.counter = 0;
  }

  rekey(seed: number, ...keys: readonly number[]): void {
    this.base = studioVolumeHashKeys(seed, ...keys);
    this.counter = 0;
  }
}

/** 키(예: 픽셀 인덱스, 스텝 인덱스, 광원 인덱스)로 고정된 서브스트림을 만든다. */
export function createStudioVolumeSampler(
  seed: number,
  ...keys: readonly number[]
): StudioVolumeSampler {
  return new HashSampler(studioVolumeHashKeys(seed, ...keys));
}

/**
 * 스텝 k 의 계층화(stratified) 지터 오프셋 ∈ [0, 1).
 *
 * 스텝 k 는 구간 [k, k+1) 을 담당하므로 각 스텝이 곧 하나의 stratum 이다. 즉 이 오프셋만으로
 * 계층화가 끝난다(추가 셔플 불필요). `strength` 는 0(정확히 중점, 밴딩 최대·노이즈 0)에서
 * 1(구간 전체 균등, 밴딩 없음·노이즈 최대) 사이를 잇는다.
 */
export function studioVolumeStratifiedOffset(
  seed: number,
  rayKey: number,
  stepIndex: number,
  strength = 1
): number {
  if (!(strength > 0)) return 0.5;
  const clamped = strength > 1 ? 1 : strength;
  const u = studioVolumeHashFloat(seed, rayKey, stepIndex, STUDIO_VOLUME_DIM_STEP_JITTER);
  return 0.5 + clamped * (u - 0.5);
}

/** 픽셀 내부 서브샘플 오프셋(0..1). samplesPerPixel 을 1 로 두면 정확히 픽셀 중심. */
export function studioVolumePixelOffset(
  seed: number,
  pixelIndex: number,
  sampleIndex: number,
  out: Float64Array = new Float64Array(2)
): Float64Array {
  out[0] = studioVolumeHashFloat(seed, pixelIndex, sampleIndex, STUDIO_VOLUME_DIM_PIXEL_X);
  out[1] = studioVolumeHashFloat(seed, pixelIndex, sampleIndex, STUDIO_VOLUME_DIM_PIXEL_Y);
  return out;
}
