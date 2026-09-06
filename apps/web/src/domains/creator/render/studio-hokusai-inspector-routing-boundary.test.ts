import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const inspectorSource = readFileSync(
  new URL("../StudioInspectorDrawingSection.tsx", import.meta.url),
  "utf8",
);
const shapeSectionSource = readFileSync(
  new URL("../StudioInspectorShapeSection.tsx", import.meta.url),
  "utf8",
);
const mountSource = readFileSync(
  new URL("../StudioHokusaiNaturalMediaInspectorMount.tsx", import.meta.url),
  "utf8",
);
const freehandControlsSource = readFileSync(
  new URL("../StudioInspectorFreehandPathControls.tsx", import.meta.url),
  "utf8",
);

describe("Hokusai inspector task routing", () => {
  it("keeps the conversion control visible after a freehand stroke is selected", () => {
    expect(shapeSectionSource).toContain('(selected.kind ?? "freehand") === "freehand"');
    expect(shapeSectionSource).toContain("<StudioInspectorFreehandPathControls");
    expect(shapeSectionSource).toContain("selected={selected}");
    expect(shapeSectionSource).toContain("onReplace={replaceDrawWithHokusaiNaturalMedia}");
    expect(freehandControlsSource).toContain("<StudioHokusaiNaturalMediaInspectorMount");
    expect(freehandControlsSource).toContain("selected={selected}");
    expect(freehandControlsSource).toContain("onReplace={onReplace}");
  });

  it("offers an explicit draw-mode action that changes to selection mode", () => {
    expect(inspectorSource).toContain("onRequestSelectStroke={() => {");
    expect(inspectorSource).toContain('setTool("select")');
    expect(inspectorSource).toContain(
      'announceDrawingShortcut("캔버스에서 변환할 자유곡선 선화를 선택하세요")',
    );
    expect(mountSource).toContain("onRequestSelectStroke={onRequestSelectStroke}");
  });
});
