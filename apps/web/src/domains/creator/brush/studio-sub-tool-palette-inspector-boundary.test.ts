/**
 * CSP-style sub tool palette ▸ inspector integration boundary.
 *
 * The palette is presentational; this pins the two seams that make it real inside the
 * drawing dock (`StudioDrawingPaletteStack`'s subTools slot in StudioInspectorAside):
 *
 * 1. category tab activation routes through the SAME tool transition path the ad-hoc
 *    draw-mode controls use (`activateCanvasTool("draw", …)`), never a parallel one, and
 * 2. sub tool selection applies a core preset through the `applyBuiltInBrushPreset`
 *    handler transaction — and the palette stays hidden while that handler is unwired,
 *    so a host that has not connected StudioPage's function never shows a dead control.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "../read-studio-inspector-aside-source";

const inspectorSource = readStudioInspectorAsideSurface();
const dataSource = readFileSync(
  new URL("./studio-sub-tool-palette-data.ts", import.meta.url),
  "utf8",
);
const paletteSource = readFileSync(
  new URL("./StudioSubToolPalette.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(
  source: string,
  startToken: string,
  endToken: string,
  label: string,
): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  if (start < 0 || end <= start) {
    throw new Error(`Missing ${label} source boundary: ${startToken} -> ${endToken}`);
  }
  return source.slice(start, end);
}

describe("Studio sub tool palette inspector boundary", () => {
  const subToolsSlot = sourceBetween(
    inspectorSource,
    "subTools={",
    "toolProperties={",
    "drawing palette subTools slot",
  );

  it("mounts the palette inside the drawing dock's subTools slot", () => {
    expect(subToolsSlot).toContain("<StudioSubToolPalette");
    // The ad-hoc draw mode controls keep their behavior alongside the palette.
    expect(subToolsSlot).toContain("<StudioInspectorDrawModeControls");
  });

  it("routes category tab activation through the existing tool transition path", () => {
    const paletteMount = sourceBetween(
      subToolsSlot,
      "<StudioSubToolPalette",
      "/>",
      "sub tool palette mount",
    );
    expect(paletteMount).toContain('activateCanvasTool("draw", nextDrawMode)');
    expect(paletteMount).toContain("studioSubToolPaletteCategoryById(category)?.drawMode");
  });

  it("applies sub tool selection via the applyBuiltInBrushPreset handler transaction", () => {
    const paletteMount = sourceBetween(
      subToolsSlot,
      "<StudioSubToolPalette",
      "/>",
      "sub tool palette mount",
    );
    expect(paletteMount).toContain("studioSubToolPalettePresetById(subToolId)");
    expect(paletteMount).toContain("applyBuiltInBrushPreset(preset)");
  });

  it("declares the handler on the aside contract and gates rendering on it", () => {
    const handlersContract = sourceBetween(
      inspectorSource,
      "export interface StudioInspectorAsideHandlers",
      "interface StudioInspectorAsideProps",
      "aside handlers contract",
    );
    expect(handlersContract).toContain(
      "applyBuiltInBrushPreset?: (preset: BrushPreset) => void;",
    );
    // Unwired host ⇒ no dead palette rows.
    expect(subToolsSlot).toContain("applyBuiltInBrushPreset && (drawMode ===");
  });

  it("keeps the palette data on the launch-safe core catalogue (no lazy catalogue import)", () => {
    expect(dataSource).not.toContain("studio-brush-catalog");
    expect(paletteSource).not.toContain("studio-brush-catalog");
    expect(dataSource).toContain('from "../studio-brush"');
  });
});
