/**
 * Character Shaper — bounded label + snapshot history.
 *
 * The Shaper does not own a scene document, so its history stores *whole host snapshots* rather
 * than diffs: one entry per commit, holding the label shown in the summary bar and the raw host
 * state as it was **before** that commit. Undo restores that snapshot and moves the pre-undo state
 * onto the redo stack, so a redo is exact even when the runtime's own history reacted to the same
 * change (pose / expression keep their native transactions; inside the dialog the Shaper entry is
 * the one the creator sees).
 *
 * The stack is bounded at 60 entries — the oldest is dropped, never the newest — and every helper
 * here is pure, so `useCharacterShaperHistory` is a thin `useState` wrapper the binding can drive
 * from event handlers.
 */

import { useCallback, useMemo, useState } from "react";

import type { CharacterShaperHistoryState } from "./character-shaper-ui-contract";

/** Maximum number of undo steps kept per dialog session (brief §4). */
export const CHARACTER_SHAPER_HISTORY_LIMIT = 60;

/** How many labels the summary bar tooltip shows. */
export const CHARACTER_SHAPER_HISTORY_LABEL_PREVIEW = 5;

export interface CharacterShaperHistoryEntry<TSnapshot> {
  /** Korean step label, e.g. "눈: 순정 반짝눈". */
  readonly label: string;
  /** Host state as it was before the labelled step ran. */
  readonly snapshot: TSnapshot;
}

export interface CharacterShaperHistoryStack<TSnapshot> {
  /** Oldest first; the last entry is the one `undo` restores. */
  readonly past: readonly CharacterShaperHistoryEntry<TSnapshot>[];
  /** Oldest first; the last entry is the one `redo` restores. */
  readonly future: readonly CharacterShaperHistoryEntry<TSnapshot>[];
}

export function createCharacterShaperHistory<TSnapshot>(): CharacterShaperHistoryStack<TSnapshot> {
  return { past: [], future: [] };
}

/** Appends one step and drops the oldest entries beyond the bound. A push clears the redo stack. */
export function pushCharacterShaperHistory<TSnapshot>(
  stack: CharacterShaperHistoryStack<TSnapshot>,
  entry: CharacterShaperHistoryEntry<TSnapshot>,
): CharacterShaperHistoryStack<TSnapshot> {
  const past = [...stack.past, entry];
  return {
    past: past.length > CHARACTER_SHAPER_HISTORY_LIMIT
      ? past.slice(past.length - CHARACTER_SHAPER_HISTORY_LIMIT)
      : past,
    future: [],
  };
}

export interface CharacterShaperHistoryTravel<TSnapshot> {
  readonly stack: CharacterShaperHistoryStack<TSnapshot>;
  /** The snapshot to restore, or `null` when there was nothing to travel to. */
  readonly restore: TSnapshot | null;
  readonly label: string | null;
}

/**
 * Moves one step back. `current` is the state right now; it becomes the redo entry so a redo
 * restores exactly what undo replaced.
 */
export function undoCharacterShaperHistory<TSnapshot>(
  stack: CharacterShaperHistoryStack<TSnapshot>,
  current: TSnapshot,
): CharacterShaperHistoryTravel<TSnapshot> {
  const entry = stack.past[stack.past.length - 1];
  if (!entry) return { stack, restore: null, label: null };
  return {
    stack: {
      past: stack.past.slice(0, -1),
      future: [...stack.future, { label: entry.label, snapshot: current }],
    },
    restore: entry.snapshot,
    label: entry.label,
  };
}

/** Moves one step forward, mirroring `undoCharacterShaperHistory`. */
export function redoCharacterShaperHistory<TSnapshot>(
  stack: CharacterShaperHistoryStack<TSnapshot>,
  current: TSnapshot,
): CharacterShaperHistoryTravel<TSnapshot> {
  const entry = stack.future[stack.future.length - 1];
  if (!entry) return { stack, restore: null, label: null };
  return {
    stack: {
      past: [...stack.past, { label: entry.label, snapshot: current }],
      future: stack.future.slice(0, -1),
    },
    restore: entry.snapshot,
    label: entry.label,
  };
}

/** The renderer-facing view of the stack (`CharacterShaperBinding.history`). */
export function characterShaperHistoryState<TSnapshot>(
  stack: CharacterShaperHistoryStack<TSnapshot>,
): CharacterShaperHistoryState {
  const recentLabels = stack.past
    .slice(Math.max(0, stack.past.length - CHARACTER_SHAPER_HISTORY_LABEL_PREVIEW))
    .map((entry) => entry.label)
    .reverse();
  return {
    canUndo: stack.past.length > 0,
    canRedo: stack.future.length > 0,
    recentLabels,
    length: stack.past.length,
  };
}

export interface CharacterShaperHistoryController<TSnapshot> {
  readonly state: CharacterShaperHistoryState;
  /** Records one committed step. `before` is the host state prior to the step. */
  push(label: string, before: TSnapshot): void;
  /** Returns the snapshot to restore, or `null` when there is nothing to undo. */
  undo(current: TSnapshot): TSnapshot | null;
  redo(current: TSnapshot): TSnapshot | null;
  /** Drops both stacks (new model, dialog reopened). */
  reset(): void;
}

/**
 * React wrapper over the pure stack. The travel helpers need the *current* host state, which only
 * the caller can read, so `undo`/`redo` take it as an argument and return what to restore.
 */
export function useCharacterShaperHistory<TSnapshot>(): CharacterShaperHistoryController<TSnapshot> {
  const [stack, setStack] = useState<CharacterShaperHistoryStack<TSnapshot>>(createCharacterShaperHistory);

  const push = useCallback((label: string, before: TSnapshot) => {
    setStack((current) => pushCharacterShaperHistory(current, { label, snapshot: before }));
  }, []);

  const undo = useCallback((current: TSnapshot): TSnapshot | null => {
    const travel = undoCharacterShaperHistory(stack, current);
    if (travel.restore === null) return null;
    setStack(travel.stack);
    return travel.restore;
  }, [stack]);

  const redo = useCallback((current: TSnapshot): TSnapshot | null => {
    const travel = redoCharacterShaperHistory(stack, current);
    if (travel.restore === null) return null;
    setStack(travel.stack);
    return travel.restore;
  }, [stack]);

  const reset = useCallback(() => {
    setStack(createCharacterShaperHistory<TSnapshot>());
  }, []);

  const state = useMemo(() => characterShaperHistoryState(stack), [stack]);

  return useMemo(
    () => ({ state, push, undo, redo, reset }),
    [state, push, undo, redo, reset],
  );
}
