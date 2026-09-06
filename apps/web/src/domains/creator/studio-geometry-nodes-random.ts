/**
 * 지오메트리 노드 — 시드 난수·노이즈 (순수 정수 연산).
 *
 * `Math.random()` 과 `Date.now()` 를 쓰지 않는다. 모든 무작위성은 명시 시드에서 나오고,
 * 같은 시드는 항상 같은 비트 시퀀스를 낸다.
 *
 * ## 알고리즘
 * - `createStudioGeometryRandom(seed)` — splitmix32. 상태를 매 호출 `0x9e3779b9` 만큼
 *   전진시키고 xor-shift + `Math.imul` 2라운드로 섞는다. 32비트 정수 연산만 쓰므로
 *   (`Math.imul` 은 스펙상 정확한 32비트 곱셈) 엔진과 무관하게 비트 동일하다.
 *   레포 기존 관용구(`studio-advanced-pixel-filters.ts` 의 `hashNoise`, `studio-bg-scenes.ts`
 *   의 LCG)와 같은 계열이며, 스트림 품질만 splitmix32 로 올린 것이다.
 * - `studioGeometryHash32(a,b,c,seed)` — 좌표 해시. 스트림 상태 없이 위치만으로 값을 얻어야
 *   하는 노이즈 격자에 쓴다.
 * - `studioGeometryValueNoise3` — 정수 격자 8점 해시 + smoothstep 가중 삼선형 보간.
 *   전부 다항식이라 삼각함수가 개입하지 않는다 → 양자화 불필요.
 * - `studioGeometryFractalNoise3` — 옥타브 1~5, lacunarity 2, gain 0.5, 합을 진폭 합으로 정규화.
 * - `studioGeometryRandomUnitVector` — Marsaglia 극좌표 기각법. `Math.sin/cos` 를 아예 쓰지
 *   않고 `Math.sqrt` 만 쓴다(주류 엔진에서 IEEE754 정확). 기각 루프는 64회로 상한을 두고
 *   초과 시 [0,0,1] 로 수렴한다(무한 루프 불가).
 *
 * ## 한계
 * 암호학적 난수가 아니다. 통계적 균일성은 절차적 배치에 충분한 수준이고, 주기는 2^32 다.
 */

const GOLDEN_GAMMA = 0x9e3779b9 | 0;

export interface StudioGeometryRandom {
  /** 다음 32비트 부호 없는 정수. */
  readonly nextUint32: () => number;
  /** 다음 [0,1) 실수 — nextUint32 / 2^32. */
  readonly nextFloat: () => number;
  /** 다음 [min,max) 실수. min>=max 면 min 을 그대로 돌려준다. */
  readonly nextRange: (min: number, max: number) => number;
  /** 다음 [0,bound) 정수. bound<=0 이면 0. */
  readonly nextBelow: (bound: number) => number;
  /** 현재 내부 상태(부호 없는 32비트) — 스냅샷/재현 검증용. */
  readonly state: () => number;
}

function mixSplitMix32(z0: number): number {
  let z = z0 | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/** 시드 정규화 — 비정수/비유한 시드도 결정적인 32비트 값으로 접는다. */
export function studioGeometryNormalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.trunc(seed) >>> 0;
}

export function createStudioGeometryRandom(seed: number): StudioGeometryRandom {
  let state = studioGeometryNormalizeSeed(seed) | 0;
  const nextUint32 = (): number => {
    state = (state + GOLDEN_GAMMA) | 0;
    return mixSplitMix32(state);
  };
  const nextFloat = (): number => nextUint32() / 4_294_967_296;
  return {
    nextUint32,
    nextFloat,
    nextRange: (min, max) => (max > min ? min + nextFloat() * (max - min) : min),
    nextBelow: (bound) => (bound > 0 ? Math.min(bound - 1, Math.floor(nextFloat() * bound)) : 0),
    state: () => state >>> 0,
  };
}

/** 위치 기반 32비트 해시 — 스트림 상태 없이 좌표만으로 결정되는 값. */
export function studioGeometryHash32(a: number, b: number, c: number, seed: number): number {
  let h = studioGeometryNormalizeSeed(seed) | 0;
  h = Math.imul(h ^ (a | 0), 0x27d4eb2f);
  h = Math.imul(h ^ (b | 0), 0x165667b1);
  h = Math.imul(h ^ (c | 0), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** [0,1) 로 정규화한 좌표 해시. */
export function studioGeometryHashUnit(a: number, b: number, c: number, seed: number): number {
  return studioGeometryHash32(a, b, c, seed) / 4_294_967_296;
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 정수 격자 값 노이즈(삼선형 + smoothstep). 반환 범위 [0,1). */
export function studioGeometryValueNoise3(x: number, y: number, z: number, seed: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smoothStep(x - x0);
  const ty = smoothStep(y - y0);
  const tz = smoothStep(z - z0);
  let accumulated = 0;
  for (let dz = 0; dz < 2; dz++) {
    const wz = dz === 0 ? 1 - tz : tz;
    for (let dy = 0; dy < 2; dy++) {
      const wy = dy === 0 ? 1 - ty : ty;
      for (let dx = 0; dx < 2; dx++) {
        const wx = dx === 0 ? 1 - tx : tx;
        accumulated += wx * wy * wz * studioGeometryHashUnit(x0 + dx, y0 + dy, z0 + dz, seed);
      }
    }
  }
  return accumulated;
}

export const STUDIO_GEOMETRY_MAX_NOISE_OCTAVES = 5;

/** 프랙탈(fBm) 값 노이즈. octaves 는 1~5 로 클램프. 반환 범위 [0,1). */
export function studioGeometryFractalNoise3(
  x: number,
  y: number,
  z: number,
  seed: number,
  octaves: number,
  scale = 1
): number {
  const count = Math.max(1, Math.min(STUDIO_GEOMETRY_MAX_NOISE_OCTAVES, Math.trunc(octaves) || 1));
  const safeScale = Number.isFinite(scale) && scale !== 0 ? scale : 1;
  let frequency = safeScale;
  let amplitude = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < count; octave++) {
    total +=
      amplitude *
      studioGeometryValueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 7919);
    normalization += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return normalization > 0 ? total / normalization : 0;
}

const UNIT_VECTOR_MAX_ATTEMPTS = 64;

/**
 * 균일 분포 단위 벡터 — Marsaglia (1972) 극좌표 기각법.
 * 삼각함수를 쓰지 않으므로 양자화 없이도 결정적이다.
 */
export function studioGeometryRandomUnitVector(
  random: StudioGeometryRandom
): [number, number, number] {
  for (let attempt = 0; attempt < UNIT_VECTOR_MAX_ATTEMPTS; attempt++) {
    const u = random.nextFloat() * 2 - 1;
    const v = random.nextFloat() * 2 - 1;
    const s = u * u + v * v;
    if (s >= 1 || s === 0) continue;
    const factor = 2 * Math.sqrt(1 - s);
    return [u * factor, v * factor, 1 - 2 * s];
  }
  return [0, 0, 1];
}

/**
 * 삼각형 위 균일 배리센트릭 좌표. 제곱근 접기(sqrt folding)로 편향 없이 뽑는다.
 * 소비하는 난수는 정확히 2개 — 스트림 순서가 곧 출력 정체성이다.
 */
export function studioGeometryRandomBarycentric(
  random: StudioGeometryRandom
): [number, number, number] {
  const r1 = random.nextFloat();
  const r2 = random.nextFloat();
  const su = Math.sqrt(r1);
  const a = 1 - su;
  const b = r2 * su;
  return [a, b, 1 - a - b];
}
