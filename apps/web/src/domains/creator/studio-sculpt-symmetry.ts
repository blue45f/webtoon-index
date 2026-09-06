/**
 * Studio Sculpt — 1축 미러 대칭(페어맵 + 미러 복사).
 *
 * ## 왜 "재계산" 이 아니라 "미러 복사" 인가
 * 순진한 구현은 브러시를 중심 C 와 그 미러 C′ 에서 두 번 돌린다. 그러면 결과가 **비트 정확하게**
 * 대칭이 되지 않는다. 이유는 법선이다:
 *   cross(Mu, Mv) === diag(1,−1,−1)·cross(u,v) (M = diag(−1,1,1)) 는 IEEE 에서 정확하지만,
 *   이는 "같은 winding 의 미러 삼각형" 법선이 **−M·n** 이라는 뜻이다. 즉 미러 짝의 법선이 M·n 이
 *   되려면 삼각형 winding 이 뒤집혀 저장돼 있어야 하고, 게다가 정점당 누산 **순서**까지 짝끼리
 *   일치해야 한다. 임의 메시에서 그 두 조건이 동시에 성립한다고 가정할 수 없다.
 * 그래서 이 모듈은 권위(authority) 쪽 절반에서만 변위 d 를 계산하고, 짝 정점에는 M(d)(축 성분만
 * 부호 반전)를 **그대로 복사**한다. 그러면 대칭 정확성이 법선 잡음과 무관하게 구조적으로 성립한다
 * (테스트가 비트 동일성을 단언한다).
 *
 * ## 의미론 (Blender 와 다른 점을 분명히)
 * 이건 Blender 의 "대칭 스컬프팅"(두 브러시의 **중첩**)이 아니라 Mirror 모디파이어에 가깝다:
 * 결과의 비권위 절반은 권위 절반의 정확한 반사다. 브러시가 대칭 평면을 걸쳐 있어도 비권위 쪽
 * 정점은 직접 계산되지 않고 반사로만 채워진다. 평면 위 정점(self-paired)은 변위의 축 성분을
 * **명시적으로 0** 으로 만들어 한 번만 적용한다(`a + (−a) === +0` 같은 IEEE 성질에 기대지 않는다).
 * 권위 쪽은 스트로크 첫 dab 중심의 축 좌표 부호로 정해진다(0 이면 +).
 *
 * ## 짝이 없는 정점 (과대주장 금지)
 * 임포트된 비대칭 GLB 나 이미 비대칭으로 스컬프트된 메시에는 짝이 없는 정점이 생긴다. 이 정점은
 * 대칭 처리에서 제외되고(변위는 계산된 그대로 적용), `unpairedCount` 로 보고된다. 호출부는 이를
 * "대칭 정확 / 부분 근사" 로 표시해야 한다. 짝이 없다고 조용히 성공한 척하지 않는다.
 *
 * ## 한계
 * - 1축만. 다축(x+y), 방사(radial) 대칭 없음.
 * - 대칭 평면은 원점을 지나는 축 평면 고정. 임의 평면/오브젝트 로컬 축 없음.
 * - 토폴로지 대칭(topology mirror) 없음 — 순전히 좌표 근접 매칭이다.
 */

import {
  buildSculptSpatialHash,
  findSculptNearestVertex,
  type SculptSpatialHash,
} from "./studio-sculpt-spatial-hash";

export const SCULPT_SYMMETRY_AXES = ["x", "y", "z"] as const;

export type SculptSymmetryAxis = (typeof SCULPT_SYMMETRY_AXES)[number];

export const DEFAULT_SCULPT_SYMMETRY_EPSILON_RATIO = 1e-4;

export function normalizeSculptSymmetryAxis(value: unknown): SculptSymmetryAxis {
  return SCULPT_SYMMETRY_AXES.includes(value as SculptSymmetryAxis)
    ? (value as SculptSymmetryAxis)
    : "x";
}

export function sculptSymmetryAxisComponent(axis: SculptSymmetryAxis): 0 | 1 | 2 {
  return axis === "y" ? 1 : axis === "z" ? 2 : 0;
}

export interface SculptSymmetryMap {
  readonly axis: SculptSymmetryAxis;
  readonly component: 0 | 1 | 2;
  readonly epsilon: number;
  readonly vertexCount: number;
  /** partner[i] === i 는 평면 위(self-paired), −1 은 짝 없음. */
  readonly partner: Int32Array;
  readonly planarCount: number;
  /** 서로 다른 두 정점이 짝을 이룬 쌍의 개수(정점 수가 아니라 쌍 수). */
  readonly pairCount: number;
  readonly unpairedCount: number;
}

export interface SculptSymmetryOptions {
  readonly axis?: SculptSymmetryAxis;
  /** 절대 허용 오차. 생략하면 바운딩박스 대각 × DEFAULT_SCULPT_SYMMETRY_EPSILON_RATIO. */
  readonly epsilon?: number;
  /** 이미 만들어 둔 해시가 있으면 재사용한다(없으면 내부에서 만든다). */
  readonly hash?: SculptSpatialHash;
}

/**
 * 페어맵 빌드. 미러 좌표를 스패셜 해시로 조회하므로 O(V) 에 가깝다.
 * 결정성: i 를 오름차순으로 순회하고, 후보 동률은 작은 인덱스를 고른다.
 */
export function buildSculptSymmetryMap(
  positions: Float32Array,
  vertexCount: number,
  options: SculptSymmetryOptions = {},
): SculptSymmetryMap {
  const axis = normalizeSculptSymmetryAxis(options.axis);
  const component = sculptSymmetryAxisComponent(axis);
  const hash = options.hash ?? buildSculptSpatialHash(positions, vertexCount);
  let epsilon = options.epsilon;
  if (!(typeof epsilon === "number" && Number.isFinite(epsilon) && epsilon > 0)) {
    const diagonal = Math.sqrt(
      (hash.dimX * hash.cellSize) ** 2
      + (hash.dimY * hash.cellSize) ** 2
      + (hash.dimZ * hash.cellSize) ** 2,
    );
    epsilon = Math.max(diagonal * DEFAULT_SCULPT_SYMMETRY_EPSILON_RATIO, 1e-9);
  }

  const partner = new Int32Array(vertexCount).fill(-1);
  let planarCount = 0;
  let pairCount = 0;
  for (let i = 0; i < vertexCount; i += 1) {
    if (partner[i] !== -1) continue;
    const base = i * 3;
    const axisValue = positions[base + component];
    if (Math.abs(axisValue) <= epsilon) {
      partner[i] = i;
      planarCount += 1;
      continue;
    }
    const mirrorX = component === 0 ? -positions[base] : positions[base];
    const mirrorY = component === 1 ? -positions[base + 1] : positions[base + 1];
    const mirrorZ = component === 2 ? -positions[base + 2] : positions[base + 2];
    const found = findSculptNearestVertex(hash, positions, mirrorX, mirrorY, mirrorZ, epsilon);
    if (found < 0 || found === i || partner[found] !== -1) continue;
    partner[i] = found;
    partner[found] = i;
    pairCount += 1;
  }
  let unpairedCount = 0;
  for (let i = 0; i < vertexCount; i += 1) if (partner[i] === -1) unpairedCount += 1;
  return { axis, component, epsilon, vertexCount, partner, planarCount, pairCount, unpairedCount };
}

/**
 * 평면 위 정점의 축 성분을 **정확히 0** 으로 스냅한다(호출부가 명시적으로 부르는 파괴적 연산).
 * 미러 복사 불변식 `pos[partner[i]] === M(pos[i])` 가 self-paired 정점에서도 성립하려면
 * 축 성분이 정확히 ±0 이어야 하기 때문이다. 반환값은 실제로 바뀐 정점 수.
 */
export function snapSculptSymmetryPlane(positions: Float32Array, map: SculptSymmetryMap): number {
  let changed = 0;
  for (let i = 0; i < map.vertexCount; i += 1) {
    if (map.partner[i] !== i) continue;
    const index = i * 3 + map.component;
    if (positions[index] === 0) continue;
    positions[index] = 0;
    changed += 1;
  }
  return changed;
}

/**
 * 미러 복사 불변식이 **비트 단위로** 성립하는지 검사한다(테스트와 UI 배지의 근거).
 * 비교는 `===` 다 — `Object.is` 를 쓰면 평면 위 정점에서 `+0` 과 `-0` 이 다르다고 나와
 * (같은 좌표인데도) 거짓 실패가 난다. NaN 은 `!==` 로 자연히 걸러진다.
 */
export function sculptSymmetryIsExact(positions: Float32Array, map: SculptSymmetryMap): boolean {
  for (let i = 0; i < map.vertexCount; i += 1) {
    const j = map.partner[i];
    if (j < 0) continue;
    const a = i * 3;
    const b = j * 3;
    for (let c = 0; c < 3; c += 1) {
      const expected = c === map.component ? -positions[a + c] : positions[a + c];
      if (positions[b + c] !== expected) return false;
    }
  }
  return true;
}

/** 첫 dab 중심의 축 좌표로 권위 쪽을 정한다(0 이면 +). */
export function sculptSymmetryAuthoritySign(centerAxisValue: number): 1 | -1 {
  return Number.isFinite(centerAxisValue) && centerAxisValue < 0 ? -1 : 1;
}

/** 이 정점이 권위 쪽(또는 평면 위)인가 — 비권위 쪽은 반사로만 채워진다. */
export function sculptSymmetryIsAuthorityVertex(
  positions: Float32Array,
  map: SculptSymmetryMap,
  vertex: number,
  authoritySign: 1 | -1,
): boolean {
  if (map.partner[vertex] === -1) return true; // 짝 없음 → 대칭 처리 제외, 직접 계산.
  if (map.partner[vertex] === vertex) return true; // 평면 위.
  return positions[vertex * 3 + map.component] * authoritySign > 0;
}
