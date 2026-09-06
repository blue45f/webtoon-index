import { beforeAll, describe, expect, it } from "vitest";

import { loadStudioGeometryNodesPlanarBooleanBackend } from "./studio-geometry-nodes-boolean";
import {
  createStudioGeometryNodesEvaluator,
  studioGeometryCanonicalParams,
  studioGeometryFnv1a,
} from "./studio-geometry-nodes-eval";
import {
  studioGeometrySurfaceArea,
  studioGeometryTriangleCount,
  studioGeometryVertexCount,
} from "./studio-geometry-nodes-mesh";
import {
  createStudioGeometryNodeRegistry,
  studioGeometryDefaultNodeRegistry,
  studioGeometryDefaultParams,
} from "./studio-geometry-nodes-registry";
import { createStudioGeometryNodesStarterGraph } from "./studio-geometry-nodes-serialization";

import type { StudioGeometryNodesPlanarBooleanBackend } from "./studio-geometry-nodes-boolean";
import type { StudioGeometryGraph, StudioGeometryGraphNode } from "./studio-geometry-nodes-graph";
import type {
  StudioGeometryNodeDefinition,
  StudioGeometryNodeRegistry,
} from "./studio-geometry-nodes-registry";

// ---------------------------------------------------------------------------
// 카운팅 스텁 레지스트리 — 메모이제이션을 "관측 가능"하게 만드는 유일한 수단
// ---------------------------------------------------------------------------

interface CountingHarness {
  readonly registry: StudioGeometryNodeRegistry;
  readonly counts: Map<string, number>;
  readonly total: () => number;
}

function countingRegistry(types: readonly { type: string; inputs: string[] }[]): CountingHarness {
  const counts = new Map<string, number>();
  const definitions: StudioGeometryNodeDefinition[] = types.map(({ type, inputs }) => ({
    type,
    label: type,
    summary: "",
    inputs: inputs.map((key) => ({ key, label: key, type: "float" as const, optional: false })),
    outputs: [{ key: "value", label: "value", type: "float" as const }],
    params: [{ key: "n", label: "n", kind: "float" as const, defaultValue: 0 }],
    evaluate: (ctx) => {
      counts.set(type, (counts.get(type) ?? 0) + 1);
      let sum = typeof ctx.params.n === "number" ? ctx.params.n : 0;
      for (const key of inputs) {
        const value = ctx.inputs[key];
        if (value && value.kind === "float") sum += value.value;
      }
      return { ok: true, value: { value: { kind: "float", value: sum } } };
    },
  }));
  return {
    registry: createStudioGeometryNodeRegistry(definitions),
    counts,
    total: () => [...counts.values()].reduce((sum, value) => sum + value, 0),
  };
}

function node(id: string, type: string, n: number): StudioGeometryGraphNode {
  return { id, type, params: { n } };
}

describe("studio-geometry-nodes-eval · 캐시 키", () => {
  it("FNV-1a 는 결정적이고 입력이 다르면 값이 다르다", () => {
    expect(studioGeometryFnv1a("abc")).toBe(studioGeometryFnv1a("abc"));
    expect(studioGeometryFnv1a("abc")).not.toBe(studioGeometryFnv1a("abd"));
    expect(studioGeometryFnv1a("")).toHaveLength(8);
  });

  it("파라미터 정규화는 키 순서에 무관하고 −0 을 0 으로 접는다", () => {
    expect(studioGeometryCanonicalParams({ b: 2, a: 1 })).toBe(
      studioGeometryCanonicalParams({ a: 1, b: 2 })
    );
    expect(studioGeometryCanonicalParams({ a: -0 })).toBe(studioGeometryCanonicalParams({ a: 0 }));
    expect(studioGeometryCanonicalParams({ a: 1, flag: true, mode: "x" })).toBe(
      "a=1,flag=true,mode=x"
    );
  });
});

describe("studio-geometry-nodes-eval · 메모이제이션(정수 단언)", () => {
  /**
   * srcA 와 srcB 는 **같은 타입·같은 파라미터** 라 캐시 키가 동일하다.
   * sink 는 둘을 모두 받는다. 노드는 3개지만 계산은 2번이어야 한다.
   */
  const buildGraph = (aParam: number): StudioGeometryGraph => ({
    nodes: [node("srcA", "src", aParam), node("srcB", "src", 1), node("sink", "sink", 0)],
    links: [
      { fromNode: "srcA", fromSocket: "value", toNode: "sink", toSocket: "a" },
      { fromNode: "srcB", fromSocket: "value", toNode: "sink", toSocket: "b" },
    ],
    outputNodeId: "sink",
  });

  it("(a) 같은 계산을 하는 노드가 둘이면 한 번만 실행된다", () => {
    const harness = countingRegistry([
      { type: "src", inputs: [] },
      { type: "sink", inputs: ["a", "b"] },
    ]);
    const evaluator = createStudioGeometryNodesEvaluator({ registry: harness.registry });
    const result = evaluator.evaluate(buildGraph(1));
    expect(result.ok).toBe(true);
    expect(harness.counts.get("src")).toBe(1);
    expect(harness.counts.get("sink")).toBe(1);
    expect(harness.total()).toBe(2);
    if (result.ok) {
      expect(result.computed).toBe(2);
      expect(result.hits).toBe(1);
      // srcA=1, srcB=1 → sink = 0 + 1 + 1 = 2
      const value = result.outputs.value;
      expect(value.kind).toBe("float");
      if (value.kind === "float") expect(value.value).toBe(2);
    }
  });

  it("(b) 같은 그래프를 다시 평가하면 단 한 번도 계산하지 않는다", () => {
    const harness = countingRegistry([
      { type: "src", inputs: [] },
      { type: "sink", inputs: ["a", "b"] },
    ]);
    const evaluator = createStudioGeometryNodesEvaluator({ registry: harness.registry });
    evaluator.evaluate(buildGraph(1));
    const before = harness.total();
    const second = evaluator.evaluate(buildGraph(1));
    expect(harness.total()).toBe(before);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.computed).toBe(0);
      expect(second.hits).toBe(3);
    }
    expect(evaluator.stats().evaluations).toBe(2);
    expect(evaluator.stats().cacheHits).toBe(4);
  });

  it("(c) 리프 파라미터를 바꾸면 그 노드와 하류만 재계산된다", () => {
    const harness = countingRegistry([
      { type: "src", inputs: [] },
      { type: "sink", inputs: ["a", "b"] },
    ]);
    const evaluator = createStudioGeometryNodesEvaluator({ registry: harness.registry });
    evaluator.evaluate(buildGraph(1));
    harness.counts.clear();
    const changed = evaluator.evaluate(buildGraph(5));
    // srcA 는 키가 바뀌어 재계산, srcB 는 그대로라 캐시 적중, sink 는 상류 키가 바뀌어 재계산.
    expect(harness.counts.get("src")).toBe(1);
    expect(harness.counts.get("sink")).toBe(1);
    expect(changed.ok).toBe(true);
    if (changed.ok) {
      expect(changed.computed).toBe(2);
      expect(changed.hits).toBe(1);
      const value = changed.outputs.value;
      if (value.kind === "float") expect(value.value).toBe(6);
    }
  });

  it("깊은 사슬에서 중간 노드를 바꾸면 상류는 건드리지 않는다", () => {
    const harness = countingRegistry([
      { type: "n0", inputs: [] },
      { type: "n1", inputs: ["a"] },
      { type: "n2", inputs: ["a"] },
      { type: "n3", inputs: ["a"] },
    ]);
    const evaluator = createStudioGeometryNodesEvaluator({ registry: harness.registry });
    const chain = (middle: number): StudioGeometryGraph => ({
      nodes: [node("a", "n0", 1), node("b", "n1", middle), node("c", "n2", 3), node("d", "n3", 4)],
      links: [
        { fromNode: "a", fromSocket: "value", toNode: "b", toSocket: "a" },
        { fromNode: "b", fromSocket: "value", toNode: "c", toSocket: "a" },
        { fromNode: "c", fromSocket: "value", toNode: "d", toSocket: "a" },
      ],
      outputNodeId: "d",
    });
    evaluator.evaluate(chain(2));
    expect(harness.total()).toBe(4);
    harness.counts.clear();
    const again = evaluator.evaluate(chain(99));
    expect(harness.counts.has("n0")).toBe(false);
    expect(harness.counts.get("n1")).toBe(1);
    expect(harness.counts.get("n2")).toBe(1);
    expect(harness.counts.get("n3")).toBe(1);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.computed).toBe(3);
      expect(again.hits).toBe(1);
    }
  });

  it("엔트리 예산을 넘으면 LRU 로 밀려나 재계산된다", () => {
    const harness = countingRegistry([
      { type: "src", inputs: [] },
      { type: "sink", inputs: ["a", "b"] },
    ]);
    const evaluator = createStudioGeometryNodesEvaluator({
      registry: harness.registry,
      cacheMaxEntries: 1,
    });
    evaluator.evaluate(buildGraph(1));
    expect(evaluator.stats().cachedEntries).toBe(1);
    harness.counts.clear();
    evaluator.evaluate(buildGraph(1));
    // 엔트리 1개만 남으므로 최소 한 노드는 다시 계산된다.
    expect(harness.total()).toBeGreaterThan(0);
  });

  it("clearCache 후에는 전부 다시 계산한다", () => {
    const harness = countingRegistry([
      { type: "src", inputs: [] },
      { type: "sink", inputs: ["a", "b"] },
    ]);
    const evaluator = createStudioGeometryNodesEvaluator({ registry: harness.registry });
    evaluator.evaluate(buildGraph(1));
    evaluator.clearCache();
    expect(evaluator.stats().cachedEntries).toBe(0);
    harness.counts.clear();
    evaluator.evaluate(buildGraph(1));
    expect(harness.total()).toBe(2);
  });
});

describe("studio-geometry-nodes-eval · 실패 전파", () => {
  it("사이클 그래프는 평가를 시작하지 않고 graph-invalid 로 거부한다", () => {
    const harness = countingRegistry([{ type: "n", inputs: ["a"] }]);
    const evaluator = createStudioGeometryNodesEvaluator({ registry: harness.registry });
    const result = evaluator.evaluate({
      nodes: [node("x", "n", 1), node("y", "n", 2)],
      links: [
        { fromNode: "x", fromSocket: "value", toNode: "y", toSocket: "a" },
        { fromNode: "y", fromSocket: "value", toNode: "x", toSocket: "a" },
      ],
      outputNodeId: "y",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("graph-invalid");
      expect(result.detail).toContain("사이클");
    }
    expect(harness.total()).toBe(0);
  });

  it("필수 입력이 비면 missing-input 이고 하류는 실행되지 않는다", () => {
    const harness = countingRegistry([
      { type: "src", inputs: [] },
      { type: "sink", inputs: ["a", "b"] },
    ]);
    const evaluator = createStudioGeometryNodesEvaluator({ registry: harness.registry });
    const result = evaluator.evaluate({
      nodes: [node("srcA", "src", 1), node("sink", "sink", 0)],
      links: [{ fromNode: "srcA", fromSocket: "value", toNode: "sink", toSocket: "a" }],
      outputNodeId: "sink",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing-input");
      expect(result.nodeId).toBe("sink");
    }
    expect(harness.counts.get("sink")).toBeUndefined();
  });

  it("노드가 실패하면 그 노드 id 와 함께 실패가 올라온다", () => {
    const failing = createStudioGeometryNodeRegistry([
      {
        type: "boom",
        label: "boom",
        summary: "",
        inputs: [],
        outputs: [{ key: "value", label: "value", type: "float" }],
        params: [],
        evaluate: () => ({ ok: false, code: "degenerate-input", detail: "고의 실패" }),
      },
    ]);
    const evaluator = createStudioGeometryNodesEvaluator({ registry: failing });
    const result = evaluator.evaluate({
      nodes: [{ id: "b", type: "boom", params: {} }],
      links: [],
      outputNodeId: "b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("degenerate-input");
      expect(result.nodeId).toBe("b");
      expect(result.detail).toBe("고의 실패");
    }
  });

  it("노드가 하나도 없으면 no-output-node", () => {
    const evaluator = createStudioGeometryNodesEvaluator();
    const result = evaluator.evaluate({ nodes: [], links: [], outputNodeId: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("no-output-node");
  });
});

describe("studio-geometry-nodes-eval · 기본 레지스트리 종단 평가", () => {
  let backend: StudioGeometryNodesPlanarBooleanBackend;

  beforeAll(async () => {
    backend = await loadStudioGeometryNodesPlanarBooleanBackend();
  });

  it("스타터 그래프(격자 → 압출 → 출력)는 8정점·12삼각형 상자를 만든다", () => {
    const evaluator = createStudioGeometryNodesEvaluator();
    const result = evaluator.evaluate(createStudioGeometryNodesStarterGraph());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.outputs.geometry;
    expect(output.kind).toBe("geometry");
    if (output.kind !== "geometry") return;
    expect(studioGeometryVertexCount(output.mesh)).toBe(8);
    expect(studioGeometryTriangleCount(output.mesh)).toBe(12);
    // 1×1 판 양면(2) + 둘레 4 × 두께 0.25 (1) = 3
    expect(studioGeometrySurfaceArea(output.mesh)).toBeCloseTo(3, 5);
  });

  it("포인트 → 인스턴스 파이프라인이 정확한 정점 수를 낸다", () => {
    const evaluator = createStudioGeometryNodesEvaluator();
    const cube = studioGeometryDefaultNodeRegistry.get("mesh-cube");
    const grid = studioGeometryDefaultNodeRegistry.get("mesh-grid");
    const distribute = studioGeometryDefaultNodeRegistry.get("distribute-points-on-faces");
    const instance = studioGeometryDefaultNodeRegistry.get("instance-on-points");
    expect(cube && grid && distribute && instance).toBeTruthy();
    if (!cube || !grid || !distribute || !instance) return;
    const result = evaluator.evaluate({
      nodes: [
        { id: "grid", type: "mesh-grid", params: studioGeometryDefaultParams(grid) },
        { id: "cube", type: "mesh-cube", params: studioGeometryDefaultParams(cube) },
        {
          id: "pts",
          type: "distribute-points-on-faces",
          params: { ...studioGeometryDefaultParams(distribute), count: 12, seed: 5 },
        },
        {
          id: "inst",
          type: "instance-on-points",
          params: { ...studioGeometryDefaultParams(instance), scale: 0.1 },
        },
      ],
      links: [
        { fromNode: "grid", fromSocket: "geometry", toNode: "pts", toSocket: "geometry" },
        { fromNode: "cube", fromSocket: "geometry", toNode: "inst", toSocket: "instance" },
        { fromNode: "pts", fromSocket: "points", toNode: "inst", toSocket: "points" },
      ],
      outputNodeId: "inst",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.outputs.geometry;
    if (output.kind !== "geometry") return;
    expect(studioGeometryVertexCount(output.mesh)).toBe(12 * 24);
    expect(studioGeometryTriangleCount(output.mesh)).toBe(12 * 12);
  });

  it("불리언 노드는 주입된 백엔드를 실제로 쓴다(없으면 실패)", () => {
    const nodes: StudioGeometryGraphNode[] = [
      { id: "a", type: "mesh-grid", params: { sizeX: 2, sizeY: 2, segmentsX: 1, segmentsY: 1 } },
      { id: "b", type: "mesh-grid", params: { sizeX: 2, sizeY: 2, segmentsX: 1, segmentsY: 1 } },
      { id: "t", type: "transform", params: { translateX: 1, translateY: 1 } },
      { id: "bool", type: "mesh-boolean", params: { op: "union" } },
    ];
    const links = [
      { fromNode: "b", fromSocket: "geometry", toNode: "t", toSocket: "geometry" },
      { fromNode: "a", fromSocket: "geometry", toNode: "bool", toSocket: "a" },
      { fromNode: "t", fromSocket: "geometry", toNode: "bool", toSocket: "b" },
    ];
    const graph: StudioGeometryGraph = { nodes, links, outputNodeId: "bool" };

    const withoutBackend = createStudioGeometryNodesEvaluator().evaluate(graph);
    expect(withoutBackend.ok).toBe(false);
    if (!withoutBackend.ok) expect(withoutBackend.code).toBe("boolean-backend-missing");

    const withBackend = createStudioGeometryNodesEvaluator({
      booleanBackend: backend,
    }).evaluate(graph);
    expect(withBackend.ok).toBe(true);
    if (!withBackend.ok) return;
    const output = withBackend.outputs.geometry;
    if (output.kind !== "geometry") return;
    expect(studioGeometrySurfaceArea(output.mesh)).toBeCloseTo(7, 4);
  });

  it("벡터 소켓이 파라미터를 덮어쓴다", () => {
    const evaluator = createStudioGeometryNodesEvaluator();
    const result = evaluator.evaluate({
      nodes: [
        { id: "grid", type: "mesh-grid", params: { sizeX: 1, sizeY: 1, segmentsX: 1, segmentsY: 1 } },
        { id: "vec", type: "value-vector", params: { x: 0, y: 0, z: 7 } },
        { id: "t", type: "transform", params: { translateZ: -99 } },
      ],
      links: [
        { fromNode: "grid", fromSocket: "geometry", toNode: "t", toSocket: "geometry" },
        { fromNode: "vec", fromSocket: "vector", toNode: "t", toSocket: "translation" },
      ],
      outputNodeId: "t",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.outputs.geometry;
    if (output.kind !== "geometry") return;
    for (let i = 0; i < studioGeometryVertexCount(output.mesh); i++) {
      expect(output.mesh.positions[i * 3 + 2]).toBe(7);
    }
  });

  it("전체 파이프라인 결과가 두 번 평가해도 바이트 동일하다(캐시 우회 포함)", () => {
    const graph = createStudioGeometryNodesStarterGraph();
    const first = createStudioGeometryNodesEvaluator().evaluate(graph);
    const second = createStudioGeometryNodesEvaluator().evaluate(graph);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const a = first.outputs.geometry;
    const b = second.outputs.geometry;
    if (a.kind !== "geometry" || b.kind !== "geometry") return;
    expect(Array.from(b.mesh.positions)).toEqual(Array.from(a.mesh.positions));
    expect(Array.from(b.mesh.indices)).toEqual(Array.from(a.mesh.indices));
  });
});
