import { describe, expect, it } from "vitest";

import {
  detectStudioGeometryGraphCycle,
  studioGeometryDownstreamNodeIds,
  validateStudioGeometryGraph,
} from "./studio-geometry-nodes-graph";
import { studioGeometryDefaultNodeRegistry } from "./studio-geometry-nodes-registry";

import type {
  StudioGeometryGraph,
  StudioGeometryGraphLink,
  StudioGeometryGraphNode,
} from "./studio-geometry-nodes-graph";

const schema = studioGeometryDefaultNodeRegistry;

function node(id: string, type: string): StudioGeometryGraphNode {
  return { id, type, params: {} };
}

function link(fromNode: string, fromSocket: string, toNode: string, toSocket: string) {
  return { fromNode, fromSocket, toNode, toSocket } satisfies StudioGeometryGraphLink;
}

function graph(
  nodes: StudioGeometryGraphNode[],
  links: StudioGeometryGraphLink[],
  outputNodeId: string | null = null
): StudioGeometryGraph {
  return { nodes, links, outputNodeId };
}

describe("studio-geometry-nodes-graph · 위상 정렬", () => {
  it("사슬 그래프는 상류 → 하류 순서로 정렬된다", () => {
    const result = validateStudioGeometryGraph(
      graph(
        [node("grid", "mesh-grid"), node("ex", "extrude"), node("out", "output")],
        [link("grid", "geometry", "ex", "geometry"), link("ex", "geometry", "out", "geometry")]
      ),
      schema
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual(["grid", "ex", "out"]);
  });

  it("선언 순서가 뒤집혀 있어도 의존 순서를 지킨다", () => {
    const result = validateStudioGeometryGraph(
      graph(
        [node("out", "output"), node("ex", "extrude"), node("grid", "mesh-grid")],
        [link("grid", "geometry", "ex", "geometry"), link("ex", "geometry", "out", "geometry")]
      ),
      schema
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual(["grid", "ex", "out"]);
  });

  it("다이아몬드 그래프에서 합류 노드는 두 갈래 뒤에 온다", () => {
    // grid → t1, grid → t2, (t1,t2) → join
    const result = validateStudioGeometryGraph(
      graph(
        [
          node("grid", "mesh-grid"),
          node("t1", "transform"),
          node("t2", "transform"),
          node("join", "join"),
        ],
        [
          link("grid", "geometry", "t1", "geometry"),
          link("grid", "geometry", "t2", "geometry"),
          link("t1", "geometry", "join", "a"),
          link("t2", "geometry", "join", "b"),
        ]
      ),
      schema
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const index = (id: string): number => result.order.indexOf(id);
    expect(index("grid")).toBeLessThan(index("t1"));
    expect(index("grid")).toBeLessThan(index("t2"));
    expect(index("t1")).toBeLessThan(index("join"));
    expect(index("t2")).toBeLessThan(index("join"));
    expect(result.order).toEqual(["grid", "t1", "t2", "join"]);
  });

  it("루트가 여럿이면 선언 순서로 결정적으로 정렬된다", () => {
    const nodes = [node("cube", "mesh-cube"), node("sphere", "mesh-sphere"), node("join", "join")];
    const links = [
      link("cube", "geometry", "join", "a"),
      link("sphere", "geometry", "join", "b"),
    ];
    const first = validateStudioGeometryGraph(graph(nodes, links), schema);
    const second = validateStudioGeometryGraph(graph(nodes, links.slice().reverse()), schema);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.order).toEqual(["cube", "sphere", "join"]);
      expect(second.order).toEqual(first.order);
    }
  });

  it("연결되지 않은 고립 노드도 순서에 포함된다", () => {
    const result = validateStudioGeometryGraph(
      graph([node("grid", "mesh-grid"), node("lonely", "mesh-cube")], []),
      schema
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order).toEqual(["grid", "lonely"]);
  });
});

describe("studio-geometry-nodes-graph · 사이클 거부", () => {
  it("자기 루프를 잡는다", () => {
    const result = validateStudioGeometryGraph(
      graph([node("t", "transform")], [link("t", "geometry", "t", "geometry")]),
      schema
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.cycleNodeIds).toEqual(["t"]);
      expect(result.issues.some((entry) => entry.code === "cycle")).toBe(true);
    }
  });

  it("2노드 사이클을 잡고 멤버를 선언 순서로 돌려준다", () => {
    const result = validateStudioGeometryGraph(
      graph(
        [node("a", "transform"), node("b", "transform")],
        [link("a", "geometry", "b", "geometry"), link("b", "geometry", "a", "geometry")]
      ),
      schema
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cycleNodeIds).toEqual(["a", "b"]);
  });

  it("3노드 사이클을 잡는다(사이클 밖 노드는 멤버에 없다)", () => {
    const result = validateStudioGeometryGraph(
      graph(
        [
          node("grid", "mesh-grid"),
          node("a", "transform"),
          node("b", "transform"),
          node("c", "transform"),
        ],
        [
          link("a", "geometry", "b", "geometry"),
          link("b", "geometry", "c", "geometry"),
          link("c", "geometry", "a", "geometry"),
        ]
      ),
      schema
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.cycleNodeIds).toEqual(["a", "b", "c"]);
  });

  it("사이클 멤버 반환은 노드 선언 순서를 바꿔도 정렬 규약을 지킨다", () => {
    const links = [
      link("x", "geometry", "y", "geometry"),
      link("y", "geometry", "x", "geometry"),
    ];
    const forward = validateStudioGeometryGraph(
      graph([node("x", "transform"), node("y", "transform")], links),
      schema
    );
    const reversed = validateStudioGeometryGraph(
      graph([node("y", "transform"), node("x", "transform")], links),
      schema
    );
    expect(forward.ok || reversed.ok).toBe(false);
    if (!forward.ok) expect(forward.cycleNodeIds).toEqual(["x", "y"]);
    if (!reversed.ok) expect(reversed.cycleNodeIds).toEqual(["y", "x"]);
  });

  it("DAG 에서는 사이클을 찾지 않는다", () => {
    expect(
      detectStudioGeometryGraphCycle(
        ["a", "b", "c"],
        [link("a", "o", "b", "i"), link("a", "o", "c", "i"), link("b", "o", "c", "i")]
      )
    ).toEqual([]);
  });
});

describe("studio-geometry-nodes-graph · 구조 오류", () => {
  it("소켓 타입이 다르면 socket-type-mismatch 로 거부한다", () => {
    // distribute 는 points 를 내는데 transform 은 geometry 를 받는다.
    const result = validateStudioGeometryGraph(
      graph(
        [
          node("grid", "mesh-grid"),
          node("dist", "distribute-points-on-faces"),
          node("t", "transform"),
        ],
        [
          link("grid", "geometry", "dist", "geometry"),
          link("dist", "points", "t", "geometry"),
        ]
      ),
      schema
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((entry) => entry.code)).toContain("socket-type-mismatch");
    }
  });

  it("한 입력 소켓에 링크가 둘이면 multi-link-input", () => {
    const result = validateStudioGeometryGraph(
      graph(
        [node("a", "mesh-cube"), node("b", "mesh-sphere"), node("t", "transform")],
        [link("a", "geometry", "t", "geometry"), link("b", "geometry", "t", "geometry")]
      ),
      schema
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const entry = result.issues.find((candidate) => candidate.code === "multi-link-input");
      expect(entry?.nodeId).toBe("t");
      expect(entry?.socket).toBe("geometry");
    }
  });

  it("없는 소켓·없는 노드·미등록 타입·중복 id 를 각각의 코드로 잡는다", () => {
    const unknownSocket = validateStudioGeometryGraph(
      graph(
        [node("a", "mesh-cube"), node("t", "transform")],
        [link("a", "nope", "t", "geometry")]
      ),
      schema
    );
    expect(unknownSocket.ok).toBe(false);
    if (!unknownSocket.ok) {
      expect(unknownSocket.issues.map((entry) => entry.code)).toContain("unknown-socket");
    }

    const missingNode = validateStudioGeometryGraph(
      graph([node("t", "transform")], [link("ghost", "geometry", "t", "geometry")]),
      schema
    );
    expect(missingNode.ok).toBe(false);
    if (!missingNode.ok) {
      expect(missingNode.issues.map((entry) => entry.code)).toContain("missing-node");
    }

    const unknownType = validateStudioGeometryGraph(graph([node("x", "정체불명")], []), schema);
    expect(unknownType.ok).toBe(false);
    if (!unknownType.ok) {
      expect(unknownType.issues.map((entry) => entry.code)).toContain("unknown-node-type");
    }

    const duplicate = validateStudioGeometryGraph(
      graph([node("dup", "mesh-cube"), node("dup", "mesh-sphere")], []),
      schema
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.issues.map((entry) => entry.code)).toContain("duplicate-node-id");
    }

    const emptyId = validateStudioGeometryGraph(graph([node("", "mesh-cube")], []), schema);
    expect(emptyId.ok).toBe(false);
    if (!emptyId.ok) {
      expect(emptyId.issues.map((entry) => entry.code)).toContain("empty-node-id");
    }
  });

  it("issue 배열은 (code, nodeId, socket) 사전순으로 안정 정렬된다", () => {
    const result = validateStudioGeometryGraph(
      graph(
        [node("zz", "정체불명"), node("aa", "정체불명")],
        [link("ghost", "geometry", "aa", "geometry")]
      ),
      schema
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.issues.map((entry) => entry.code);
      expect(codes).toEqual([...codes].sort());
      const unknown = result.issues.filter((entry) => entry.code === "unknown-node-type");
      expect(unknown.map((entry) => entry.nodeId)).toEqual(["aa", "zz"]);
    }
  });
});

describe("studio-geometry-nodes-graph · 하류 추적", () => {
  it("루트에서 도달 가능한 노드만, 선언 순서로 돌려준다", () => {
    const target = graph(
      [
        node("grid", "mesh-grid"),
        node("t1", "transform"),
        node("t2", "transform"),
        node("other", "mesh-cube"),
      ],
      [link("grid", "geometry", "t1", "geometry"), link("t1", "geometry", "t2", "geometry")]
    );
    expect(studioGeometryDownstreamNodeIds(target, "grid")).toEqual(["grid", "t1", "t2"]);
    expect(studioGeometryDownstreamNodeIds(target, "t1")).toEqual(["t1", "t2"]);
    expect(studioGeometryDownstreamNodeIds(target, "other")).toEqual(["other"]);
  });
});
