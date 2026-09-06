import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readStudioSource(fileName: string): string {
  const relativePath = fileName === "StudioDrawOptionsBar.tsx" ? `./brush/${fileName}` : `./${fileName}`;
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function expectNearby(source: string, anchor: string, expected: string, span = 800): void {
  const anchorIndex = source.indexOf(anchor);
  expect(anchorIndex, `missing source anchor: ${anchor}`).toBeGreaterThanOrEqual(0);
  expect(source.slice(anchorIndex, anchorIndex + span)).toContain(expected);
}

describe("Studio rich-hint consumer mappings", () => {
  it("keeps every pixel selection gesture and boolean operation visually distinct", () => {
    const source = readStudioSource("StudioSelectionToolsPanel.tsx");

    for (const [tool, preview] of [
      ["rect", "marquee-rect"],
      ["ellipse", "marquee-ellipse"],
      ["lasso", "lasso"],
      ["\"poly-lasso\"", "polygon-lasso"],
      ["brush", "selection-brush"],
    ]) {
      expect(source).toContain(`${tool}: "${preview}"`);
    }
    for (const [operation, preview] of [
      ["add", "selection-add"],
      ["subtract", "selection-subtract"],
      ["intersect", "selection-intersect"],
    ]) {
      expect(source).toContain(`${operation}: "${preview}"`);
    }
  });

  it("maps the dynamic left-rail lasso coach to the next click", () => {
    const source = readStudioSource("StudioLeftToolRail.tsx");
    expectNearby(source, "const lassoToolHintProps", 'pixelTool === "lasso"', 600);
    expectNearby(source, "const lassoToolHintProps", '{ hintPreview: "polygon-lasso" as const }', 600);
    expectNearby(source, "const lassoToolHintProps", '{ hintPreview: "dismiss" as const }', 600);
    expectNearby(source, "const lassoToolHintProps", '{ hintPreview: "lasso" as const }', 600);
    expectNearby(source, 'label={\n                pixelTool === "lasso"', "{...lassoToolHintProps}", 1_200);
  });

  it("maps selection actions to their actual edit result", () => {
    const source = readStudioSource("StudioSelectOptionsBar.tsx");
    for (const [action, preview] of [
      ["edit-text", "text"],
      ["fit-bubble", "bubble"],
      ["duplicate", "layer-duplicate"],
      ["bring-front", "layer-reorder-front"],
      ["send-back", "layer-reorder-back"],
      ["locked ? \"unlock\" : \"lock\"", "layer-lock"],
      ["delete", "layer-delete"],
    ]) {
      expectNearby(source, `id=${action.startsWith("locked") ? `{${action}}` : `"${action}"`}`, `preview="${preview}"`);
    }
    expectNearby(source, 'id="fit-bubble"', 'previewVariant="fit-text"');
  });

  it("maps each view HUD toggle to the next open or close action", () => {
    const source = readStudioSource("StudioLeftToolRail.tsx");

    expectNearby(source, "const zoomViewToolHintProps", 'hintPreview: "view-hud" as const', 800);
    expectNearby(source, "const zoomViewToolHintProps", 'hintPreviewVariant: "zoom-close" as const', 800);
    expectNearby(source, "const zoomViewToolHintProps", 'hintPreviewVariant: "zoom-open" as const', 800);
    expectNearby(source, "const rotateViewToolHintProps", 'hintPreviewVariant: "rotate-close" as const', 800);
    expectNearby(source, "const rotateViewToolHintProps", 'hintPreviewVariant: "rotate-open" as const', 800);
  });

  it("opens the bubble library from menus while preserving fit-to-text on selection", () => {
    const menubar = readStudioSource("StudioMenubarContent.tsx");
    const toolBelt = readStudioSource("StudioToolBeltContent.tsx");

    expectNearby(menubar, "bubbles: {", 'preview: "bubble"');
    expectNearby(menubar, "bubbles: {", 'previewVariant: "open-library"');
    expectNearby(toolBelt, "bubble: studioToolHintFromLabel(", '"bubble",\n    "open-library"');
  });

  it("uses purpose-built previews for the drawing dock instead of generic ink and rotation", () => {
    const source = readStudioSource("StudioDrawOptionsBar.tsx");
    for (const [anchor, preview] of [
      ["현재 브러시 ·", "brush-library"],
      ["브러시 즐겨찾기 해제", "brush-favorite"],
      ["도형 채우기 끄기", "shape-fill"],
      ["세부 그리기 옵션 접기", "draw-settings"],
      ["캔버스 좌우 반전", "flip-view"],
      ["브러시 스튜디오", "brush-studio"],
      ["스마트 도형 끄기", "smart-shape"],
      ["브러시 슬롯 ${index + 1}", "brush-slot"],
    ]) {
      expectNearby(source, anchor, `"${preview}"`, 1_200);
    }
  });

  it("maps drawing-dock toggle previews to the next action instead of only the current state", () => {
    const source = readStudioSource("StudioDrawOptionsBar.tsx");
    for (const [anchor, variantExpression] of [
      ["브러시 즐겨찾기 해제", 'isFavorite ? "remove" : "add"'],
      ["도형 채우기 끄기", 'shapeFill ? "disable" : "enable"'],
      ["세부 그리기 옵션 접기", 'advancedOpen ? "collapse" : "expand"'],
      ["캔버스 좌우 반전", 'canvasFlipH ? "restore" : "flip"'],
      ["스마트 도형 끄기", 'quickShapeActive ? "disable" : "enable"'],
    ]) {
      expectNearby(source, anchor, variantExpression, 1_200);
    }
  });

  it("maps rail toggles to the action that the next click performs", () => {
    const source = readStudioSource("StudioLeftToolRail.tsx");
    const hintCatalog = readStudioSource("studio-tool-hints.ts");

    expectNearby(source, "댓글 핀 배치 취소", 'commentPinArmed ? "dismiss" : "comment"', 1_000);
    expectNearby(source, "스마트 도형 끄기", 'quickShapeActive ? "disable" : "enable"', 1_000);
    expectNearby(hintCatalog, '"shape-rect":', 'previewVariant: "rect"', 600);
    expectNearby(hintCatalog, '"shape-ellipse":', 'previewVariant: "ellipse"', 600);
  });

  it("distinguishes mobile direct shapes, export settings, file workflows, insertion, and comments", () => {
    const mobile = readStudioSource("StudioMobileEditingDock.tsx");
    const menubar = readStudioSource("StudioMenubarContent.tsx");
    const studioPage = readStudioSource("studio-cuttoon-editor/StudioCuttoonEditorChrome.tsx");
    const toolBelt = readStudioSource("StudioToolBeltCreateModeUtilityButtons.tsx");

    expectNearby(mobile, "const shapeHintPreviewProps", 'hintPreview: "shape" as const');
    expectNearby(mobile, "const shapeHintPreviewProps", "hintPreviewVariant: drawShape");
    expectNearby(mobile, "const shapeHintPreviewProps", 'hintPreview: "draw-settings" as const');
    // The dock's labels now resolve through the locale packs, so anchor on the label binding.
    expectNearby(mobile, "label={label.shape}", "{...shapeHintPreviewProps}");
    expectNearby(mobile, "label={label.brush}", 'hintPreview="draw-settings"');
    expectNearby(mobile, "label={label.brush}", 'hintPreviewVariant={drawSettingsOpen ? "collapse" : "expand"}');
    expectNearby(menubar, "assets: {", 'preview: "assets"');
    expectNearby(menubar, "exportOptions: {", 'preview: "export-options"');
    expectNearby(menubar, "project: {", 'preview: "project"');
    expectNearby(studioPage, 'id: "menubar-comment-inbox"', 'preview: "comment-inbox"');
    expectNearby(toolBelt, 'id: "toolbelt-comment-inbox"', 'preview: "comment-inbox"');
  });

  it("passes each palette identity into its palette-specific preview mapper", () => {
    const popover = readStudioSource("StudioColorPopover.tsx");
    const hints = readStudioSource("studio-color-popover-hints.ts");

    expect(popover).toContain("studioPaletteFamilyHint(p.label, p.tip, p.id)");
    for (const paletteId of [
      "skin-natural",
      "hair-natural",
      "hair-vivid",
      "sky-hours",
      "nature-green",
      "pastel-mood",
      "neon-cyber",
      "vintage-sepia",
      "mono-ink",
      "romance-pink",
      "autumn-fall",
      "dark-fantasy",
    ]) {
      expect(hints).toContain(`"${paletteId}": "palette-${paletteId}"`);
    }
  });

  it("preserves unique smart-filter identities for engine-specific renderer variants", () => {
    const source = readStudioSource("StudioSmartFiltersPanel.tsx");
    expect(source).toContain("id: `smart-filter-${entry.engine}`");
    expect(source).toContain('preview: "filter"');
    expect(source).toContain("모든 계산은 브라우저의 로컬 Worker에서 우선 실행됩니다");
    expect(source).toContain("원본을 보존한 채 스택에 추가");
  });
});
