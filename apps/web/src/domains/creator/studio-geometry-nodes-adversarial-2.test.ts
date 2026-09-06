/**
 * 적대적 검증 2차 — 불리언 출력 방향, 파서 퍼징, 시드 결정성, 캐시 정합성.
 * 기존 스위트가 단언하지 않은 경로만 고른다.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  loadStudioGeometryNodesPlanarBooleanBackend,
  studioGeometryPlanarBoolean,
} from "./studio-geometry-nodes-boolean";
import { createStudioGeometryNodesEvaluator } from "./studio-geometry-nodes-eval";
import {
  studioGeometryFaceNormal,
  studioGeometrySurfaceArea,
  studioGeometryTriangleCount,
} from "./studio-geometry-nodes-mesh";
import {
  studioGeometryDistributePointsOnFaces,
  studioGeometryInstanceOnPoints,
  studioGeometryTransform,
} from "./studio-geometry-nodes-ops";
import { studioGeometryCube, studioGeometryGrid } from "./studio-geometry-nodes-primitives";
import {
  createStudioGeometryNodesStarterGraph,
  parseStudioGeometryNodesGraph,
  serializeStudioGeometryNodesGraph,
} from "./studio-geometry-nodes-serialization";

import type { StudioGeometryNodesPlanarBooleanBackend } from "./studio-geometry-nodes-boolean";
import type { StudioGeometryMesh, StudioGeometryResult } from "./studio-geometry-nodes-mesh";

function unwrap<T>(result: StudioGeometryResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.value;
}

let backend: StudioGeometryNodesPlanarBooleanBackend;

beforeAll(async () => {
  backend = await loadStudioGeometryNodesPlanarBooleanBackend();
});

const squareA = unwrap(studioGeometryGrid({ sizeX: 2, sizeY: 2 }));

describe("적대적 · 불리언 출력 방향", () => {
  it("법선 −Z 인 두 프로파일의 합집합은 결과 면도 −Z 를 향한다", () => {
    // X축 180° 회전 → 법선 −Z 로 뒤집힌 같은 정사각형.
    const flippedA = unwrap(studioGeometryTransform(squareA, { rotate: [Math.PI, 0, 0] }));
    const flippedB = unwrap(studioGeometryTransform(flippedA, { translate: [1, 1, 0] }));
    const out = unwrap(studioGeometryPlanarBoolean(flippedA, flippedB, "union", { backend }));
    expect(studioGeometrySurfaceArea(out)).toBeCloseTo(7, 4);
    for (let t = 0; t < studioGeometryTriangleCount(out); t++) {
      expect(studioGeometryFaceNormal(out, t)[2]).toBeLessThan(0);
    }
  });

  it("서로 떨어진 두 정사각형의 합집합은 두 조각 전부 남아 면적 8 이다", () => {
    const far = unwrap(studioGeometryTransform(squareA, { translate: [10, 0, 0] }));
    const out = unwrap(studioGeometryPlanarBoolean(squareA, far, "union", { backend }));
    expect(studioGeometrySurfaceArea(out)).toBeCloseTo(8, 4);
    expect(studioGeometryTriangleCount(out)).toBe(4);
  });

  it("3D 큐브(비평면)는 가짜 결과 대신 거부한다", () => {
    const cube = unwrap(studioGeometryCube());
    const result = studioGeometryPlanarBoolean(cube, cube, "union", { backend });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["non-planar", "degenerate-input"]).toContain(result.code);
  });
});

describe("적대적 · 파서 퍼징(throw 금지)", () => {
  const garbage: unknown[] = [
    undefined,
    null,
    0,
    NaN,
    "",
    "{",
    "[]",
    '{"kind":"toonspectrum.geometry-nodes"}',
    '{"kind":"toonspectrum.geometry-nodes","version":1,"nodes":[],"links":[]}',
    { kind: "toonspectrum.geometry-nodes", version: 1, nodes: [{}], links: [] },
    { kind: "toonspectrum.geometry-nodes", version: 1, nodes: null, links: [] },
    {
      kind: "toonspectrum.geometry-nodes",
      version: 1,
      nodes: [{ id: "a", type: "mesh-grid", params: { sizeX: "NaN", segmentsX: Infinity } }],
      links: [{ fromNode: "a", fromSocket: "nope", toNode: "a", toSocket: "nope" }],
    },
    [1, 2, 3],
    Symbol.iterator.toString(),
  ];

  it("어떤 쓰레기 입력도 예외를 던지지 않고 결과 객체를 낸다", () => {
    for (const input of garbage) {
      const run = (): unknown => parseStudioGeometryNodesGraph(input);
      expect(run).not.toThrow();
      const result = parseStudioGeometryNodesGraph(input);
      expect(typeof result.ok).toBe("boolean");
      if (!result.ok) expect(typeof result.code).toBe("string");
    }
  });

  it("정규형 라운드트립이 문자열 수준에서 고정점이다", () => {
    const first = serializeStudioGeometryNodesGraph(createStudioGeometryNodesStarterGraph());
    const parsed = parseStudioGeometryNodesGraph(first);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const second = serializeStudioGeometryNodesGraph(parsed.graph);
    expect(second).toBe(first);
  });
});

describe("적대적 · 시드 결정성 바이트 비교", () => {
  it("같은 시드는 바이트 동일, 다른 시드는 다르다(distribute → instance 체인)", () => {
    const grid = unwrap(studioGeometryGrid({ segmentsX: 4, segmentsY: 4 }));
    const instance = unwrap(studioGeometryCube({ size: 0.05 }));
    const run = (seed: number): Float32Array => {
      const points = unwrap(studioGeometryDistributePointsOnFaces(grid, { seed, count: 40 }));
      return unwrap(
        studioGeometryInstanceOnPoints(instance, points, {
          seed,
          scaleJitter: 0.4,
          randomRotation: true,
        })
      ).positions;
    };
    const a = run(7);
    const b = run(7);
    const c = run(8);
    expect(Buffer.from(a.buffer)).toEqual(Buffer.from(b.buffer));
    expect(Buffer.from(a.buffer)).not.toEqual(Buffer.from(c.buffer));
  });
});

describe("적대적 · 캐시가 잘못된 결과를 돌려주지 않는가", () => {
  it("파라미터를 바꿨다가 되돌리면 원래 값과 정확히 같은 결과를 준다", () => {
    const evaluator = createStudioGeometryNodesEvaluator();
    const graphWith = (distance: number) => ({
      ...createStudioGeometryNodesStarterGraph(),
      nodes: createStudioGeometryNodesStarterGraph().nodes.map((node) =>
        node.id === "extrude" ? { ...node, params: { ...node.params, distance } } : node
      ),
    });
    const readArea = (distance: number): number => {
      const result = evaluator.evaluate(graphWith(distance));
      expect(result.ok).toBe(true);
      if (!result.ok) return NaN;
      const value = result.outputs.geometry;
      expect(value.kind).toBe("geometry");
      return value.kind === "geometry"
        ? studioGeometrySurfaceArea(value.mesh as StudioGeometryMesh)
        : NaN;
    };
    const first = readArea(0.25);
    const other = readArea(0.75);
    const back = readArea(0.25);
    expect(back).toBe(first);
    expect(other).not.toBe(first);
    // 압출 표면적 = 양면(1+1) + 둘레(4)×두께.
    expect(first).toBeCloseTo(2 + 4 * 0.25, 5);
    expect(other).toBeCloseTo(2 + 4 * 0.75, 5);
  });
});
