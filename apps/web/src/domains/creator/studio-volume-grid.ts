/**
 * Studio Volume — 입력 계약(3D 스칼라 그리드) · 좌표 변환 · 삼선형 샘플링
 *
 * 이 모듈은 볼륨 렌더러의 **유일한 입력 진입점**이다. 스모크/유체 시뮬레이터(studio-smoke-*)는
 * 자기 자료구조를 이 계약(`StudioVolumeGrid`)의 평범한 typed array 로만 내보내면 되고, 렌더러는
 * 시뮬레이터 내부를 전혀 모른다. 반대로 렌더러는 시뮬레이터 타입을 import 하지 않는다.
 *
 * ── 메모리 레이아웃(불변) ────────────────────────────────────────────────
 *   index = x + nx * (y + ny * z)          // x 가 가장 빠르게 변한다(x-major run)
 *   density.length === nx * ny * nz
 *   temperature 는 선택적이며, 있으면 density 와 **정확히 같은 길이/레이아웃**이어야 한다.
 *
 * ── 좌표계 ───────────────────────────────────────────────────────────────
 *   · 그리드는 오브젝트 공간의 축 정렬 박스 [boundsMin, boundsMax] 를 균등 분할한다.
 *   · 복셀 (i,j,k) 의 **중심**은 boundsMin + (i+0.5, j+0.5, k+0.5) * cellSize 다.
 *     (셀 중심 샘플링 규약 — 코너 샘플링이 아니다. 시뮬레이터도 셀 중심에 값을 두어야 한다.)
 *   · objectToWorld 는 열 우선(column-major) 4×4 — m[col*4 + row]. gl-matrix / WGSL mat4x4<f32>
 *     와 동일한 저장 순서다. 생략/null 이면 항등행렬(= 오브젝트 공간 == 월드 공간).
 *   · 비균등 스케일/전단(shear)도 허용된다. 레이는 월드 → 오브젝트로 옮길 때 방향을 **정규화하지
 *     않는다**. 그래야 파라미터 t 가 계속 "월드 거리"를 뜻하고, 소광계수 적분이 물리적으로 옳다.
 *
 * ── 견고성 계약 ──────────────────────────────────────────────────────────
 *   `prepareStudioVolume` 는 **절대 throw 하지 않는다**. 길이 불일치·NaN·0 크기 bounds·특이행렬
 *   같은 퇴화 입력은 `degenerate: true` + `issues[]` 로 보고하고, 샘플링은 전부 0 을 돌려준다.
 *   렌더 경로가 방어 코드 없이도 "빈 볼륨"으로 안전하게 흘러가게 하기 위한 설계다.
 */

export type StudioVolumeVec3 = readonly [number, number, number];

/** 시뮬레이터 → 렌더러 입력 계약. 순수 데이터만 담는다(메서드/클래스 없음). */
export interface StudioVolumeGrid {
  /** 복셀 개수 (nx, ny, nz). 각 축 ≥ 1 정수. */
  readonly resolution: StudioVolumeVec3;
  /** 밀도 필드. 단위는 임의(무차원) — 소광계수는 `densityScale * density` 로 환산한다. */
  readonly density: Float32Array;
  /** 온도 필드(켈빈). 없으면 방출(불) 항이 0 이 된다. */
  readonly temperature?: Float32Array | null;
  /** 오브젝트 공간 AABB 최소 코너. */
  readonly boundsMin: StudioVolumeVec3;
  /** 오브젝트 공간 AABB 최대 코너. */
  readonly boundsMax: StudioVolumeVec3;
  /** 열 우선 4×4 object→world. 생략 시 항등. */
  readonly objectToWorld?: ArrayLike<number> | null;
}

/** 전처리된 볼륨 — 렌더 경로가 매 샘플 재계산하지 않도록 역행렬/셀크기/최댓값을 캐싱한다. */
export interface StudioVolumePrepared {
  readonly resolution: StudioVolumeVec3;
  readonly density: Float32Array;
  readonly temperature: Float32Array | null;
  readonly boundsMin: StudioVolumeVec3;
  readonly boundsMax: StudioVolumeVec3;
  /** (boundsMax - boundsMin) / resolution */
  readonly cellSize: StudioVolumeVec3;
  /** resolution / (boundsMax - boundsMin) — 샘플링 핫패스의 나눗셈 제거용. */
  readonly invCellSize: StudioVolumeVec3;
  readonly objectToWorld: Float64Array;
  readonly worldToObject: Float64Array;
  /** 델타/비율 추적의 전역 majorant 근거값. 퇴화 볼륨은 0. */
  readonly maxDensity: number;
  readonly maxTemperature: number;
  readonly voxelCount: number;
  /** true 면 샘플링이 항상 0 이고 레이는 볼륨을 만나지 않는다. */
  readonly degenerate: boolean;
  readonly issues: readonly string[];
}

/** 레이 ↔ AABB 교차 구간(오브젝트 공간, 파라미터 t 는 월드 거리 단위). */
export interface StudioVolumeSpan {
  readonly tEnter: number;
  readonly tExit: number;
}

const IDENTITY_MAT4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readVec3(value: unknown, fallback: StudioVolumeVec3): StudioVolumeVec3 {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return fallback;
  const source = value as ArrayLike<number>;
  const x = source[0];
  const y = source[1];
  const z = source[2];
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return fallback;
  return [x, y, z];
}

/**
 * 열 우선 4×4 역행렬(gl-matrix `mat4.invert` 이식). 특이행렬이면 false 를 돌려주고 out 은
 * 건드리지 않는다 — 호출부는 항등행렬로 폴백하고 issue 를 기록한다.
 */
export function invertStudioVolumeMat4(m: ArrayLike<number>, out: Float64Array): boolean {
  const a00 = m[0];
  const a01 = m[1];
  const a02 = m[2];
  const a03 = m[3];
  const a10 = m[4];
  const a11 = m[5];
  const a12 = m[6];
  const a13 = m[7];
  const a20 = m[8];
  const a21 = m[9];
  const a22 = m[10];
  const a23 = m[11];
  const a30 = m[12];
  const a31 = m[13];
  const a32 = m[14];
  const a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(det) || det === 0) return false;
  const invDet = 1 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * invDet;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * invDet;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * invDet;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * invDet;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * invDet;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * invDet;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * invDet;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * invDet;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;
  return true;
}

/** 열 우선 4×4 로 점 변환(평행이동 포함). */
export function transformStudioVolumePoint(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  out: Float64Array
): Float64Array {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

/** 열 우선 4×4 로 방향 변환(평행이동 제외, **정규화하지 않는다**). */
export function transformStudioVolumeDirection(
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  out: Float64Array
): Float64Array {
  out[0] = m[0] * x + m[4] * y + m[8] * z;
  out[1] = m[1] * x + m[5] * y + m[9] * z;
  out[2] = m[2] * x + m[6] * y + m[10] * z;
  return out;
}

function degenerateVolume(issues: string[]): StudioVolumePrepared {
  return {
    resolution: [0, 0, 0],
    density: new Float32Array(0),
    temperature: null,
    boundsMin: [0, 0, 0],
    boundsMax: [0, 0, 0],
    cellSize: [0, 0, 0],
    invCellSize: [0, 0, 0],
    objectToWorld: Float64Array.from(IDENTITY_MAT4),
    worldToObject: Float64Array.from(IDENTITY_MAT4),
    maxDensity: 0,
    maxTemperature: 0,
    voxelCount: 0,
    degenerate: true,
    issues,
  };
}

function readResolution(value: unknown, issues: string[]): StudioVolumeVec3 | null {
  const raw = readVec3(value, [0, 0, 0]);
  const nx = Math.floor(raw[0]);
  const ny = Math.floor(raw[1]);
  const nz = Math.floor(raw[2]);
  if (nx < 1 || ny < 1 || nz < 1) {
    issues.push(`resolution must be >= 1 on every axis (got ${raw[0]},${raw[1]},${raw[2]})`);
    return null;
  }
  return [nx, ny, nz];
}

function fieldExtent(field: Float32Array): number {
  let max = 0;
  for (let i = 0; i < field.length; i += 1) {
    const v = field[i];
    if (v > max) max = v;
  }
  return Number.isFinite(max) ? max : 0;
}

/**
 * 입력 그리드를 렌더 가능한 형태로 정규화한다. throw 하지 않는다.
 *
 * 퇴화로 판정하는 경우:
 *  - resolution 이 1 미만이거나 정수화 불가
 *  - density 길이 ≠ nx*ny*nz
 *  - temperature 가 있는데 길이가 density 와 다름
 *  - bounds 가 유한하지 않거나 어느 축이든 두께 0 (boundsMax[i] <= boundsMin[i])
 *  - objectToWorld 가 특이행렬(역변환 불가) — 볼륨이 평면으로 찌부러진 경우
 */
export function prepareStudioVolume(grid: StudioVolumeGrid): StudioVolumePrepared {
  const issues: string[] = [];

  const resolution = readResolution(grid?.resolution, issues);
  if (!resolution) return degenerateVolume(issues);
  const [nx, ny, nz] = resolution;
  const voxelCount = nx * ny * nz;

  const density = grid.density;
  if (!(density instanceof Float32Array) || density.length !== voxelCount) {
    issues.push(`density length must be ${voxelCount} (got ${density?.length ?? "none"})`);
    return degenerateVolume(issues);
  }

  let temperature: Float32Array | null = null;
  if (grid.temperature) {
    if (!(grid.temperature instanceof Float32Array) || grid.temperature.length !== voxelCount) {
      issues.push(`temperature length must be ${voxelCount} (got ${grid.temperature.length})`);
    } else {
      temperature = grid.temperature;
    }
  }

  const boundsMin = readVec3(grid.boundsMin, [0, 0, 0]);
  const boundsMax = readVec3(grid.boundsMax, [0, 0, 0]);
  for (let axis = 0; axis < 3; axis += 1) {
    if (!(boundsMax[axis] > boundsMin[axis])) {
      issues.push(
        `bounds must have positive extent on axis ${axis} (min=${boundsMin[axis]}, max=${boundsMax[axis]})`
      );
      return degenerateVolume(issues);
    }
  }

  const objectToWorld = new Float64Array(16);
  const source = grid.objectToWorld ?? IDENTITY_MAT4;
  let matrixOk = source.length === 16;
  if (!matrixOk) {
    issues.push(`objectToWorld must have 16 elements (got ${source.length})`);
  }
  for (let i = 0; i < 16; i += 1) {
    const v = matrixOk ? source[i] : IDENTITY_MAT4[i];
    if (!isFiniteNumber(v)) {
      matrixOk = false;
      issues.push(`objectToWorld[${i}] is not finite`);
      break;
    }
    objectToWorld[i] = v;
  }
  if (!matrixOk) objectToWorld.set(IDENTITY_MAT4);

  const worldToObject = new Float64Array(16);
  if (!invertStudioVolumeMat4(objectToWorld, worldToObject)) {
    issues.push("objectToWorld is singular; volume collapses to zero world volume");
    return degenerateVolume(issues);
  }

  const cellSize: StudioVolumeVec3 = [
    (boundsMax[0] - boundsMin[0]) / nx,
    (boundsMax[1] - boundsMin[1]) / ny,
    (boundsMax[2] - boundsMin[2]) / nz,
  ];
  const invCellSize: StudioVolumeVec3 = [1 / cellSize[0], 1 / cellSize[1], 1 / cellSize[2]];

  return {
    resolution,
    density,
    temperature,
    boundsMin,
    boundsMax,
    cellSize,
    invCellSize,
    objectToWorld,
    worldToObject,
    maxDensity: fieldExtent(density),
    maxTemperature: temperature ? fieldExtent(temperature) : 0,
    voxelCount,
    degenerate: false,
    issues,
  };
}

/** 문서화된 인덱스 규약 — 시뮬레이터/테스트가 동일 수식을 쓰도록 함수로 노출한다. */
export function studioVolumeVoxelIndex(
  resolution: StudioVolumeVec3,
  i: number,
  j: number,
  k: number
): number {
  return i + resolution[0] * (j + resolution[1] * k);
}

/** 복셀 (i,j,k) 의 오브젝트 공간 **중심** 좌표. */
export function studioVolumeCellCenter(
  prepared: StudioVolumePrepared,
  i: number,
  j: number,
  k: number,
  out: Float64Array = new Float64Array(3)
): Float64Array {
  out[0] = prepared.boundsMin[0] + (i + 0.5) * prepared.cellSize[0];
  out[1] = prepared.boundsMin[1] + (j + 0.5) * prepared.cellSize[1];
  out[2] = prepared.boundsMin[2] + (k + 0.5) * prepared.cellSize[2];
  return out;
}

function clampIndex(value: number, maxIndex: number): number {
  if (value < 0) return 0;
  if (value > maxIndex) return maxIndex;
  return value;
}

/**
 * 오브젝트 공간 점의 삼선형 보간.
 *
 *  - AABB **바깥**은 0 을 돌려준다(매질이 존재하지 않는 영역).
 *  - AABB **안쪽**에서 보간 지지대가 격자 밖으로 나가는 경계 반 셀 영역은 clamp-to-edge 다.
 *    (0 으로 감쇠시키면 경계에서 밀도가 인위적으로 반토막 나서 슬랩 투과율이 어긋난다.)
 */
export function sampleStudioVolumeField(
  prepared: StudioVolumePrepared,
  field: Float32Array | null,
  x: number,
  y: number,
  z: number
): number {
  if (!field || prepared.degenerate) return 0;
  const { boundsMin, boundsMax, invCellSize, resolution } = prepared;
  // NaN 은 모든 비교가 false 라 `x < min || x > max` 를 통과해버린다 — 부정 형태로 써서
  // 비유한 좌표가 격자 인덱싱까지 새어 들어가지 않게 막는다.
  if (!(x >= boundsMin[0] && x <= boundsMax[0])) return 0;
  if (!(y >= boundsMin[1] && y <= boundsMax[1])) return 0;
  if (!(z >= boundsMin[2] && z <= boundsMax[2])) return 0;

  const nx = resolution[0];
  const ny = resolution[1];
  const nz = resolution[2];

  const gx = (x - boundsMin[0]) * invCellSize[0] - 0.5;
  const gy = (y - boundsMin[1]) * invCellSize[1] - 0.5;
  const gz = (z - boundsMin[2]) * invCellSize[2] - 0.5;

  const fx0 = Math.floor(gx);
  const fy0 = Math.floor(gy);
  const fz0 = Math.floor(gz);

  const tx = gx - fx0;
  const ty = gy - fy0;
  const tz = gz - fz0;

  const x0 = clampIndex(fx0, nx - 1);
  const x1 = clampIndex(fx0 + 1, nx - 1);
  const y0 = clampIndex(fy0, ny - 1);
  const y1 = clampIndex(fy0 + 1, ny - 1);
  const z0 = clampIndex(fz0, nz - 1);
  const z1 = clampIndex(fz0 + 1, nz - 1);

  const rowY0 = nx * y0;
  const rowY1 = nx * y1;
  const sliceZ0 = nx * ny * z0;
  const sliceZ1 = nx * ny * z1;

  const c000 = field[x0 + rowY0 + sliceZ0];
  const c100 = field[x1 + rowY0 + sliceZ0];
  const c010 = field[x0 + rowY1 + sliceZ0];
  const c110 = field[x1 + rowY1 + sliceZ0];
  const c001 = field[x0 + rowY0 + sliceZ1];
  const c101 = field[x1 + rowY0 + sliceZ1];
  const c011 = field[x0 + rowY1 + sliceZ1];
  const c111 = field[x1 + rowY1 + sliceZ1];

  const c00 = c000 + (c100 - c000) * tx;
  const c10 = c010 + (c110 - c010) * tx;
  const c01 = c001 + (c101 - c001) * tx;
  const c11 = c011 + (c111 - c011) * tx;

  const c0 = c00 + (c10 - c00) * ty;
  const c1 = c01 + (c11 - c01) * ty;

  return c0 + (c1 - c0) * tz;
}

export function sampleStudioVolumeDensity(
  prepared: StudioVolumePrepared,
  x: number,
  y: number,
  z: number
): number {
  return sampleStudioVolumeField(prepared, prepared.density, x, y, z);
}

export function sampleStudioVolumeTemperature(
  prepared: StudioVolumePrepared,
  x: number,
  y: number,
  z: number
): number {
  return sampleStudioVolumeField(prepared, prepared.temperature, x, y, z);
}

/**
 * 월드 레이 → 오브젝트 공간 레이. 방향은 **정규화하지 않는다**(위 좌표계 주석 참고).
 * out 은 [ox, oy, oz, dx, dy, dz] 6원소.
 */
export function studioVolumeWorldRayToObject(
  prepared: StudioVolumePrepared,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  out: Float64Array = new Float64Array(6)
): Float64Array {
  const m = prepared.worldToObject;
  out[0] = m[0] * ox + m[4] * oy + m[8] * oz + m[12];
  out[1] = m[1] * ox + m[5] * oy + m[9] * oz + m[13];
  out[2] = m[2] * ox + m[6] * oy + m[10] * oz + m[14];
  out[3] = m[0] * dx + m[4] * dy + m[8] * dz;
  out[4] = m[1] * dx + m[5] * dy + m[9] * dz;
  out[5] = m[2] * dx + m[6] * dy + m[10] * dz;
  return out;
}

/**
 * 슬랩 방식 레이 ↔ AABB 교차. 오브젝트 공간 레이(비정규화 방향)를 받고, 반환하는 t 는
 * 원본 월드 레이의 거리 단위다. 교차 없음 / 두께 0 이면 null.
 */
export function intersectStudioVolumeBounds(
  prepared: StudioVolumePrepared,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMin = 0,
  tMax = Number.POSITIVE_INFINITY
): StudioVolumeSpan | null {
  if (prepared.degenerate) return null;
  const { boundsMin, boundsMax } = prepared;
  let tEnter = tMin;
  let tExit = tMax;

  const origins = [ox, oy, oz];
  const dirs = [dx, dy, dz];
  for (let axis = 0; axis < 3; axis += 1) {
    const d = dirs[axis];
    const o = origins[axis];
    if (d === 0 || !Number.isFinite(d)) {
      if (o < boundsMin[axis] || o > boundsMax[axis]) return null;
      continue;
    }
    const inv = 1 / d;
    let t0 = (boundsMin[axis] - o) * inv;
    let t1 = (boundsMax[axis] - o) * inv;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    if (t0 > tEnter) tEnter = t0;
    if (t1 < tExit) tExit = t1;
    if (tExit <= tEnter) return null;
  }

  if (!Number.isFinite(tEnter) || !Number.isFinite(tExit) || tExit <= tEnter) return null;
  return { tEnter, tExit };
}
