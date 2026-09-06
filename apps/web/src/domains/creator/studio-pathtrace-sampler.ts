/**
 * Studio Path Tracer — 결정적 샘플러 (studio-pathtrace-sampler)
 *
 * 패스 트레이서가 쓰는 모든 난수는 이 모듈의 **상태 없는 정수 해시**에서 나온다.
 * `Math.random()` / `Date.now()` 는 이 서브시스템 어디에도 없다(계약 테스트가 소스
 * 문자열로도 확인한다).
 *
 * 알고리즘
 *  - 코어는 PCG32 의 출력 순열(RXS-M-XS)을 32비트로 축약한 것이다. 상태를 들고 다니는
 *    스트림 대신 `(pixelIndex, sampleIndex, bounce, dimension, seed)` 5-튜플을 네 번
 *    연쇄 믹싱해 u32 를 만든다. 결과적으로 난수는 "좌표의 순수 함수"라서
 *      · 타일을 어떤 순서로 돌든,
 *      · 워커 몇 개로 쪼개든,
 *      · 픽셀을 어떤 순서로 순회하든
 *    같은 시드면 같은 값이 나온다. 워커 슬라이스(다음 단계)를 위한 전제 조건이다.
 *  - 정수 연산만 쓰므로 CPU(TS)와 GPU(WGSL) 가 **정확히 같은 u32** 를 만든다. 픽셀이
 *    어긋날 때 "샘플 시퀀스가 같은가"를 먼저 이분할 수 있는 유일한 지점이다.
 *  - 픽셀 안 지터는 √spp × √spp 스트라텀에 샘플 인덱스를 사상한 뒤 해시로 셀 안을
 *    흔든다(stratified + hash decorrelation).
 *
 * 정직한 한계
 *  - **Owen-scrambled Sobol 이 아니다.** 저불일치(low-discrepancy) 수열이 아니라
 *    "층화 + 해시 비상관화"다. 고차원(바운스가 깊은 경로)에서는 사실상 순수 난수처럼
 *    행동하며, Sobol/Halton 대비 수렴 상수가 나쁘다.
 *  - 스트라텀 1:1 대응은 `spp` 가 완전제곱수일 때만 성립한다. 아닐 때는
 *    `sampleIndex % (s*s)` 로 감기므로 일부 스트라텀에 샘플이 겹친다.
 *  - blue-noise 픽셀 간 상관(공간적 디더링) 없음 — 픽셀마다 독립 시퀀스다.
 */

// ---------------------------------------------------------------------------
// PCG 상수 — WGSL 포트가 이 값을 문자열 보간으로 그대로 받아쓴다(드리프트 불가).
// ---------------------------------------------------------------------------

/** PCG32 LCG 곱수. */
export const STUDIO_PATHTRACE_PCG_MULTIPLIER = 747796405;
/** PCG32 LCG 증분. */
export const STUDIO_PATHTRACE_PCG_INCREMENT = 2891336453;
/** RXS-M-XS 출력 순열 곱수. */
export const STUDIO_PATHTRACE_PCG_OUTPUT_MULTIPLIER = 277803737;
/** 튜플 믹싱 곱수(황금비/murmur 파생) — 순서 고정. */
export const STUDIO_PATHTRACE_MIX_SAMPLE = 0x9e3779b1;
export const STUDIO_PATHTRACE_MIX_BOUNCE = 0x85ebca6b;
export const STUDIO_PATHTRACE_MIX_DIMENSION = 0xc2b2ae35;

/** u32 → [0,1) 변환 스케일 (2^-32). */
export const STUDIO_PATHTRACE_U32_TO_UNIT = 2.3283064365386963e-10;

/**
 * 샘플 차원 번호 — 같은 바운스 안에서 서로 다른 결정에 다른 차원을 쓴다.
 * 새 차원을 추가할 때는 **끝에만** 붙인다(기존 번호를 바꾸면 모든 이미지가 바뀐다).
 */
export const STUDIO_PATHTRACE_DIMENSION = {
  pixelJitterX: 0,
  pixelJitterY: 1,
  lightSelect: 2,
  lightU: 3,
  lightV: 4,
  bsdfLobe: 5,
  bsdfU: 6,
  bsdfV: 7,
  russianRoulette: 8,
} as const;

// ---------------------------------------------------------------------------
// 해시
// ---------------------------------------------------------------------------

/** PCG32 RXS-M-XS 출력 순열(32비트 입출력). */
export function studioPathtracePcgHash(input: number): number {
  const state =
    (Math.imul(input >>> 0, STUDIO_PATHTRACE_PCG_MULTIPLIER) + STUDIO_PATHTRACE_PCG_INCREMENT) >>> 0;
  const shifted = ((state >>> ((state >>> 28) + 4)) ^ state) >>> 0;
  const word = Math.imul(shifted, STUDIO_PATHTRACE_PCG_OUTPUT_MULTIPLIER) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/**
 * 5-튜플 → u32. 상태 없음: 같은 인자면 언제 어디서 불러도 같은 값.
 * WGSL `pt_hash` 와 연산 순서까지 동일하다.
 */
export function studioPathtraceHash(
  pixelIndex: number,
  sampleIndex: number,
  bounce: number,
  dimension: number,
  seed: number,
): number {
  let h = studioPathtracePcgHash(((seed >>> 0) ^ (pixelIndex >>> 0)) >>> 0);
  h = studioPathtracePcgHash((h ^ Math.imul(sampleIndex >>> 0, STUDIO_PATHTRACE_MIX_SAMPLE)) >>> 0);
  h = studioPathtracePcgHash((h ^ Math.imul(bounce >>> 0, STUDIO_PATHTRACE_MIX_BOUNCE)) >>> 0);
  h = studioPathtracePcgHash((h ^ Math.imul(dimension >>> 0, STUDIO_PATHTRACE_MIX_DIMENSION)) >>> 0);
  return h >>> 0;
}

/** 5-튜플 → [0,1). */
export function studioPathtraceRandom01(
  pixelIndex: number,
  sampleIndex: number,
  bounce: number,
  dimension: number,
  seed: number,
): number {
  return studioPathtraceHash(pixelIndex, sampleIndex, bounce, dimension, seed) * STUDIO_PATHTRACE_U32_TO_UNIT;
}

// ---------------------------------------------------------------------------
// 층화 픽셀 지터
// ---------------------------------------------------------------------------

/** spp 에 대응하는 축당 스트라텀 수 = floor(sqrt(spp)), 최소 1. */
export function studioPathtraceStrataPerAxis(samplesPerPixel: number): number {
  if (!Number.isFinite(samplesPerPixel) || samplesPerPixel < 1) return 1;
  return Math.max(1, Math.floor(Math.sqrt(Math.floor(samplesPerPixel))));
}

/**
 * 픽셀 내부 [0,1)² 지터. `out` 에 [u, v] 를 쓴다(할당 없음).
 * spp 가 완전제곱수면 sampleIndex 0..spp-1 이 각 스트라텀을 정확히 한 번씩 방문한다.
 */
export function studioPathtraceStratifiedPixelSample(
  pixelIndex: number,
  sampleIndex: number,
  samplesPerPixel: number,
  seed: number,
  out: Float64Array | number[],
): void {
  const strata = studioPathtraceStrataPerAxis(samplesPerPixel);
  const cells = strata * strata;
  const cell = ((sampleIndex % cells) + cells) % cells;
  const cx = cell % strata;
  const cy = Math.floor(cell / strata);
  const jx = studioPathtraceRandom01(
    pixelIndex,
    sampleIndex,
    0,
    STUDIO_PATHTRACE_DIMENSION.pixelJitterX,
    seed,
  );
  const jy = studioPathtraceRandom01(
    pixelIndex,
    sampleIndex,
    0,
    STUDIO_PATHTRACE_DIMENSION.pixelJitterY,
    seed,
  );
  out[0] = (cx + jx) / strata;
  out[1] = (cy + jy) / strata;
}

// ---------------------------------------------------------------------------
// 워핑(warp) — 균등 [0,1)² 를 분포로 사상
// ---------------------------------------------------------------------------

/** Shirley-Chiu 동심원 디스크 사상. out ← [x, y], x²+y² ≤ 1. */
export function sampleStudioPathtraceUniformDisk(u1: number, u2: number, out: Float64Array | number[]): void {
  const a = 2 * u1 - 1;
  const b = 2 * u2 - 1;
  if (a === 0 && b === 0) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  let r: number;
  let phi: number;
  if (a * a > b * b) {
    r = a;
    phi = (Math.PI / 4) * (b / a);
  } else {
    r = b;
    phi = Math.PI / 2 - (Math.PI / 4) * (a / b);
  }
  out[0] = r * Math.cos(phi);
  out[1] = r * Math.sin(phi);
}

/**
 * 코사인 가중 반구 샘플(로컬 프레임, z = 노멀). out ← [x, y, z].
 * pdf = z / π (`studioPathtraceCosineHemispherePdf`).
 */
export function sampleStudioPathtraceCosineHemisphere(
  u1: number,
  u2: number,
  out: Float64Array | number[],
): void {
  sampleStudioPathtraceUniformDisk(u1, u2, out);
  const x = out[0];
  const y = out[1];
  out[2] = Math.sqrt(Math.max(0, 1 - x * x - y * y));
}

/** 코사인 반구 pdf(입체각). */
export function studioPathtraceCosineHemispherePdf(cosTheta: number): number {
  return cosTheta > 0 ? cosTheta / Math.PI : 0;
}

/**
 * Heitz(2018) GGX VNDF 샘플 — 로컬 프레임에서 가시 마이크로패싯 노멀(half vector).
 * `woLocal` 은 표면 위(z>0)를 가정한다. out ← [hx, hy, hz].
 */
export function sampleStudioPathtraceGgxVndf(
  woX: number,
  woY: number,
  woZ: number,
  alpha: number,
  u1: number,
  u2: number,
  out: Float64Array | number[],
): void {
  // 1) 반구 구성으로 스트레치
  let vx = alpha * woX;
  let vy = alpha * woY;
  let vz = woZ;
  const vLen = Math.hypot(vx, vy, vz);
  if (vLen > 0) {
    vx /= vLen;
    vy /= vLen;
    vz /= vLen;
  } else {
    vx = 0;
    vy = 0;
    vz = 1;
  }
  // 2) Vh 에 직교하는 기저
  const lensq = vx * vx + vy * vy;
  let t1x = 1;
  let t1y = 0;
  let t1z = 0;
  if (lensq > 0) {
    const inv = 1 / Math.sqrt(lensq);
    t1x = -vy * inv;
    t1y = vx * inv;
    t1z = 0;
  }
  const t2x = vy * t1z - vz * t1y;
  const t2y = vz * t1x - vx * t1z;
  const t2z = vx * t1y - vy * t1x;
  // 3) 투영 면적 파라미터화
  const r = Math.sqrt(u1);
  const phi = 2 * Math.PI * u2;
  const p1 = r * Math.cos(phi);
  let p2 = r * Math.sin(phi);
  const s = 0.5 * (1 + vz);
  p2 = (1 - s) * Math.sqrt(Math.max(0, 1 - p1 * p1)) + s * p2;
  // 4) 반구로 재투영
  const nz = Math.sqrt(Math.max(0, 1 - p1 * p1 - p2 * p2));
  const nhx = p1 * t1x + p2 * t2x + nz * vx;
  const nhy = p1 * t1y + p2 * t2y + nz * vy;
  const nhz = p1 * t1z + p2 * t2z + nz * vz;
  // 5) 타원체 구성으로 되돌리기
  let hx = alpha * nhx;
  let hy = alpha * nhy;
  let hz = Math.max(1e-9, nhz);
  const hLen = Math.hypot(hx, hy, hz);
  hx /= hLen;
  hy /= hLen;
  hz /= hLen;
  out[0] = hx;
  out[1] = hy;
  out[2] = hz;
}

/** 삼각형 균등 샘플 → 무게중심 좌표 [b1, b2] (b0 = 1 - b1 - b2). */
export function sampleStudioPathtraceUniformTriangle(
  u1: number,
  u2: number,
  out: Float64Array | number[],
): void {
  const su = Math.sqrt(u1);
  out[0] = 1 - su;
  out[1] = u2 * su;
}

/** 평행사변형 균등 샘플 → [s, t] ∈ [0,1)². (면적 pdf 는 1/|edgeU × edgeV|.) */
export function sampleStudioPathtraceParallelogram(
  u1: number,
  u2: number,
  out: Float64Array | number[],
): void {
  out[0] = u1;
  out[1] = u2;
}

/**
 * Duff et al. 분기 없는 정규직교 기저. `out` ← [tx,ty,tz, bx,by,bz].
 * n 은 단위 벡터여야 한다.
 */
export function buildStudioPathtraceOnb(
  nx: number,
  ny: number,
  nz: number,
  out: Float64Array | number[],
): void {
  const sign = nz >= 0 ? 1 : -1;
  const a = -1 / (sign + nz);
  const b = nx * ny * a;
  out[0] = 1 + sign * nx * nx * a;
  out[1] = sign * b;
  out[2] = -sign * nx;
  out[3] = b;
  out[4] = sign + ny * ny * a;
  out[5] = -ny;
}
