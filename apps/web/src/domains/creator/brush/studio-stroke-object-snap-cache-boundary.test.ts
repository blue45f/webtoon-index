import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const page = readStudioCuttoonEditorSource();

describe("studio stroke object-snap cache boundary", () => {
  it("wires the pure per-stroke cache into StudioPage object-snap hot path", () => {
    expect(page).toMatch(/from\s+["'](?:\.\/brush|\.\.\/brush|\.)\/studio-stroke-object-snap-cache["']/u);
    expect(page).toContain("resolveStudioStrokeObjectSnapTargets");
    expect(page).toContain("strokeObjectSnapCacheRef");
    expect(page).toContain("strokeObjectSnapTargetsFor(");
    // Contact end must drop the frozen target list so the next stroke recollects.
    expect(page).toContain("strokeObjectSnapCacheRef.current = null");
  });
});
