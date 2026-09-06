import { describe, expect, it } from "vitest";

import {
  allocateStudioBg3dTemplateInstanceNodeIds,
  collectStudioBg3dTemplateInstances,
  hasStudioBg3dSelectedAncestor,
  hashStudioBg3dTemplateSourceId,
  orderStudioBg3dHierarchySelectionRootsFirst,
  parseStudioBg3dTemplateInstanceNodeId,
  resolveStudioBg3dTemplateSourceByKey,
  resolveStudioBg3dDuplicateHierarchyPatch,
} from "./studio-bg3d-template-instance";
import {
  planStudioBg3dTemplateInstanceArrangement,
  planStudioBg3dTemplateInstanceReset,
  type StudioBg3dTemplateRuntimeEntity,
} from "./studio-bg3d-template-organizer-plans";

function allocation(
  sourceId: string,
  nodeCount: number,
  seed: string,
  insertionOffset = 0,
) {
  const result = allocateStudioBg3dTemplateInstanceNodeIds({
    sourceKind: "catalog",
    sourceId,
    insertionOffset,
    nodeCount,
    occupiedNodeIds: new Set(),
    createSeed: () => seed,
  });
  if (!result) throw new Error("Unable to allocate template fixture ids.");
  return result;
}

describe("studio-bg3d-template-instance", () => {
  it("orders hierarchy roots first and keeps descendants from receiving duplicate deltas", () => {
    const entities = [
      { id: "primitive-child", parentId: "model-root", position: [0, 1, 0] as const },
      { id: "model-root", parentId: null, position: [2, 0, 0] as const },
      { id: "nested-child", parentId: "primitive-child", position: [0, 2, 0] as const },
    ];
    const byId = new Map(entities.map((entity) => [entity.id, entity]));

    expect(orderStudioBg3dHierarchySelectionRootsFirst(entities)).toEqual([
      "model-root",
      "primitive-child",
      "nested-child",
    ]);
    expect(hasStudioBg3dSelectedAncestor(
      entities[2]!,
      new Set(["model-root"]),
      (id) => byId.get(id),
    )).toBe(true);

    const lockedParent = {
      id: "locked-parent",
      parentId: null,
      position: [0, 0, 0] as const,
      locked: true,
    };
    const editableChild = {
      id: "editable-child",
      parentId: lockedParent.id,
      position: [0, 1, 0] as const,
      locked: false,
    };
    const otherDriver = {
      id: "other-driver",
      parentId: null,
      position: [3, 0, 0] as const,
      locked: false,
    };
    const transformEntities = new Map(
      [lockedParent, editableChild, otherDriver].map((candidate) => [candidate.id, candidate]),
    );
    expect(hasStudioBg3dSelectedAncestor(
      editableChild,
      new Set([otherDriver.id, lockedParent.id, editableChild.id]),
      (id) => transformEntities.get(id),
      (ancestor) => ancestor.locked !== true,
    )).toBe(false);
    transformEntities.set(lockedParent.id, { ...lockedParent, locked: false });
    expect(hasStudioBg3dSelectedAncestor(
      editableChild,
      new Set([otherDriver.id, lockedParent.id, editableChild.id]),
      (id) => transformEntities.get(id),
      (ancestor) => ancestor.locked !== true,
    )).toBe(true);

    expect(resolveStudioBg3dDuplicateHierarchyPatch({
      source: entities[0]!,
      clone: { ...entities[0]!, id: "child-copy", position: [0.4, 1, 0] },
      cloneIdBySourceId: new Map([["model-root", "root-copy"]]),
    })).toEqual({ parentId: "root-copy", position: [0, 1, 0] });
    expect(resolveStudioBg3dDuplicateHierarchyPatch({
      source: entities[1]!,
      clone: { ...entities[1]!, id: "root-copy", position: [2.4, 0, 0] },
      cloneIdBySourceId: new Map([["model-root", "root-copy"]]),
    })).toEqual({ parentId: null, position: [2.4, 0, 0] });
  });

  it("encodes bounded persistent provenance and retries an occupied instance token", () => {
    const first = allocation("classroom", 3, "same-seed", 17);
    const second = allocateStudioBg3dTemplateInstanceNodeIds({
      sourceKind: "catalog",
      sourceId: "classroom",
      insertionOffset: 17,
      nodeCount: 3,
      occupiedNodeIds: new Set(first.nodeIds),
      createSeed: () => "same-seed",
    });

    expect(second).not.toBeNull();
    expect(second?.instanceId).not.toBe(first.instanceId);
    expect(second?.nodeIds).toHaveLength(3);
    expect(second?.nodeIds.every((id) => id.length <= 80)).toBe(true);
    expect(parseStudioBg3dTemplateInstanceNodeId(first.nodeIds[2]!)).toEqual({
      instanceId: first.instanceId,
      sourceKind: "catalog",
      sourceKey: hashStudioBg3dTemplateSourceId("classroom"),
      insertionOffset: 17,
      baselineOffset: [0, 0, 0],
      ordinal: 2,
    });
    expect(parseStudioBg3dTemplateInstanceNodeId("ordinary-node")).toBeNull();
  });

  it("persists a duplicate baseline without changing the source insertion offset", () => {
    const duplicate = allocateStudioBg3dTemplateInstanceNodeIds({
      sourceKind: "catalog",
      sourceId: "classroom",
      insertionOffset: 17,
      baselineOffset: [0.4, 0, 0.4],
      nodeCount: 2,
      occupiedNodeIds: new Set(),
      createSeed: () => "duplicate-baseline",
    });

    expect(duplicate).not.toBeNull();
    expect(duplicate?.nodeIds.every((id) => id.length <= 80)).toBe(true);
    expect(parseStudioBg3dTemplateInstanceNodeId(duplicate!.nodeIds[0]!)).toMatchObject({
      insertionOffset: 17,
      baselineOffset: [0.4, 0, 0.4],
      ordinal: 0,
    });
    expect(collectStudioBg3dTemplateInstances([
      { id: duplicate!.nodeIds[0]!, parentId: null, locked: false },
      { id: duplicate!.nodeIds[1]!, parentId: duplicate!.nodeIds[0]!, locked: false },
    ], [])[0]).toMatchObject({
      insertionOffset: 17,
      baselineOffset: [0.4, 0, 0.4],
    });
  });

  it("collects roots and surviving ordinals without guessing ordinary scene nodes", () => {
    const ids = allocation("cafe", 3, "group").nodeIds;
    const instances = collectStudioBg3dTemplateInstances([
      { id: "ordinary", parentId: null, locked: false },
      { id: ids[0]!, parentId: null, locked: false },
      { id: ids[2]!, parentId: ids[0]!, locked: true },
    ], [
      { id: ids[1]!, parentId: null, locked: false },
    ]);

    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      sourceKind: "catalog",
      sourceKey: hashStudioBg3dTemplateSourceId("cafe"),
      rootNodeIds: [ids[0], ids[1]],
      hasDuplicateOrdinals: false,
    });
    expect(instances[0]?.nodes.map(({ ordinal }) => ordinal)).toEqual([0, 1, 2]);
  });

  it("grounds groups and spaces their world bounds while translating roots only", () => {
    const leftIds = allocation("left", 2, "left").nodeIds;
    const rightIds = allocation("right", 1, "right").nodeIds;
    const instances = collectStudioBg3dTemplateInstances([
      { id: leftIds[0]!, parentId: null, locked: false },
      { id: leftIds[1]!, parentId: leftIds[0]!, locked: false },
      { id: rightIds[0]!, parentId: null, locked: false },
    ], []);
    const plan = planStudioBg3dTemplateInstanceArrangement({
      instances,
      gapMeters: 1,
      boundsByNodeId: new Map([
        [leftIds[0]!, { min: [2, 2, 0], max: [4, 4, 2] }],
        [leftIds[1]!, { min: [3, 1, 0], max: [5, 3, 2] }],
        [rightIds[0]!, { min: [10, -2, 0], max: [12, 2, 2] }],
      ]),
    });

    expect(plan).toEqual({
      ok: true,
      instanceIds: [instances[0]?.id, instances[1]?.id],
      translations: [
        { nodeId: leftIds[0], delta: [0, -1, 0] },
        { nodeId: rightIds[0], delta: [-4, 2, 0] },
      ],
    });
  });

  it("fails arrangement closed for locks, external parenting, and unavailable geometry", () => {
    const ids = allocation("locked", 1, "locked").nodeIds;
    const locked = collectStudioBg3dTemplateInstances([
      { id: ids[0]!, parentId: null, locked: true },
    ], []);
    expect(planStudioBg3dTemplateInstanceArrangement({
      instances: locked,
      boundsByNodeId: new Map([[ids[0]!, { min: [0, 0, 0], max: [1, 1, 1] }]]),
    })).toMatchObject({ ok: false, reason: "locked-node", nodeId: ids[0] });

    const hierarchyIds = allocation("locked-child", 2, "locked-child").nodeIds;
    const lockedChild = collectStudioBg3dTemplateInstances([
      { id: hierarchyIds[0]!, parentId: null, locked: false },
      { id: hierarchyIds[1]!, parentId: hierarchyIds[0]!, locked: true },
    ], []);
    expect(planStudioBg3dTemplateInstanceArrangement({
      instances: lockedChild,
      boundsByNodeId: new Map([
        [hierarchyIds[0]!, { min: [0, 0, 0], max: [1, 1, 1] }],
        [hierarchyIds[1]!, { min: [0, 1, 0], max: [1, 2, 1] }],
      ]),
    })).toMatchObject({ ok: false, reason: "locked-node", nodeId: hierarchyIds[1] });

    const externallyParented = collectStudioBg3dTemplateInstances([
      { id: ids[0]!, parentId: "ordinary-parent", locked: false },
    ], []);
    expect(planStudioBg3dTemplateInstanceArrangement({
      instances: externallyParented,
      boundsByNodeId: new Map([[ids[0]!, { min: [0, 0, 0], max: [1, 1, 1] }]]),
    })).toMatchObject({ ok: false, reason: "external-parent", nodeId: ids[0] });

    const cycleIds = allocation("cycle", 2, "cycle").nodeIds;
    const cyclic = collectStudioBg3dTemplateInstances([
      { id: cycleIds[0]!, parentId: cycleIds[1]!, locked: false },
      { id: cycleIds[1]!, parentId: cycleIds[0]!, locked: false },
    ], []);
    expect(planStudioBg3dTemplateInstanceArrangement({
      instances: cyclic,
      boundsByNodeId: new Map([
        [cycleIds[0]!, { min: [0, 0, 0], max: [1, 1, 1] }],
        [cycleIds[1]!, { min: [1, 0, 0], max: [2, 1, 1] }],
      ]),
    })).toMatchObject({ ok: false, reason: "cyclic-hierarchy" });

    const ready = collectStudioBg3dTemplateInstances([
      { id: ids[0]!, parentId: null, locked: false },
    ], []);
    expect(planStudioBg3dTemplateInstanceArrangement({
      instances: ready,
      boundsByNodeId: new Map(),
    })).toMatchObject({ ok: false, reason: "missing-bounds", nodeId: ids[0] });
  });

  it("resets exact source transforms only when node kinds and hierarchy still match", () => {
    const ids = allocation("hierarchy", 2, "hierarchy").nodeIds;
    const instance = collectStudioBg3dTemplateInstances([
      { id: ids[0]!, parentId: null, locked: false },
    ], [
      { id: ids[1]!, parentId: ids[0]!, locked: false },
    ])[0]!;
    const entities = new Map<string, StudioBg3dTemplateRuntimeEntity>([
      [ids[0]!, { id: ids[0]!, kind: "primitive" as const, parentId: null }],
      [ids[1]!, { id: ids[1]!, kind: "model" as const, parentId: ids[0] }],
    ]);
    const sourceNodes = [
      {
        ordinal: 0,
        kind: "primitive" as const,
        parentOrdinal: null,
        position: [1, 2, 3] as const,
        rotation: [0, 0.5, 0] as const,
        scale: [2, 2, 2] as const,
      },
      {
        ordinal: 1,
        kind: "model" as const,
        parentOrdinal: 0,
        position: [0, 1, 0] as const,
        rotation: [0, 0, 0] as const,
        scale: [1, 1, 1] as const,
      },
    ];

    expect(planStudioBg3dTemplateInstanceReset({
      instance,
      entitiesById: entities,
      sourceNodes,
    })).toEqual({
      ok: true,
      updates: [
        { nodeId: ids[0], position: [1, 2, 3], rotation: [0, 0.5, 0], scale: [2, 2, 2] },
        { nodeId: ids[1], position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      ],
    });

    expect(planStudioBg3dTemplateInstanceReset({
      instance: { ...instance, baselineOffset: [0.4, 0, 0.4] },
      entitiesById: entities,
      sourceNodes,
    })).toEqual({
      ok: true,
      updates: [
        { nodeId: ids[0], position: [1.4, 2, 3.4], rotation: [0, 0.5, 0], scale: [2, 2, 2] },
        { nodeId: ids[1], position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      ],
    });

    entities.set(ids[1]!, { id: ids[1]!, kind: "model", parentId: null });
    expect(planStudioBg3dTemplateInstanceReset({
      instance,
      entitiesById: entities,
      sourceNodes,
    })).toMatchObject({ ok: false, reason: "hierarchy-mismatch", nodeId: ids[1] });

    expect(planStudioBg3dTemplateInstanceReset({
      instance: { ...instance, nodes: instance.nodes.slice(0, 1) },
      entitiesById: entities,
      sourceNodes,
    })).toMatchObject({ ok: false, reason: "source-node-set-mismatch" });
  });

  it("resolves a source only when its compact key is unambiguous", () => {
    const sources = [{ id: "classroom", label: "교실" }, { id: "cafe", label: "카페" }];
    expect(resolveStudioBg3dTemplateSourceByKey(
      hashStudioBg3dTemplateSourceId("cafe"),
      sources,
    )).toEqual(sources[1]);
    expect(resolveStudioBg3dTemplateSourceByKey("0000000000000000", sources)).toBeNull();
  });
});
