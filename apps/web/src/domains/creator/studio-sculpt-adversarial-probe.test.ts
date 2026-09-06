import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCULPT_BRUSH_PARAMS,
  SCULPT_BRUSH_KINDS,
  sculptSmoothDisplacement,
} from "./studio-sculpt-brush";
import { sculptFalloffWeight } from "./studio-sculpt-falloff";
import { revertSculptDelta } from "./studio-sculpt-history";
import {
  buildSculptVertexAdjacency,
  cloneSculptMesh,
  createSculptIcosphere,
  createSculptPlaneGrid,
  createSculptUvSphere,
  recomputeSculptNormals,
  type SculptMesh,
} from "./studio-sculpt-mesh";
import {
  bruteForceSculptSphere,
  buildSculptSpatialHash,
  findSculptNearestVertex,
  querySculptSphere,
  sculptSpatialHashShouldRebuild,
} from "./studio-sculpt-spatial-hash";
import {
  createSculptStrokeSession,
  resampleSculptStroke,
  runSculptStroke,
  type SculptStrokeOptions,
  type SculptStrokePoint,
} from "./studio-sculpt-stroke";
import { buildSculptSymmetryMap, sculptSymmetryIsExact } from "./studio-sculpt-symmetry";

function firstMismatch(a: Float32Array, b: Float32Array): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return i;
  return -1;
}

function surfaceStroke(steps = 24, radius = 1): SculptStrokePoint[] {
  const points: SculptStrokePoint[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (i / (steps - 1)) * Math.PI * 0.5 - Math.PI * 0.25;
    points.push({
      x: Math.sin(t) * radius,
      y: Math.cos(t) * radius,
      z: 0,
      pressure: 0.4 + 0.6 * (i / (steps - 1)),
    });
  }
  return points;
}

function baseOptions(overrides: Partial<SculptStrokeOptions> = {}): SculptStrokeOptions {
  return {
    seed: 20260724,
    brush: "draw",
    radius: 0.35,
    strength: 0.35,
    spacingRatio: 0.35,
    radiusJitter: 0.2,
    strengthJitter: 0.15,
    ...overrides,
  };
}

describe("probe — 증분 법선이 전역 재계산과 일치하는가", () => {
  it("스트로크 후 mesh.normals 가 전역 재계산과 비트 동일하다(모든 브러시)", () => {
    for (const brush of SCULPT_BRUSH_KINDS) {
      const mesh = createSculptIcosphere(3);
      const result = runSculptStroke(mesh, surfaceStroke(20), baseOptions({ brush }));
      expect({ brush, status: result.status }).toEqual({ brush, status: "ok" });
      const incremental = Float32Array.from(mesh.normals);
      recomputeSculptNormals(mesh);
      expect({ brush, mismatch: firstMismatch(incremental, mesh.normals) }).toEqual({
        brush,
        mismatch: -1,
      });
    }
  });

  it("대칭을 켠 스트로크 후에도 증분 법선이 전역과 비트 동일하다", () => {
    const mesh = createSculptIcosphere(3);
    runSculptStroke(mesh, surfaceStroke(20), baseOptions({ symmetry: { axis: "x" } }));
    const incremental = Float32Array.from(mesh.normals);
    recomputeSculptNormals(mesh);
    expect(firstMismatch(incremental, mesh.normals)).toBe(-1);
  });
});

describe("probe — 임의 청크 분할 결정성", () => {
  it("2/3/7 개씩 나눠 넣어도 한 번에 넣은 것과 비트 동일하다", () => {
    for (const chunk of [2, 3, 7]) {
      for (const brush of SCULPT_BRUSH_KINDS) {
        const source = createSculptIcosphere(3);
        const points = surfaceStroke(23);
        const options = baseOptions({ brush });
        const whole = cloneSculptMesh(source);
        runSculptStroke(whole, points, options);
        const split = cloneSculptMesh(source);
        const session = createSculptStrokeSession(split, options);
        for (let i = 0; i < points.length; i += chunk) {
          session.appendPoints(points.slice(i, i + chunk));
        }
        session.end();
        expect({ chunk, brush, mismatch: firstMismatch(split.positions, whole.positions) }).toEqual({
          chunk,
          brush,
          mismatch: -1,
        });
      }
    }
  });

  it("중복점(길이 0 세그먼트)이 섞여도 dab 열이 달라지지 않는다", () => {
    const clean: SculptStrokePoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 4, z: 0 },
    ];
    const dirty: SculptStrokePoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 4, z: 0 },
    ];
    expect(resampleSculptStroke(dirty, 1.5)).toEqual(resampleSculptStroke(clean, 1.5));
  });
});

describe("probe — 대칭 배지가 주장만큼 강한가", () => {
  it("unpairedCount === 0 인데도 대칭이 비트 정확하지 않을 수 있다(UV 구 y축)", () => {
    const mesh = createSculptUvSphere(16, 12);
    const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, { axis: "y" });
    expect(map.unpairedCount).toBe(0);
    const result = runSculptStroke(
      mesh,
      [
        { x: 0, y: 0.9, z: 0.3 },
        { x: 0.2, y: 0.85, z: 0.35 },
      ],
      baseOptions({ radius: 0.4, symmetry: { axis: "y" } }),
    );
    expect(result.unpairedCount).toBe(0);
    // 배지 근거가 unpairedCount 뿐이라면 "대칭 정확" 이라고 표시되지만 실제로는 아니다.
    expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(false);
  });

  it("언두 예산 중단이 대칭을 깨진 상태로 남길 수 있다", () => {
    const source = createSculptIcosphere(3);
    const mesh = cloneSculptMesh(source);
    const map = buildSculptSymmetryMap(source.positions, source.vertexCount, { axis: "x" });
    expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(true);
    let aborted = false;
    let broken = false;
    for (const limit of [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]) {
      const trial = cloneSculptMesh(source);
      const result = runSculptStroke(
        trial,
        surfaceStroke(24),
        baseOptions({ symmetry: { axis: "x" }, historyLimits: { maxVerticesPerDelta: limit } }),
      );
      if (result.status !== "budget-exceeded") continue;
      aborted = true;
      if (!sculptSymmetryIsExact(trial.positions, map)) broken = true;
      // 중단되더라도 되돌리기는 정확해야 한다.
      revertSculptDelta(trial.positions, result.delta);
      expect(firstMismatch(trial.positions, source.positions)).toBe(-1);
    }
    expect(aborted).toBe(true);
    expect(broken).toBe(true);
  });
});

describe("probe — 중단 경로의 법선", () => {
  it("budget-exceeded 로 중단되면 법선이 위치와 어긋난 채 남는다", () => {
    const mesh = createSculptIcosphere(3);
    const result = runSculptStroke(
      mesh,
      surfaceStroke(24),
      baseOptions({ historyLimits: { maxVerticesPerDelta: 5 } }),
    );
    expect(result.status).toBe("budget-exceeded");
    const stale = Float32Array.from(mesh.normals);
    recomputeSculptNormals(mesh);
    expect(firstMismatch(stale, mesh.normals)).toBeGreaterThanOrEqual(0);
  });
});

describe("probe — 기존 스위트가 놓친 계약(뮤턴트 생존 지점)", () => {
  it("stale padding 이 실제로 셀 스캔을 넓힌다 — padding 을 빼면 정점을 놓친다", () => {
    // 셀 크기 1 의 격자. 정점 하나를 셀 경계 너머로 옮겨 두고, 지금 위치를 질의한다.
    const positions = new Float32Array([
      0, 0, 0,
      5.5, 0, 0,
      9, 0, 0,
      9, 9, 9,
    ]);
    const hash = buildSculptSpatialHash(positions, 4, { cellSize: 1 });
    expect(hash.cellSize).toBe(1);
    expect(hash.minX).toBe(0);

    positions[3] = 4.4; // 빌드 시 셀 5 → 현재 셀 4. 변위 1.1.
    const moved = 1.1;
    expect(sculptSpatialHashShouldRebuild(hash, moved)).toBe(false);

    const out = new Uint32Array(4);
    const withPadding = querySculptSphere(hash, positions, 4.4, 0, 0, 0.05, moved, out);
    expect(Array.from(out.subarray(0, withPadding))).toEqual([1]);

    // padding 을 거짓으로 0 이라고 넘기면(=구현에서 padding 을 빼면) 조용히 놓친다.
    const lying = querySculptSphere(hash, positions, 4.4, 0, 0, 0.05, 0, out);
    expect(lying).toBe(0);

    const brute = new Uint32Array(4);
    const bruteCount = bruteForceSculptSphere(positions, 4, 4.4, 0, 0, 0.05, brute);
    expect(Array.from(brute.subarray(0, bruteCount))).toEqual([1]);
  });

  it("smooth 변위가 중심 밖 정점에서도 팔로프 가중치에 비례한다", () => {
    const mesh = createSculptPlaneGrid(8, 8, 4);
    const spike = 4 * 9 + 4;
    mesh.positions[spike * 3 + 1] = 1;
    const adjacency = buildSculptVertexAdjacency(mesh);
    const affected = new Uint32Array(mesh.vertexCount);
    const radius = 1.5;
    const count = bruteForceSculptSphere(
      mesh.positions,
      mesh.vertexCount,
      mesh.positions[spike * 3],
      1,
      mesh.positions[spike * 3 + 2],
      radius,
      affected,
    );
    const weights = new Float32Array(count);
    for (let k = 0; k < count; k += 1) {
      const base = affected[k] * 3;
      const dx = mesh.positions[base] - mesh.positions[spike * 3];
      const dy = mesh.positions[base + 1] - 1;
      const dz = mesh.positions[base + 2] - mesh.positions[spike * 3 + 2];
      weights[k] = sculptFalloffWeight("smooth", Math.sqrt(dx * dx + dy * dy + dz * dz), radius);
    }
    const out = new Float32Array(count * 3);
    sculptSmoothDisplacement(
      { positions: mesh.positions, normals: mesh.normals, affected, affectedCount: count, weights, adjacency },
      { ...DEFAULT_SCULPT_BRUSH_PARAMS, strength: 1, smoothLambda: 1 },
      out,
    );

    // 중심(weight === 1) 이 아닌 정점을 골라야 가중치 인자가 실제로 검증된다.
    let checked = 0;
    for (let k = 0; k < count; k += 1) {
      const v = affected[k];
      if (weights[k] >= 0.999 || weights[k] <= 1e-6) continue;
      const start = adjacency.offsets[v];
      const end = adjacency.offsets[v + 1];
      let sy = 0;
      for (let s = start; s < end; s += 1) sy += mesh.positions[adjacency.neighbors[s] * 3 + 1];
      const expected = (sy * (1 / (end - start)) - mesh.positions[v * 3 + 1]) * weights[k];
      if (Math.abs(expected) < 1e-6) continue;
      // f32 저장 오차만 허용한다 — 가중치 인자가 빠지면 상대오차가 1/weight − 1 만큼 벌어진다.
      expect({ v, relative: Math.abs(out[k * 3 + 1] - expected) / Math.abs(expected) < 1e-5 })
        .toEqual({ v, relative: true });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it("최근접 조회의 동률 타이브레이크가 실제로 작은 인덱스를 고른다", () => {
    // 동률이 되려면 두 후보가 서로 다른 셀에 있고, 스캔 순서(cz,cy,cx 오름차순)에서
    // 큰 인덱스가 먼저 나와야 한다. 그래야 "작은 인덱스 우선" 규칙이 실제로 일을 한다.
    const positions = new Float32Array([
      10, 0, 0, // 0 — 멀리
      0.3, 0, 0, // 1 — 오른쪽(늦게 스캔되는 셀)
      10, 1, 0, // 2
      10, 2, 0, // 3
      10, 3, 0, // 4
      -0.3, 0, 0, // 5 — 왼쪽(먼저 스캔되는 셀), 거리는 정점 1 과 비트 동일
    ]);
    const hash = buildSculptSpatialHash(positions, 6, { cellSize: 0.2 });
    const dxLeft = positions[15] - 0;
    const dxRight = positions[3] - 0;
    expect(dxLeft * dxLeft).toBe(dxRight * dxRight); // 진짜 동률인지 먼저 확인.
    expect(findSculptNearestVertex(hash, positions, 0, 0, 0, 0.5)).toBe(1);
  });
});

describe("probe — 생성기 상한", () => {
  it("createSculptIcosphere 는 subdivisions 7 에서 잘린다(655k 정점은 도달 불가)", () => {
    const seven: SculptMesh = createSculptIcosphere(7);
    const eight: SculptMesh = createSculptIcosphere(8);
    expect(seven.vertexCount).toBe(163_842);
    expect(eight.vertexCount).toBe(163_842);
  });
});
