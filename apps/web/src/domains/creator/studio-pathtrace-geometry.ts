/**
 * Studio Path Tracer — 레이/프리미티브 교차 (studio-pathtrace-geometry)
 *
 * 알고리즘
 *  - **ray-AABB**: Williams 슬랩 테스트. 방향 역수를 레이당 1회만 계산하되 ±1e18 로
 *    **포화(clamp)** 시킨다 — ±Infinity 를 쓰면 원점이 슬랩 경계에 정확히 놓인
 *    축평행 레이에서 0×Inf = NaN 이 생겨 히트가 조용히 사라진다. 포화 역수는 그 경우를
 *    "슬랩 전체가 열려 있음"으로 보수적으로 처리하므로 히트를 절대 떨어뜨리지 않는다
 *    (과다 보고는 이어지는 watertight 삼각형 테스트가 걸러낸다). tFar 에 (1 + 2·γ(3))
 *    를 곱해 f32 반올림으로 얇은 바운즈를 놓치는 경우도 막는다.
 *  - **ray-triangle**: Woop-Benthin-Wald(2013) *watertight* 방식. 레이당 한 번 축을
 *    순열하고(|d| 최대 축을 z 로) shear 상수를 만든 뒤, 삼각형마다 부호 있는 edge 함수
 *    U/V/W 를 f64 로 평가한다. 세 edge 함수가 공유 edge 위에서 정확히 같은 부동소수
 *    식으로 계산되므로, 인접 삼각형이 같은 edge 를 서로 다르게 판정해 생기는 **구멍(크랙)이
 *    생기지 않는다.**
 *
 * 정직한 한계
 *  - 논문의 "구멍 없음"은 보장하되 **중복 히트 배제는 주장하지 않는다.** edge 위 레이는
 *    양쪽 삼각형 모두에 히트로 잡힐 수 있다(closest-hit 에서는 같은 t 라 무해하고,
 *    any-hit 섀도 레이에서도 무해하다). 테스트도 "dropped hit 0건"만 단언한다.
 *  - 백페이스 컬링 없음(양면). 얇은 셸 모델에서 내부 히트가 그대로 잡힌다.
 *  - f64 로 계산하고 f32 로 저장한다. WGSL 포트는 f32 전체라 t 값이 비트 단위로 같지
 *    않다(모듈 docstring 의 허용오차 계약 참조).
 */

/** pbrt γ(n) — f32 기준 반올림 오차 상한 계수. */
const F32_EPS_HALF = 5.960464477539063e-8; // 2^-24
const GAMMA3 = (3 * F32_EPS_HALF) / (1 - 3 * F32_EPS_HALF);
/** AABB tFar 보정 계수 — 얇은 바운즈에서 f32 반올림으로 히트를 놓치지 않게 한다. */
export const STUDIO_PATHTRACE_AABB_TFAR_SCALE = 1 + 2 * GAMMA3;

/**
 * 방향 역수 포화 한계. |1/d| 가 이 값을 넘으면 잘라낸다 — 좌표 상한(1e6)과 곱해도
 * 1e24 라 f32/f64 모두 오버플로 없이 표현된다.
 */
export const STUDIO_PATHTRACE_INV_DIR_LIMIT = 1e18;

function saturateInverse(value: number): number {
  const inv = 1 / value;
  if (inv > STUDIO_PATHTRACE_INV_DIR_LIMIT) return STUDIO_PATHTRACE_INV_DIR_LIMIT;
  if (inv < -STUDIO_PATHTRACE_INV_DIR_LIMIT) return -STUDIO_PATHTRACE_INV_DIR_LIMIT;
  return inv;
}

/** NaN 을 두 번째 인자로 흡수하는 min/max (방어적 — 포화 역수 덕에 실제로는 NaN 이 없다). */
function minNaNSafe(a: number, b: number): number {
  return a < b ? a : b;
}
function maxNaNSafe(a: number, b: number): number {
  return a > b ? a : b;
}

/**
 * 레이 상태 — 방향 역수와 watertight shear 상수를 캐시한다.
 * 재사용(mutate)을 전제로 설계했다: 픽셀당 수만 번 생성되므로 할당을 피한다.
 */
export interface StudioPathtraceRay {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  /** 1/d — ±STUDIO_PATHTRACE_INV_DIR_LIMIT 로 포화된다(0 방향에서 NaN 방지). */
  idx: number;
  idy: number;
  idz: number;
  /** watertight 축 순열(0=x,1=y,2=z). */
  kx: number;
  ky: number;
  kz: number;
  /** watertight shear 상수. */
  sx: number;
  sy: number;
  sz: number;
}

/** 히트 레코드 — t < 0 이면 미스. */
export interface StudioPathtraceHit {
  t: number;
  triangle: number;
  /** 무게중심 좌표(정점 b, c 가중치). a 가중치는 1 - u - v. */
  u: number;
  v: number;
}

export function createStudioPathtraceRay(): StudioPathtraceRay {
  return {
    ox: 0,
    oy: 0,
    oz: 0,
    dx: 0,
    dy: 0,
    dz: 1,
    idx: STUDIO_PATHTRACE_INV_DIR_LIMIT,
    idy: STUDIO_PATHTRACE_INV_DIR_LIMIT,
    idz: 1,
    kx: 0,
    ky: 1,
    kz: 2,
    sx: 0,
    sy: 0,
    sz: 1,
  };
}

export function createStudioPathtraceHit(): StudioPathtraceHit {
  return { t: -1, triangle: -1, u: 0, v: 0 };
}

/** 레이 원점/방향을 갱신하고 역수·shear 상수를 다시 굽는다. */
export function setStudioPathtraceRay(
  ray: StudioPathtraceRay,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): void {
  ray.ox = ox;
  ray.oy = oy;
  ray.oz = oz;
  ray.dx = dx;
  ray.dy = dy;
  ray.dz = dz;
  ray.idx = saturateInverse(dx);
  ray.idy = saturateInverse(dy);
  ray.idz = saturateInverse(dz);

  // |d| 최대 축을 kz 로. 동점이면 낮은 축 우선(결정적).
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  let kz = 0;
  if (ay > ax) kz = 1;
  if (az > (kz === 0 ? ax : ay)) kz = 2;
  let kx = kz + 1;
  if (kx === 3) kx = 0;
  let ky = kx + 1;
  if (ky === 3) ky = 0;
  const dkz = kz === 0 ? dx : kz === 1 ? dy : dz;
  if (dkz < 0) {
    const swap = kx;
    kx = ky;
    ky = swap;
  }
  const dkx = kx === 0 ? dx : kx === 1 ? dy : dz;
  const dky = ky === 0 ? dx : ky === 1 ? dy : dz;
  ray.kx = kx;
  ray.ky = ky;
  ray.kz = kz;
  ray.sx = dkx / dkz;
  ray.sy = dky / dkz;
  ray.sz = 1 / dkz;
}

/** 방향만 정규화해서 세팅하는 편의 래퍼. 길이 0 방향은 +z 로 대체한다. */
export function setStudioPathtraceRayNormalized(
  ray: StudioPathtraceRay,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): void {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0 || !Number.isFinite(len)) {
    setStudioPathtraceRay(ray, ox, oy, oz, 0, 0, 1);
    return;
  }
  setStudioPathtraceRay(ray, ox, oy, oz, dx / len, dy / len, dz / len);
}

/**
 * 슬랩 ray-AABB. 히트면 진입 t(레이가 이미 안에 있으면 tMin)를, 미스면 -1 을 반환한다.
 * front-to-back BVH 순회가 이 진입 t 로 자식 순서를 정한다.
 */
export function intersectStudioPathtraceAabb(
  ray: StudioPathtraceRay,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  tMin: number,
  tMax: number,
): number {
  const tx1 = (minX - ray.ox) * ray.idx;
  const tx2 = (maxX - ray.ox) * ray.idx;
  let tNear = minNaNSafe(tx1, tx2);
  let tFar = maxNaNSafe(tx1, tx2);

  const ty1 = (minY - ray.oy) * ray.idy;
  const ty2 = (maxY - ray.oy) * ray.idy;
  tNear = maxNaNSafe(tNear, minNaNSafe(ty1, ty2));
  tFar = minNaNSafe(tFar, maxNaNSafe(ty1, ty2));

  const tz1 = (minZ - ray.oz) * ray.idz;
  const tz2 = (maxZ - ray.oz) * ray.idz;
  tNear = maxNaNSafe(tNear, minNaNSafe(tz1, tz2));
  tFar = minNaNSafe(tFar, maxNaNSafe(tz1, tz2));

  const entry = maxNaNSafe(tNear, tMin);
  const exit = minNaNSafe(tFar * STUDIO_PATHTRACE_AABB_TFAR_SCALE, tMax);
  return entry <= exit ? entry : -1;
}

function axisComponent(axis: number, x: number, y: number, z: number): number {
  return axis === 0 ? x : axis === 1 ? y : z;
}

/**
 * Woop watertight ray-triangle. 히트면 t 를, 미스면 -1 을 반환하고
 * 히트일 때 `baryOut` 에 [u, v] (정점 b, c 가중치)를 쓴다.
 */
export function intersectStudioPathtraceTriangle(
  ray: StudioPathtraceRay,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  tMin: number,
  tMax: number,
  baryOut: Float64Array | number[],
): number {
  // 원점 기준 상대 좌표
  const pax = ax - ray.ox;
  const pay = ay - ray.oy;
  const paz = az - ray.oz;
  const pbx = bx - ray.ox;
  const pby = by - ray.oy;
  const pbz = bz - ray.oz;
  const pcx = cx - ray.ox;
  const pcy = cy - ray.oy;
  const pcz = cz - ray.oz;

  const { kx, ky, kz, sx, sy, sz } = ray;
  const akz = axisComponent(kz, pax, pay, paz);
  const bkz = axisComponent(kz, pbx, pby, pbz);
  const ckz = axisComponent(kz, pcx, pcy, pcz);

  const axS = axisComponent(kx, pax, pay, paz) - sx * akz;
  const ayS = axisComponent(ky, pax, pay, paz) - sy * akz;
  const bxS = axisComponent(kx, pbx, pby, pbz) - sx * bkz;
  const byS = axisComponent(ky, pbx, pby, pbz) - sy * bkz;
  const cxS = axisComponent(kx, pcx, pcy, pcz) - sx * ckz;
  const cyS = axisComponent(ky, pcx, pcy, pcz) - sy * ckz;

  // 부호 있는 edge 함수 — 공유 edge 에서 인접 삼각형과 정확히 같은 식이 평가된다.
  const u = cxS * byS - cyS * bxS;
  const v = axS * cyS - ayS * cxS;
  const w = bxS * ayS - byS * axS;

  if ((u < 0 || v < 0 || w < 0) && (u > 0 || v > 0 || w > 0)) return -1;
  const det = u + v + w;
  if (det === 0) return -1;

  const tScaled = u * (sz * akz) + v * (sz * bkz) + w * (sz * ckz);
  const detSign = det < 0 ? -1 : 1;
  const absDet = det * detSign;
  const tSigned = tScaled * detSign;
  if (tSigned <= tMin * absDet || tSigned >= tMax * absDet) return -1;

  const invDet = 1 / det;
  baryOut[0] = v * invDet;
  baryOut[1] = w * invDet;
  return tScaled * invDet;
}

/**
 * 레이-평행사변형(면적 광원) 교차. origin + s·edgeU + t·edgeV, s,t ∈ [0,1].
 * 히트면 t 를, 미스면 -1 을 반환하고 `uvOut` 에 [s, t] 를 쓴다.
 */
export function intersectStudioPathtraceParallelogram(
  ray: StudioPathtraceRay,
  originX: number,
  originY: number,
  originZ: number,
  eux: number,
  euy: number,
  euz: number,
  evx: number,
  evy: number,
  evz: number,
  tMin: number,
  tMax: number,
  uvOut: Float64Array | number[],
): number {
  // Möller-Trumbore 를 평행사변형으로 확장(무게중심 상한이 1 대신 각 축 1).
  const px = ray.dy * evz - ray.dz * evy;
  const py = ray.dz * evx - ray.dx * evz;
  const pz = ray.dx * evy - ray.dy * evx;
  const det = eux * px + euy * py + euz * pz;
  if (det === 0) return -1;
  const invDet = 1 / det;
  const tx = ray.ox - originX;
  const ty = ray.oy - originY;
  const tz = ray.oz - originZ;
  const s = (tx * px + ty * py + tz * pz) * invDet;
  if (s < 0 || s > 1) return -1;
  const qx = ty * euz - tz * euy;
  const qy = tz * eux - tx * euz;
  const qz = tx * euy - ty * eux;
  const tt = (ray.dx * qx + ray.dy * qy + ray.dz * qz) * invDet;
  if (tt < 0 || tt > 1) return -1;
  const hit = (evx * qx + evy * qy + evz * qz) * invDet;
  if (hit <= tMin || hit >= tMax) return -1;
  uvOut[0] = s;
  uvOut[1] = tt;
  return hit;
}

/** 정규화된 지오메트릭 노멀. out ← [nx, ny, nz]. 퇴화 삼각형은 [0,0,1]. */
export function studioPathtraceGeometricNormal(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  out: Float64Array | number[],
): void {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz);
  if (len === 0 || !Number.isFinite(len)) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 1;
    return;
  }
  nx /= len;
  ny /= len;
  nz /= len;
  out[0] = nx;
  out[1] = ny;
  out[2] = nz;
}

/** 무게중심 보간(정점 속성 3개). out ← 보간값. */
export function studioPathtraceInterpolate3(
  u: number,
  v: number,
  a0: number,
  a1: number,
  a2: number,
  b0: number,
  b1: number,
  b2: number,
  c0: number,
  c1: number,
  c2: number,
  out: Float64Array | number[],
): void {
  const w = 1 - u - v;
  out[0] = w * a0 + u * b0 + v * c0;
  out[1] = w * a1 + u * b1 + v * c1;
  out[2] = w * a2 + u * b2 + v * c2;
}
