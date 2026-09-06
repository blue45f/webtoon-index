
import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageSource = readStudioPageCompositionSource();
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing end marker: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Studio help brush catalog routing boundary", () => {
  it("uses one responsive catalog opener with the real launch button", () => {
    const opener = between(
      pageSource,
      "function openBrushCatalogFromHelp(trigger: HTMLButtonElement)",
      "function closeBuiltInBrushCatalog",
    );

    expect(opener).toContain('activatePrimaryCanvasTool("draw", "pen")');
    expect(opener).toContain('setMobileSheet("draw")');
    expect(opener).toContain('toggleBuiltInBrushCatalog("mobile-sheet", trigger)');
    expect(opener).toContain('toggleBuiltInBrushCatalog("desktop-dock", trigger)');
    expect(opener).not.toContain("document.createElement");
    expect(opener).not.toContain("as HTMLButtonElement");
  });

  it("routes the brush tutorial to the catalog instead of silently applying a preset", () => {
    const brushCase = between(pageSource, 'case "brush":', 'case "template":');

    expect(brushCase).toContain("openBrushCatalogFromHelp(trigger)");
    expect(brushCase).not.toContain("applyBuiltInBrushPreset");
  });

  it("passes quick-start remaps and the actual clicked brush button through the viewport", () => {
    const quickStartBrush = between(
      viewportSource,
      "onBrushKit={(trigger) => {",
      "onCollabFocus={() => {",
    );

    expect(quickStartBrush).toContain("openBrushCatalogFromHelp(trigger)");
    expect(quickStartBrush).not.toContain("applyBuiltInBrushPreset");
    expect(viewportSource).toContain("shortcuts={appSettings.shortcuts}");
    expect(viewportSource).toContain(
      "openBrushCatalogFromHelp: (trigger: HTMLButtonElement) => void;",
    );
  });
});
