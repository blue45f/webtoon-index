import { describe, expect, it } from "vitest";

import { serializeFullVrmState } from "./studio-vrm-poser-utils";
import {
  appendStudioVrmFullStateHistory,
  commitStudioVrmFullStateHistoryTransaction,
  createStudioVrmFullStateHistory,
  resetStudioVrmFullStateHistory,
  stepStudioVrmFullStateHistory,
  type StudioVrmFullStateHistory,
} from "./studio-vrm-state-history";

function state(modelId: string, bodyRotation: number) {
  return serializeFullVrmState({
    modelId,
    bones: {},
    yOffset: 0,
    bodyRotation,
  });
}

describe("studio VRM full-state history ownership", () => {
  it("never appends or restores snapshots from a previous model session", () => {
    let history = createStudioVrmFullStateHistory();
    history = appendStudioVrmFullStateHistory(history, state("model-a", 0), history.generation, "model-a");
    history = appendStudioVrmFullStateHistory(history, state("model-a", 0.5), history.generation, "model-a");

    const staleModelAGeneration = history.generation;
    history = resetStudioVrmFullStateHistory(history);

    history = appendStudioVrmFullStateHistory(
      history,
      state("model-a", 0.75),
      staleModelAGeneration,
      "model-b",
    );
    expect(history.entries).toEqual([]);

    history = appendStudioVrmFullStateHistory(history, state("model-b", 0), history.generation, "model-b");
    history = appendStudioVrmFullStateHistory(history, state("model-b", -0.4), history.generation, "model-b");

    const undo = stepStudioVrmFullStateHistory(history, -1, "model-b");
    expect(undo.snapshot?.modelId).toBe("model-b");
    expect(undo.snapshot?.bodyRotation).toBe(0);

    const redo = stepStudioVrmFullStateHistory(undo.history, 1, "model-b");
    expect(redo.snapshot?.modelId).toBe("model-b");
    expect(redo.snapshot?.bodyRotation).toBeCloseTo(-0.4);
  });

  it("fails closed and resets a timeline whose target snapshot belongs to another model", () => {
    const poisoned: StudioVrmFullStateHistory = {
      entries: [state("model-a", 0), state("model-b", 0.5)],
      index: 1,
      generation: 7,
    };

    const transition = stepStudioVrmFullStateHistory(poisoned, -1, "model-b");
    expect(transition.snapshot).toBeNull();
    expect(transition.history.entries).toEqual([]);
    expect(transition.history.index).toBe(-1);
    expect(transition.history.generation).toBe(8);
  });

  it("truncates redo states, deduplicates snapshots and enforces the bounded limit", () => {
    let history = createStudioVrmFullStateHistory();
    history = appendStudioVrmFullStateHistory(history, state("model", 0), history.generation, "model", 2);
    const duplicate = appendStudioVrmFullStateHistory(history, state("model", 0), history.generation, "model", 2);
    expect(duplicate).toBe(history);

    history = appendStudioVrmFullStateHistory(history, state("model", 0.1), history.generation, "model", 2);
    history = appendStudioVrmFullStateHistory(history, state("model", 0.2), history.generation, "model", 2);
    expect(history.entries.map((entry) => entry.bodyRotation)).toEqual([0.1, 0.2]);

    const undo = stepStudioVrmFullStateHistory(history, -1, "model");
    history = appendStudioVrmFullStateHistory(
      undo.history,
      state("model", -0.3),
      undo.history.generation,
      "model",
      2,
    );
    expect(history.entries.map((entry) => entry.bodyRotation)).toEqual([0.1, -0.3]);
  });

  it("commits a discrete before/after command immediately even before the initial debounce snapshot", () => {
    const before = state("model", 0);
    const after = state("model", 0.7);
    const history = commitStudioVrmFullStateHistoryTransaction(
      createStudioVrmFullStateHistory(),
      before,
      after,
      "model",
    );

    expect(history.entries.map((entry) => entry.bodyRotation)).toEqual([0, 0.7]);
    expect(history.index).toBe(1);

    const undo = stepStudioVrmFullStateHistory(history, -1, "model");
    expect(undo.snapshot?.bodyRotation).toBe(0);
    const redo = stepStudioVrmFullStateHistory(undo.history, 1, "model");
    expect(redo.snapshot?.bodyRotation).toBe(0.7);
  });

  it("deduplicates an already-recorded before state and fails closed across model ownership", () => {
    let history = createStudioVrmFullStateHistory();
    history = appendStudioVrmFullStateHistory(history, state("model", 0), history.generation, "model");
    history = commitStudioVrmFullStateHistoryTransaction(
      history,
      state("model", 0),
      state("model", 0.25),
      "model",
    );
    expect(history.entries.map((entry) => entry.bodyRotation)).toEqual([0, 0.25]);

    const rejected = commitStudioVrmFullStateHistoryTransaction(
      history,
      state("other", 0),
      state("other", 0.5),
      "model",
    );
    expect(rejected.entries).toEqual([]);
    expect(rejected.index).toBe(-1);
    expect(rejected.generation).toBe(history.generation + 1);
  });
});
