import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageSource = readStudioCuttoonEditorSource();

describe("Studio canvas ruler layout boundary", () => {
  it("scopes ruler chrome to the canvas shell instead of the inspector row", () => {
    const shellIndex = pageSource.indexOf('data-studio-canvas-ruler-layout=');
    const shellStartIndex = pageSource.lastIndexOf("<div", shellIndex);
    const rulerIndex = pageSource.indexOf("<StudioCanvasRulerBars", shellIndex);
    const viewportIndex = pageSource.indexOf("<StudioCanvasViewport", shellIndex);
    const inspectorResizeIndex = pageSource.indexOf(
      "<StudioPanelResizeHandle",
      shellIndex
    );

    expect(shellIndex).toBeGreaterThan(-1);
    expect(rulerIndex).toBeGreaterThan(shellIndex);
    expect(viewportIndex).toBeGreaterThan(rulerIndex);
    expect(inspectorResizeIndex).toBeGreaterThan(viewportIndex);
    expect(pageSource.slice(shellStartIndex, viewportIndex)).toContain(
      'showRulers && !canvasOnlyMode && "lg:pl-[22px] lg:pt-[22px]"'
    );
  });

  it("returns the full canvas area when rulers are off or canvas-only mode is active", () => {
    expect(pageSource).toContain(
      'showRulers && !canvasOnlyMode ? "inset-top-left" : "off"'
    );
    expect(pageSource).toContain(
      "{showRulers && !canvasOnlyMode ? ("
    );
  });
});
