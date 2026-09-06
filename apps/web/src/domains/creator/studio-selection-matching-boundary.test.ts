import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const bodySource = readFileSync(
  new URL("./StudioInspectorAsideBody.tsx", import.meta.url),
  "utf8",
);
const panelSource = readFileSync(
  new URL("./StudioSelectionMatchingPanel.tsx", import.meta.url),
  "utf8",
);

describe("Studio matching-selection boundary", () => {
  it("matches only visible page elements", () => {
    expect(bodySource).toContain("!localHiddenElementIds.has(element.id)");
    expect(bodySource).toContain("!isEffectivelyHidden(element, groups)");
    expect(bodySource).toContain(
      "resolveStudioSelectMatchingOptions(visibleMatchingElements, matchingSourceId)",
    );
  });

  it("publishes the result through the canonical layer/canvas selection adapter", () => {
    expect(bodySource).toContain("selectStudioMatchingElementIds(");
    expect(bodySource).toContain("selectLayersFromNavigator(ids)");
    expect(bodySource).toContain("<StudioSelectionMatchingPanel");
  });

  it("keeps matching selection available independently of mutation locks", () => {
    expect(panelSource).toContain("Selection is navigation, not a document mutation");
    expect(panelSource).not.toContain("disabled={");
  });
});
