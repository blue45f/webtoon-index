import {
  reconcileStudioCrdtPages,
  reconcileStudioCrdtSceneGraphPages,
  type StudioCrdtCompatibleElement,
  type StudioCrdtCompatibleOrderedPage,
  type StudioCrdtCompatiblePage,
} from "./studio-crdt-page-bridge";

import type {
  StudioCrdtLayerGroupRecord,
  StudioCrdtPageRecord,
  StudioCrdtSceneElementRecord,
  StudioCrdtStrokeRecord,
} from "./studio-crdt-document";

export interface StudioCrdtHistoryReconcileResult<TPage> {
  history: TPage[][];
  changed: boolean;
}

export interface StudioCrdtSceneGraphFrontier {
  strokes: readonly StudioCrdtStrokeRecord[];
  sceneElements: readonly StudioCrdtSceneElementRecord[];
  pages: readonly StudioCrdtPageRecord[];
  layerGroups: readonly StudioCrdtLayerGroupRecord[];
}

export interface StudioCrdtSceneGraphChangedIds {
  strokeIds: ReadonlySet<string>;
  sceneElementIds: ReadonlySet<string>;
  pageIds: ReadonlySet<string>;
  layerGroupIds: ReadonlySet<string>;
}

/**
 * Keeps collaborative operations out of another artist's undo path.
 *
 * Initial hydration has no local operation ownership yet, so the complete durable frontier is
 * carried into every existing snapshot. Later remote transactions carry only their exact changed
 * stroke IDs through history; untouched local strokes retain their own undo semantics. The current
 * snapshot is then reconciled with the complete frontier so it always renders the converged page.
 */
export function reconcileStudioCrdtHistory<
  TElement extends StudioCrdtCompatibleElement,
  TPage extends StudioCrdtCompatiblePage<TElement>,
>(
  history: TPage[][],
  currentIndex: number,
  records: readonly StudioCrdtStrokeRecord[],
  changedStrokeIds: ReadonlySet<string> | null
): StudioCrdtHistoryReconcileResult<TPage> {
  if (history.length === 0) return { history, changed: false };
  if (changedStrokeIds !== null && changedStrokeIds.size === 0) {
    return { history, changed: false };
  }

  const historicalRecords = changedStrokeIds === null
    ? records
    : records.filter((record) => changedStrokeIds.has(record.id));
  let nextHistory = history;
  let changed = false;

  const replaceSnapshot = (index: number, pages: TPage[]) => {
    if (!changed) nextHistory = [...history];
    nextHistory[index] = pages;
    changed = true;
  };

  for (let index = 0; index < history.length; index += 1) {
    const snapshot = nextHistory[index];
    if (!snapshot) continue;
    const reconciled = reconcileStudioCrdtPages(snapshot, historicalRecords);
    if (reconciled.changed) replaceSnapshot(index, reconciled.pages);
  }

  if (changedStrokeIds !== null) {
    const boundedCurrentIndex = Math.max(0, Math.min(currentIndex, history.length - 1));
    const currentSnapshot = nextHistory[boundedCurrentIndex];
    if (currentSnapshot) {
      const current = reconcileStudioCrdtPages(currentSnapshot, records);
      if (current.changed) replaceSnapshot(boundedCurrentIndex, current.pages);
    }
  }

  return { history: nextHistory, changed };
}

/** Phase-2 counterpart that carries text/bubbles/page topology through remote-safe undo history. */
export function reconcileStudioCrdtSceneGraphHistory<
  TElement extends StudioCrdtCompatibleElement,
  TPage extends StudioCrdtCompatibleOrderedPage<TElement>,
>(
  history: TPage[][],
  currentIndex: number,
  frontier: StudioCrdtSceneGraphFrontier,
  changedIds: StudioCrdtSceneGraphChangedIds | null,
  referenceSources?: ReadonlyMap<string, TElement>
): StudioCrdtHistoryReconcileResult<TPage> {
  if (history.length === 0) return { history, changed: false };
  if (
    changedIds !== null && changedIds.strokeIds.size === 0 &&
    changedIds.sceneElementIds.size === 0 && changedIds.pageIds.size === 0
    && changedIds.layerGroupIds.size === 0
  ) {
    return { history, changed: false };
  }

  let nextHistory = history;
  let changed = false;
  const replaceSnapshot = (index: number, pages: TPage[]) => {
    if (!changed) nextHistory = [...history];
    nextHistory[index] = pages;
    changed = true;
  };

  const boundedCurrentIndex = Math.max(0, Math.min(currentIndex, history.length - 1));

  // Reconcile current active snapshot first so the artist sees the converged state immediately
  const currentSnapshot = history[boundedCurrentIndex];
  if (currentSnapshot) {
    const current = reconcileStudioCrdtSceneGraphPages(
      currentSnapshot,
      frontier.strokes,
      frontier.sceneElements,
      frontier.pages,
      frontier.layerGroups,
      changedIds !== null ? undefined : (changedIds ?? undefined),
      referenceSources
    );
    if (current.changed) replaceSnapshot(boundedCurrentIndex, current.pages);
  }

  // Reconcile remaining history steps for remote-safe undo
  for (let index = 0; index < history.length; index += 1) {
    if (index === boundedCurrentIndex) continue;
    const snapshot = nextHistory[index];
    if (!snapshot) continue;
    const reconciled = reconcileStudioCrdtSceneGraphPages(
      snapshot,
      frontier.strokes,
      frontier.sceneElements,
      frontier.pages,
      frontier.layerGroups,
      changedIds ?? undefined,
      referenceSources
    );
    if (reconciled.changed) replaceSnapshot(index, reconciled.pages);
  }

  return { history: nextHistory, changed };
}
