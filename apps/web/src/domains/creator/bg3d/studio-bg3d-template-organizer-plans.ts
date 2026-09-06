import type {
  StudioBg3dTemplateInstance,
  StudioBg3dTemplateInstanceNode,
} from "./studio-bg3d-template-instance";

export interface StudioBg3dTemplateWorldBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface StudioBg3dTemplateInstanceTranslation {
  readonly nodeId: string;
  readonly delta: readonly [number, number, number];
}

export type StudioBg3dTemplateArrangeFailureReason =
  | "empty"
  | "invalid-gap"
  | "duplicate-ordinal"
  | "locked-node"
  | "external-parent"
  | "cyclic-hierarchy"
  | "missing-bounds"
  | "invalid-bounds";

export type StudioBg3dTemplateArrangePlan =
  | {
      readonly ok: true;
      readonly instanceIds: readonly string[];
      readonly translations: readonly StudioBg3dTemplateInstanceTranslation[];
    }
  | {
      readonly ok: false;
      readonly reason: StudioBg3dTemplateArrangeFailureReason;
      readonly instanceId?: string;
      readonly nodeId?: string;
    };

export interface StudioBg3dTemplateSourceNodeLayout {
  readonly ordinal: number;
  readonly kind: "primitive" | "model";
  readonly parentOrdinal: number | null;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface StudioBg3dTemplateRuntimeEntity {
  readonly id: string;
  readonly kind: "primitive" | "model";
  readonly parentId?: string | null;
  readonly locked?: boolean;
}

export interface StudioBg3dTemplateResetUpdate {
  readonly nodeId: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

export type StudioBg3dTemplateResetFailureReason =
  | "duplicate-ordinal"
  | "source-node-set-mismatch"
  | "missing-entity"
  | "missing-source-node"
  | "kind-mismatch"
  | "locked-node"
  | "missing-parent"
  | "hierarchy-mismatch";

export type StudioBg3dTemplateResetPlan =
  | { readonly ok: true; readonly updates: readonly StudioBg3dTemplateResetUpdate[] }
  | {
      readonly ok: false;
      readonly reason: StudioBg3dTemplateResetFailureReason;
      readonly nodeId?: string;
    };

function finiteBounds(bounds: StudioBg3dTemplateWorldBounds): boolean {
  return (
    bounds.min.length === 3 &&
    bounds.max.length === 3 &&
    bounds.min.every(Number.isFinite) &&
    bounds.max.every(Number.isFinite) &&
    bounds.min.every((value, index) => value <= bounds.max[index]!)
  );
}

export function planStudioBg3dTemplateInstanceArrangement(input: {
  readonly instances: readonly StudioBg3dTemplateInstance[];
  readonly boundsByNodeId: ReadonlyMap<string, StudioBg3dTemplateWorldBounds>;
  readonly gapMeters?: number;
}): StudioBg3dTemplateArrangePlan {
  if (input.instances.length === 0) return { ok: false, reason: "empty" };
  const gap = input.gapMeters ?? 1;
  if (!Number.isFinite(gap) || gap < 0 || gap > 1_000) {
    return { ok: false, reason: "invalid-gap" };
  }

  const resolved: Array<{
    instance: StudioBg3dTemplateInstance;
    bounds: StudioBg3dTemplateWorldBounds;
  }> = [];
  for (const instance of input.instances) {
    if (instance.hasDuplicateOrdinals) {
      return { ok: false, reason: "duplicate-ordinal", instanceId: instance.id };
    }
    const memberIds = new Set(instance.nodes.map((node) => node.id));
    const nodeById = new Map(instance.nodes.map((node) => [node.id, node]));
    const rootNodeIds = new Set(instance.rootNodeIds);
    for (const node of instance.nodes) {
      // Moving a root moves every descendant in world space, so any lock makes the group atomic.
      if (node.locked) {
        return { ok: false, reason: "locked-node", instanceId: instance.id, nodeId: node.id };
      }
      if (node.parentId !== null && !memberIds.has(node.parentId) && rootNodeIds.has(node.id)) {
        return { ok: false, reason: "external-parent", instanceId: instance.id, nodeId: node.id };
      }
      const visited = new Set<string>();
      let ancestor: StudioBg3dTemplateInstanceNode | undefined = node;
      while (ancestor && ancestor.parentId !== null && memberIds.has(ancestor.parentId)) {
        if (visited.has(ancestor.id)) {
          return {
            ok: false,
            reason: "cyclic-hierarchy",
            instanceId: instance.id,
            nodeId: ancestor.id,
          };
        }
        visited.add(ancestor.id);
        ancestor = nodeById.get(ancestor.parentId);
      }
    }

    let union: StudioBg3dTemplateWorldBounds | null = null;
    for (const node of instance.nodes) {
      const bounds = input.boundsByNodeId.get(node.id);
      if (!bounds) {
        return { ok: false, reason: "missing-bounds", instanceId: instance.id, nodeId: node.id };
      }
      if (!finiteBounds(bounds)) {
        return { ok: false, reason: "invalid-bounds", instanceId: instance.id, nodeId: node.id };
      }
      union = union
        ? {
            min: [
              Math.min(union.min[0], bounds.min[0]),
              Math.min(union.min[1], bounds.min[1]),
              Math.min(union.min[2], bounds.min[2]),
            ],
            max: [
              Math.max(union.max[0], bounds.max[0]),
              Math.max(union.max[1], bounds.max[1]),
              Math.max(union.max[2], bounds.max[2]),
            ],
          }
        : bounds;
    }
    if (!union) return { ok: false, reason: "missing-bounds", instanceId: instance.id };
    resolved.push({ instance, bounds: union });
  }

  resolved.sort((left, right) =>
    left.bounds.min[0] - right.bounds.min[0] ||
    left.instance.firstSceneIndex - right.instance.firstSceneIndex
  );
  let cursorX = Math.min(...resolved.map(({ bounds }) => bounds.min[0]));
  const translations: StudioBg3dTemplateInstanceTranslation[] = [];
  for (const { instance, bounds } of resolved) {
    const deltaX = cursorX - bounds.min[0];
    const deltaY = -bounds.min[1];
    for (const rootNodeId of instance.rootNodeIds) {
      translations.push(Object.freeze({
        nodeId: rootNodeId,
        delta: Object.freeze([deltaX, deltaY, 0] as [number, number, number]),
      }));
    }
    cursorX += bounds.max[0] - bounds.min[0] + gap;
  }
  return Object.freeze({
    ok: true,
    instanceIds: Object.freeze(resolved.map(({ instance }) => instance.id)),
    translations: Object.freeze(translations),
  });
}

export function planStudioBg3dTemplateInstanceReset(input: {
  readonly instance: StudioBg3dTemplateInstance;
  readonly entitiesById: ReadonlyMap<string, StudioBg3dTemplateRuntimeEntity>;
  readonly sourceNodes: readonly StudioBg3dTemplateSourceNodeLayout[];
}): StudioBg3dTemplateResetPlan {
  if (input.instance.hasDuplicateOrdinals) {
    return { ok: false, reason: "duplicate-ordinal" };
  }
  const sourceByOrdinal = new Map(input.sourceNodes.map((node) => [node.ordinal, node]));
  const instanceNodeIdByOrdinal = new Map(
    input.instance.nodes.map((node) => [node.ordinal, node.id]),
  );
  if (
    sourceByOrdinal.size !== input.sourceNodes.length ||
    input.sourceNodes.length !== input.instance.nodes.length ||
    input.sourceNodes.some((node) => !instanceNodeIdByOrdinal.has(node.ordinal))
  ) {
    return { ok: false, reason: "source-node-set-mismatch" };
  }
  const updates: StudioBg3dTemplateResetUpdate[] = [];
  for (const instanceNode of input.instance.nodes) {
    const entity = input.entitiesById.get(instanceNode.id);
    if (!entity) return { ok: false, reason: "missing-entity", nodeId: instanceNode.id };
    const source = sourceByOrdinal.get(instanceNode.ordinal);
    if (!source) return { ok: false, reason: "missing-source-node", nodeId: instanceNode.id };
    if (entity.kind !== source.kind) {
      return { ok: false, reason: "kind-mismatch", nodeId: instanceNode.id };
    }
    if (entity.locked === true) {
      return { ok: false, reason: "locked-node", nodeId: instanceNode.id };
    }
    const expectedParentId = source.parentOrdinal === null
      ? null
      : instanceNodeIdByOrdinal.get(source.parentOrdinal);
    if (source.parentOrdinal !== null && !expectedParentId) {
      return { ok: false, reason: "missing-parent", nodeId: instanceNode.id };
    }
    if ((entity.parentId ?? null) !== expectedParentId) {
      return { ok: false, reason: "hierarchy-mismatch", nodeId: instanceNode.id };
    }
    updates.push(Object.freeze({
      nodeId: instanceNode.id,
      position: Object.freeze((source.parentOrdinal === null
        ? source.position.map((component, axis) =>
            component + input.instance.baselineOffset[axis]!
          )
        : [...source.position]) as [number, number, number]),
      rotation: Object.freeze([...source.rotation] as [number, number, number]),
      scale: Object.freeze([...source.scale] as [number, number, number]),
    }));
  }
  return Object.freeze({ ok: true, updates: Object.freeze(updates) });
}
