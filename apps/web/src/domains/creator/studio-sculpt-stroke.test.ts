import { describe, expect, it } from "vitest";

import { SCULPT_BRUSH_KINDS, type SculptBrushKind } from "./studio-sculpt-brush";
import { revertSculptDelta } from "./studio-sculpt-history";
import { cloneSculptMesh, createSculptIcosphere, type SculptMesh } from "./studio-sculpt-mesh";
import { bruteForceSculptSphere } from "./studio-sculpt-spatial-hash";
import {
  SCULPT_DEFAULT_SPACING_RATIO,
  createSculptStrokeSession,
  resampleSculptStroke,
  runSculptStroke,
  sculptDabJitter,
  type SculptStrokeOptions,
  type SculptStrokePoint,
} from "./studio-sculpt-stroke";
import { buildSculptSymmetryMap, sculptSymmetryIsExact } from "./studio-sculpt-symmetry";

function expectBitIdentical(actual: Float32Array, expected: Float32Array, label = ""): void {
  expect(actual.length).toBe(expected.length);
  let mismatch = -1;
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) {
      mismatch = i;
      break;
    }
  }
  expect({
    label,
    index: mismatch,
    actual: mismatch < 0 ? null : actual[mismatch],
    expected: mismatch < 0 ? null : expected[mismatch],
  }).toEqual({ label, index: -1, actual: null, expected: null });
}

/** 구 표면을 따라 도는 스트로크 — 브러시가 실제로 여러 dab 을 밟도록 길이를 준다. */
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

function movedVertexCount(before: SculptMesh, after: SculptMesh): number {
  let moved = 0;
  for (let v = 0; v < before.vertexCount; v += 1) {
    const base = v * 3;
    if (
      before.positions[base] !== after.positions[base]
      || before.positions[base + 1] !== after.positions[base + 1]
      || before.positions[base + 2] !== after.positions[base + 2]
    ) {
      moved += 1;
    }
  }
  return moved;
}

describe("sculpt stroke — dab 리샘플", () => {
  it("dab 간격이 균등하고 첫 dab 은 시작점 위에 있다", () => {
    const points: SculptStrokePoint[] = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ];
    const dabs = resampleSculptStroke(points, 2);
    expect(dabs[0]).toEqual({ x: 0, y: 0, z: 0, pressure: 1 });
    expect(dabs.length).toBe(6); // 0, 2, 4, 6, 8, 10
    for (let i = 1; i < dabs.length; i += 1) {
      expect(dabs[i].x - dabs[i - 1].x).toBeCloseTo(2, 9);
    }
  });

  it("세그먼트 경계에서 잔여 거리를 이월한다 — 꺾인 경로에서도 간격이 유지된다", () => {
    const dabs = resampleSculptStroke(
      [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 3, y: 5, z: 0 },
      ],
      2,
    );
    // 총 길이 8, 간격 2 → 0, 2, (3,1), (3,3), (3,5) 위치의 dab 5개.
    expect(dabs.length).toBe(5);
    for (let i = 1; i < dabs.length; i += 1) {
      const dx = dabs[i].x - dabs[i - 1].x;
      const dy = dabs[i].y - dabs[i - 1].y;
      // 꺾이는 dab 한 쌍은 직선거리가 2 보다 짧다(경로 길이 기준이므로) — 그 외엔 정확히 2.
      const straight = Math.sqrt(dx * dx + dy * dy);
      expect(straight).toBeLessThanOrEqual(2 + 1e-9);
      expect(straight).toBeGreaterThan(1.4);
    }
  });

  it("maxDabs 상한을 넘지 않는다", () => {
    const dabs = resampleSculptStroke(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1000, y: 0, z: 0 },
      ],
      0.1,
      50,
    );
    expect(dabs.length).toBe(50);
  });

  it("유한하지 않은 점은 건너뛴다", () => {
    const dabs = resampleSculptStroke(
      [
        { x: Number.NaN, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      2,
    );
    expect(dabs.map((dab) => dab.x)).toEqual([0, 2, 4]);
  });
});

describe("sculpt stroke — 시드 지터", () => {
  it("같은 (seed, dabIndex, salt) 는 같은 값을, 다른 조합은 다른 값을 준다", () => {
    expect(sculptDabJitter(7, 3, 11)).toBe(sculptDabJitter(7, 3, 11));
    expect(sculptDabJitter(7, 3, 11)).not.toBe(sculptDabJitter(8, 3, 11));
    expect(sculptDabJitter(7, 3, 11)).not.toBe(sculptDabJitter(7, 4, 11));
    expect(sculptDabJitter(7, 3, 11)).not.toBe(sculptDabJitter(7, 3, 12));
    for (let i = 0; i < 500; i += 1) {
      const value = sculptDabJitter(1234, i, 17);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("sculpt stroke — 결정성", () => {
  it("같은 seed + 같은 스트로크는 모든 브러시에서 비트 동일한 메시를 만든다", () => {
    for (const brush of SCULPT_BRUSH_KINDS) {
      const source = createSculptIcosphere(3);
      const first = cloneSculptMesh(source);
      const second = cloneSculptMesh(source);
      const points = surfaceStroke();
      const options = baseOptions({ brush });
      const a = runSculptStroke(first, points, options);
      const b = runSculptStroke(second, points, options);
      expect({ brush, status: a.status }).toEqual({ brush, status: "ok" });
      expect(a.dabCount).toBe(b.dabCount);
      expect(a.touchedCount).toBe(b.touchedCount);
      expectBitIdentical(first.positions, second.positions, `${brush}:positions`);
      expectBitIdentical(first.normals, second.normals, `${brush}:normals`);
    }
  });

  it("dab 을 잘게 쪼개 넣어도 한 번에 넣은 것과 비트 동일하다", () => {
    for (const brush of SCULPT_BRUSH_KINDS) {
      const source = createSculptIcosphere(3);
      const points = surfaceStroke();
      const options = baseOptions({ brush });

      const whole = cloneSculptMesh(source);
      const wholeResult = runSculptStroke(whole, points, options);

      const split = cloneSculptMesh(source);
      const session = createSculptStrokeSession(split, options);
      for (const point of points) session.appendPoints([point]);
      const splitResult = session.end();

      expect({ brush, dabs: splitResult.dabCount }).toEqual({
        brush,
        dabs: wholeResult.dabCount,
      });
      expectBitIdentical(split.positions, whole.positions, `${brush}:split-positions`);
      expectBitIdentical(split.normals, whole.normals, `${brush}:split-normals`);
    }
  });

  it("seed 를 바꾸면(지터가 켜진 채) 결과가 달라진다 — seed 가 장식이 아니다", () => {
    const source = createSculptIcosphere(3);
    const points = surfaceStroke();
    const a = cloneSculptMesh(source);
    const b = cloneSculptMesh(source);
    runSculptStroke(a, points, baseOptions({ seed: 1 }));
    runSculptStroke(b, points, baseOptions({ seed: 2 }));
    let differences = 0;
    for (let i = 0; i < a.positions.length; i += 1) {
      if (a.positions[i] !== b.positions[i]) differences += 1;
    }
    expect(differences).toBeGreaterThan(0);
  });

  it("지터를 끄면 seed 가 달라도 결과가 같다(지터만이 seed 의 소비처다)", () => {
    const source = createSculptIcosphere(2);
    const points = surfaceStroke(12);
    const a = cloneSculptMesh(source);
    const b = cloneSculptMesh(source);
    const options = baseOptions({ radiusJitter: 0, strengthJitter: 0 });
    runSculptStroke(a, points, { ...options, seed: 1 });
    runSculptStroke(b, points, { ...options, seed: 999 });
    expectBitIdentical(a.positions, b.positions);
  });
});

describe("sculpt stroke — 실제 변형", () => {
  it("draw 브러시가 표면을 바깥으로 밀어낸다(direction 이 반대면 안쪽)", () => {
    const source = createSculptIcosphere(3);
    const out = cloneSculptMesh(source);
    const inward = cloneSculptMesh(source);
    const points = surfaceStroke(16);
    runSculptStroke(out, points, baseOptions({ direction: 1, radiusJitter: 0, strengthJitter: 0 }));
    runSculptStroke(
      inward,
      points,
      baseOptions({ direction: -1, radiusJitter: 0, strengthJitter: 0 }),
    );
    const moved = movedVertexCount(source, out);
    expect(moved).toBeGreaterThan(20);

    let grew = 0;
    let shrank = 0;
    for (let v = 0; v < source.vertexCount; v += 1) {
      const base = v * 3;
      const radiusOf = (mesh: SculptMesh): number =>
        Math.sqrt(
          mesh.positions[base] ** 2 + mesh.positions[base + 1] ** 2 + mesh.positions[base + 2] ** 2,
        );
      const original = radiusOf(source);
      if (radiusOf(out) > original + 1e-6) grew += 1;
      if (radiusOf(inward) < original - 1e-6) shrank += 1;
    }
    expect(grew).toBeGreaterThan(20);
    expect(shrank).toBeGreaterThan(20);
  });

  it("grab 은 스트로크 시작 시 집합을 고정한다 — 마지막 dab 반경 밖 정점도 움직인다", () => {
    const source = createSculptIcosphere(3);
    const mesh = cloneSculptMesh(source);
    const points: SculptStrokePoint[] = [];
    for (let i = 0; i < 12; i += 1) points.push({ x: -0.4 + i * 0.08, y: 1, z: 0 });
    const options = baseOptions({
      brush: "grab",
      radius: 0.3,
      strength: 1,
      radiusJitter: 0,
      strengthJitter: 0,
      pressureMinRadiusRatio: 1,
    });
    const result = runSculptStroke(mesh, points, options);
    expect(result.status).toBe("ok");
    expect(result.touchedCount).toBeGreaterThan(3);

    // 고정 집합의 근거: 접촉 정점은 (원본 좌표 기준) 첫 dab 반경 안이다.
    const firstSet = new Uint32Array(source.vertexCount);
    const firstCount = bruteForceSculptSphere(
      source.positions,
      source.vertexCount,
      points[0].x,
      points[0].y,
      points[0].z,
      0.3,
      firstSet,
    );
    const firstMembers = new Set(Array.from(firstSet.subarray(0, firstCount)));
    for (const vertex of result.delta.touched) {
      expect({ vertex, inFirst: firstMembers.has(vertex) }).toEqual({ vertex, inFirst: true });
    }

    // 그리고 마지막 dab 반경 밖에 있던 정점도 실제로 움직였다 → 매 dab 재질의가 아니다.
    const lastPoint = points[points.length - 1];
    let outsideLast = 0;
    for (const vertex of result.delta.touched) {
      const base = vertex * 3;
      const dx = source.positions[base] - lastPoint.x;
      const dy = source.positions[base + 1] - lastPoint.y;
      const dz = source.positions[base + 2] - lastPoint.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.3) outsideLast += 1;
    }
    expect(outsideLast).toBeGreaterThan(0);
  });

  it("반경 밖 정점은 단 하나도 움직이지 않는다", () => {
    const source = createSculptIcosphere(3);
    const mesh = cloneSculptMesh(source);
    const points: SculptStrokePoint[] = [
      { x: 0, y: 1, z: 0 },
      { x: 0.1, y: 0.99, z: 0 },
    ];
    const radius = 0.3;
    runSculptStroke(
      mesh,
      points,
      baseOptions({ radius, radiusJitter: 0, strengthJitter: 0, brush: "draw" }),
    );
    for (let v = 0; v < source.vertexCount; v += 1) {
      const base = v * 3;
      let minDistance = Infinity;
      for (const point of points) {
        const dx = source.positions[base] - point.x;
        const dy = source.positions[base + 1] - point.y;
        const dz = source.positions[base + 2] - point.z;
        minDistance = Math.min(minDistance, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      if (minDistance <= radius + 0.02) continue;
      expect({ v, moved: source.positions[base] !== mesh.positions[base] }).toEqual({
        v,
        moved: false,
      });
    }
  });
});

describe("sculpt stroke — 대칭", () => {
  it("대칭을 켜면 스트로크 후에도 미러 불변식이 비트 정확하게 유지된다", () => {
    for (const brush of SCULPT_BRUSH_KINDS) {
      const mesh = createSculptIcosphere(3);
      const map = buildSculptSymmetryMap(mesh.positions, mesh.vertexCount, { axis: "x" });
      expect(map.unpairedCount).toBe(0);
      expect(sculptSymmetryIsExact(mesh.positions, map)).toBe(true);

      const result = runSculptStroke(
        mesh,
        surfaceStroke(20),
        baseOptions({ brush, symmetry: { axis: "x" } }),
      );
      expect({ brush, symmetryEnabled: result.symmetryEnabled, unpaired: result.unpairedCount })
        .toEqual({ brush, symmetryEnabled: true, unpaired: 0 });
      expect({ brush, exact: sculptSymmetryIsExact(mesh.positions, map) }).toEqual({
        brush,
        exact: true,
      });
    }
  });

  it("대칭이 꺼지면 한쪽만 변형된다(대칭이 실제로 뭔가 하고 있다)", () => {
    const source = createSculptIcosphere(3);
    const asymmetric = cloneSculptMesh(source);
    const map = buildSculptSymmetryMap(source.positions, source.vertexCount, { axis: "x" });
    runSculptStroke(asymmetric, surfaceStroke(20), baseOptions({ symmetry: null }));
    expect(sculptSymmetryIsExact(asymmetric.positions, map)).toBe(false);
  });

  it("비대칭 메시에서는 unpairedCount 를 정직하게 보고한다", () => {
    const mesh = createSculptIcosphere(2);
    let victim = -1;
    for (let v = 0; v < mesh.vertexCount; v += 1) {
      if (mesh.positions[v * 3] > 0.3) {
        victim = v;
        break;
      }
    }
    mesh.positions[victim * 3 + 2] += 0.4;
    const result = runSculptStroke(
      mesh,
      surfaceStroke(10),
      baseOptions({ symmetry: { axis: "x" } }),
    );
    expect(result.unpairedCount).toBe(2);
  });
});

describe("sculpt stroke — 언두 델타", () => {
  it("스트로크 델타를 되돌리면 원본이 비트 동일하게 복원된다", () => {
    for (const brush of SCULPT_BRUSH_KINDS) {
      const source = createSculptIcosphere(3);
      const mesh = cloneSculptMesh(source);
      const result = runSculptStroke(
        mesh,
        surfaceStroke(20),
        baseOptions({ brush, symmetry: { axis: "x" } }),
      );
      expect(result.touchedCount).toBeGreaterThan(0);
      revertSculptDelta(mesh.positions, result.delta);
      expectBitIdentical(mesh.positions, source.positions, `${brush}:revert`);
    }
  });

  it("델타는 실제로 움직인 정점만 담는다(전체 스냅샷이 아니다)", () => {
    const source = createSculptIcosphere(3);
    const mesh = cloneSculptMesh(source);
    const result = runSculptStroke(mesh, surfaceStroke(20), baseOptions({ radius: 0.25 }));
    expect(result.touchedCount).toBeGreaterThan(0);
    expect(result.touchedCount).toBeLessThan(mesh.vertexCount / 2);
    expect(result.touchedCount).toBe(movedVertexCount(source, mesh));
  });

  it("예산을 넘기면 스트로크를 중단하고 budget-exceeded 를 보고하되 복원은 정확하다", () => {
    const source = createSculptIcosphere(3);
    const mesh = cloneSculptMesh(source);
    const result = runSculptStroke(
      mesh,
      surfaceStroke(24),
      baseOptions({ historyLimits: { maxVerticesPerDelta: 12 } }),
    );
    expect(result.status).toBe("budget-exceeded");
    expect(result.touchedCount).toBeLessThanOrEqual(12);
    revertSculptDelta(mesh.positions, result.delta);
    expectBitIdentical(mesh.positions, source.positions);
  });
});

describe("sculpt stroke — 세션 계약", () => {
  it("점을 하나도 안 넣으면 empty 를 보고한다", () => {
    const mesh = createSculptIcosphere(1);
    const session = createSculptStrokeSession(mesh, baseOptions());
    const result = session.end();
    expect(result.status).toBe("empty");
    expect(result.dabCount).toBe(0);
    expect(result.touchedCount).toBe(0);
    expect(result.dirtyRanges).toEqual([]);
  });

  it("end() 이후의 appendPoints 는 무시된다", () => {
    const source = createSculptIcosphere(2);
    const mesh = cloneSculptMesh(source);
    const session = createSculptStrokeSession(mesh, baseOptions());
    session.appendPoints(surfaceStroke(8));
    session.end();
    const afterEnd = Float32Array.from(mesh.positions);
    session.appendPoints(surfaceStroke(8));
    expectBitIdentical(mesh.positions, afterEnd);
  });

  it("dirty range 가 실제로 움직인 정점을 전부 덮는다", () => {
    const source = createSculptIcosphere(3);
    const mesh = cloneSculptMesh(source);
    const result = runSculptStroke(mesh, surfaceStroke(16), baseOptions());
    expect(result.dirtyRanges.length).toBeGreaterThan(0);
    for (const vertex of result.delta.touched) {
      const covered = result.dirtyRanges.some(
        (range) => vertex >= range.firstVertex && vertex < range.firstVertex + range.vertexCount,
      );
      expect({ vertex, covered }).toEqual({ vertex, covered: true });
    }
  });

  it("스트로크가 길어지면 스패셜 해시를 재빌드하고도 결정성이 유지된다", () => {
    const source = createSculptIcosphere(3);
    const options = baseOptions({
      brush: "grab",
      radius: 0.5,
      strength: 1,
      radiusJitter: 0,
      strengthJitter: 0,
    });
    const points: SculptStrokePoint[] = [];
    for (let i = 0; i < 40; i += 1) points.push({ x: 0, y: 1 + i * 0.12, z: 0 });
    const a = cloneSculptMesh(source);
    const b = cloneSculptMesh(source);
    const resultA = runSculptStroke(a, points, options);
    const resultB = runSculptStroke(b, points, options);
    expect(resultA.rebuildCount).toBeGreaterThan(0);
    expect(resultB.rebuildCount).toBe(resultA.rebuildCount);
    expectBitIdentical(a.positions, b.positions);
  });

  it("잘못된 옵션은 안전한 기본값으로 폴백한다", () => {
    const mesh = createSculptIcosphere(2);
    const result = runSculptStroke(mesh, surfaceStroke(8), {
      seed: Number.NaN,
      brush: "unknown" as SculptBrushKind,
      radius: -1,
      strength: 5,
      spacingRatio: -3,
    });
    expect(result.status).toBe("ok");
    expect(result.dabCount).toBeGreaterThan(0);
  });

  it("기본 dab 간격 비율이 2D 브러시 관례(0.35)와 같다", () => {
    expect(SCULPT_DEFAULT_SPACING_RATIO).toBe(0.35);
  });
});
