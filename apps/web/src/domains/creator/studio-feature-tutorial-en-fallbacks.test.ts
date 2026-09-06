import { describe, expect, it } from "vitest";

import { studioTutorialSourceCopy } from "./studio-feature-tutorial-en-fallbacks";
import { STUDIO_FEATURE_TUTORIAL_BY_ID } from "./studio-feature-tutorials";

describe("studioTutorialSourceCopy", () => {
  it("keeps Korean source copy for Korean locales", () => {
    const tutorial = STUDIO_FEATURE_TUTORIAL_BY_ID.get("fill")!;
    expect(studioTutorialSourceCopy(tutorial, true)).toBe(tutorial);
  });

  it("provides complete English safety copy for every newly added tutorial", () => {
    for (const id of [
      "eraser",
      "fill",
      "smudge",
      "liquify",
      "filters",
      "comment-collaboration",
      "canvas-view",
      "select-move-group",
      "asset-drop",
      "save-recovery",
    ]) {
      const source = STUDIO_FEATURE_TUTORIAL_BY_ID.get(id)!;
      const english = studioTutorialSourceCopy(source, false);
      expect(english.title).not.toMatch(/[가-힣]/u);
      expect(english.summary).not.toMatch(/[가-힣]/u);
      expect(english.steps).toHaveLength(source.steps.length);
      for (const step of english.steps) {
        expect(step.title).not.toMatch(/[가-힣]/u);
        expect(step.body).not.toMatch(/[가-힣]/u);
        expect(step.tip ?? "").not.toMatch(/[가-힣]/u);
      }
    }
  });
});
