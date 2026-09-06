import { describe, expect, it } from "vitest";

import { createStudioGeometryNodesEvaluator } from "./studio-geometry-nodes-eval";
import {
  createStudioGeometryNodesStarterGraph,
  parseStudioGeometryNodesGraph,
  serializeStudioGeometryNodesGraph,
  STUDIO_GEOMETRY_NODES_DOC_KIND,
  STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES,
  STUDIO_GEOMETRY_NODES_DOC_MAX_LINKS,
  STUDIO_GEOMETRY_NODES_DOC_MAX_NODES,
  STUDIO_GEOMETRY_NODES_DOC_VERSION,
} from "./studio-geometry-nodes-serialization";

import type { StudioGeometryGraph } from "./studio-geometry-nodes-graph";
import type {
  StudioGeometryNodeDefinition,
  StudioGeometryNodeRegistry,
} from "./studio-geometry-nodes-registry";
import type { StudioGeometryNodesParseResult } from "./studio-geometry-nodes-serialization";

function unwrap(result: StudioGeometryNodesParseResult): StudioGeometryGraph {
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.graph;
}

function envelope(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: STUDIO_GEOMETRY_NODES_DOC_KIND,
    version: STUDIO_GEOMETRY_NODES_DOC_VERSION,
    outputNodeId: null,
    nodes: [],
    links: [],
    ...overrides,
  };
}

const linearNodeDefinition: StudioGeometryNodeDefinition = {
  type: "linear-test",
  label: "대규모 직렬화 테스트",
  summary: "문서 개수 admission 회귀 전용 노드",
  inputs: [{ key: "geometry", label: "지오메트리", type: "geometry" }],
  outputs: [{ key: "geometry", label: "지오메트리", type: "geometry" }],
  params: [],
  evaluate: () => {
    throw new Error("직렬화 테스트 노드는 평가하지 않습니다.");
  },
};

const linearNodeRegistry: StudioGeometryNodeRegistry = {
  get: (type) => (type === linearNodeDefinition.type ? linearNodeDefinition : undefined),
  list: () => [linearNodeDefinition],
};

function createLargeLinearGraph(nodeCount: number): StudioGeometryGraph {
  return {
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `n${index}`,
      type: linearNodeDefinition.type,
      params: {},
    })),
    links: Array.from({ length: Math.max(0, nodeCount - 1) }, (_, index) => ({
      fromNode: `n${index}`,
      fromSocket: "geometry",
      toNode: `n${index + 1}`,
      toSocket: "geometry",
    })),
    outputNodeId: nodeCount > 0 ? `n${nodeCount - 1}` : null,
  };
}

describe("studio-geometry-nodes-serialization · 라운드트립", () => {
  it("스타터 그래프가 구조 그대로 복원된다", () => {
    const graph = createStudioGeometryNodesStarterGraph();
    const restored = unwrap(parseStudioGeometryNodesGraph(serializeStudioGeometryNodesGraph(graph)));
    expect(restored.nodes.map((node) => node.id)).toEqual(["grid", "extrude", "output"]);
    expect(restored.outputNodeId).toBe("output");
    expect(restored.links).toHaveLength(2);
    expect(restored.nodes[1].params.distance).toBe(0.25);
  });

  it("재직렬화 문자열이 원본과 정확히 같다(정규형)", () => {
    const graph = createStudioGeometryNodesStarterGraph();
    const once = serializeStudioGeometryNodesGraph(graph);
    const twice = serializeStudioGeometryNodesGraph(unwrap(parseStudioGeometryNodesGraph(once)));
    expect(twice).toBe(once);
    const thrice = serializeStudioGeometryNodesGraph(unwrap(parseStudioGeometryNodesGraph(twice)));
    expect(thrice).toBe(once);
  });

  it("파라미터 키 순서와 링크 순서가 달라도 같은 문자열로 정규화된다", () => {
    const a: StudioGeometryGraph = {
      nodes: [
        { id: "g", type: "mesh-grid", params: { sizeY: 2, sizeX: 1, segmentsX: 1, segmentsY: 1 } },
        { id: "o", type: "output", params: {} },
        { id: "t", type: "transform", params: {} },
      ],
      links: [
        { fromNode: "t", fromSocket: "geometry", toNode: "o", toSocket: "geometry" },
        { fromNode: "g", fromSocket: "geometry", toNode: "t", toSocket: "geometry" },
      ],
      outputNodeId: "o",
    };
    const b: StudioGeometryGraph = {
      ...a,
      nodes: [
        { id: "g", type: "mesh-grid", params: { sizeX: 1, segmentsY: 1, sizeY: 2, segmentsX: 1 } },
        { id: "o", type: "output", params: {} },
        { id: "t", type: "transform", params: {} },
      ],
      links: [...a.links].reverse(),
    };
    expect(serializeStudioGeometryNodesGraph(b)).toBe(serializeStudioGeometryNodesGraph(a));
  });

  it("파서는 이미 파싱된 객체도 받는다", () => {
    const graph = createStudioGeometryNodesStarterGraph();
    const asObject: unknown = JSON.parse(serializeStudioGeometryNodesGraph(graph));
    expect(unwrap(parseStudioGeometryNodesGraph(asObject)).nodes).toHaveLength(3);
  });

  it("1,001 노드·1,000 링크를 바이트 예산 안에서 무손실 왕복한다", () => {
    const graph = createLargeLinearGraph(1_001);
    const serialized = serializeStudioGeometryNodesGraph(graph);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES
    );

    const fromString = unwrap(parseStudioGeometryNodesGraph(serialized, linearNodeRegistry));
    expect(fromString.nodes).toHaveLength(1_001);
    expect(fromString.links).toHaveLength(1_000);
    expect(serializeStudioGeometryNodesGraph(fromString)).toBe(serialized);

    const fromObject = unwrap(
      parseStudioGeometryNodesGraph(JSON.parse(serialized) as unknown, linearNodeRegistry)
    );
    expect(fromObject).toEqual(fromString);
    expect(STUDIO_GEOMETRY_NODES_DOC_MAX_NODES).toBe(Number.POSITIVE_INFINITY);
    expect(STUDIO_GEOMETRY_NODES_DOC_MAX_LINKS).toBe(Number.POSITIVE_INFINITY);
  });

  it("복원한 그래프가 평가까지 통과한다(왕복 후에도 실제로 동작)", () => {
    const graph = createStudioGeometryNodesStarterGraph();
    const restored = unwrap(parseStudioGeometryNodesGraph(serializeStudioGeometryNodesGraph(graph)));
    const result = createStudioGeometryNodesEvaluator().evaluate(restored);
    expect(result.ok).toBe(true);
  });

  it("결측 파라미터는 스키마 기본값으로 채워진다", () => {
    const restored = unwrap(
      parseStudioGeometryNodesGraph(
        envelope({ nodes: [{ id: "c", type: "mesh-cube", params: {} }] })
      )
    );
    expect(restored.nodes[0].params).toEqual({ segments: 1, size: 1 });
  });

  it("범위를 벗어난 파라미터는 스키마 min/max 로 클램프된다", () => {
    const restored = unwrap(
      parseStudioGeometryNodesGraph(
        envelope({ nodes: [{ id: "c", type: "mesh-cube", params: { segments: 9999, size: -5 } }] })
      )
    );
    expect(restored.nodes[0].params.segments).toBe(256);
    expect(restored.nodes[0].params.size).toBe(0.001);
  });

  it("enum 파라미터는 목록에 없는 값을 기본값으로 되돌린다", () => {
    const restored = unwrap(
      parseStudioGeometryNodesGraph(
        envelope({ nodes: [{ id: "b", type: "mesh-boolean", params: { op: "정체불명" } }] })
      )
    );
    expect(restored.nodes[0].params.op).toBe("union");
  });
});

describe("studio-geometry-nodes-serialization · 손상 입력(예외 없이 거부)", () => {
  const corruptCases: readonly { name: string; input: unknown; code: string }[] = [
    { name: "null", input: null, code: "not-an-object" },
    { name: "undefined", input: undefined, code: "not-an-object" },
    { name: "숫자", input: 42, code: "not-an-object" },
    { name: "배열", input: [], code: "not-an-object" },
    { name: "빈 객체", input: {}, code: "kind-mismatch" },
    { name: "잘못된 JSON 문자열", input: "{not json", code: "invalid-json" },
    { name: "JSON 이지만 배열", input: "[1,2,3]", code: "not-an-object" },
    { name: "kind 불일치", input: envelope({ kind: "other.doc" }), code: "kind-mismatch" },
    { name: "version 불일치", input: envelope({ version: 99 }), code: "version-unsupported" },
    { name: "nodes 가 배열 아님", input: envelope({ nodes: {} }), code: "invalid-node" },
    { name: "links 가 배열 아님", input: envelope({ links: "x" }), code: "invalid-link" },
    {
      name: "노드가 객체 아님",
      input: envelope({ nodes: ["문자열"] }),
      code: "invalid-node",
    },
    {
      name: "노드 id 없음",
      input: envelope({ nodes: [{ type: "mesh-cube", params: {} }] }),
      code: "invalid-id",
    },
    {
      name: "노드 id 빈 문자열",
      input: envelope({ nodes: [{ id: "", type: "mesh-cube", params: {} }] }),
      code: "invalid-id",
    },
    {
      name: "노드 id 과길이",
      input: envelope({ nodes: [{ id: "x".repeat(200), type: "mesh-cube", params: {} }] }),
      code: "invalid-id",
    },
    {
      name: "노드 type 이 문자열 아님",
      input: envelope({ nodes: [{ id: "a", type: 7, params: {} }] }),
      code: "invalid-node",
    },
    {
      name: "미등록 노드 타입",
      input: envelope({ nodes: [{ id: "a", type: "정체불명", params: {} }] }),
      code: "unknown-node-type",
    },
    {
      name: "중복 노드 id",
      input: envelope({
        nodes: [
          { id: "a", type: "mesh-cube", params: {} },
          { id: "a", type: "mesh-sphere", params: {} },
        ],
      }),
      code: "duplicate-node-id",
    },
    {
      name: "없는 노드를 가리키는 링크",
      input: envelope({
        nodes: [{ id: "a", type: "output", params: {} }],
        links: [{ fromNode: "ghost", fromSocket: "geometry", toNode: "a", toSocket: "geometry" }],
      }),
      code: "dangling-link",
    },
    {
      name: "없는 소켓을 가리키는 링크",
      input: envelope({
        nodes: [
          { id: "a", type: "mesh-cube", params: {} },
          { id: "b", type: "output", params: {} },
        ],
        links: [{ fromNode: "a", fromSocket: "없음", toNode: "b", toSocket: "geometry" }],
      }),
      code: "unknown-socket",
    },
    {
      name: "링크가 객체 아님",
      input: envelope({ links: [3] }),
      code: "invalid-link",
    },
    {
      name: "링크 소켓이 문자열 아님",
      input: envelope({
        nodes: [
          { id: "a", type: "mesh-cube", params: {} },
          { id: "b", type: "output", params: {} },
        ],
        links: [{ fromNode: "a", fromSocket: 1, toNode: "b", toSocket: "geometry" }],
      }),
      code: "invalid-link",
    },
    {
      name: "한 입력에 링크 둘",
      input: envelope({
        nodes: [
          { id: "a", type: "mesh-cube", params: {} },
          { id: "b", type: "mesh-sphere", params: {} },
          { id: "o", type: "output", params: {} },
        ],
        links: [
          { fromNode: "a", fromSocket: "geometry", toNode: "o", toSocket: "geometry" },
          { fromNode: "b", fromSocket: "geometry", toNode: "o", toSocket: "geometry" },
        ],
      }),
      code: "invalid-link",
    },
    {
      name: "존재하지 않는 outputNodeId",
      input: envelope({ outputNodeId: "ghost" }),
      code: "dangling-link",
    },
    {
      name: "문자열 바이트 상한 초과",
      input: "x".repeat(STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES + 1),
      code: "too-large",
    },
  ];

  for (const testCase of corruptCases) {
    it(`${testCase.name} → ${testCase.code} (throw 없음)`, () => {
      let result: StudioGeometryNodesParseResult | null = null;
      expect(() => {
        result = parseStudioGeometryNodesGraph(testCase.input);
      }).not.toThrow();
      expect(result).not.toBeNull();
      const parsed = result as StudioGeometryNodesParseResult | null;
      expect(parsed?.ok).toBe(false);
      if (parsed && !parsed.ok) {
        expect(parsed.code).toBe(testCase.code);
        expect(parsed.detail.length).toBeGreaterThan(0);
      }
    });
  }

  it("NaN·Infinity·문자열 파라미터는 던지지 않고 기본값으로 정화된다", () => {
    const restored = unwrap(
      parseStudioGeometryNodesGraph(
        envelope({
          nodes: [
            {
              id: "c",
              type: "mesh-cube",
              params: { size: Number.NaN, segments: Number.POSITIVE_INFINITY },
            },
            { id: "cy", type: "mesh-cylinder", params: { caps: "네", radius: "크게" } },
          ],
        })
      )
    );
    expect(restored.nodes[0].params).toEqual({ segments: 1, size: 1 });
    expect(restored.nodes[1].params.caps).toBe(true);
    expect(restored.nodes[1].params.radius).toBe(0.3);
  });

  it("스키마에 없는 여분 파라미터는 조용히 버려진다", () => {
    const restored = unwrap(
      parseStudioGeometryNodesGraph(
        envelope({ nodes: [{ id: "c", type: "mesh-cube", params: { size: 2, 악성: "코드" } }] })
      )
    );
    expect(Object.keys(restored.nodes[0].params)).toEqual(["segments", "size"]);
    expect(restored.nodes[0].params.size).toBe(2);
  });

  it("객체 입력의 getter를 한 번도 실행하지 않고 fail-closed 한다", () => {
    let getterCalls = 0;
    const input = envelope({});
    Object.defineProperty(input, "nodes", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error("실행되면 안 됩니다");
      },
    });

    let result: StudioGeometryNodesParseResult | null = null;
    expect(() => {
      result = parseStudioGeometryNodesGraph(input);
    }).not.toThrow();
    expect(getterCalls).toBe(0);
    expect(result).toMatchObject({ ok: false, code: "invalid-json" });
  });

  it("순환 참조·희소 배열을 throw 없이 fail-closed 한다", () => {
    const cyclic = envelope({});
    cyclic.self = cyclic;
    const sparseNodes = new Array<unknown>(2);
    sparseNodes[1] = { id: "n1", type: "mesh-cube", params: {} };

    expect(() => parseStudioGeometryNodesGraph(cyclic)).not.toThrow();
    expect(parseStudioGeometryNodesGraph(cyclic)).toMatchObject({
      ok: false,
      code: "invalid-json",
    });
    expect(() => parseStudioGeometryNodesGraph(envelope({ nodes: sparseNodes }))).not.toThrow();
    expect(parseStudioGeometryNodesGraph(envelope({ nodes: sparseNodes }))).toMatchObject({
      ok: false,
      code: "invalid-json",
    });
  });

  it("객체 입력도 256KiB canonical UTF-8 admission을 우회하지 못한다", () => {
    const oversizedObject = envelope({
      nodes: [
        {
          id: "n",
          type: "mesh-cube",
          params: { ignoredPadding: "가".repeat(STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES) },
        },
      ],
    });
    const result = parseStudioGeometryNodesGraph(oversizedObject);
    expect(result).toMatchObject({ ok: false, code: "too-large" });
  });

  it("UTF-16 length가 작아도 UTF-8 바이트가 상한을 넘는 문자열을 거부한다", () => {
    const input = `"${"가".repeat(Math.ceil(STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES / 2))}"`;
    expect(input.length).toBeLessThan(STUDIO_GEOMETRY_NODES_DOC_MAX_BYTES);
    expect(parseStudioGeometryNodesGraph(input)).toMatchObject({ ok: false, code: "too-large" });
  });

  it("사이클이 든 문서도 파싱은 되지만 평가에서 거부된다(관심사 분리)", () => {
    const parsed = unwrap(
      parseStudioGeometryNodesGraph(
        envelope({
          nodes: [
            { id: "a", type: "transform", params: {} },
            { id: "b", type: "transform", params: {} },
          ],
          links: [
            { fromNode: "a", fromSocket: "geometry", toNode: "b", toSocket: "geometry" },
            { fromNode: "b", fromSocket: "geometry", toNode: "a", toSocket: "geometry" },
          ],
          outputNodeId: "b",
        })
      )
    );
    expect(parsed.nodes).toHaveLength(2);
    const result = createStudioGeometryNodesEvaluator().evaluate(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("graph-invalid");
  });

});
