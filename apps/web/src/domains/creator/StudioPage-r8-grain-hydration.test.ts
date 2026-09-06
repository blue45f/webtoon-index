import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const source = readStudioCuttoonEditorSource();

describe("StudioPage R8 grain hydration boundary", () => {
  it("owns, observes, subscribes, projects, and disposes the verified grain lifecycle", () => {
    expect(source).toContain("new StudioBrushR8GrainHydrator()");
    expect(source).toContain("studioBrushR8GrainHydrator.subscribe");
    expect(source).toContain("studioBrushR8GrainHydrator.getVersion");
    expect(source).toContain("studioBrushR8GrainHydrator.observe(");
    expect(source).toContain("authorizedWorkAssetScopeId,");
    expect(source).toContain("collectStudioBrushR8GrainSources({");
    expect(source).toContain("currentPages: pages");
    expect(source).toContain("history: pagesHistory");
    expect(source).toContain("extraElements: master.elements");
    expect(source).toMatch(
      /projectStudioBrushR8GrainRenderElements\(\s*elements,\s*studioBrushR8GrainHydrationRevision/u
    );
    expect(source).toContain(
      "elements={studioBrushR8GrainRenderElements}"
    );
    expect(source).toContain("studioBrushR8GrainHydrator.dispose()");
  });
});
