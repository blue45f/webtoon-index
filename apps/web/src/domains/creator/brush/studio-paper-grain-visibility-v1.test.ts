import { describe, expect, it } from "vitest";

import {
  resolveStudioPaperGrainVisibleV1,
  studioPageHasAuthoredPaperSurfaceV1,
} from "./studio-paper-grain-visibility-v1";

describe("resolveStudioPaperGrainVisibleV1", () => {
  it("keeps a legacy page that never chose a paper visually untouched", () => {
    // The whole reason the default is not an unconditional `!== false`: a finished page with no
    // paper of its own must not gain a backdrop it never opted into.
    expect(resolveStudioPaperGrainVisibleV1({})).toBe(false);
    expect(resolveStudioPaperGrainVisibleV1(undefined)).toBe(false);
    expect(resolveStudioPaperGrainVisibleV1({ paperSurface: undefined })).toBe(false);
    expect(resolveStudioPaperGrainVisibleV1({ paperSurface: null })).toBe(false);
  });

  it("shows the sheet as soon as the page carries an authored paper — the reported defect", () => {
    expect(
      resolveStudioPaperGrainVisibleV1({
        paperSurface: { kind: "cold-press", seed: 7 },
      }),
    ).toBe(true);
  });

  it("lets an explicit toggle win in both directions", () => {
    expect(
      resolveStudioPaperGrainVisibleV1({
        paperGrainVisible: false,
        paperSurface: { kind: "rough", seed: 1 },
      }),
    ).toBe(false);
    expect(resolveStudioPaperGrainVisibleV1({ paperGrainVisible: true })).toBe(true);
  });

  it("ignores non-boolean flags rather than coercing them", () => {
    expect(
      resolveStudioPaperGrainVisibleV1({
        paperGrainVisible: "true" as unknown,
        paperSurface: null,
      }),
    ).toBe(false);
    expect(
      resolveStudioPaperGrainVisibleV1({
        paperGrainVisible: 0 as unknown,
        paperSurface: { kind: "washi", seed: 3 },
      }),
    ).toBe(true);
  });
});

describe("studioPageHasAuthoredPaperSurfaceV1", () => {
  it("treats only an object sheet as authored", () => {
    expect(studioPageHasAuthoredPaperSurfaceV1({ paperSurface: { kind: "kraft" } })).toBe(true);
    expect(studioPageHasAuthoredPaperSurfaceV1({ paperSurface: "kraft" })).toBe(false);
    expect(studioPageHasAuthoredPaperSurfaceV1({})).toBe(false);
  });
});
