import {
  canRestoreFullVrmHistoryState,
  type FullVrmState,
} from "./studio-vrm-poser-utils";

export const STUDIO_VRM_FULL_STATE_HISTORY_LIMIT = 60;

export type StudioVrmFullStateHistory = Readonly<{
  entries: readonly FullVrmState[];
  index: number;
  generation: number;
}>;

export type StudioVrmFullStateHistoryStep = Readonly<{
  history: StudioVrmFullStateHistory;
  snapshot: FullVrmState | null;
}>;

export function createStudioVrmFullStateHistory(): StudioVrmFullStateHistory {
  return { entries: [], index: -1, generation: 0 };
}

export function resetStudioVrmFullStateHistory(
  history: StudioVrmFullStateHistory,
): StudioVrmFullStateHistory {
  return {
    entries: [],
    index: -1,
    generation: history.generation + 1,
  };
}

function fullStateSnapshotsMatch(left: FullVrmState, right: FullVrmState): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/**
 * Debounced capture가 예약됐던 세대와 현재 세대가 다르면 이전 모델의 늦은 결과이므로 무시한다.
 * 같은 세대라도 모델 소유권이 맞지 않으면 timeline 전체를 폐기한다.
 */
export function appendStudioVrmFullStateHistory(
  history: StudioVrmFullStateHistory,
  snapshot: FullVrmState,
  capturedGeneration: number,
  activeModelId: unknown,
  limit = STUDIO_VRM_FULL_STATE_HISTORY_LIMIT,
): StudioVrmFullStateHistory {
  if (capturedGeneration !== history.generation) return history;
  if (!canRestoreFullVrmHistoryState(snapshot, activeModelId)) {
    return resetStudioVrmFullStateHistory(history);
  }

  const safeLimit = Number.isSafeInteger(limit) && limit > 0
    ? limit
    : STUDIO_VRM_FULL_STATE_HISTORY_LIMIT;
  const entries = history.entries.slice(0, history.index + 1);
  const last = entries.at(-1);
  if (last && fullStateSnapshotsMatch(last, snapshot)) return history;

  entries.push(snapshot);
  if (entries.length > safeLimit) {
    entries.splice(0, entries.length - safeLimit);
  }
  return {
    entries,
    index: entries.length - 1,
    generation: history.generation,
  };
}

/**
 * Commits one user command as an explicit before/after pair.
 *
 * The regular poser history is intentionally debounced for sliders, but discrete commands such as
 * applying a portable pose material must be undoable immediately—even when the initial 450 ms
 * snapshot has not fired yet. Both snapshots use the same generation and model-ownership checks;
 * any invalid owner resets the timeline through the existing fail-closed append path.
 */
export function commitStudioVrmFullStateHistoryTransaction(
  history: StudioVrmFullStateHistory,
  before: FullVrmState,
  after: FullVrmState,
  activeModelId: unknown,
  limit = STUDIO_VRM_FULL_STATE_HISTORY_LIMIT,
): StudioVrmFullStateHistory {
  const generation = history.generation;
  const withBefore = appendStudioVrmFullStateHistory(
    history,
    before,
    generation,
    activeModelId,
    limit,
  );
  if (withBefore.generation !== generation) return withBefore;
  return appendStudioVrmFullStateHistory(
    withBefore,
    after,
    generation,
    activeModelId,
    limit,
  );
}

/**
 * Undo/redo target을 선택하면서 현재 모델의 소유권을 다시 확인한다. 오염된 timeline에서는
 * 스냅샷을 반환하지 않고 전체 history를 초기화한다.
 */
export function stepStudioVrmFullStateHistory(
  history: StudioVrmFullStateHistory,
  direction: -1 | 1,
  activeModelId: unknown,
): StudioVrmFullStateHistoryStep {
  const targetIndex = history.index + direction;
  if (targetIndex < 0 || targetIndex >= history.entries.length) {
    return { history, snapshot: null };
  }

  const snapshot = history.entries[targetIndex];
  if (!snapshot || !canRestoreFullVrmHistoryState(snapshot, activeModelId)) {
    return {
      history: resetStudioVrmFullStateHistory(history),
      snapshot: null,
    };
  }

  return {
    history: { ...history, index: targetIndex },
    snapshot,
  };
}
