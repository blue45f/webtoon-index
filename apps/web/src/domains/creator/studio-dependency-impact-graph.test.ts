import { describe, expect, it } from "vitest";

import {
  createStudioDependencyImpactGraph,
  planStudioImpactApplication,
  previewStudioDependencyImpact,
  STUDIO_DEPENDENCY_IMPACT_LIMITS,
  StudioDependencyImpactGraphError,
  type StudioDependencyEdge,
  type StudioDependencyNode,
} from "./studio-dependency-impact-graph";

function node(
  id: string,
  kind: StudioDependencyNode["kind"],
  overrides: Partial<StudioDependencyNode> = {},
): StudioDependencyNode {
  return {
    id,
    kind,
    label: id,
    approval: "draft",
    reworkMinutes: 10,
    ...overrides,
  };
}

function edge(
  dependencyId: string,
  dependentId: string,
  relation: StudioDependencyEdge["relation"] = "uses",
): StudioDependencyEdge {
  return { dependencyId, dependentId, relation };
}

describe("studio dependency impact graph", () => {
  it("detects damaged references, duplicate links, self-links, and real cycles without poisoning traversal", () => {
    const graph = createStudioDependencyImpactGraph({
      nodes: [
        node("asset-a", "asset"),
        node("shot-a", "shot"),
        node("panel-a", "panel"),
      ],
      edges: [
        edge("asset-a", "shot-a"),
        edge("asset-a", "shot-a"),
        edge("shot-a", "panel-a", "contains"),
        edge("panel-a", "shot-a", "derives-from "),
        edge("asset-a", "asset-a"),
        edge("missing", "panel-a"),
        edge("asset-a", "missing"),
      ],
    });

    expect(graph.edges).toHaveLength(3);
    expect(graph.diagnostics.map(({ code }) => code)).toEqual([
      "DUPLICATE_EDGE",
      "SELF_DEPENDENCY",
      "DANGLING_DEPENDENCY",
      "DANGLING_DEPENDENT",
      "DEPENDENCY_CYCLE",
    ]);
    expect(
      graph.diagnostics.find(({ code }) => code === "DEPENDENCY_CYCLE")?.nodeIds,
    ).toEqual(["panel-a", "shot-a"]);

    const preview = previewStudioDependencyImpact(graph, [
      { nodeId: "asset-a", kind: "replacement" },
    ]);
    expect(preview.impacts.map(({ node }) => node.id)).toEqual([
      "shot-a",
      "panel-a",
    ]);
    expect(preview.truncated).toBe(false);
  });

  it("builds deterministic transitive paths, approval risk, cost, and assignee summaries", () => {
    const graph = createStudioDependencyImpactGraph({
      nodes: [
        node("costume:hero:v2", "costume", { reworkMinutes: 30 }),
        node("component:hero", "component", {
          assigneeId: "character-team",
          reworkMinutes: 20,
        }),
        node("shot:12", "shot", {
          assigneeId: "3d-team",
          reworkMinutes: 45,
        }),
        node("panel:38", "panel", {
          approval: "approved",
          assigneeId: "line-team",
          reworkMinutes: 90,
        }),
        node("unrelated:cover", "panel"),
      ],
      edges: [
        edge("costume:hero:v2", "component:hero", "uses"),
        edge("component:hero", "shot:12", "renders-with"),
        edge("shot:12", "panel:38", "derives-from "),
      ],
    });

    const preview = previewStudioDependencyImpact(graph, [
      {
        nodeId: "costume:hero:v2",
        kind: "replacement",
        reason: "주인공 교복 디자인 변경",
      },
    ]);

    expect(
      preview.impacts.map(({ node, depth, severity }) => ({
        id: node.id,
        depth,
        severity,
      })),
    ).toEqual([
      { id: "component:hero", depth: 1, severity: "high" },
      { id: "shot:12", depth: 2, severity: "high" },
      { id: "panel:38", depth: 3, severity: "high" },
    ]);
    expect(preview.impacts[2]?.paths).toEqual([
      {
        rootNodeId: "costume:hero:v2",
        nodeIds: [
          "costume:hero:v2",
          "component:hero",
          "shot:12",
          "panel:38",
        ],
        relations: ["uses", "renders-with", "derives-from "],
      },
    ]);
    expect(preview.approvedImpactCount).toBe(1);
    expect(preview.totalEstimatedReworkMinutes).toBe(155);
    expect(preview.unaffectedNodeCount).toBe(1);
    expect(preview.assignees).toEqual([
      {
        assigneeId: "3d-team",
        nodeIds: ["shot:12"],
        estimatedReworkMinutes: 45,
      },
      {
        assigneeId: "character-team",
        nodeIds: ["component:hero"],
        estimatedReworkMinutes: 20,
      },
      {
        assigneeId: "line-team",
        nodeIds: ["panel:38"],
        estimatedReworkMinutes: 90,
      },
    ]);
  });

  it("merges multiple change roots once while retaining one shortest path per trigger", () => {
    const graph = createStudioDependencyImpactGraph({
      nodes: [
        node("font:body", "font"),
        node("platform:mobile", "platform"),
        node("balloon:1", "balloon"),
        node("export:webtoon", "export-preset"),
      ],
      edges: [
        edge("font:body", "balloon:1", "styles-with"),
        edge("platform:mobile", "balloon:1", "uses"),
        edge("balloon:1", "export:webtoon", "exports-with"),
      ],
    });

    const preview = previewStudioDependencyImpact(graph, [
      { nodeId: "platform:mobile", kind: "specification" },
      { nodeId: "font:body", kind: "license", reason: "폰트 사용권 만료" },
    ]);

    expect(preview.impacts).toHaveLength(2);
    expect(preview.impacts[0]?.node.id).toBe("balloon:1");
    expect(preview.impacts[0]?.paths.map(({ rootNodeId }) => rootNodeId)).toEqual([
      "font:body",
      "platform:mobile",
    ]);
    expect(preview.impacts[0]?.changeKinds).toEqual([
      "license",
      "specification",
    ]);
    expect(preview.impacts.every(({ severity }) => severity === "critical")).toBe(
      true,
    );
  });

  it("plans full application with approved versions held for review and creates bounded task notifications", () => {
    const graph = createStudioDependencyImpactGraph({
      nodes: [
        node("font:expired", "font"),
        node("balloon:draft", "balloon", {
          assigneeId: "lettering",
          reworkMinutes: 15,
        }),
        node("panel:approved", "panel", {
          approval: "approved",
          assigneeId: "lettering",
          reworkMinutes: 30,
        }),
      ],
      edges: [
        edge("font:expired", "balloon:draft", "styles-with"),
        edge("balloon:draft", "panel:approved", "contains"),
      ],
    });
    const preview = previewStudioDependencyImpact(graph, [
      { nodeId: "font:expired", kind: "license" },
    ]);

    const plan = planStudioImpactApplication(preview, { mode: "all" });

    expect(plan.applyNodeIds).toEqual(["balloon:draft"]);
    expect(plan.skipped).toEqual([
      { nodeId: "panel:approved", reason: "approved" },
    ]);
    expect(plan.reviewRequiredNodeIds).toEqual(["panel:approved"]);
    expect(plan.estimatedReworkMinutes).toBe(15);
    expect(plan.tasks).toEqual([
      {
        id: "impact:balloon:draft",
        nodeId: "balloon:draft",
        title: "balloon:draft 재검토",
        assigneeId: "lettering",
        estimatedReworkMinutes: 15,
        triggerNodeIds: ["font:expired"],
        severity: "critical",
      },
    ]);
    expect(plan.notifications).toEqual([
      {
        assigneeId: "lettering",
        nodeIds: ["balloon:draft"],
        estimatedReworkMinutes: 15,
      },
    ]);
  });

  it("supports explicit selected application and reports stale selections without touching unrelated impacts", () => {
    const graph = createStudioDependencyImpactGraph({
      nodes: [
        node("location:school", "location"),
        node("shot:1", "shot"),
        node("shot:2", "shot", { approval: "approved" }),
      ],
      edges: [
        edge("location:school", "shot:1"),
        edge("location:school", "shot:2"),
      ],
    });
    const preview = previewStudioDependencyImpact(graph, [
      { nodeId: "location:school", kind: "content" },
    ]);

    const plan = planStudioImpactApplication(preview, {
      mode: "selected",
      selectedNodeIds: ["shot:2", "deleted-shot"],
      includeApproved: true,
    });

    expect(plan.applyNodeIds).toEqual(["shot:2"]);
    expect(plan.skipped).toEqual([
      { nodeId: "shot:1", reason: "not-selected" },
    ]);
    expect(plan.unknownSelectedNodeIds).toEqual(["deleted-shot"]);
    expect(plan.reviewRequiredNodeIds).toEqual([]);
  });

  it("fails closed for ambiguous identities, unknown roots, invalid selections, and unsafe graph sizes", () => {
    expect(() =>
      createStudioDependencyImpactGraph({
        nodes: [node("same", "asset"), node("same", "panel")],
        edges: [],
      })
    ).toThrow(
      expect.objectContaining<Partial<StudioDependencyImpactGraphError>>({
        code: "DUPLICATE_NODE",
      }),
    );

    const graph = createStudioDependencyImpactGraph({
      nodes: [node("asset:1", "asset")],
      edges: [],
    });
    expect(() =>
      previewStudioDependencyImpact(graph, [
        { nodeId: "missing", kind: "content" },
      ])
    ).toThrow(
      expect.objectContaining<Partial<StudioDependencyImpactGraphError>>({
        code: "UNKNOWN_CHANGE_NODE",
      }),
    );
    const preview = previewStudioDependencyImpact(graph, [
      { nodeId: "asset:1", kind: "content" },
    ]);
    expect(() =>
      planStudioImpactApplication(preview, {
        mode: "selected",
        selectedNodeIds: [],
      })
    ).toThrow(
      expect.objectContaining<Partial<StudioDependencyImpactGraphError>>({
        code: "INVALID_SELECTION",
      }),
    );

    const oversizedNodes = Array.from(
      { length: STUDIO_DEPENDENCY_IMPACT_LIMITS.maxNodes + 1 },
      (_, index) => node(`node:${index}`, "other"),
    );
    expect(() =>
      createStudioDependencyImpactGraph({
        nodes: oversizedNodes,
        edges: [],
      })
    ).toThrow(
      expect.objectContaining<Partial<StudioDependencyImpactGraphError>>({
        code: "GRAPH_LIMIT_EXCEEDED",
      }),
    );
  });

  it("applies a deterministic impact cap while preserving the known unaffected count", () => {
    const graph = createStudioDependencyImpactGraph({
      nodes: [
        node("root", "asset"),
        node("dependent-a", "panel"),
        node("dependent-b", "panel"),
        node("dependent-c", "panel"),
      ],
      edges: [
        edge("root", "dependent-c"),
        edge("root", "dependent-a"),
        edge("root", "dependent-b"),
      ],
    });

    const preview = previewStudioDependencyImpact(
      graph,
      [{ nodeId: "root", kind: "style" }],
      { maxImpacts: 2 },
    );

    expect(preview.impacts.map(({ node: impactNode }) => impactNode.id)).toEqual([
      "dependent-a",
      "dependent-b",
    ]);
    expect(preview.truncated).toBe(true);
    expect(preview.unaffectedNodeCount).toBe(1);
  });
});
