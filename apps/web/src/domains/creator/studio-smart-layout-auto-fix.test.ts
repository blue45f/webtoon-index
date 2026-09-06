import { describe, expect, it } from "vitest";

import {
  applyStudioSmartLayoutPatches,
  planStudioSmartLayoutAutoFix,
  type StudioSmartLayoutConnector,
  type StudioSmartLayoutNode,
  type StudioSmartLayoutPlan,
} from "./studio-smart-layout-auto-fix";

function expectPlan(
  result: ReturnType<typeof planStudioSmartLayoutAutoFix>
): StudioSmartLayoutPlan {
  expect(result.status === "ready" || result.status === "noop").toBe(true);
  if (result.status === "rejected") throw new Error(`unexpected rejection: ${result.reason}`);
  return result;
}

describe("studio-smart-layout-auto-fix", () => {
  it("uniformly sizes, cross-axis aligns, edge-distributes, and straightens connectors", () => {
    const nodes: StudioSmartLayoutNode[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 20 },
      { id: "b", x: 50, y: 10, width: 30, height: 10 },
      { id: "c", x: 120, y: 20, width: 10, height: 30 },
    ];
    const connectors: StudioSmartLayoutConnector[] = [
      {
        id: "a-c",
        fromNodeId: "a",
        toNodeId: "c",
        points: [
          { x: 5, y: 5 },
          { x: 90, y: 80 },
          { x: 125, y: 35 },
        ],
      },
    ];

    const plan = expectPlan(
      planStudioSmartLayoutAutoFix({
        nodes,
        selectedIds: ["c", "a", "b"],
        connectors,
        reference: { kind: "selection" },
      })
    );

    expect(plan.flow).toBe("horizontal");
    expect(plan.sizeSourceId).toBe("a");
    expect(plan.preview.nodes).toEqual([
      { id: "a", geometry: { x: 0, y: 15, width: 20, height: 20 } },
      { id: "b", geometry: { x: 55, y: 15, width: 20, height: 20 } },
      { id: "c", geometry: { x: 110, y: 15, width: 20, height: 20 } },
    ]);
    expect(plan.preview.connectors).toEqual([
      {
        id: "a-c",
        points: [
          { x: 20, y: 25 },
          { x: 110, y: 25 },
        ],
      },
    ]);
    expect(plan.connectorDisposition).toBe("straightened");
    expect(plan.commit.atomic).toBe(true);
    expect(plan.stats).toEqual({
      selectedNodeCount: 3,
      consideredConnectorCount: 1,
      changedNodeCount: 3,
      changedConnectorCount: 1,
      pairChecks: 3,
    });
  });

  it("supports artboard reference, equal size from an explicit source, and reference-space distribution", () => {
    const plan = expectPlan(
      planStudioSmartLayoutAutoFix({
        nodes: [
          { id: "a", x: 0, y: 0, width: 20, height: 10 },
          { id: "b", x: 40, y: 30, width: 30, height: 20 },
          { id: "c", x: 100, y: 60, width: 40, height: 30 },
        ],
        selectedIds: ["a", "b", "c"],
        reference: {
          kind: "artboard",
          bounds: { x: 10, y: 20, width: 200, height: 100 },
        },
        flow: "horizontal",
        alignment: { vertical: "bottom" },
        distributionBasis: "reference",
        sameSize: "both",
        sizeSourceId: "b",
      })
    );

    expect(plan.preview.nodes).toEqual([
      { id: "a", geometry: { x: 10, y: 100, width: 30, height: 20 } },
      { id: "b", geometry: { x: 95, y: 100, width: 30, height: 20 } },
      { id: "c", geometry: { x: 180, y: 100, width: 30, height: 20 } },
    ]);
  });

  it("aligns to a key object without moving the key object", () => {
    const plan = expectPlan(
      planStudioSmartLayoutAutoFix({
        nodes: [
          { id: "moving", x: 10, y: 20, width: 20, height: 10 },
          { id: "key", x: 100, y: 200, width: 50, height: 40 },
        ],
        selectedIds: ["moving", "key"],
        reference: { kind: "key-object", nodeId: "key" },
        flow: "none",
        distribute: false,
        sameSize: "none",
        alignment: { horizontal: "left", vertical: "top" },
      })
    );

    expect(plan.preview.nodes).toEqual([
      { id: "key", geometry: { x: 100, y: 200, width: 50, height: 40 } },
      { id: "moving", geometry: { x: 100, y: 200, width: 20, height: 10 } },
    ]);
    expect(plan.stats.changedNodeCount).toBe(1);
  });

  it("produces the same plan for every input ordering and resolves size ties by id", () => {
    const nodes: StudioSmartLayoutNode[] = [
      { id: "b", x: 40, y: 0, width: 30, height: 10 },
      { id: "a", x: 0, y: 0, width: 10, height: 10 },
    ];
    const request = {
      nodes,
      selectedIds: ["b", "a"],
      reference: { kind: "selection" as const },
      sameSize: "width" as const,
    };
    const first = planStudioSmartLayoutAutoFix(request);
    const second = planStudioSmartLayoutAutoFix({
      ...request,
      nodes: [...nodes].reverse(),
      selectedIds: [...request.selectedIds].reverse(),
    });

    expect(first).toEqual(second);
    expectPlan(first);
    if (first.status !== "rejected") expect(first.sizeSourceId).toBe("a");
  });

  it("keeps a layout plan but skips connector straightening while nodes overlap", () => {
    const plan = expectPlan(
      planStudioSmartLayoutAutoFix({
        nodes: [
          { id: "a", x: 0, y: 0, width: 20, height: 20 },
          { id: "b", x: 10, y: 0, width: 20, height: 20 },
        ],
        selectedIds: ["a", "b"],
        connectors: [
          {
            id: "link",
            fromNodeId: "a",
            toNodeId: "b",
            points: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
            ],
          },
        ],
        reference: { kind: "selection" },
        flow: "none",
        distribute: false,
        sameSize: "none",
        alignment: {},
      })
    );

    expect(plan.status).toBe("noop");
    expect(plan.preview.overlapDetected).toBe(true);
    expect(plan.connectorDisposition).toBe("skipped-overlap");
    expect(plan.preview.connectors[0]?.points).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ]);
  });

  it("fails closed before pair checks and patch construction exceed caller budgets", () => {
    const fourNodes: StudioSmartLayoutNode[] = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      x: index * 20,
      y: 0,
      width: 10,
      height: 10,
    }));
    expect(
      planStudioSmartLayoutAutoFix({
        nodes: fourNodes,
        selectedIds: fourNodes.map((node) => node.id),
        reference: { kind: "selection" },
        budget: { maxPairChecks: 5 },
      })
    ).toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
      budget: { metric: "maxPairChecks", actual: 6, limit: 5 },
    });

    expect(
      planStudioSmartLayoutAutoFix({
        nodes: fourNodes.slice(0, 2),
        selectedIds: ["0", "1"],
        connectors: [
          {
            id: "link",
            fromNodeId: "0",
            toNodeId: "1",
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
            ],
          },
        ],
        reference: { kind: "selection" },
        budget: { maxPatches: 2 },
      })
    ).toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
      budget: { metric: "maxPatches", actual: 3, limit: 2 },
    });
  });

  it("rejects conflicting axes, locked selections, invalid endpoints, and insufficient reference space", () => {
    const nodes: StudioSmartLayoutNode[] = [
      { id: "a", x: 0, y: 0, width: 20, height: 10 },
      { id: "b", x: 40, y: 0, width: 20, height: 10 },
      { id: "c", x: 80, y: 0, width: 20, height: 10 },
    ];

    expect(
      planStudioSmartLayoutAutoFix({
        nodes,
        selectedIds: ["a", "b", "c"],
        reference: { kind: "selection" },
        flow: "horizontal",
        alignment: { horizontal: "center" },
      })
    ).toMatchObject({ status: "rejected", reason: "conflicting-operations" });

    expect(
      planStudioSmartLayoutAutoFix({
        nodes: [{ ...nodes[0]!, locked: true }, nodes[1]!],
        selectedIds: ["a", "b"],
        reference: { kind: "selection" },
      })
    ).toMatchObject({ status: "rejected", reason: "locked-selection" });

    expect(
      planStudioSmartLayoutAutoFix({
        nodes: nodes.slice(0, 2),
        selectedIds: ["a", "b"],
        connectors: [
          {
            id: "broken",
            fromNodeId: "a",
            toNodeId: "missing",
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        ],
        reference: { kind: "selection" },
      })
    ).toMatchObject({ status: "rejected", reason: "invalid-connector-endpoint" });

    expect(
      planStudioSmartLayoutAutoFix({
        nodes,
        selectedIds: ["a", "b", "c"],
        reference: {
          kind: "artboard",
          bounds: { x: 0, y: 0, width: 40, height: 100 },
        },
        flow: "horizontal",
        distributionBasis: "reference",
        sameSize: "none",
      })
    ).toMatchObject({
      status: "rejected",
      reason: "insufficient-distribution-space",
    });
  });

  it("applies forward and inverse patches exactly and rejects stale snapshots atomically", () => {
    const nodes: StudioSmartLayoutNode[] = [
      { id: "a", x: 0.123456789, y: 0, width: 10, height: 10 },
      { id: "b", x: 50, y: 20, width: 20, height: 20 },
    ];
    const connectors: StudioSmartLayoutConnector[] = [
      {
        id: "link",
        fromNodeId: "a",
        toNodeId: "b",
        points: [
          { x: 5.123456789, y: 5 },
          { x: 60, y: 30 },
        ],
      },
    ];
    const plan = expectPlan(
      planStudioSmartLayoutAutoFix({
        nodes,
        connectors,
        selectedIds: ["a", "b"],
        reference: { kind: "selection" },
      })
    );
    const applied = applyStudioSmartLayoutPatches(
      { nodes, connectors },
      plan.commit.patches
    );
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") return;

    expect(applied.nodes).toMatchObject(
      plan.preview.nodes.map(({ id, geometry }) => ({ id, ...geometry }))
    );
    const restored = applyStudioSmartLayoutPatches(
      { nodes: applied.nodes, connectors: applied.connectors },
      plan.commit.inversePatches
    );
    expect(restored).toEqual({ status: "applied", nodes, connectors });

    const staleNodes = nodes.map((node) =>
      node.id === "a" ? { ...node, x: node.x + 1 } : node
    );
    expect(
      applyStudioSmartLayoutPatches(
        { nodes: staleNodes, connectors },
        plan.commit.patches
      )
    ).toEqual({ status: "rejected", reason: "stale-node", id: "a" });
    expect(staleNodes[0]?.x).toBe(1.123456789);
  });

  it("turns hostile getter failures into a fail-closed rejection", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("blocked getter");
        },
      }
    ) as Parameters<typeof planStudioSmartLayoutAutoFix>[0];

    expect(planStudioSmartLayoutAutoFix(hostile)).toEqual({
      status: "rejected",
      reason: "invalid-input",
      detail: "input access failed",
    });
  });
});
