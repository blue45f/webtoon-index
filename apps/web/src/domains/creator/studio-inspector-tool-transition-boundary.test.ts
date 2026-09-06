import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const inspectorSource = [
  "./StudioInspectorAsideBody.tsx",
  "./StudioInspectorAsideShell.tsx",
  "./StudioInspectorDrawingSection.tsx",
  "./StudioInspectorImageToolsSection.tsx",
  "./useStudioInspectorAsideModel.ts",
].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8")).join("\n");

describe("StudioInspectorAside transient tool boundary", () => {
  it("routes every Inspector navigation through the pointer ownership transition", () => {
    expect(inspectorSource).toContain(
      'from "./studio-inspector-tool-transition"',
    );
    expect(inspectorSource).toContain(
      "executeStudioInspectorRouteTransition(",
    );
    // The ban targets *interactive* navigation wired straight to the setter, which would skip the
    // pointer-ownership transition. One headless exception is legitimate and must stay legible:
    // StudioInspectorContextRouteSync renders null and only corrects a stale image-tool subtab
    // after the selection context already changed — there is no gesture to hand over. Assert the
    // exception by name so a tab or button wired the same way still fails this test.
    const rawNavigationWiring = [...inspectorSource.matchAll(/onChange=\{changeInspectorLayout\}/gu)]
      .map((match) => {
        const opening = inspectorSource.lastIndexOf("<", match.index);
        return /<([A-Za-z][\w.]*)/u.exec(inspectorSource.slice(opening))?.[1] ?? "unknown";
      });
    expect(rawNavigationWiring).toEqual(["StudioInspectorContextRouteSync"]);
  });

  it("routes draw-mode changes through the Page-owned disarm-before-change contract", () => {
    expect(inspectorSource).toContain(
      'activateCanvasTool("draw", next);',
    );
    expect(inspectorSource).not.toContain("onDrawModeChange={setDrawMode}");
    expect(inspectorSource).not.toContain("executeStudioInspectorDrawModeTransition(");
  });

  it("keeps cross-state side effects out of React functional updaters", () => {
    expect(inspectorSource).not.toContain(
      "setPanelSplitActive((active) =>",
    );
    expect(inspectorSource).not.toContain(
      "setHistoryBrushActive((v) =>",
    );
    expect(inspectorSource).not.toContain(
      "setLayerMaskPaintActive((v) =>",
    );
    expect(inspectorSource).not.toContain(
      "setFilterMaskPaintActive((v) =>",
    );
  });

  it("disarms competing pointer owners before auto-color canvas scribble arms", () => {
    expect(inspectorSource).toContain(
      "executeStudioInspectorArmedChange(next, {",
    );
    expect(inspectorSource).toContain(
      "setActive: setAutoColorScribbleCanvasArmed",
    );
    expect(inspectorSource).not.toContain(
      "onScribbleCanvasArmedChange={setAutoColorScribbleCanvasArmed}",
    );
  });

  it("keeps collapse and mobile dismiss presentation-only so reopening restores the session", () => {
    expect(inspectorSource).toContain(
      "onClick={() => setRightPanelOpen(false)}",
    );
    expect(inspectorSource).toContain(
      "onRequestClose={() => setMobileSheet(null)}",
    );
  });
});
