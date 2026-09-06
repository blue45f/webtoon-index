import {
  STUDIO_WORKSPACE_MAX_CUSTOM,
  normalizeStudioWorkspaceState,
  saveStudioWorkspaceState,
  type StudioCustomWorkspace,
  type StudioWorkspaceSaveResult,
  type StudioWorkspaceState,
  type StudioWorkspaceStorage,
} from "./studio-workspaces";

export interface StudioWorkspaceThreeWayMergeResult {
  readonly state: StudioWorkspaceState;
  /**
   * Stable dot paths for fields where both branches changed the same base value differently.
   *
   * Custom workspace IDs use a quoted bracket segment so IDs containing dots remain unambiguous,
   * for example `customWorkspaces["custom-1"].name`. Concurrent ordering conflicts use the
   * synthetic `customWorkspaces.order` path.
   */
  readonly conflictPaths: readonly string[];
}

/** @deprecated Synchronous injected-storage rollback/test seam; product uses the SQLite runtime. */
export type StudioWorkspacePendingReconcileResult =
  | Readonly<{
      readonly kind: "retry-latest-raw";
      readonly latestRaw: string | null;
    }>
  | Readonly<{
      readonly kind: "applied";
      readonly result: StudioWorkspaceSaveResult;
      readonly conflictPaths: readonly string[];
    }>;

/** @deprecated Product reconciliation re-reads SQLite via StudioWorkspacePersistenceRuntime. */
export interface ReconcileStudioWorkspacePendingSyncInput {
  readonly storage: StudioWorkspaceStorage;
  readonly storageKey: string;
  readonly expectedRaw: string | null;
  readonly userId: string | null | undefined;
  readonly ownerScope: string;
  readonly base: StudioWorkspaceState;
  readonly local: StudioWorkspaceState;
  readonly external: StudioWorkspaceState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        structurallyEqual(left[key], right[key]),
    )
  );
}

function childPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function customWorkspacePath(id: string): string {
  return `customWorkspaces[${JSON.stringify(id)}]`;
}

/**
 * Standard object-path three-way merge.
 *
 * Arrays are atomic at this layer because their indices usually encode order rather than identity.
 * The one identity-bearing array (`customWorkspaces`) is handled separately below.
 */
function mergeNode(
  base: unknown,
  local: unknown,
  external: unknown,
  path: string,
  conflicts: Set<string>,
): unknown {
  if (structurallyEqual(local, external)) return local;
  if (structurallyEqual(local, base)) return external;
  if (structurallyEqual(external, base)) return local;

  if (isRecord(base) && isRecord(local) && isRecord(external)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(external),
    ]);
    for (const key of [...keys].sort()) {
      merged[key] = mergeNode(
        base[key],
        local[key],
        external[key],
        childPath(path, key),
        conflicts,
      );
    }
    return merged;
  }

  conflicts.add(path || "$");
  return local;
}

function workspaceMap(
  workspaces: readonly StudioCustomWorkspace[],
): ReadonlyMap<string, StudioCustomWorkspace> {
  return new Map(workspaces.map((workspace) => [workspace.id, workspace]));
}

function mergeWorkspaceEntry(
  id: string,
  base: StudioCustomWorkspace | undefined,
  local: StudioCustomWorkspace | undefined,
  external: StudioCustomWorkspace | undefined,
  conflicts: Set<string>,
): StudioCustomWorkspace | null {
  const path = customWorkspacePath(id);

  if (!base) {
    if (!local) return external ?? null;
    if (!external || structurallyEqual(local, external)) return local;
    // The same ID was independently allocated in both branches. Treat the identity collision as
    // one conflict instead of manufacturing a hybrid workspace whose name and snapshot never
    // existed together.
    conflicts.add(path);
    return local;
  }

  if (!local && !external) return null;
  if (!local) {
    if (!external || structurallyEqual(external, base)) return null;
    // Delete-vs-edit is a same-path conflict. The documented local-wins policy keeps the deletion.
    conflicts.add(path);
    return null;
  }
  if (!external) {
    if (structurallyEqual(local, base)) return null;
    conflicts.add(path);
    return local;
  }

  return mergeNode(base, local, external, path, conflicts) as StudioCustomWorkspace;
}

function uniqueProjectedOrder(
  workspaces: readonly StudioCustomWorkspace[],
  finalIds: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const workspace of workspaces) {
    if (finalIds.has(workspace.id) && !seen.has(workspace.id)) {
      seen.add(workspace.id);
      order.push(workspace.id);
    }
  }
  return order;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

/**
 * Inserts IDs missing from the primary order while preserving their nearest successor whenever
 * possible. Using the successor keeps primary-branch additions first when both branches insert at
 * the same gap, while consecutive secondary additions retain their own order.
 */
function insertMissingOrder(
  result: string[],
  source: readonly string[],
  finalIds: ReadonlySet<string>,
): void {
  for (let index = 0; index < source.length; index += 1) {
    const id = source[index];
    if (!id || !finalIds.has(id) || result.includes(id)) continue;

    let nextIndex = -1;
    for (let candidate = index + 1; candidate < source.length; candidate += 1) {
      const nextId = source[candidate];
      if (!nextId) continue;
      const position = result.indexOf(nextId);
      if (position >= 0) {
        nextIndex = position;
        break;
      }
    }
    if (nextIndex >= 0) {
      result.splice(nextIndex, 0, id);
      continue;
    }

    let previousIndex = -1;
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
      const previousId = source[candidate];
      if (!previousId) continue;
      const position = result.indexOf(previousId);
      if (position >= 0) {
        previousIndex = position;
        break;
      }
    }
    if (previousIndex >= 0) result.splice(previousIndex + 1, 0, id);
    else result.push(id);
  }
}

function mergeWorkspaceOrder(
  base: readonly StudioCustomWorkspace[],
  local: readonly StudioCustomWorkspace[],
  external: readonly StudioCustomWorkspace[],
  finalIds: ReadonlySet<string>,
  conflicts: Set<string>,
): readonly string[] {
  const baseOrder = uniqueProjectedOrder(base, finalIds);
  const localOrder = uniqueProjectedOrder(local, finalIds);
  const externalOrder = uniqueProjectedOrder(external, finalIds);
  const commonBranchIds = new Set(
    localOrder.filter((id) => externalOrder.includes(id)),
  );
  const localCommonOrder = localOrder.filter((id) => commonBranchIds.has(id));
  const externalCommonOrder = externalOrder.filter((id) =>
    commonBranchIds.has(id),
  );
  const baseCommonOrder = baseOrder.filter((id) => commonBranchIds.has(id));

  let primary = localOrder;
  let secondary = externalOrder;
  if (!sameOrder(localCommonOrder, externalCommonOrder)) {
    const localKeptBaseOrder = sameOrder(localCommonOrder, baseCommonOrder);
    const externalKeptBaseOrder = sameOrder(externalCommonOrder, baseCommonOrder);
    if (localKeptBaseOrder && !externalKeptBaseOrder) {
      primary = externalOrder;
      secondary = localOrder;
    } else if (!localKeptBaseOrder && externalKeptBaseOrder) {
      primary = localOrder;
      secondary = externalOrder;
    } else {
      conflicts.add("customWorkspaces.order");
    }
  }

  const result = [...primary];
  insertMissingOrder(result, secondary, finalIds);
  insertMissingOrder(result, baseOrder, finalIds);
  for (const id of finalIds) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

function mergeCustomWorkspaces(
  base: readonly StudioCustomWorkspace[],
  local: readonly StudioCustomWorkspace[],
  external: readonly StudioCustomWorkspace[],
  conflicts: Set<string>,
): readonly StudioCustomWorkspace[] {
  const baseById = workspaceMap(base);
  const localById = workspaceMap(local);
  const externalById = workspaceMap(external);
  const allIds = new Set([
    ...baseById.keys(),
    ...localById.keys(),
    ...externalById.keys(),
  ]);
  const mergedById = new Map<string, StudioCustomWorkspace>();

  for (const id of allIds) {
    const merged = mergeWorkspaceEntry(
      id,
      baseById.get(id),
      localById.get(id),
      externalById.get(id),
      conflicts,
    );
    if (merged) mergedById.set(id, merged);
  }

  const finalIds = new Set(mergedById.keys());
  const order = mergeWorkspaceOrder(base, local, external, finalIds, conflicts);
  if (order.length > STUDIO_WORKSPACE_MAX_CUSTOM) {
    conflicts.add("customWorkspaces.capacity");
  }
  return order
    .slice(0, STUDIO_WORKSPACE_MAX_CUSTOM)
    .map((id) => mergedById.get(id))
    .filter((workspace): workspace is StudioCustomWorkspace => workspace !== undefined);
}

/**
 * Merges two independently edited workspace states against their last common base.
 *
 * - A field changed by one branch is accepted.
 * - Disjoint object-field edits are combined recursively.
 * - A field changed differently by both branches resolves to local and records its path.
 * - Custom workspaces merge by ID, including additions/deletions, before their ordering is merged.
 * - The returned state always passes through the repository's strict allowlist normalizer.
 */
export function mergeStudioWorkspaceStates(
  base: StudioWorkspaceState,
  local: StudioWorkspaceState,
  external: StudioWorkspaceState,
): StudioWorkspaceThreeWayMergeResult {
  const normalizedBase = normalizeStudioWorkspaceState(base);
  const normalizedLocal = normalizeStudioWorkspaceState(local);
  const normalizedExternal = normalizeStudioWorkspaceState(external);
  const conflicts = new Set<string>();

  const merged = {
    version: normalizedLocal.version,
    activeWorkspaceId: mergeNode(
      normalizedBase.activeWorkspaceId,
      normalizedLocal.activeWorkspaceId,
      normalizedExternal.activeWorkspaceId,
      "activeWorkspaceId",
      conflicts,
    ),
    liveLayout: mergeNode(
      normalizedBase.liveLayout,
      normalizedLocal.liveLayout,
      normalizedExternal.liveLayout,
      "liveLayout",
      conflicts,
    ),
    customWorkspaces: mergeCustomWorkspaces(
      normalizedBase.customWorkspaces,
      normalizedLocal.customWorkspaces,
      normalizedExternal.customWorkspaces,
      conflicts,
    ),
    mobileControlSide: mergeNode(
      normalizedBase.mobileControlSide,
      normalizedLocal.mobileControlSide,
      normalizedExternal.mobileControlSide,
      "mobileControlSide",
      conflicts,
    ),
    applyQuickActionsOnSwitch: mergeNode(
      normalizedBase.applyQuickActionsOnSwitch,
      normalizedLocal.applyQuickActionsOnSwitch,
      normalizedExternal.applyQuickActionsOnSwitch,
      "applyQuickActionsOnSwitch",
      conflicts,
    ),
  };

  return Object.freeze({
    state: normalizeStudioWorkspaceState(merged),
    conflictPaths: Object.freeze([...conflicts].sort()),
  });
}

/**
 * @deprecated Explicit injected localStorage rollback/test seam. The product runtime performs
 * equivalent guarded reconciliation against SQLite/OPFS and never calls this function.
 *
 * Performs the final synchronous commit boundary for a queued cross-tab workspace update.
 *
 * The caller may await the rare merge chunk before entering this function. We then re-read the raw
 * owner envelope and refuse to write when it no longer matches the storage-event token. Because the
 * raw check, pure merge, and verified localStorage write are synchronous, no promise boundary can
 * commit an external snapshot captured before a later storage event.
 *
 * Storage read failures intentionally escape to the caller so StudioPage can preserve its latest
 * in-memory state through the same failure path used for a dynamic-import error.
 */
export function reconcileStudioWorkspacePendingSync({
  storage,
  storageKey,
  expectedRaw,
  userId,
  ownerScope,
  base,
  local,
  external,
}: ReconcileStudioWorkspacePendingSyncInput): StudioWorkspacePendingReconcileResult {
  const latestRaw = storage.getItem(storageKey);
  if (latestRaw !== expectedRaw) {
    return Object.freeze({
      kind: "retry-latest-raw",
      latestRaw,
    });
  }

  const merged = mergeStudioWorkspaceStates(base, local, external);
  const result = saveStudioWorkspaceState(storage, userId, merged.state, {
    sourceOwnerScope: ownerScope,
  });
  return Object.freeze({
    kind: "applied",
    result,
    conflictPaths: merged.conflictPaths,
  });
}
