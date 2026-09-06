import { describe, expect, it } from "vitest";

import {
  applyStudioProductionImpactPatches,
  normalizeStudioProductionSemanticGraph,
  planStudioProductionChangeImpact,
  type StudioProductionChangeImpactPlan,
  type StudioProductionSemanticEdge,
  type StudioProductionSemanticGraphInput,
  type StudioProductionSemanticNode,
} from "./studio-production-semantic-graph";

function completeGraph(): StudioProductionSemanticGraphInput {
  const nodes: StudioProductionSemanticNode[] = [
    { id: "script", kind: "script", label: "  Episode   1  " },
    { id: "scene", kind: "scene" },
    { id: "shot", kind: "shot" },
    { id: "panel", kind: "panel" },
    { id: "character", kind: "character" },
    { id: "dialogue", kind: "dialogue" },
    { id: "balloon", kind: "balloon" },
    { id: "scene3d", kind: "scene-3d" },
    { id: "layer", kind: "layer" },
    { id: "asset", kind: "asset" },
    { id: "translation", kind: "translation" },
    { id: "approval", kind: "approval", approvalStatus: "approved" },
    { id: "delivery", kind: "delivery", deliveryStatus: "exported" },
  ];
  const edges: StudioProductionSemanticEdge[] = [
    {
      id: "e-script-scene",
      kind: "story-flow",
      fromNodeId: "script",
      toNodeId: "scene",
    },
    {
      id: "e-scene-shot",
      kind: "story-flow",
      fromNodeId: "scene",
      toNodeId: "shot",
    },
    {
      id: "e-shot-panel",
      kind: "story-flow",
      fromNodeId: "shot",
      toNodeId: "panel",
    },
    {
      id: "e-character-dialogue",
      kind: "character-reference",
      fromNodeId: "character",
      toNodeId: "dialogue",
    },
    {
      id: "e-shot-dialogue",
      kind: "story-flow",
      fromNodeId: "shot",
      toNodeId: "dialogue",
    },
    {
      id: "e-dialogue-balloon",
      kind: "dialogue-render",
      fromNodeId: "dialogue",
      toNodeId: "balloon",
    },
    {
      id: "e-balloon-panel",
      kind: "balloon-placement",
      fromNodeId: "balloon",
      toNodeId: "panel",
    },
    {
      id: "e-asset-scene3d",
      kind: "asset-use",
      fromNodeId: "asset",
      toNodeId: "scene3d",
    },
    {
      id: "e-scene3d-layer",
      kind: "scene-render",
      fromNodeId: "scene3d",
      toNodeId: "layer",
    },
    {
      id: "e-layer-panel",
      kind: "layer-composite",
      fromNodeId: "layer",
      toNodeId: "panel",
    },
    {
      id: "e-dialogue-translation",
      kind: "translation-source",
      fromNodeId: "dialogue",
      toNodeId: "translation",
    },
    {
      id: "e-panel-approval",
      kind: "approval-input",
      fromNodeId: "panel",
      toNodeId: "approval",
    },
    {
      id: "e-translation-approval",
      kind: "approval-input",
      fromNodeId: "translation",
      toNodeId: "approval",
    },
    {
      id: "e-panel-delivery",
      kind: "delivery-input",
      fromNodeId: "panel",
      toNodeId: "delivery",
    },
    {
      id: "e-approval-delivery",
      kind: "delivery-input",
      fromNodeId: "approval",
      toNodeId: "delivery",
    },
  ];
  return { nodes, edges };
}

function expectPlan(
  result: ReturnType<typeof planStudioProductionChangeImpact>
): StudioProductionChangeImpactPlan {
  expect(result.status === "ready" || result.status === "noop").toBe(true);
  if (result.status === "rejected") throw new Error(`unexpected rejection: ${result.reason}`);
  return result;
}

describe("studio-production-semantic-graph", () => {
  it("normalizes all production node kinds and returns a stable topological graph", () => {
    const graph = completeGraph();
    const first = normalizeStudioProductionSemanticGraph(graph);
    const second = normalizeStudioProductionSemanticGraph({
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    });

    expect(first).toEqual(second);
    expect(first.status).toBe("ready");
    if (first.status !== "ready") return;
    expect(first.stats).toEqual({ nodeCount: 13, edgeCount: 15 });
    expect(first.graph.nodes.map((node) => node.kind)).toEqual([
      "approval",
      "asset",
      "balloon",
      "character",
      "delivery",
      "dialogue",
      "layer",
      "panel",
      "scene",
      "scene-3d",
      "script",
      "shot",
      "translation",
    ]);
    expect(first.graph.nodes.find((node) => node.id === "script")?.label).toBe(
      "Episode 1"
    );
    const order = new Map(
      first.graph.topologicalNodeIds.map((id, index) => [id, index] as const)
    );
    first.graph.edges.forEach((edge) => {
      expect(order.get(edge.fromNodeId)!).toBeLessThan(order.get(edge.toNodeId)!);
    });
  });

  it("propagates a script semantic diff with shortest evidence paths and atomic invalidations", () => {
    const plan = expectPlan(
      planStudioProductionChangeImpact({
        graph: completeGraph(),
        changes: [
          {
            nodeId: "script",
            kind: "content",
            changedFields: ["dialogue", "beats", "dialogue"],
            beforeFingerprint: "r1",
            afterFingerprint: "r2",
          },
        ],
      })
    );

    expect(plan.semanticDiff.events).toEqual([
      {
        nodeId: "script",
        nodeKind: "script",
        kinds: ["content"],
        changedFields: ["beats", "dialogue"],
        beforeFingerprint: "r1",
        afterFingerprint: "r2",
      },
    ]);
    expect(plan.downstream.map((impact) => impact.nodeId)).toEqual([
      "approval",
      "balloon",
      "delivery",
      "dialogue",
      "panel",
      "scene",
      "shot",
      "translation",
    ]);
    expect(plan.downstream.find((impact) => impact.nodeId === "approval")?.evidence).toEqual({
      sourceNodeId: "script",
      nodeIds: ["script", "scene", "shot", "panel", "approval"],
      edgeIds: [
        "e-script-scene",
        "e-scene-shot",
        "e-shot-panel",
        "e-panel-approval",
      ],
      distance: 4,
    });
    expect(plan.deliveries.reexport[0]?.evidence).toEqual({
      sourceNodeId: "script",
      nodeIds: ["script", "scene", "shot", "panel", "delivery"],
      edgeIds: [
        "e-script-scene",
        "e-scene-shot",
        "e-shot-panel",
        "e-panel-delivery",
      ],
      distance: 4,
    });
    expect(plan.approvals.invalidated.map((impact) => impact.nodeId)).toEqual([
      "approval",
    ]);
    expect(plan.deliveries.reexport.map((impact) => impact.nodeId)).toEqual([
      "delivery",
    ]);
    expect(plan.commit.patches).toEqual([
      {
        op: "set-approval-status",
        id: "approval",
        before: "approved",
        after: "invalidated",
      },
      {
        op: "set-delivery-status",
        id: "delivery",
        before: "exported",
        after: "stale",
      },
    ]);
  });

  it("merges repeated change events and is independent of graph and event input order", () => {
    const graph = completeGraph();
    const changes = [
      {
        nodeId: "asset",
        kind: "metadata" as const,
        changedFields: ["license", "source"],
        beforeFingerprint: "old",
        afterFingerprint: "new",
      },
      {
        nodeId: "asset",
        kind: "content" as const,
        changedFields: ["source", "mesh"],
        beforeFingerprint: "old",
        afterFingerprint: "new",
      },
      {
        nodeId: "character",
        kind: "structure" as const,
        changedFields: ["costume"],
      },
    ];
    const first = planStudioProductionChangeImpact({ graph, changes });
    const second = planStudioProductionChangeImpact({
      graph: { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() },
      changes: [...changes].reverse(),
    });

    expect(first).toEqual(second);
    const plan = expectPlan(first);
    expect(plan.semanticDiff.events[0]).toEqual({
      nodeId: "asset",
      nodeKind: "asset",
      kinds: ["content", "metadata"],
      changedFields: ["license", "mesh", "source"],
      beforeFingerprint: "old",
      afterFingerprint: "new",
    });
    expect(plan.semanticDiff.changedNodeCount).toBe(2);
    expect(plan.semanticDiff.changedFieldCount).toBe(4);
  });

  it("does not invalidate an approval for an approval-state-only change but reexports its delivery", () => {
    const plan = expectPlan(
      planStudioProductionChangeImpact({
        graph: completeGraph(),
        changes: [
          {
            nodeId: "approval",
            kind: "approval-state",
            changedFields: ["approvalStatus"],
          },
        ],
      })
    );

    expect(plan.approvals.affectedNodeIds).toEqual(["approval"]);
    expect(plan.approvals.invalidated).toEqual([]);
    expect(plan.deliveries.reexport.map((impact) => impact.nodeId)).toEqual([
      "delivery",
    ]);
    expect(plan.commit.patches).toEqual([
      {
        op: "set-delivery-status",
        id: "delivery",
        before: "exported",
        after: "stale",
      },
    ]);
  });

  it("applies forward and inverse status patches and rejects a stale snapshot atomically", () => {
    const graph = completeGraph();
    const plan = expectPlan(
      planStudioProductionChangeImpact({
        graph,
        changes: [{ nodeId: "script", kind: "content" }],
      })
    );
    const applied = applyStudioProductionImpactPatches(
      graph.nodes,
      plan.commit.patches
    );
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;
    expect(
      applied.nodes.find((node) => node.id === "approval")?.approvalStatus
    ).toBe("invalidated");
    expect(
      applied.nodes.find((node) => node.id === "delivery")?.deliveryStatus
    ).toBe("stale");

    const restored = applyStudioProductionImpactPatches(
      applied.nodes,
      plan.commit.inversePatches
    );
    expect(restored).toEqual({ status: "applied", nodes: graph.nodes });

    const staleNodes = graph.nodes.map((node) =>
      node.id === "approval"
        ? { ...node, approvalStatus: "in-review" as const }
        : node
    );
    expect(
      applyStudioProductionImpactPatches(staleNodes, plan.commit.patches)
    ).toEqual({ status: "rejected", reason: "stale-node", id: "approval" });
    expect(
      staleNodes.find((node) => node.id === "delivery")?.deliveryStatus
    ).toBe("exported");
  });

  it("rejects duplicate IDs and relations, dangling or mistyped edges, and valid-contract cycles", () => {
    const graph = completeGraph();
    expect(
      normalizeStudioProductionSemanticGraph({
        nodes: [...graph.nodes, graph.nodes[0]!],
        edges: graph.edges,
      })
    ).toMatchObject({ status: "rejected", reason: "duplicate-node-id" });

    expect(
      normalizeStudioProductionSemanticGraph({
        nodes: graph.nodes,
        edges: [...graph.edges, { ...graph.edges[0]!, id: "different-id" }],
      })
    ).toMatchObject({ status: "rejected", reason: "duplicate-edge-relation" });

    expect(
      normalizeStudioProductionSemanticGraph({
        nodes: graph.nodes,
        edges: [
          ...graph.edges,
          {
            id: "dangling",
            kind: "story-flow",
            fromNodeId: "script",
            toNodeId: "missing",
          },
        ],
      })
    ).toMatchObject({ status: "rejected", reason: "dangling-edge" });

    expect(
      normalizeStudioProductionSemanticGraph({
        nodes: graph.nodes,
        edges: [
          {
            id: "wrong-contract",
            kind: "scene-render",
            fromNodeId: "script",
            toNodeId: "scene",
          },
        ],
      })
    ).toMatchObject({ status: "rejected", reason: "invalid-edge-contract" });

    expect(
      normalizeStudioProductionSemanticGraph({
        nodes: [
          { id: "panel-a", kind: "panel" },
          { id: "panel-b", kind: "panel" },
        ],
        edges: [
          {
            id: "derive-a-b",
            kind: "derives-from ",
            fromNodeId: "panel-a",
            toNodeId: "panel-b",
          },
          {
            id: "derive-b-a",
            kind: "derives-from ",
            fromNodeId: "panel-b",
            toNodeId: "panel-a",
          },
        ],
      })
    ).toMatchObject({ status: "rejected", reason: "cycle" });
  });

  it("fails closed on traversal, evidence, graph-size, and conflicting-event budgets", () => {
    const graph = completeGraph();
    expect(
      planStudioProductionChangeImpact({
        graph,
        changes: [{ nodeId: "script", kind: "content" }],
        budget: { maxTraversalSteps: 2 },
      })
    ).toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
      budget: { metric: "maxTraversalSteps", actual: 3, limit: 2 },
    });

    expect(
      planStudioProductionChangeImpact({
        graph,
        changes: [{ nodeId: "script", kind: "content" }],
        budget: { maxEvidenceEntries: 2 },
      })
    ).toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
      budget: { metric: "maxEvidenceEntries" },
    });

    expect(
      normalizeStudioProductionSemanticGraph(graph, { maxNodes: 12 })
    ).toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
      budget: { metric: "maxNodes", actual: 13, limit: 12 },
    });

    expect(
      planStudioProductionChangeImpact({
        graph,
        changes: [
          {
            nodeId: "script",
            kind: "content",
            beforeFingerprint: "r1",
          },
          {
            nodeId: "script",
            kind: "metadata",
            beforeFingerprint: "different-r1",
          },
        ],
      })
    ).toMatchObject({
      status: "rejected",
      reason: "conflicting-change-event",
    });
  });

  it("rejects unknown change nodes, missing typed statuses, and hostile getters", () => {
    const graph = completeGraph();
    expect(
      planStudioProductionChangeImpact({
        graph,
        changes: [{ nodeId: "unknown", kind: "content" }],
      })
    ).toMatchObject({ status: "rejected", reason: "unknown-change-node" });

    expect(
      normalizeStudioProductionSemanticGraph({
        nodes: [{ id: "approval", kind: "approval" }],
        edges: [],
      })
    ).toMatchObject({ status: "rejected", reason: "invalid-input" });

    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("blocked getter");
        },
      }
    ) as Parameters<typeof planStudioProductionChangeImpact>[0];
    expect(planStudioProductionChangeImpact(hostile)).toEqual({
      status: "rejected",
      reason: "invalid-input",
      detail: "input access failed",
    });
  });
});
