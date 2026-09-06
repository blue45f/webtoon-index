/**
 * Studio Sculpt — 유니폼 그리드(스패셜 해시)로 반경 질의를 O(1)-ish 로 만드는 순수 코어.
 *
 * ## 알고리즘
 * 카운팅 소트 2패스로 "셀 → 그 셀에 속한 정점 목록"을 두 개의 타입드어레이(cellStart, items)에
 * 담는다. 해시맵도, 셀당 배열도 만들지 않으므로 질의 경로에 **할당이 0**이다.
 *   1) 패스 A: 각 정점의 셀 인덱스를 계산해 셀별 개수를 센다 → prefix sum 으로 cellStart.
 *   2) 패스 B: 정점 인덱스를 오름차순으로 순회하며 items 에 배치한다 → 같은 셀 안의 정점은
 *      항상 **정점 인덱스 오름차순**으로 저장된다(질의 결과 순서가 결정적이 되는 근거).
 * 질의는 (cz, cy, cx) 오름차순 3중 루프로 셀을 훑고, 셀 안에서는 저장 순서를 그대로 쓴다.
 * 따라서 같은 입력이면 결과 배열의 **순서까지** 항상 같다.
 *
 * ## stale(낡음) 계약 — 스컬프팅의 진짜 함정
 * 스컬프팅은 정의상 해시를 만든 그 좌표를 움직인다. 빌드 이후 어떤 정점이 최대 d 만큼 움직였다면,
 * "지금" 중심에서 반경 r 안에 있는 정점은 빌드 시점에는 중심에서 **최대 r + d** 안에 있었다.
 * 그래서 `querySculptSphere` 는 `padding`(= 빌드 이후 최대 변위)을 받아 셀 스캔 반경만 r + d 로
 * 넓히고, 최종 판정은 **현재 positions** 로 한다 → 브루트포스와 결과가 정확히 일치한다.
 * padding 을 거짓으로 넘기면(실제로 더 움직였는데 0을 넘기면) 조용히 정점을 놓친다. 이건
 * 호출부(스트로크 세션)가 최대 변위를 추적해서 지켜야 하는 **전제조건**이며, 이 모듈은:
 *   - `padding` 이 셀 크기의 `SCULPT_HASH_MAX_PADDING_CELLS` 배를 넘으면 조용히 느려지는 대신
 *     `SCULPT_QUERY_STALE` 을 반환해 **명시적으로 거부**한다(세션이 재빌드해야 한다).
 *   - out 버퍼가 모자라면 잘라내지 않고 `SCULPT_QUERY_OVERFLOW` 를 반환한다(세션이 버퍼를 키워
 *     재시도). 조용한 절단은 브러시에 구멍을 내므로 금지한다.
 *
 * ## 한계 (정직하게)
 * - BVH 도, 옥트리도, 계층 구조도 아니다. 균일 격자 하나뿐이라 정점 밀도가 극단적으로 불균일한
 *   메시(예: 한 구석만 100배 조밀)에서는 셀당 정점 수가 치우친다.
 * - 삼각형/면 질의가 없다. 정점 질의만 한다(브러시가 정점만 움직이므로 필요하지 않다).
 * - 레이캐스트(브러시 커서 → 표면 교차)를 제공하지 않는다. 그건 렌더러/피킹 계층의 일이고,
 *   이 코어는 "이미 정해진 3D 중심점" 만 받는다.
 */

// ---------------------------------------------------------------------------
// 상수 · 타입
// ---------------------------------------------------------------------------

/** 질의 결과 out 버퍼가 모자람 — 호출부가 버퍼를 키워 재시도해야 한다. */
export const SCULPT_QUERY_OVERFLOW = -1;
/** padding 이 허용 범위를 넘음 — 호출부가 해시를 재빌드해야 한다. */
export const SCULPT_QUERY_STALE = -2;

/** padding 허용 상한(셀 크기 배수). 이보다 커지면 재빌드가 스캔 확장보다 싸다. */
export const SCULPT_HASH_MAX_PADDING_CELLS = 4;

/** 셀 개수 상한 — 얇고 긴 메시에서 dims 곱이 폭발하는 것을 막는다. */
export const SCULPT_HASH_MAX_CELLS = 1 << 22; // 4,194,304 셀 = cellStart 16MB

export interface SculptSpatialHash {
  readonly cellSize: number;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly dimX: number;
  readonly dimY: number;
  readonly dimZ: number;
  readonly vertexCount: number;
  /** 길이 cellCount + 1 인 prefix sum. */
  readonly cellStart: Uint32Array;
  /** 길이 vertexCount. 같은 셀 안에서는 정점 인덱스 오름차순. */
  readonly items: Uint32Array;
}

export interface SculptSpatialHashOptions {
  /** 명시하지 않으면 바운딩박스와 정점 수로 유도한다(대략 셀당 1~2 정점 목표). */
  readonly cellSize?: number;
  readonly maxCells?: number;
}

// ---------------------------------------------------------------------------
// 빌드
// ---------------------------------------------------------------------------

function clampCellIndex(value: number, dim: number): number {
  if (value < 0) return 0;
  if (value >= dim) return dim - 1;
  return value;
}

/**
 * 셀 크기 유도: 바운딩박스 최대 변 / cbrt(V). 정점이 균일 분포일 때 셀당 대략 1개가 되어
 * 반경 질의의 후보 수가 반경/셀크기의 세제곱에 비례하게 된다.
 */
export function suggestSculptCellSize(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  vertexCount: number,
): number {
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(extent > 0)) return 1;
  const perAxis = Math.max(1, Math.cbrt(Math.max(1, vertexCount)));
  return Math.max(extent / perAxis, extent * 1e-4);
}

/**
 * 유니폼 그리드 빌드. `positions` 는 복사하지 않는다(스냅샷이 아니라 "빌드 당시 좌표"의 색인일
 * 뿐이며, 이후 변위는 질의의 padding 으로 보정한다 — 위 stale 계약 참고).
 */
export function buildSculptSpatialHash(
  positions: Float32Array,
  vertexCount: number,
  options: SculptSpatialHashOptions = {},
): SculptSpatialHash {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let v = 0; v < vertexCount; v += 1) {
    const base = v * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (vertexCount === 0) {
    minX = 0;
    minY = 0;
    minZ = 0;
    maxX = 0;
    maxY = 0;
    maxZ = 0;
  }

  const maxCells = Math.max(1, Math.floor(options.maxCells ?? SCULPT_HASH_MAX_CELLS));
  const requested = options.cellSize;
  let cellSize = typeof requested === "number" && Number.isFinite(requested) && requested > 0
    ? requested
    : suggestSculptCellSize(minX, minY, minZ, maxX, maxY, maxZ, vertexCount);

  // 퇴화(두께 0) 축은 dim 1 이 된다 — 평면 메시가 여기로 들어온다.
  const dimsFor = (size: number): [number, number, number] => [
    Math.max(1, Math.floor((maxX - minX) / size) + 1),
    Math.max(1, Math.floor((maxY - minY) / size) + 1),
    Math.max(1, Math.floor((maxZ - minZ) / size) + 1),
  ];
  let [dimX, dimY, dimZ] = dimsFor(cellSize);
  // 셀 예산 초과 시 셀을 키워 다시 센다. 각 라운드에서 최소 2배씩 키우므로 유한 반복이다.
  let guard = 0;
  while (dimX * dimY * dimZ > maxCells && guard < 64) {
    const ratio = Math.cbrt((dimX * dimY * dimZ) / maxCells);
    cellSize *= Math.max(2, ratio);
    [dimX, dimY, dimZ] = dimsFor(cellSize);
    guard += 1;
  }

  const cellCount = dimX * dimY * dimZ;
  const cellStart = new Uint32Array(cellCount + 1);
  const inverse = 1 / cellSize;
  const cellOf = (v: number): number => {
    const base = v * 3;
    const cx = clampCellIndex(Math.floor((positions[base] - minX) * inverse), dimX);
    const cy = clampCellIndex(Math.floor((positions[base + 1] - minY) * inverse), dimY);
    const cz = clampCellIndex(Math.floor((positions[base + 2] - minZ) * inverse), dimZ);
    return (cz * dimY + cy) * dimX + cx;
  };
  for (let v = 0; v < vertexCount; v += 1) cellStart[cellOf(v) + 1] += 1;
  for (let c = 0; c < cellCount; c += 1) cellStart[c + 1] += cellStart[c];
  const cursor = Uint32Array.from(cellStart.subarray(0, cellCount));
  const items = new Uint32Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) {
    const cell = cellOf(v);
    items[cursor[cell]] = v;
    cursor[cell] += 1;
  }
  return { cellSize, minX, minY, minZ, dimX, dimY, dimZ, vertexCount, cellStart, items };
}

// ---------------------------------------------------------------------------
// 질의
// ---------------------------------------------------------------------------

/** padding 이 이 해시로 감당 가능한지 — false 면 세션이 재빌드해야 한다. */
export function sculptSpatialHashShouldRebuild(hash: SculptSpatialHash, padding: number): boolean {
  if (!Number.isFinite(padding) || padding < 0) return true;
  return padding > hash.cellSize * SCULPT_HASH_MAX_PADDING_CELLS;
}

/**
 * 구 질의. `padding` 은 "빌드 이후 어떤 정점도 이보다 더 움직이지 않았다"는 상한이다.
 * 반환값: 채운 개수, 또는 `SCULPT_QUERY_OVERFLOW` / `SCULPT_QUERY_STALE`.
 * 최종 거리 판정은 현재 positions 로 하므로 브루트포스와 **집합이 정확히 동일**하다.
 */
export function querySculptSphere(
  hash: SculptSpatialHash,
  positions: Float32Array,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
  padding: number,
  out: Uint32Array,
): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  if (sculptSpatialHashShouldRebuild(hash, padding)) return SCULPT_QUERY_STALE;
  const scan = radius + padding;
  const inverse = 1 / hash.cellSize;
  const minCellX = clampCellIndex(Math.floor((centerX - scan - hash.minX) * inverse), hash.dimX);
  const maxCellX = clampCellIndex(Math.floor((centerX + scan - hash.minX) * inverse), hash.dimX);
  const minCellY = clampCellIndex(Math.floor((centerY - scan - hash.minY) * inverse), hash.dimY);
  const maxCellY = clampCellIndex(Math.floor((centerY + scan - hash.minY) * inverse), hash.dimY);
  const minCellZ = clampCellIndex(Math.floor((centerZ - scan - hash.minZ) * inverse), hash.dimZ);
  const maxCellZ = clampCellIndex(Math.floor((centerZ + scan - hash.minZ) * inverse), hash.dimZ);
  const radiusSquared = radius * radius;
  const capacity = out.length;
  let count = 0;
  for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
    for (let cy = minCellY; cy <= maxCellY; cy += 1) {
      const rowBase = (cz * hash.dimY + cy) * hash.dimX;
      const start = hash.cellStart[rowBase + minCellX];
      const end = hash.cellStart[rowBase + maxCellX + 1];
      for (let s = start; s < end; s += 1) {
        const v = hash.items[s];
        const base = v * 3;
        const dx = positions[base] - centerX;
        const dy = positions[base + 1] - centerY;
        const dz = positions[base + 2] - centerZ;
        if (dx * dx + dy * dy + dz * dz > radiusSquared) continue;
        if (count >= capacity) return SCULPT_QUERY_OVERFLOW;
        out[count] = v;
        count += 1;
      }
    }
  }
  return count;
}

/**
 * 브루트포스 참조 구현. 테스트의 정답지이자, 해시를 만들 가치가 없는 초소형 메시의 폴백이다.
 * 결과는 정점 인덱스 오름차순.
 */
export function bruteForceSculptSphere(
  positions: Float32Array,
  vertexCount: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
  out: Uint32Array,
): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  const radiusSquared = radius * radius;
  let count = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    const base = v * 3;
    const dx = positions[base] - centerX;
    const dy = positions[base + 1] - centerY;
    const dz = positions[base + 2] - centerZ;
    if (dx * dx + dy * dy + dz * dz > radiusSquared) continue;
    if (count >= out.length) return SCULPT_QUERY_OVERFLOW;
    out[count] = v;
    count += 1;
  }
  return count;
}

/**
 * 미러 좌표에 가장 가까운 정점 1개(반경 epsilon 안). 없으면 -1.
 * 동률이면 **작은 정점 인덱스**를 고른다(대칭 페어맵 결정성의 근거).
 */
export function findSculptNearestVertex(
  hash: SculptSpatialHash,
  positions: Float32Array,
  x: number,
  y: number,
  z: number,
  maxDistance: number,
): number {
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) return -1;
  const inverse = 1 / hash.cellSize;
  const minCellX = clampCellIndex(Math.floor((x - maxDistance - hash.minX) * inverse), hash.dimX);
  const maxCellX = clampCellIndex(Math.floor((x + maxDistance - hash.minX) * inverse), hash.dimX);
  const minCellY = clampCellIndex(Math.floor((y - maxDistance - hash.minY) * inverse), hash.dimY);
  const maxCellY = clampCellIndex(Math.floor((y + maxDistance - hash.minY) * inverse), hash.dimY);
  const minCellZ = clampCellIndex(Math.floor((z - maxDistance - hash.minZ) * inverse), hash.dimZ);
  const maxCellZ = clampCellIndex(Math.floor((z + maxDistance - hash.minZ) * inverse), hash.dimZ);
  let best = -1;
  let bestDistance = maxDistance * maxDistance;
  for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
    for (let cy = minCellY; cy <= maxCellY; cy += 1) {
      const rowBase = (cz * hash.dimY + cy) * hash.dimX;
      const start = hash.cellStart[rowBase + minCellX];
      const end = hash.cellStart[rowBase + maxCellX + 1];
      for (let s = start; s < end; s += 1) {
        const v = hash.items[s];
        const base = v * 3;
        const dx = positions[base] - x;
        const dy = positions[base + 1] - y;
        const dz = positions[base + 2] - z;
        const distance = dx * dx + dy * dy + dz * dz;
        if (distance < bestDistance || (distance === bestDistance && best >= 0 && v < best)) {
          bestDistance = distance;
          best = v;
        }
      }
    }
  }
  return best;
}
