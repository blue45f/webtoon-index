import { describe, expect, it } from "vitest";

import {
  isCompleteStudioDrawOp,
  isStudioImmediateFreehandCommit,
} from "./studio-draw-completion";

describe("isCompleteStudioDrawOp", () => {
  it("commits a one-point freehand tap as a visible dot", () => {
    expect(isCompleteStudioDrawOp({ kind: "freehand", points: [12, 34] })).toBe(true);
    expect(isCompleteStudioDrawOp({ points: [12, 34] })).toBe(true);
  });

  it("rejects empty or malformed freehand drafts", () => {
    expect(isCompleteStudioDrawOp({ kind: "freehand", points: [] })).toBe(false);
    expect(isCompleteStudioDrawOp({ kind: "freehand", points: [12] })).toBe(false);
  });

  it("keeps minimum drag thresholds for geometric tools", () => {
    expect(isCompleteStudioDrawOp({ kind: "line", points: [0, 0, 2, 0] })).toBe(false);
    expect(isCompleteStudioDrawOp({ kind: "line", points: [0, 0, 3, 0] })).toBe(true);
    expect(isCompleteStudioDrawOp({ kind: "rect", points: [0, 0, 10, 2] })).toBe(false);
    expect(isCompleteStudioDrawOp({ kind: "rect", points: [0, 0, 3, 3] })).toBe(true);
  });

  it("routes taps and short coalesced freehand releases around the 200ms batch window", () => {
    expect(isStudioImmediateFreehandCommit({ kind: "freehand", points: [12, 34] })).toBe(true);
    expect(isStudioImmediateFreehandCommit({ points: [0, 0, 2, 3] })).toBe(true);
    expect(isStudioImmediateFreehandCommit({ kind: "freehand", points: [0, 0, 2, 3, 5, 8] })).toBe(true);
    expect(isStudioImmediateFreehandCommit({ kind: "freehand", points: [0, 0, 12, 0, 25, 0] })).toBe(false);
    expect(isStudioImmediateFreehandCommit({
      kind: "freehand",
      points: Array.from({ length: 16 }, (_, index) => (index % 2 === 0 ? index * 0.4 : 0)),
    })).toBe(false);
    expect(isStudioImmediateFreehandCommit({
      kind: "freehand",
      points: Array.from({ length: 18 }, (_, index) => (index % 2 === 0 ? index * 8 : 0)),
    })).toBe(false);
    expect(isStudioImmediateFreehandCommit({ kind: "freehand", points: [0, 0, Number.NaN, 1, 2, 2] })).toBe(false);
    expect(isStudioImmediateFreehandCommit({ kind: "line", points: [0, 0, 2, 3] })).toBe(false);
    expect(isStudioImmediateFreehandCommit({ kind: "freehand", points: [] })).toBe(false);
  });
});
