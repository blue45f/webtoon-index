import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "../read-studio-inspector-aside-source";

const pageSource = readFileSync(
  new URL("../StudioCuttoonEditorHost.tsx", import.meta.url),
  "utf8",
);
const inspectorSource = readStudioInspectorAsideSurface();

function sourceBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Studio brush default restore adapter boundary", () => {
  it("keeps size and opacity locks inside the canonical page transaction", () => {
    const transactionAdapter = sourceBetween(
      pageSource,
      "function applyBrushDefaultRestoreTransaction(",
      "function toggleBuiltInBrushFavorite(",
    );

    expect(transactionAdapter).toContain(
      "if (!proDrawPrefs.sizeLocked) setStrokeWidth(values.strokeWidth);",
    );
    expect(transactionAdapter).toContain(
      "if (!proDrawPrefs.opacityLocked) setBrushOpacity(values.brushOpacity);",
    );
    expect(transactionAdapter).toContain(
      'direction === "undo" ? transaction.before : transaction.after',
    );
  });

  it("routes the inspector brush studio through the canonical page adapter", () => {
    const pageHandlers = sourceBetween(
      pageSource,
      "const studioInspectorAsideHandlers =",
      "const studioLeftToolRailHandlers =",
    );
    const brushStudio = sourceBetween(
      inspectorSource,
      "<StudioBrushStudio",
      "</Suspense>",
    );

    expect(pageHandlers).toContain("applyBrushDefaultRestoreTransaction,");
    expect(inspectorSource).toContain(
      "applyBrushDefaultRestoreTransaction: (\n"
        + "    transaction: StudioBrushDefaultRestoreTransaction,\n"
        + "    direction: StudioBrushDefaultRestoreDirection,\n"
        + "  ) => void;",
    );
    expect(brushStudio).toContain(
      "onRestoreDefaults={applyBrushDefaultRestoreTransaction}",
    );
    expect(brushStudio).not.toContain("onRestoreDefaults={(");
    expect(brushStudio).not.toContain("setStrokeWidth(values.strokeWidth)");
    expect(brushStudio).not.toContain(
      "setBrushOpacity(values.brushOpacity)",
    );
  });
});
