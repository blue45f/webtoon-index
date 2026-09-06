export interface StudioBg3dHierarchyEntity {
  readonly id: string;
  readonly parentId?: string | null;
}

export interface StudioBg3dVisibleHierarchyEntity extends StudioBg3dHierarchyEntity {
  readonly visible?: boolean;
}

export interface StudioBg3dResolvedHierarchy {
  readonly roots: readonly string[];
  readonly childrenByParent: ReadonlyMap<string, readonly string[]>;
  readonly parentById: ReadonlyMap<string, string | null>;
  readonly repairedOrphans: number;
  readonly repairedSelfParents: number;
  readonly repairedCycles: number;
}

/**
 * Resolves a bounded forest from user/project data. Invalid parents are promoted to roots and one
 * deterministic edge per cycle is removed, so recursive renderers and layer trees can never loop.
 */
export function resolveStudioBg3dHierarchy(
  entities: readonly StudioBg3dHierarchyEntity[],
): StudioBg3dResolvedHierarchy {
  const orderedIds: string[] = [];
  const entityById = new Map<string, StudioBg3dHierarchyEntity>();
  for (const entity of entities) {
    if (!entity.id || entityById.has(entity.id)) continue;
    entityById.set(entity.id, entity);
    orderedIds.push(entity.id);
  }
  const order = new Map(orderedIds.map((id, index) => [id, index] as const));
  const parentById = new Map<string, string | null>();
  let repairedOrphans = 0;
  let repairedSelfParents = 0;
  for (const id of orderedIds) {
    const requested = entityById.get(id)?.parentId ?? null;
    if (!requested) {
      parentById.set(id, null);
    } else if (requested === id) {
      repairedSelfParents += 1;
      parentById.set(id, null);
    } else if (!entityById.has(requested)) {
      repairedOrphans += 1;
      parentById.set(id, null);
    } else {
      parentById.set(id, requested);
    }
  }

  let repairedCycles = 0;
  for (const startId of orderedIds) {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let cursor: string | null = startId;
    while (cursor !== null) {
      const cycleStart = pathIndex.get(cursor);
      if (cycleStart !== undefined) {
        const cycle = path.slice(cycleStart);
        const breakId = cycle.reduce((first, id) =>
          (order.get(id) ?? Number.MAX_SAFE_INTEGER) < (order.get(first) ?? Number.MAX_SAFE_INTEGER)
            ? id
            : first);
        parentById.set(breakId, null);
        repairedCycles += 1;
        break;
      }
      pathIndex.set(cursor, path.length);
      path.push(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  }

  const roots: string[] = [];
  const mutableChildren = new Map<string, string[]>();
  for (const id of orderedIds) {
    const parentId = parentById.get(id) ?? null;
    if (parentId === null) {
      roots.push(id);
      continue;
    }
    const children = mutableChildren.get(parentId) ?? [];
    children.push(id);
    mutableChildren.set(parentId, children);
  }
  const childrenByParent = new Map<string, readonly string[]>();
  for (const [id, children] of mutableChildren) {
    childrenByParent.set(id, Object.freeze([...children]));
  }
  return Object.freeze({
    roots: Object.freeze(roots),
    childrenByParent,
    parentById,
    repairedOrphans,
    repairedSelfParents,
    repairedCycles,
  });
}

export function normalizeStudioBg3dHierarchyParents<T extends StudioBg3dHierarchyEntity>(
  entities: readonly T[],
): readonly T[] {
  const resolved = resolveStudioBg3dHierarchy(entities);
  return entities.map((entity) => {
    const parentId = resolved.parentById.get(entity.id) ?? null;
    return (entity.parentId ?? null) === parentId ? entity : { ...entity, parentId };
  });
}

/** Returns exactly the entities visible through the same repaired hierarchy used for rendering. */
export function collectStudioBg3dEffectivelyVisibleEntityIds(
  entities: readonly StudioBg3dVisibleHierarchyEntity[],
): ReadonlySet<string> {
  const hierarchy = resolveStudioBg3dHierarchy(entities);
  const entityById = new Map(entities.map((entity) => [entity.id, entity] as const));
  const visibleIds = new Set<string>();
  const pending = hierarchy.roots.map((id) => ({ id, ancestorsVisible: true }));
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    const entity = entityById.get(entry.id);
    if (!entity) continue;
    const visible = entry.ancestorsVisible && entity.visible !== false;
    if (visible) visibleIds.add(entry.id);
    const children = hierarchy.childrenByParent.get(entry.id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const childId = children[index];
      if (childId) pending.push({ id: childId, ancestorsVisible: visible });
    }
  }
  return visibleIds;
}

export function canSetStudioBg3dParent(
  entities: readonly StudioBg3dHierarchyEntity[],
  childId: string,
  proposedParentId: string | null,
): boolean {
  if (proposedParentId === null) return entities.some((entity) => entity.id === childId);
  const entityById = new Map(entities.map((entity) => [entity.id, entity] as const));
  if (!entityById.has(childId) || !entityById.has(proposedParentId) || childId === proposedParentId) {
    return false;
  }
  const visited = new Set<string>();
  let cursor: string | null = proposedParentId;
  while (cursor !== null) {
    if (cursor === childId || visited.has(cursor)) return false;
    visited.add(cursor);
    const parentId: string | null | undefined = entityById.get(cursor)?.parentId;
    cursor = parentId && entityById.has(parentId) ? parentId : null;
  }
  return true;
}
