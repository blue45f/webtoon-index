/**
 * CSP-class layer solo (temporary local view).
 *
 * Soloing a layer hides every other layer **on this client only** so the artist can inspect one
 * plate without writing document `hidden` flags (collaborators keep their own view). Toggling the
 * same layer again, or clearing solo, restores the previous local-hidden set.
 *
 * Pure + immutable: no DOM/Konva. StudioPage owns the React state and render filter.
 */

export interface StudioLayerSoloState {
  /** Active solo target, or null when solo is off. */
  readonly soloId: string | null;
  /** Local-hidden set captured when solo was entered (restored on exit). */
  readonly snapshotLocalHidden: ReadonlySet<string> | null;
}

export const EMPTY_STUDIO_LAYER_SOLO_STATE: StudioLayerSoloState = Object.freeze({
  soloId: null,
  snapshotLocalHidden: null,
});

function freezeSet(ids: Iterable<string>): ReadonlySet<string> {
  return new Set(ids);
}

/**
 * Builds the local-hidden set that shows only `soloId` among `allItemIds`.
 * Unknown solo targets yield an empty hide set (fail closed to "show everything").
 */
export function planStudioLayerSoloLocalHidden(
  allItemIds: readonly string[],
  soloId: string
): ReadonlySet<string> {
  if (!soloId || allItemIds.length === 0) return freezeSet([]);
  if (!allItemIds.includes(soloId)) return freezeSet([]);
  const hidden = new Set<string>();
  for (const id of allItemIds) {
    if (id !== soloId) hidden.add(id);
  }
  return hidden;
}

export interface StudioLayerSoloToggleInput {
  readonly state: StudioLayerSoloState;
  /** Layer currently receiving the solo gesture. */
  readonly targetId: string;
  /** Every navigable layer id on the active page (BACK→FRONT or any order). */
  readonly allItemIds: readonly string[];
  /** Current client-only local-hidden set (before this gesture). */
  readonly currentLocalHidden: ReadonlySet<string>;
}

export interface StudioLayerSoloToggleResult {
  readonly state: StudioLayerSoloState;
  readonly localHiddenIds: ReadonlySet<string>;
}

/**
 * Toggle solo for `targetId`.
 * - Off → On: snapshot current local-hidden, hide all others.
 * - On same target → Off: restore snapshot.
 * - On different target → switch solo target (keep original snapshot until exit).
 */
export function toggleStudioLayerSolo(
  input: StudioLayerSoloToggleInput
): StudioLayerSoloToggleResult {
  const { state, targetId, allItemIds, currentLocalHidden } = input;
  if (!targetId) {
    return {
      state,
      localHiddenIds: currentLocalHidden,
    };
  }

  // Exit solo when clicking the active solo layer again.
  if (state.soloId === targetId) {
    return {
      state: EMPTY_STUDIO_LAYER_SOLO_STATE,
      localHiddenIds: state.snapshotLocalHidden
        ? freezeSet(state.snapshotLocalHidden)
        : freezeSet([]),
    };
  }

  // Enter solo or switch target. Snapshot only when entering from a non-solo state so nested
  // switches do not forget the pre-solo local hides.
  const snapshot = state.soloId === null
    ? freezeSet(currentLocalHidden)
    : (state.snapshotLocalHidden ?? freezeSet([]));
  const nextHidden = planStudioLayerSoloLocalHidden(allItemIds, targetId);
  return {
    state: {
      soloId: targetId,
      snapshotLocalHidden: snapshot,
    },
    localHiddenIds: nextHidden,
  };
}

/** Force-clear solo and restore the pre-solo local-hidden snapshot (if any). */
export function clearStudioLayerSolo(
  state: StudioLayerSoloState
): StudioLayerSoloToggleResult {
  if (state.soloId === null) {
    return {
      state: EMPTY_STUDIO_LAYER_SOLO_STATE,
      localHiddenIds: freezeSet([]),
    };
  }
  return {
    state: EMPTY_STUDIO_LAYER_SOLO_STATE,
    localHiddenIds: state.snapshotLocalHidden
      ? freezeSet(state.snapshotLocalHidden)
      : freezeSet([]),
  };
}
