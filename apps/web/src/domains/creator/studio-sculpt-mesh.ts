/**
 * Studio Sculpt — 인덱스드 삼각형 메시 모델 + 결정적 생성기 + 법선/인접 재계산.
 *
 * ## 이 서브시스템이 아닌 것 (정직한 한계)
 * 이것은 Blender 스컬프트 모드가 **아니다**. 없는 것을 먼저 적는다:
 *   - 동적 토폴로지(dyntopo: 브러시 반경 안에서 온디맨드 세분/붕괴) 없음. 이유는 아래 "동적
 *     토폴로지" 절에 숫자와 함께 적었다. 대신 스트로크와 무관한 **결정적 균일 세분**을 준다.
 *   - 리메시(voxel/quad), 멀티레졸루션, 스컬프트 레이어 없음.
 *   - 마스크/하이드, 버텍스 컬러·텍스처 페인팅, 트림/부울, 클로스 없음.
 *   - 알파/텍스처 브러시, anchored·drag-dot 스트로크 방식, 압력 커브 편집기 없음.
 *   - 브러시는 draw / clay / smooth / grab / pinch 5종, 미러 대칭은 1축뿐이다.
 *   - UV/접선(tangent) 없음. 정점 위치와 법선만 다룬다.
 *
 * ## 데이터 모델
 * `SculptMesh` 는 three.js 나 WebGPU 를 전혀 모르는 순수 타입드어레이 묶음이다.
 *   positions: Float32Array(3V) · normals: Float32Array(3V) · indices: Uint32Array(3T)
 * 이 레포의 정식 직렬 형태(`StudioBg3dCanonicalGeometryPayload`)와 무손실 상호변환된다
 * (`sculptMeshFromCanonicalGeometry` / `sculptMeshToCanonicalGeometry`). 렌더러 결합은
 * `studio-sculpt-render-bridge.ts` 의 sink 인터페이스가 전담한다.
 *
 * ## 결정성 계약 (이 파일의 존재 이유)
 * 부동소수 누산은 순서에 따라 마지막 비트가 달라진다. 그래서:
 *   1. 전역 법선 재계산(`recomputeSculptNormals`)은 **삼각형 인덱스 오름차순**으로 면적 가중
 *      법선(정규화하지 않은 외적 = 2×면적 가중)을 누산한다.
 *   2. 부분 재계산(`recomputeSculptNormalsForVertices`)은 정점→삼각형 CSR 을 쓰되, CSR 은
 *      카운팅 소트를 삼각형 오름차순으로 채우므로 각 정점의 누산 순서가 (1)과 **동일**하다.
 *      따라서 "전역 재계산 == 전 정점 부분 재계산" 이 비트 동일하다(테스트로 잠갔다).
 *   3. 인접(`buildSculptVertexAdjacency`)은 이웃 정점 인덱스를 오름차순 정렬 + 중복 제거한다.
 *      smooth 브러시의 라플라시안 평균이 순회 순서에 흔들리지 않게 하기 위해서다.
 *   4. `Math.random` / `Date.now` 를 쓰지 않는다(소스 정적 검사 테스트로 강제).
 *
 * ## 생성기가 x축 미러 대칭을 "비트 정확"하게 만족하는 이유
 * IEEE754 에서 부호 반전은 정확하고, 곱셈은 교환법칙이 정확하며, `fl(-a - (-b)) === -fl(a - b)`
 * 이다. 그래서 생성기가 x 좌표를 "정확히 부호가 뒤집힌 값"으로만 방출하면 미러 짝의 위치는
 * 비트 동일해진다.
 *   - 정이십면체: 좌표가 (±1, ±φ, 0) / (0, ±1, ±φ) / (±φ, 0, ±1) 이라 집합이 x→−x 로 닫혀 있고,
 *     정규화 길이 sqrt(x²+y²+z²) 도 (−x)² === x² 이라 짝끼리 동일하다.
 *   - 세분: 중점 (a+b)/2 는 성분별이라 x 성분이 정확히 부호 반전되고, 덧셈 교환법칙이 정확하므로
 *     미러 엣지가 (b′,a′) 순서로 저장돼도 같은 값이 나온다.
 *   - UV 구: `Math.cos(Math.PI - t) !== -Math.cos(t)` 이므로 경도를 직접 계산하면 대칭이 깨진다.
 *     그래서 1/4 구간만 삼각함수로 구하고 나머지는 **부호 반전·스왑으로만** 유도하며, 4분점
 *     (0, S/4, S/2, 3S/4)은 (1,0)/(0,1)/(−1,0)/(0,−1) 리터럴로 못 박는다.
 *   - 평면 격자: x = (2i − nx) × halfCell. (2i − nx) 는 정확한 정수이고 i′ = nx − i 에서 정확히
 *     부호가 뒤집힌다.
 *
 * ## 동적 토폴로지를 하지 않는 이유 (정직한 설명)
 * (a) 언두 모델이 "정점 델타"인데 토폴로지 변경은 정점 인덱스를 무효화한다. 그러면 과거 델타 전부의
 *     인덱스 리맵 + 별도 토폴로지 델타 레코드가 필요해 완전히 다른(그리고 훨씬 큰) 설계가 된다.
 * (b) 스패셜 해시·대칭 페어맵·인접 CSR 이 전부 고정 정점 수 위에 세워져 있어, 스트로크 도중
 *     증분 삽입 + 재빌드 정책이 통째로 따라붙는다.
 * (c) 결정성을 지키려면 캐노니컬 엣지 순서와 안정적 신규 정점 id 규칙이 필요해 테스트 표면이
 *     두 배가 된다.
 * 대신 `subdivideSculptMesh` (1→4 균일 세분, V′ = V + E, T′ = 4T)를 스트로크와 분리된 독립
 * 조작으로 제공한다. 실사용 이득(해상도 올리기)의 대부분을 가져오면서 위 세 위험이 전부 사라진다.
 * 이것을 "dyntopo 상당"이라고 부르지 않는다.
 *
 * ## wasm64 판단 (숫자로)
 * 정점당 상주 바이트 ≈ 위치 12 + 법선 12 + 인덱스(닫힌 메시 T≈2V 이므로 24) + 유니폼 그리드 8 +
 * 대칭 페어맵 4 ≈ **60B/정점**. wasm32 주소공간 4GiB ÷ 60B ≈ **71.6M 정점**이 되어야 넘친다.
 * 이 레포가 스스로 정한 상한은 4,000,000 정점(= 240MB, 4GiB 의 5.6%)이고, 실사용(icosphere
 * subdiv 5~8 = 10,242 ~ 655,362 정점)은 655k × 60B ≈ 39MB (4GiB 의 0.9%)다. 즉 wasm64 가 푸는
 * 문제는 레포 예산보다 18배, 실사용보다 110배 먼 지점에서만 발생한다. 반대로 비용은 즉시 발생한다
 * — 이 레포에 우리가 컴파일하는 wasm 은 0개라(유일한 wasm 은 사전빌드 rapier 바이너리) 툴체인을
 * 0에서 1로 늘려야 하고, memory64 는 4GiB 가드 리전 트릭을 잃어 경계검사가 붙으며(포인터 밀집
 * 루프 통상 10~20% 손해), TS 참조 구현과의 비트 동일성 계약이 깨진다. **하지 않는다.** 성능이
 * 실제로 문제되면 순서는 (1) Worker + SharedArrayBuffer, (2) dirty-range 업로드 최적화,
 * (3) wasm32 SIMD 이며 wasm64 는 그 어디에도 없다.
 */

import type {
  StudioBg3dCanonicalGeometryPayload,
  StudioBg3dGeometryWorkerFormat,
} from "./bg3d/studio-bg3d-geometry-worker-protocol";

// ---------------------------------------------------------------------------
// 예산 · 타입
// ---------------------------------------------------------------------------

/**
 * 정점/삼각형 상한. bg3d 지오메트리 워커 예산(4,000,000 / 2,000,000) **이하**로 못 박는다 —
 * 스컬프트 메시는 언제든 그 파이프라인으로 흘러갈 수 있으므로 더 관대해서는 안 된다.
 */
export const STUDIO_SCULPT_MAX_VERTICES = 1_000_000;
export const STUDIO_SCULPT_MAX_TRIANGLES = 2_000_000;

export type SculptMeshFailureCode =
  | "vertex-budget-exceeded"
  | "triangle-budget-exceeded"
  | "index-out-of-range"
  | "malformed-arrays";

export class SculptMeshError extends Error {
  readonly code: SculptMeshFailureCode;

  constructor(code: SculptMeshFailureCode, message: string) {
    super(message);
    this.name = "SculptMeshError";
    this.code = code;
  }
}

/**
 * 인덱스드 삼각형 메시. 배열은 **가변**이다(스컬프팅이 positions 를 제자리에서 고친다).
 * vertexCount/triangleCount 는 배열 길이에서 유도된 불변 값이다.
 */
export interface SculptMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/** 정점 → 인접 삼각형 CSR. triangles 슬라이스는 항상 삼각형 인덱스 오름차순이다. */
export interface SculptVertexTriangleCsr {
  readonly offsets: Uint32Array;
  readonly triangles: Uint32Array;
}

/** 정점 → 인접 정점 CSR. neighbors 슬라이스는 오름차순 정렬 + 중복 제거되어 있다. */
export interface SculptVertexAdjacency {
  readonly offsets: Uint32Array;
  readonly neighbors: Uint32Array;
}

// ---------------------------------------------------------------------------
// 생성 · 검증
// ---------------------------------------------------------------------------

function assertMeshBudget(vertexCount: number, triangleCount: number): void {
  if (vertexCount > STUDIO_SCULPT_MAX_VERTICES) {
    throw new SculptMeshError(
      "vertex-budget-exceeded",
      `vertexCount ${vertexCount} > ${STUDIO_SCULPT_MAX_VERTICES}`,
    );
  }
  if (triangleCount > STUDIO_SCULPT_MAX_TRIANGLES) {
    throw new SculptMeshError(
      "triangle-budget-exceeded",
      `triangleCount ${triangleCount} > ${STUDIO_SCULPT_MAX_TRIANGLES}`,
    );
  }
}

/**
 * 소유권 이전 생성자 — 넘긴 배열을 복사하지 않고 그대로 소유한다. 법선은 즉시 재계산된다.
 * 배열 길이·인덱스 범위를 fail-closed 로 검증한다(조용한 손상 금지).
 */
export function createSculptMesh(positions: Float32Array, indices: Uint32Array): SculptMesh {
  if (positions.length % 3 !== 0 || indices.length % 3 !== 0) {
    throw new SculptMeshError("malformed-arrays", "positions/indices length must be a multiple of 3");
  }
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  assertMeshBudget(vertexCount, triangleCount);
  for (let i = 0; i < indices.length; i += 1) {
    if (indices[i] >= vertexCount) {
      throw new SculptMeshError("index-out-of-range", `index ${indices[i]} >= vertexCount ${vertexCount}`);
    }
  }
  const mesh: SculptMesh = {
    positions,
    normals: new Float32Array(positions.length),
    indices,
    vertexCount,
    triangleCount,
  };
  recomputeSculptNormals(mesh);
  return mesh;
}

/** 깊은 복사 — 테스트에서 "같은 입력 두 번" 을 만들 때와 언두 기준선을 뜰 때 쓴다. */
export function cloneSculptMesh(mesh: SculptMesh): SculptMesh {
  return {
    positions: Float32Array.from(mesh.positions),
    normals: Float32Array.from(mesh.normals),
    indices: Uint32Array.from(mesh.indices),
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
  };
}

// ---------------------------------------------------------------------------
// 법선
// ---------------------------------------------------------------------------

function normalizeInPlace(target: Float32Array, base: number): void {
  const x = target[base];
  const y = target[base + 1];
  const z = target[base + 2];
  const lengthSquared = x * x + y * y + z * z;
  if (lengthSquared <= 0) return; // 퇴화 정점(고립/영면적) — 0 법선을 그대로 둔다.
  const inverse = 1 / Math.sqrt(lengthSquared);
  target[base] = x * inverse;
  target[base + 1] = y * inverse;
  target[base + 2] = z * inverse;
}

/** 전역 법선 재계산 — 삼각형 오름차순 면적 가중 누산 후 정규화. */
export function recomputeSculptNormals(mesh: SculptMesh): void {
  const { positions, normals, indices, triangleCount } = mesh;
  normals.fill(0);
  for (let t = 0; t < triangleCount; t += 1) {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    const ax = positions[ia];
    const ay = positions[ia + 1];
    const az = positions[ia + 2];
    const ux = positions[ib] - ax;
    const uy = positions[ib + 1] - ay;
    const uz = positions[ib + 2] - az;
    const vx = positions[ic] - ax;
    const vy = positions[ic + 1] - ay;
    const vz = positions[ic + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[ia] += nx;
    normals[ia + 1] += ny;
    normals[ia + 2] += nz;
    normals[ib] += nx;
    normals[ib + 1] += ny;
    normals[ib + 2] += nz;
    normals[ic] += nx;
    normals[ic + 1] += ny;
    normals[ic + 2] += nz;
  }
  for (let v = 0; v < mesh.vertexCount; v += 1) normalizeInPlace(normals, v * 3);
}

function accumulateTriangleNormal(mesh: SculptMesh, t: number, vertex: number): void {
  const { positions, normals, indices } = mesh;
  const ia = indices[t * 3] * 3;
  const ib = indices[t * 3 + 1] * 3;
  const ic = indices[t * 3 + 2] * 3;
  const ax = positions[ia];
  const ay = positions[ia + 1];
  const az = positions[ia + 2];
  const ux = positions[ib] - ax;
  const uy = positions[ib + 1] - ay;
  const uz = positions[ib + 2] - az;
  const vx = positions[ic] - ax;
  const vy = positions[ic + 1] - ay;
  const vz = positions[ic + 2] - az;
  const base = vertex * 3;
  normals[base] += uy * vz - uz * vy;
  normals[base + 1] += uz * vx - ux * vz;
  normals[base + 2] += ux * vy - uy * vx;
}

/**
 * 부분 법선 재계산. `vertices` 의 각 정점에 대해 인접 삼각형을 CSR 순서(= 삼각형 오름차순)로
 * 누산하므로 결과가 전역 재계산과 비트 동일하다. 중복 정점이 들어와도 안전하도록 방문 비트맵을
 * 쓴다(같은 정점을 두 번 누산하면 값이 2배가 되어 계약이 깨지므로 fail-closed 가 아니라 무시).
 */
export function recomputeSculptNormalsForVertices(
  mesh: SculptMesh,
  csr: SculptVertexTriangleCsr,
  vertices: Uint32Array | readonly number[],
  count: number,
  visitScratch?: Uint8Array,
): void {
  const visited = visitScratch && visitScratch.length >= mesh.vertexCount
    ? visitScratch
    : new Uint8Array(mesh.vertexCount);
  const limit = Math.min(count, vertices.length);
  for (let k = 0; k < limit; k += 1) {
    const v = vertices[k];
    if (v >= mesh.vertexCount || visited[v] === 1) continue;
    visited[v] = 1;
    const base = v * 3;
    mesh.normals[base] = 0;
    mesh.normals[base + 1] = 0;
    mesh.normals[base + 2] = 0;
    const start = csr.offsets[v];
    const end = csr.offsets[v + 1];
    for (let s = start; s < end; s += 1) accumulateTriangleNormal(mesh, csr.triangles[s], v);
    normalizeInPlace(mesh.normals, base);
  }
  // 스크래치를 재사용하려면 호출부가 비워야 하므로, 우리가 세운 비트만 되돌린다.
  for (let k = 0; k < limit; k += 1) {
    const v = vertices[k];
    if (v < mesh.vertexCount) visited[v] = 0;
  }
}

// ---------------------------------------------------------------------------
// 인접 (CSR)
// ---------------------------------------------------------------------------

/** 정점 → 인접 삼각형. 카운팅 소트 2패스, 각 슬라이스는 삼각형 오름차순. */
export function buildSculptVertexTriangleCsr(mesh: SculptMesh): SculptVertexTriangleCsr {
  const { indices, vertexCount, triangleCount } = mesh;
  const offsets = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < indices.length; i += 1) offsets[indices[i] + 1] += 1;
  for (let v = 0; v < vertexCount; v += 1) offsets[v + 1] += offsets[v];
  const cursor = Uint32Array.from(offsets.subarray(0, vertexCount));
  const triangles = new Uint32Array(indices.length);
  for (let t = 0; t < triangleCount; t += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const v = indices[t * 3 + corner];
      triangles[cursor[v]] = t;
      cursor[v] += 1;
    }
  }
  return { offsets, triangles };
}

/** 정점 → 인접 정점. 오름차순 정렬 + 중복 제거(라플라시안 결정성의 근거). */
export function buildSculptVertexAdjacency(mesh: SculptMesh): SculptVertexAdjacency {
  const { indices, vertexCount, triangleCount } = mesh;
  const rawOffsets = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < indices.length; i += 1) rawOffsets[indices[i] + 1] += 2;
  for (let v = 0; v < vertexCount; v += 1) rawOffsets[v + 1] += rawOffsets[v];
  const cursor = Uint32Array.from(rawOffsets.subarray(0, vertexCount));
  const raw = new Uint32Array(rawOffsets[vertexCount]);
  for (let t = 0; t < triangleCount; t += 1) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    raw[cursor[a]] = b;
    raw[cursor[a] + 1] = c;
    cursor[a] += 2;
    raw[cursor[b]] = a;
    raw[cursor[b] + 1] = c;
    cursor[b] += 2;
    raw[cursor[c]] = a;
    raw[cursor[c] + 1] = b;
    cursor[c] += 2;
  }
  const offsets = new Uint32Array(vertexCount + 1);
  const neighbors = new Uint32Array(raw.length);
  let write = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    offsets[v] = write;
    const slice = raw.subarray(rawOffsets[v], rawOffsets[v + 1]);
    slice.sort();
    let previous = -1;
    for (let s = 0; s < slice.length; s += 1) {
      const n = slice[s];
      if (n === v || n === previous) continue;
      neighbors[write] = n;
      write += 1;
      previous = n;
    }
  }
  offsets[vertexCount] = write;
  return { offsets, neighbors: neighbors.slice(0, write) };
}

// ---------------------------------------------------------------------------
// 균일 세분 (1 → 4)
// ---------------------------------------------------------------------------

/**
 * 결정적 균일 세분. 각 삼각형을 엣지 중점 3개로 4개로 쪼갠다.
 *   - 엣지 키는 문자열이 아니라 `min * vertexCount + max` (V ≤ 2^26 이면 2^53 안이라 정확).
 *   - 신규 정점 id 는 **삼각형 오름차순 순회에서 그 엣지를 처음 만난 순서**로 부여된다 —
 *     같은 입력이면 항상 같은 id 배치가 나온다.
 *   - 결과 불변식: V′ = V + E, T′ = 4T.
 * 세분은 스트로크와 완전히 분리된 조작이다(스트로크 도중 호출하면 인덱스 계약이 깨진다).
 */
export function subdivideSculptMesh(mesh: SculptMesh): SculptMesh {
  const { positions, indices, vertexCount, triangleCount } = mesh;
  const newTriangleCount = triangleCount * 4;
  // 오일러 상한: 닫힌 메시에서 E = 3T/2, 일반적으로 E ≤ 3T.
  const maxNewVertices = vertexCount + triangleCount * 3;
  assertMeshBudget(maxNewVertices, newTriangleCount);

  const midpointOf = new Map<number, number>();
  const outPositions = new Float32Array(maxNewVertices * 3);
  outPositions.set(positions.subarray(0, vertexCount * 3));
  let nextVertex = vertexCount;

  const edgeMidpoint = (a: number, b: number): number => {
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    const key = low * vertexCount + high;
    const cached = midpointOf.get(key);
    if (cached !== undefined) return cached;
    const id = nextVertex;
    nextVertex += 1;
    const ia = a * 3;
    const ib = b * 3;
    // 성분별 중점 — 덧셈 교환법칙이 정확하므로 (a,b)/(b,a) 어느 쪽이든 같은 비트가 나온다.
    outPositions[id * 3] = (positions[ia] + positions[ib]) * 0.5;
    outPositions[id * 3 + 1] = (positions[ia + 1] + positions[ib + 1]) * 0.5;
    outPositions[id * 3 + 2] = (positions[ia + 2] + positions[ib + 2]) * 0.5;
    midpointOf.set(key, id);
    return id;
  };

  const outIndices = new Uint32Array(newTriangleCount * 3);
  let write = 0;
  const emit = (a: number, b: number, c: number): void => {
    outIndices[write] = a;
    outIndices[write + 1] = b;
    outIndices[write + 2] = c;
    write += 3;
  };
  for (let t = 0; t < triangleCount; t += 1) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    const ab = edgeMidpoint(a, b);
    const bc = edgeMidpoint(b, c);
    const ca = edgeMidpoint(c, a);
    emit(a, ab, ca);
    emit(ab, b, bc);
    emit(ca, bc, c);
    emit(ab, bc, ca);
  }
  return createSculptMesh(outPositions.slice(0, nextVertex * 3), outIndices);
}

// ---------------------------------------------------------------------------
// 결정적 베이스 메시 생성기
// ---------------------------------------------------------------------------

function projectToSphere(positions: Float32Array, vertexCount: number, radius: number): void {
  for (let v = 0; v < vertexCount; v += 1) {
    const base = v * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    const lengthSquared = x * x + y * y + z * z;
    if (lengthSquared <= 0) continue;
    const scale = radius / Math.sqrt(lengthSquared);
    positions[base] = x * scale;
    positions[base + 1] = y * scale;
    positions[base + 2] = z * scale;
  }
}

const ICOSAHEDRON_FACES: readonly number[] = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
  1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
  4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];

/**
 * 정이십면체 기반 구. `subdivisions` 회 균일 세분 후 반지름으로 투영한다.
 * 정점 수 = 10·4^n + 2 (n=0 → 12, n=4 → 2,562, n=6 → 40,962).
 * x=0 평면에 대해 **비트 정확**한 미러 대칭을 만족한다(위 docstring 참고).
 */
export function createSculptIcosphere(subdivisions = 3, radius = 1): SculptMesh {
  const steps = Math.max(0, Math.min(7, Math.floor(subdivisions)));
  const phi = (1 + Math.sqrt(5)) / 2;
  const base = new Float32Array([
    -1, phi, 0, 1, phi, 0, -1, -phi, 0, 1, -phi, 0,
    0, -1, phi, 0, 1, phi, 0, -1, -phi, 0, 1, -phi,
    phi, 0, -1, phi, 0, 1, -phi, 0, -1, -phi, 0, 1,
  ]);
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;
  projectToSphere(base, 12, safeRadius);
  let mesh = createSculptMesh(base, Uint32Array.from(ICOSAHEDRON_FACES));
  for (let step = 0; step < steps; step += 1) {
    mesh = subdivideSculptMesh(mesh);
    projectToSphere(mesh.positions, mesh.vertexCount, safeRadius);
    recomputeSculptNormals(mesh);
  }
  return mesh;
}

/**
 * UV 구. `segments` 는 4의 배수로 올림된다(1/4 대칭 유도의 전제). 극점 2개는 공유되고 경도
 * 이음매도 정점을 중복하지 않으므로 닫힌 다양체가 나온다(smooth 브러시가 이음매에서 끊기지 않게).
 */
export function createSculptUvSphere(segments = 16, rings = 12, radius = 1): SculptMesh {
  const rawSegments = Math.max(4, Math.floor(segments));
  const s = Math.ceil(rawSegments / 4) * 4;
  const r = Math.max(2, Math.floor(rings));
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 1;

  // 1/4 구간만 삼각함수로 구하고 나머지는 부호 반전/스왑으로 유도 → x 미러가 비트 정확.
  const cosLon = new Float64Array(s);
  const sinLon = new Float64Array(s);
  const quarter = s / 4;
  for (let j = 0; j <= quarter; j += 1) {
    const angle = (2 * Math.PI * j) / s;
    cosLon[j] = Math.cos(angle);
    sinLon[j] = Math.sin(angle);
  }
  cosLon[0] = 1;
  sinLon[0] = 0;
  cosLon[quarter] = 0;
  sinLon[quarter] = 1;
  for (let j = quarter + 1; j < s; j += 1) {
    if (j <= s / 2) {
      const k = s / 2 - j;
      cosLon[j] = -cosLon[k];
      sinLon[j] = sinLon[k];
    } else if (j <= 3 * quarter) {
      const k = j - s / 2;
      cosLon[j] = -cosLon[k];
      sinLon[j] = -sinLon[k];
    } else {
      const k = s - j;
      cosLon[j] = cosLon[k];
      sinLon[j] = -sinLon[k];
    }
  }

  const interiorRows = r - 1;
  const vertexCount = 2 + interiorRows * s;
  const positions = new Float32Array(vertexCount * 3);
  positions[0] = 0;
  positions[1] = safeRadius;
  positions[2] = 0;
  for (let row = 0; row < interiorRows; row += 1) {
    const polar = (Math.PI * (row + 1)) / r;
    const y = Math.cos(polar) * safeRadius;
    const ringRadius = Math.sin(polar) * safeRadius;
    for (let j = 0; j < s; j += 1) {
      const base = (1 + row * s + j) * 3;
      positions[base] = ringRadius * cosLon[j];
      positions[base + 1] = y;
      positions[base + 2] = ringRadius * sinLon[j];
    }
  }
  const south = vertexCount - 1;
  positions[south * 3] = 0;
  positions[south * 3 + 1] = -safeRadius;
  positions[south * 3 + 2] = 0;

  const triangleCount = s * 2 * (r - 1);
  const indices = new Uint32Array(triangleCount * 3);
  let write = 0;
  const rowVertex = (row: number, j: number): number => 1 + row * s + (j % s);
  for (let j = 0; j < s; j += 1) {
    indices[write] = 0;
    indices[write + 1] = rowVertex(0, j + 1);
    indices[write + 2] = rowVertex(0, j);
    write += 3;
  }
  for (let row = 0; row < interiorRows - 1; row += 1) {
    for (let j = 0; j < s; j += 1) {
      const a = rowVertex(row, j);
      const b = rowVertex(row, j + 1);
      const c = rowVertex(row + 1, j + 1);
      const d = rowVertex(row + 1, j);
      indices[write] = a;
      indices[write + 1] = b;
      indices[write + 2] = c;
      indices[write + 3] = a;
      indices[write + 4] = c;
      indices[write + 5] = d;
      write += 6;
    }
  }
  for (let j = 0; j < s; j += 1) {
    indices[write] = south;
    indices[write + 1] = rowVertex(interiorRows - 1, j);
    indices[write + 2] = rowVertex(interiorRows - 1, j + 1);
    write += 3;
  }
  return createSculptMesh(positions, indices);
}

/**
 * 평면 격자(y = 0). 스패셜 해시의 퇴화 바운딩박스(한 축 두께 0) 경로와 경계 정점 처리를
 * 테스트하기 위한 베이스이기도 하다. x 미러가 비트 정확하다.
 */
export function createSculptPlaneGrid(divisionsX = 8, divisionsZ = 8, size = 2): SculptMesh {
  const nx = Math.max(1, Math.floor(divisionsX));
  const nz = Math.max(1, Math.floor(divisionsZ));
  const extent = Number.isFinite(size) && size > 0 ? size : 2;
  const halfCellX = extent / (2 * nx);
  const halfCellZ = extent / (2 * nz);
  const vertexCount = (nx + 1) * (nz + 1);
  const positions = new Float32Array(vertexCount * 3);
  for (let k = 0; k <= nz; k += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const base = (k * (nx + 1) + i) * 3;
      positions[base] = (2 * i - nx) * halfCellX;
      positions[base + 1] = 0;
      positions[base + 2] = (2 * k - nz) * halfCellZ;
    }
  }
  const indices = new Uint32Array(nx * nz * 6);
  let write = 0;
  for (let k = 0; k < nz; k += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = k * (nx + 1) + i;
      const b = a + 1;
      const c = a + (nx + 1);
      const d = c + 1;
      indices[write] = a;
      indices[write + 1] = c;
      indices[write + 2] = b;
      indices[write + 3] = b;
      indices[write + 4] = c;
      indices[write + 5] = d;
      write += 6;
    }
  }
  return createSculptMesh(positions, indices);
}

// ---------------------------------------------------------------------------
// bg3d 캐노니컬 지오메트리 상호변환
// ---------------------------------------------------------------------------

/** bg3d 워커 payload → SculptMesh. 인덱스 없는(soup) 지오메트리와 points 는 거부한다. */
export function sculptMeshFromCanonicalGeometry(
  payload: StudioBg3dCanonicalGeometryPayload,
): SculptMesh | null {
  if (payload.kind !== "mesh" || payload.index === null) return null;
  const position = payload.attributes.find((attribute) => attribute.name === "position");
  if (!position || position.itemSize !== 3) return null;
  const positions = new Float32Array(position.buffer.slice(0));
  const indices = new Uint32Array(payload.index.buffer.slice(0));
  if (positions.length !== payload.vertexCount * 3) return null;
  if (indices.length !== payload.index.count) return null;
  try {
    return createSculptMesh(positions, indices);
  } catch {
    return null;
  }
}

/** SculptMesh → bg3d 워커 payload(위치 + 법선 + 인덱스). */
export function sculptMeshToCanonicalGeometry(
  mesh: SculptMesh,
  format: StudioBg3dGeometryWorkerFormat = "ply",
): StudioBg3dCanonicalGeometryPayload {
  const positionBuffer = mesh.positions.slice().buffer;
  const normalBuffer = mesh.normals.slice().buffer;
  const indexBuffer = mesh.indices.slice().buffer;
  return {
    format,
    kind: "mesh",
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
    byteLength: positionBuffer.byteLength + normalBuffer.byteLength + indexBuffer.byteLength,
    attributes: [
      {
        name: "position",
        itemSize: 3,
        count: mesh.vertexCount,
        normalized: false,
        arrayType: "float32",
        buffer: positionBuffer,
      },
      {
        name: "normal",
        itemSize: 3,
        count: mesh.vertexCount,
        normalized: false,
        arrayType: "float32",
        buffer: normalBuffer,
      },
    ],
    index: { count: mesh.indices.length, arrayType: "uint32", buffer: indexBuffer },
  };
}

/** 축 정렬 바운딩박스 — 해시 셀 크기 산정과 대칭 epsilon 스케일에 쓴다. */
export function sculptMeshBounds(mesh: SculptMesh): {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
} {
  const { positions, vertexCount } = mesh;
  if (vertexCount === 0) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  }
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
  return { minX, minY, minZ, maxX, maxY, maxZ };
}
