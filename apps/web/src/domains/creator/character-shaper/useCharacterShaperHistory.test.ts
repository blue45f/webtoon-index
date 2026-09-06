import { describe, expect, it } from "vitest";

import {
  CHARACTER_SHAPER_HISTORY_LIMIT,
  characterShaperHistoryState,
  createCharacterShaperHistory,
  pushCharacterShaperHistory,
  redoCharacterShaperHistory,
  undoCharacterShaperHistory,
} from "./useCharacterShaperHistory";

import type { CharacterShaperHistoryStack } from "./useCharacterShaperHistory";

type Snapshot = { readonly value: string };

function stackOf(...labels: readonly string[]): CharacterShaperHistoryStack<Snapshot> {
  let stack = createCharacterShaperHistory<Snapshot>();
  for (const label of labels) {
    stack = pushCharacterShaperHistory(stack, { label, snapshot: { value: label } });
  }
  return stack;
}

describe("character shaper history", () => {
  it("starts empty and reports nothing to undo or redo", () => {
    expect(characterShaperHistoryState(createCharacterShaperHistory<Snapshot>())).toEqual({
      canUndo: false,
      canRedo: false,
      recentLabels: [],
      length: 0,
    });
  });

  it("records one step per push and lists the newest labels first", () => {
    const state = characterShaperHistoryState(stackOf("눈: 순정 반짝눈", "헤어: 보브", "상의: 셔츠"));
    expect(state.length).toBe(3);
    expect(state.canUndo).toBe(true);
    expect(state.recentLabels).toEqual(["상의: 셔츠", "헤어: 보브", "눈: 순정 반짝눈"]);
  });

  it("undo restores the snapshot recorded before the step and offers it back to redo", () => {
    const stack = stackOf("눈: 순정 반짝눈", "헤어: 보브");
    const undone = undoCharacterShaperHistory(stack, { value: "현재" });
    expect(undone.restore).toEqual({ value: "헤어: 보브" });
    expect(undone.label).toBe("헤어: 보브");
    expect(characterShaperHistoryState(undone.stack)).toMatchObject({ canUndo: true, canRedo: true, length: 1 });

    const redone = redoCharacterShaperHistory(undone.stack, { value: "되돌린 상태" });
    expect(redone.restore).toEqual({ value: "현재" });
    expect(characterShaperHistoryState(redone.stack)).toMatchObject({ canUndo: true, canRedo: false, length: 2 });
  });

  it("returns null and keeps the stack when there is nothing to travel to", () => {
    const empty = createCharacterShaperHistory<Snapshot>();
    const undone = undoCharacterShaperHistory(empty, { value: "현재" });
    expect(undone.restore).toBeNull();
    expect(undone.stack).toBe(empty);

    const redone = redoCharacterShaperHistory(empty, { value: "현재" });
    expect(redone.restore).toBeNull();
    expect(redone.stack).toBe(empty);
  });

  it("a new step after an undo drops the redo branch", () => {
    const undone = undoCharacterShaperHistory(stackOf("a", "b"), { value: "현재" });
    expect(characterShaperHistoryState(undone.stack).canRedo).toBe(true);
    const pushed = pushCharacterShaperHistory(undone.stack, { label: "c", snapshot: { value: "c" } });
    expect(characterShaperHistoryState(pushed)).toMatchObject({ canRedo: false, canUndo: true, length: 2 });
  });

  it("keeps at most 60 steps and drops the oldest", () => {
    const labels = Array.from({ length: CHARACTER_SHAPER_HISTORY_LIMIT + 5 }, (_, index) => `단계 ${index}`);
    const stack = stackOf(...labels);
    expect(stack.past).toHaveLength(CHARACTER_SHAPER_HISTORY_LIMIT);
    expect(stack.past[0]?.label).toBe("단계 5");
    expect(stack.past[stack.past.length - 1]?.label).toBe(`단계 ${CHARACTER_SHAPER_HISTORY_LIMIT + 4}`);
  });

  it("never mutates the stack it is given", () => {
    const stack = stackOf("a");
    const frozen = { past: [...stack.past], future: [...stack.future] };
    pushCharacterShaperHistory(stack, { label: "b", snapshot: { value: "b" } });
    undoCharacterShaperHistory(stack, { value: "현재" });
    expect(stack.past).toEqual(frozen.past);
    expect(stack.future).toEqual(frozen.future);
  });
});
