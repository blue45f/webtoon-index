import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageSource = readStudioCuttoonEditorSource();

describe("selection filter-mask StudioPage wiring boundary", () => {
  it("captures the selection at dialog open and exposes the explicit scope controls", () => {
    expect(pageSource).toContain("selection?: PixelSelection");
    expect(pageSource).toContain("const selectionAtOpen = pixelSelRef.current");
    expect(pageSource).toContain(
      "selectionAtOpen && isSelectionUsable(selectionAtOpen)",
    );
    expect(pageSource).toContain("selectionAvailable={");
    expect(pageSource).toContain("selectionFeatherPx={");
    expect(pageSource).toContain("selectionInverted={");
  });

  it("hands one combined helper payload to one patchEl commit", () => {
    const start = pageSource.indexOf(
      "const result = await createStudioSelectionFilterMaskTransactionAsync({",
    );
    const end = pageSource.indexOf("announceDrawingShortcut(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const boundary = pageSource.slice(start, end);

    expect(boundary).toContain("filterPatch: patch");
    expect(boundary).toContain("commitStudioSelectionFilterMaskTransaction(");
    expect(boundary).toContain("encodeStudioPixelEditResultPng");
    expect(boundary.match(/patchEl\(/gu)).toHaveLength(1);
    expect(boundary).toContain("transaction.patch as Partial<El>");
  });
});
