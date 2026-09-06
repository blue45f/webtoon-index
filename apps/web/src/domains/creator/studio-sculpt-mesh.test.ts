import { describe, expect, it } from "vitest";

import {
  STUDIO_SCULPT_MAX_VERTICES,
  SculptMeshError,
  buildSculptVertexAdjacency,
  buildSculptVertexTriangleCsr,
  cloneSculptMesh,
  createSculptIcosphere,
  createSculptMesh,
  createSculptPlaneGrid,
  createSculptUvSphere,
  recomputeSculptNormals,
  recomputeSculptNormalsForVertices,
  sculptMeshBounds,
  sculptMeshFromCanonicalGeometry,
  sculptMeshToCanonicalGeometry,
  subdivideSculptMesh,
  type SculptMesh,
} from "./studio-sculpt-mesh";

function expectBitIdentical(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  let mismatch = -1;
  for (let i = 0; i < actual.length; i += 1) {
    if (!Object.is(actual[i], expected[i])) {
      mismatch = i;
      break;
    }
  }
  expect({ index: mismatch, actual: actual[mismatch], expected: expected[mismatch] }).toEqual({
    index: -1,
    actual: undefined,
    expected: undefined,
  });
}

/** x축 미러 짝을 좌표 근접으로 찾아 위치가 비트 정확히 반사인지 본다(대칭 모듈과 독립적으로). */
function assertExactMirrorX(mesh: SculptMesh): { paired: number; planar: number } {
  const { positions, vertexCount } = mesh;
  const key = (x: number, y: number, z: number): string => `${x}|${y}|${z}`;
  const byKey = new Map<string, number>();
  for (let v = 0; v < vertexCount; v += 1) {
    byKey.set(key(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]), v);
  }
  let paired = 0;
  let planar = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    if (x === 0) {
      planar += 1;
      continue;
    }
    const partner = byKey.get(key(-x, y, z));
    expect(partner, `vertex ${v} (${x}, ${y}, ${z}) has no bit-exact mirror`).toBeDefined();
    paired += 1;
  }
  return { paired, planar };
}

/** 엣지 사용 횟수 히스토그램 — 닫힌 다양체면 모든 엣지가 정확히 2회 쓰인다. */
function countSculptEdgeUses(mesh: SculptMesh): { edges: number; allUsedTwice: boolean } {
  const uses = new Map<number, number>();
  for (let t = 0; t < mesh.triangleCount; t += 1) {
    const corners = [mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]];
    for (let c = 0; c < 3; c += 1) {
      const a = corners[c];
      const b = corners[(c + 1) % 3];
      const key = a < b ? a * mesh.vertexCount + b : b * mesh.vertexCount + a;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  let allUsedTwice = true;
  for (const value of uses.values()) if (value !== 2) allUsedTwice = false;
  return { edges: uses.size, allUsedTwice };
}

describe("sculpt mesh — 생성기", () => {
  it("아이코스피어의 정점/삼각형 수가 10·4^n + 2 / 20·4^n 공식과 일치한다", () => {
    for (let level = 0; level <= 3; level += 1) {
      const mesh = createSculptIcosphere(level);
      expect(mesh.vertexCount).toBe(10 * 4 ** level + 2);
      expect(mesh.triangleCount).toBe(20 * 4 ** level);
    }
  });

  it("아이코스피어의 모든 정점이 반지름 위에 있고 법선이 바깥을 향한다", () => {
    const mesh = createSculptIcosphere(2, 2);
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      const x = mesh.positions[v * 3];
      const y = mesh.positions[v * 3 + 1];
      const z = mesh.positions[v * 3 + 2];
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(2, 5);
      const dot = x * mesh.normals[v * 3] + y * mesh.normals[v * 3 + 1] + z * mesh.normals[v * 3 + 2];
      expect(dot).toBeGreaterThan(0);
    }
  });

  it("아이코스피어는 x축 미러 대칭이 비트 정확하다", () => {
    const mesh = createSculptIcosphere(3);
    const { paired, planar } = assertExactMirrorX(mesh);
    expect(planar).toBeGreaterThan(0);
    expect(paired + planar).toBe(mesh.vertexCount);
  });

  it("아이코스피어는 닫힌 다양체다 — 모든 엣지가 정확히 두 삼각형에 속한다", () => {
    const mesh = createSculptIcosphere(2);
    expect(countSculptEdgeUses(mesh)).toEqual({ edges: 480, allUsedTwice: true });
  });

  it("UV 구는 극점·이음매를 공유하고 x축 미러 대칭이 비트 정확하다", () => {
    const mesh = createSculptUvSphere(16, 10);
    expect(mesh.vertexCount).toBe(2 + 9 * 16);
    const { paired, planar } = assertExactMirrorX(mesh);
    // 극점 2개 + 경도 S/4·3S/4 의 두 열이 평면 위에 있다.
    expect(planar).toBe(2 + 9 * 2);
    expect(paired + planar).toBe(mesh.vertexCount);
    // 닫힌 다양체: 모든 엣지가 정확히 두 삼각형에 속한다(V - E + F = 2).
    const { edges, allUsedTwice } = countSculptEdgeUses(mesh);
    expect(allUsedTwice).toBe(true);
    expect(mesh.vertexCount - edges + mesh.triangleCount).toBe(2);
  });

  it("평면 격자는 y=0 이고 x축 미러 대칭이 비트 정확하다", () => {
    const mesh = createSculptPlaneGrid(6, 4, 3);
    expect(mesh.vertexCount).toBe(7 * 5);
    for (let v = 0; v < mesh.vertexCount; v += 1) expect(mesh.positions[v * 3 + 1]).toBe(0);
    const { paired, planar } = assertExactMirrorX(mesh);
    expect(planar).toBe(5); // x=0 열(divisionsX 가 짝수라 존재).
    expect(paired + planar).toBe(mesh.vertexCount);
    const bounds = sculptMeshBounds(mesh);
    expect(bounds.minX).toBeCloseTo(-1.5, 6);
    expect(bounds.maxX).toBeCloseTo(1.5, 6);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxY).toBe(0);
  });
});

describe("sculpt mesh — 법선 결정성", () => {
  it("전 정점 부분 재계산이 전역 재계산과 비트 동일하다", () => {
    const mesh = createSculptIcosphere(3);
    // 메시를 결정적으로 흔들어 법선이 자명하지 않게(구 = 위치와 동일) 만든다.
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      mesh.positions[v * 3] += ((v % 7) - 3) * 0.013;
      mesh.positions[v * 3 + 1] += ((v % 5) - 2) * 0.021;
      mesh.positions[v * 3 + 2] += ((v % 11) - 5) * 0.007;
    }
    recomputeSculptNormals(mesh);
    const global = Float32Array.from(mesh.normals);

    mesh.normals.fill(Number.NaN);
    const csr = buildSculptVertexTriangleCsr(mesh);
    const all = new Uint32Array(mesh.vertexCount);
    for (let v = 0; v < mesh.vertexCount; v += 1) all[v] = v;
    recomputeSculptNormalsForVertices(mesh, csr, all, all.length);

    expectBitIdentical(mesh.normals, global);
  });

  it("부분 재계산은 중복 정점이 들어와도 두 번 누산하지 않는다", () => {
    const mesh = createSculptIcosphere(1);
    const csr = buildSculptVertexTriangleCsr(mesh);
    const once = Float32Array.from(mesh.normals);
    recomputeSculptNormalsForVertices(mesh, csr, new Uint32Array([5, 5, 5, 5]), 4);
    expect(mesh.normals[5 * 3]).toBe(once[5 * 3]);
    expect(mesh.normals[5 * 3 + 1]).toBe(once[5 * 3 + 1]);
    expect(mesh.normals[5 * 3 + 2]).toBe(once[5 * 3 + 2]);
  });

  it("CSR 의 각 정점 슬라이스는 삼각형 오름차순이다", () => {
    const mesh = createSculptIcosphere(2);
    const csr = buildSculptVertexTriangleCsr(mesh);
    expect(csr.offsets[mesh.vertexCount]).toBe(mesh.indices.length);
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      for (let s = csr.offsets[v] + 1; s < csr.offsets[v + 1]; s += 1) {
        expect(csr.triangles[s]).toBeGreaterThan(csr.triangles[s - 1]);
      }
    }
  });
});

describe("sculpt mesh — 인접", () => {
  it("이웃 목록이 오름차순·중복 없음·자기 자신 제외이고 대칭적이다", () => {
    const mesh = createSculptIcosphere(2);
    const adjacency = buildSculptVertexAdjacency(mesh);
    const neighborSets: Set<number>[] = [];
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      const set = new Set<number>();
      for (let s = adjacency.offsets[v]; s < adjacency.offsets[v + 1]; s += 1) {
        const n = adjacency.neighbors[s];
        expect(n).not.toBe(v);
        if (s > adjacency.offsets[v]) expect(n).toBeGreaterThan(adjacency.neighbors[s - 1]);
        set.add(n);
      }
      // 정이십면체 세분 구는 정점 차수가 5 또는 6 이다.
      expect([5, 6]).toContain(set.size);
      neighborSets.push(set);
    }
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      for (const n of neighborSets[v]) expect(neighborSets[n].has(v)).toBe(true);
    }
  });
});

describe("sculpt mesh — 균일 세분", () => {
  it("V' = V + E, T' = 4T 불변식을 지킨다(닫힌 메시에서 E = 3T/2)", () => {
    let mesh = createSculptIcosphere(0);
    for (let step = 0; step < 3; step += 1) {
      const beforeVertices = mesh.vertexCount;
      const beforeTriangles = mesh.triangleCount;
      const edges = (beforeTriangles * 3) / 2;
      mesh = subdivideSculptMesh(mesh);
      expect(mesh.vertexCount).toBe(beforeVertices + edges);
      expect(mesh.triangleCount).toBe(beforeTriangles * 4);
    }
  });

  it("세분은 결정적이다 — 같은 입력이 두 번 모두 비트 동일한 결과를 낸다", () => {
    const source = createSculptIcosphere(2);
    const first = subdivideSculptMesh(cloneSculptMesh(source));
    const second = subdivideSculptMesh(cloneSculptMesh(source));
    expectBitIdentical(first.positions, second.positions);
    expect(Array.from(first.indices)).toEqual(Array.from(second.indices));
  });

  it("세분이 x축 미러 대칭을 보존한다", () => {
    const mesh = subdivideSculptMesh(createSculptPlaneGrid(4, 4, 2));
    const { paired, planar } = assertExactMirrorX(mesh);
    expect(paired + planar).toBe(mesh.vertexCount);
  });
});

describe("sculpt mesh — 검증과 예산", () => {
  it("범위를 벗어난 인덱스를 fail-closed 로 거부한다", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(() => createSculptMesh(positions, new Uint32Array([0, 1, 3]))).toThrowError(
      SculptMeshError,
    );
    try {
      createSculptMesh(positions, new Uint32Array([0, 1, 3]));
    } catch (error) {
      expect((error as SculptMeshError).code).toBe("index-out-of-range");
    }
  });

  it("3의 배수가 아닌 배열 길이를 거부한다", () => {
    expect(() => createSculptMesh(new Float32Array(4), new Uint32Array(3))).toThrowError(
      SculptMeshError,
    );
  });

  it("정점 예산은 bg3d 워커 상한(4,000,000) 이하로 고정돼 있다", () => {
    expect(STUDIO_SCULPT_MAX_VERTICES).toBeLessThanOrEqual(4_000_000);
  });
});

describe("sculpt mesh — bg3d 캐노니컬 지오메트리 상호변환", () => {
  it("왕복 변환이 위치/인덱스를 비트 동일하게 보존한다", () => {
    const mesh = createSculptIcosphere(2);
    const payload = sculptMeshToCanonicalGeometry(mesh);
    expect(payload.vertexCount).toBe(mesh.vertexCount);
    expect(payload.triangleCount).toBe(mesh.triangleCount);
    const restored = sculptMeshFromCanonicalGeometry(payload);
    expect(restored).not.toBeNull();
    if (!restored) return;
    expectBitIdentical(restored.positions, mesh.positions);
    expect(Array.from(restored.indices)).toEqual(Array.from(mesh.indices));
  });

  it("인덱스 없는 payload 는 null 로 거부한다", () => {
    const mesh = createSculptIcosphere(1);
    const payload = sculptMeshToCanonicalGeometry(mesh);
    expect(sculptMeshFromCanonicalGeometry({ ...payload, index: null })).toBeNull();
    expect(sculptMeshFromCanonicalGeometry({ ...payload, kind: "points" })).toBeNull();
  });
});
