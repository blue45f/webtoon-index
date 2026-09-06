import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioCuttoonEditorSource();
const brushBaselineControllerSource = readFileSync(
  new URL("./brush/useStudioBrushBaselineController.ts", import.meta.url),
  "utf8",
);
const leftToolRailSource = readFileSync(
  new URL("./StudioLeftToolRail.tsx", import.meta.url),
  "utf8",
);
// The rail no longer declares the transition's signature inline: it binds every host action
// generically through `bindVoidAction("activatePrimaryCanvasTool")`, and the typed signature moved
// to the EditorClient handler contract. That is where the rail's half of this invariant now lives.
const leftToolRailClientSource = readFileSync(
  new URL("./editor-client/studio-left-tool-rail-client.ts", import.meta.url),
  "utf8",
);
const toolBeltSource = readFileSync(
  new URL("./StudioToolBeltContent.tsx", import.meta.url),
  "utf8",
);
const inspectorSource = readStudioInspectorAsideSurface();
const canvasViewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");
const companionToolExecutorSource = readFileSync(
  new URL("./studio-companion-tool-command-executor.ts", import.meta.url),
  "utf8",
);

describe("StudioPage tool transition boundary", () => {
  it("clears every transient Inspector pointer owner through one central disarm", () => {
    const start = studioPageSource.indexOf("function disarmAllPixelTools()");
    const end = studioPageSource.indexOf(
      "disarmAllPixelToolsRef.current = disarmAllPixelTools;",
      start,
    );
    const disarm = studioPageSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(disarm).toContain("cancelPixelSelectionPointerSession();");
    expect(disarm).toContain("pixelWandRunIdRef.current += 1;");
    expect(disarm).toContain("pixelWandActiveRunIdRef.current = null;");
    expect(disarm).toContain("colorRangeActiveRunIdRef.current !== null");
    expect(disarm).toContain("colorRangeRunIdRef.current += 1;");
    expect(disarm).toContain("colorRangeActiveRunIdRef.current = null;");
    expect(disarm).toContain("setPixelBusy(false);");
    for (const cleanup of [
      "setAdvancedFillActive(false);",
      "setAdvancedFillBusy(false);",
      "setAutoColorScribbleCanvasArmed(false);",
      "setPixelTool(null);",
      "clearPolyLassoDraft();",
      "setColorRangePickActive(false);",
      "setQuickMaskActive(false);",
      "setSmudgeActive(false);",
      "setDodgeBurnActive(false);",
      "setWetMixActive(false);",
      "setLiquifyActive(false);",
      "setHealCloneTool(null);",
      "setHistoryBrushActive(false);",
      "setLayerMaskPaintActive(false);",
      "setFilterMaskPaintActive(false);",
      "setCropRect(null);",
      "setPuppetWarpActive(false);",
      "setEyedropperActive(false);",
      "setQuickShapeActive(false);",
      "setNodeEditTool(null);",
      "setBubbleAnchorPickActive(false);",
      "setBubbleShapeEditActive(false);",
      "setPanelSplitActive(false);",
    ]) {
      expect(disarm, cleanup).toContain(cleanup);
    }

    // 도구 해제가 **버리지 말아야 할** 것: 아직 적용하지 않은 채우기 미리보기.
    //
    // 예전에는 이 목록에 `setAdvancedFillPreview(null);` 이 있었다. 그래서 채우기를 계산해 둔
    // 채 스포이드·지우개를 한 번 거치면 "채우기 미리보기 · 적용/취소" 배너가 안내 한 줄 없이
    // 사라졌다(실측: 잉크 229,019 → 15,885 로 되돌아감). 도구를 내리는 것과 사용자가 만든
    // 결과를 폐기하는 것은 다른 결정이다 — 후자는 사용자가 취소를 눌러야 일어난다.
    //
    // 미리보기가 도구와 무관하게 살아 있는 것은 이미 이 저장소의 설계다: 캔버스 렌더는
    // preview 의 targetId/historyIndex 만 보고, 상태 레일 배너도 preview 유무만 본다.
    // `toggleAdvancedFill` 이 스스로 도구를 내릴 때도 재사용 가능한 미리보기는 남긴다.
    expect(disarm).not.toContain("setAdvancedFillPreview(null);");
    expect(disarm).toContain("advancedFillPreviewRef.current !== null");
    expect(disarm).toContain("적용하거나 취소할 수 있어요");
  });

  it("runs Color Range selection as one abortable Worker-owned operation", () => {
    const start = studioPageSource.indexOf(
      "async function runColorRangeApply(",
    );
    const end = studioPageSource.indexOf(
      "// ── 픽셀 선택 한정 조정 적용",
      start,
    );
    const apply = studioPageSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(apply).toContain("colorRangeAbortRef.current?.abort();");
    expect(apply).toContain("const controller = new AbortController();");
    expect(apply).toContain(
      'await import("./studio-color-range-browser")',
    );
    expect(apply).toContain("colorRangeSelectionFromImage(");
    expect(apply).toContain("signal: controller.signal");
    expect(apply).toContain(
      "const currentSelectionSnapshot = pixelSelRef.current;",
    );
    expect(apply).toContain("const selectionSnapshot = selectionOperationBase(");
    expect(apply).toContain("currentSelectionSnapshot,");
    expect(apply).toContain("selection: selectionSnapshot,");
    expect(apply).toContain(
      "pixelSelRef.current !== currentSelectionSnapshot",
    );
    expect(apply).not.toContain("pixelSelRef.current !== selectionSnapshot");
    expect(apply).not.toContain("applyColorRangeMaskToSelection(");
  });

  it("does not run cross-tool disarm side effects from the bubble-anchor state updater", () => {
    const start = studioPageSource.indexOf("function toggleBubbleAnchorPick()");
    const end = studioPageSource.indexOf("function detachBubbleAnchor()", start);
    const handler = studioPageSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(handler).toContain("const next = !bubbleAnchorPickActive;");
    expect(handler).toContain("if (next) disarmAllPixelTools();");
    expect(handler).toContain("setBubbleAnchorPickActive(next);");
    expect(handler).not.toContain("setBubbleAnchorPickActive((");
  });

  it("marks only the synthetic blank-page color target as an intentional whole-canvas fill", () => {
    expect(studioPageSource).toContain(
      "intentionalWholeCanvasFill: vectorTarget?.sourceElementCount === 0,",
    );
  });

  it("arms fill without forcing a collapsed inspector open and changing the fitted canvas scale", () => {
    const start = studioPageSource.indexOf("function toggleAdvancedFill()");
    const end = studioPageSource.indexOf(
      "function updateAdvancedFillSettings(",
      start,
    );
    const fillTransition = studioPageSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(
      fillTransition.match(
        /selectInspectorRoute\(\{ primary: "properties", image: "fill" \}\);/gu,
      ),
    ).toHaveLength(2);
    expect(fillTransition).not.toContain(
      'openInspectorRoute({ primary: "properties", image: "fill" }, null)',
    );
    expect(fillTransition).not.toContain("setZoom(");
  });

  it("makes the eyedropper shortcut disarm any previous canvas owner before activation", () => {
    const start = studioPageSource.indexOf(
      'if (matchStudioShortcut(sc["tool-eyedropper"], e))',
    );
    const end = studioPageSource.indexOf(
      'if (matchStudioShortcut(sc["tool-lasso"], e))',
      start,
    );
    const shortcut = studioPageSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(shortcut).toContain(
      "const nextEyedropperActive = !eyedropperActive;",
    );
    expect(shortcut).toContain(
      "if (nextEyedropperActive) disarmAllPixelTools();",
    );
    expect(shortcut).toContain(
      "setEyedropperActive(nextEyedropperActive);",
    );
    expect(shortcut).not.toContain("setEyedropperActive((");
  });

  it("routes top-menu drawing modes through the stroke-safe primary transition", () => {
    const start = studioPageSource.indexOf("selectDrawMode: (mode) => {");
    // 의도된 변경(2026-08, B-04): 예전 끝 마커("},\n        },")는 실제로는 뒤따르던
    // executePublishPackageExport 의 validation-report JSON 리터럴에 걸려 있었고, 그 코드가
    // export/studio-publish-package-export.ts 로 추출되며 사라졌다. 그리기 메뉴 구간의 실제
    // 다음 항목(activateTransformTool)으로 끝을 고정한다 — 검증 대상 전이 두 건은 동일하다.
    const end = studioPageSource.indexOf("activateTransformTool:", start);
    const drawingMenu = studioPageSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(drawingMenu).toContain(
      'studioMainMenuActions.activatePrimaryCanvasTool("draw", mode);',
    );
    expect(drawingMenu).toContain("setQuickShapeActive(true);");
    expect(
      drawingMenu.match(
        /studioMainMenuActions\.activatePrimaryCanvasTool\("draw", (?:mode|"pen")\);/gu,
      ),
    )
      .toHaveLength(2);
  });

  it("routes tutorial drawing actions through the stroke-safe primary transition", () => {
    const start = studioPageSource.indexOf("function handleTutorialTry(");
    const end = studioPageSource.indexOf(
      "const [quickStartDismissed",
      start,
    );
    const tutorial = studioPageSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    for (const action of ["pen", "smart-shape"]) {
      const caseStart = tutorial.indexOf(`case "${action}":`);
      const caseEnd = tutorial.indexOf("break;", caseStart);
      const branch = tutorial.slice(caseStart, caseEnd);
      expect(caseStart).toBeGreaterThanOrEqual(0);
      expect(branch).toContain('activatePrimaryCanvasTool("draw", "pen");');
    }

    const brushStart = tutorial.indexOf('case "brush":');
    const brushEnd = tutorial.indexOf("break;", brushStart);
    expect(tutorial.slice(brushStart, brushEnd)).toContain(
      "openBrushCatalogFromHelp(trigger);",
    );
    const catalogStart = studioPageSource.indexOf(
      "function openBrushCatalogFromHelp(",
    );
    const catalogEnd = studioPageSource.indexOf(
      "function closeBuiltInBrushCatalog(",
      catalogStart,
    );
    expect(studioPageSource.slice(catalogStart, catalogEnd)).toContain(
      'activatePrimaryCanvasTool("draw", "pen");',
    );
  });

  it("routes saved, catalogue, and slot brush application through the same transition", () => {
    for (const [startMarker, endMarker, drawModeSource] of [
      [
        "function applySavedBrush(",
        "function applyStudioBrushCatalogSelection(",
        "resolveStudioBrushPresetDrawMode(saved.brushId)",
      ],
      [
        "function applyStudioBrushCatalogSelection(",
        "function applyBuiltInBrushPreset(",
        'selection.operation === "erase" ? "eraser" : "pen"',
      ],
      [
        "function applyBrushSlot(",
        "function applyDynamicsPreset(",
        "resolveStudioBrushPresetDrawMode(slot.brushId)",
      ],
    ] as const) {
      const start = studioPageSource.indexOf(startMarker);
      const end = studioPageSource.indexOf(endMarker, start);
      const branch = studioPageSource.slice(start, end);

      expect(start, startMarker).toBeGreaterThanOrEqual(0);
      expect(end, endMarker).toBeGreaterThan(start);
      expect(branch).toContain("activatePrimaryCanvasTool(");
      expect(branch).toContain('"draw",');
      expect(branch).toContain(drawModeSource);
      expect(branch).not.toContain('setTool("draw");');
      expect(branch).not.toContain('setDrawMode("pen");');
    }
    expect(studioPageSource).toContain(
      'selection.operation === "erase" ? "eraser" : "pen",',
    );
  });

  it("preserves independent paint and erase snapshots across explicit mode switches", () => {
    const transitionStart = studioPageSource.indexOf(
      "function activatePrimaryCanvasTool(",
    );
    const transitionEnd = studioPageSource.indexOf(
      "activatePrimaryCanvasToolRef.current = activatePrimaryCanvasTool;",
      transitionStart,
    );
    const transition = studioPageSource.slice(transitionStart, transitionEnd);

    expect(transitionStart).toBeGreaterThanOrEqual(0);
    expect(transitionEnd).toBeGreaterThan(transitionStart);
    expect(transition).toContain("rememberedOperationForDrawMode(drawModeRef.current)");
    expect(transition).toContain("rememberStudioToolOperationSnapshot(");
    expect(transition).toContain("applyToolOperationSnapshot(toolOperationMemoryRef.current[targetOperation]);");
    expect(transition).toContain("selectionWillReplaceToolSnapshot = false");
    expect(transition).not.toContain("resetNamedEraserBrushIdentity");
    expect(studioPageSource).not.toContain("function resetNamedEraserBrushIdentity()");
    expect(studioPageSource).toContain("function prepareStudioSymmetryForBrush(");
    expect(studioPageSource).toContain(
      "prepareStudioSymmetryForBrush(applied.brushId);",
    );
    expect(studioPageSource).toContain(
      "prepareStudioSymmetryForBrush(saved.brushId);",
    );
    expect(studioPageSource).toContain(
      "prepareStudioSymmetryForBrush(slot.brushId);",
    );
    expect(studioPageSource).toContain("function changeStudioSymmetryType(");
    expect(studioPageSource).toContain(
      "떡지우개는 저농도 합성을 위해 대칭을 함께 사용할 수 없어요.",
    );
  });

  it("keeps every literal pen activation on the identity-resetting transition boundary", () => {
    expect(studioPageSource).not.toContain('setDrawMode("pen");');
    expect(inspectorSource).not.toContain('setDrawMode("pen");');
    expect(canvasViewportSource).not.toContain('setDrawMode("pen");');
    expect(inspectorSource).toContain('activateCanvasTool("draw", "pen");');
    expect(canvasViewportSource).toContain('activateCanvasTool("draw", "pen");');

    const inspectorModeTabs = inspectorSource.slice(
      inspectorSource.indexOf("onDrawModeChange={(next) =>"),
      inspectorSource.indexOf("onDrawShapeChange={setDrawShape}"),
    );
    expect(inspectorModeTabs).toContain('activateCanvasTool("draw", next);');
    expect(inspectorModeTabs).not.toContain("setDrawMode,");
  });

  it("delegates brush baseline ownership while preserving fresh one-step undo validation", () => {
    expect(studioPageSource).toContain(
      'import { useStudioBrushBaselineController } from "./brush/useStudioBrushBaselineController";',
    );
    expect(studioPageSource).toContain(
      "const brushBaselineController = useStudioBrushBaselineController({",
    );
    expect(studioPageSource).toContain(
      "void brushBaselineController.restoreDefaults();",
    );
    expect(studioPageSource).not.toContain(
      'import("./brush/studio-brush-baseline-contract")',
    );
    expect(
      brushBaselineControllerSource.match(
        /return import\("\.\/studio-brush-baseline-contract"\);/gu,
      ),
    ).toHaveLength(1);
    expect(brushBaselineControllerSource).not.toContain('from "./StudioPage"');
    expect(brushBaselineControllerSource).not.toContain('import("./StudioPage")');

    const start = brushBaselineControllerSource.indexOf(
      "async function restoreDefaults(): Promise<void>",
    );
    const end = brushBaselineControllerSource.indexOf(
      "\n  return {",
      start,
    );
    const restore = brushBaselineControllerSource.slice(start, end);
    const freshInspection = restore.indexOf(
      "contract.inspectStudioBrushBaseline(",
    );
    const undoBranch = restore.indexOf(
      "if (requestedUndo && previousRestore)",
    );
    const undoApply = restore.indexOf(
      'previousRestore.transaction,\n            "undo",',
    );

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(freshInspection).toBeGreaterThanOrEqual(0);
    expect(undoBranch).toBeGreaterThan(freshInspection);
    expect(undoApply).toBeGreaterThan(undoBranch);
    expect(restore).toContain(
      "브러시 설정이 바뀌어 이전 복원 되돌리기를 취소했어요.",
    );
  });

  it("routes options-bar and context-menu drawing actions through the stroke-safe transition", () => {
    const optionsStart = studioPageSource.indexOf(
      "const studioOptionsBarsHandlers = useStudioStableHandlers",
    );
    const optionsEnd = studioPageSource.indexOf(
      "const studioOptionsBarsDrawModel",
      optionsStart,
    );
    const options = studioPageSource.slice(optionsStart, optionsEnd);
    // 컨텍스트 메뉴는 StudioCuttoonEditorContextMenu.tsx로 추출되었다 — 파일 전체가 슬라이스 대상.
    const contextMenu = readFileSync(
      new URL("./studio-cuttoon-editor/StudioCuttoonEditorContextMenu.tsx", import.meta.url),
      "utf8",
    );
    const contextStart = 0;
    const contextEnd = contextMenu.length;

    expect(optionsStart).toBeGreaterThanOrEqual(0);
    expect(optionsEnd).toBeGreaterThan(optionsStart);
    expect(options).toMatch(
      /setDrawMode: \(mode\) => \{\s+activateDrawToolWithProperties\(mode\);/u,
    );
    const brushSettingsStart = options.indexOf("openBrushStudio: () => {");
    const brushSettingsEnd = options.indexOf("recallBrushSlot:", brushSettingsStart);
    const brushSettings = options.slice(brushSettingsStart, brushSettingsEnd);
    expect(brushSettingsStart).toBeGreaterThanOrEqual(0);
    expect(brushSettingsEnd).toBeGreaterThan(brushSettingsStart);
    expect(brushSettings).toContain("loadStudioBrushStudio();");
    expect(brushSettings).toContain("openInspectorRoute(");
    expect(brushSettings).not.toContain("disarmAllPixelTools();");
    expect(brushSettings).not.toContain('setTool("draw");');
    expect(brushSettings).not.toContain('setDrawMode("pen");');
    expect(options).not.toContain("setEraseToIntersection((prev) =>");

    expect(contextStart).toBeGreaterThanOrEqual(0);
    expect(contextEnd).toBeGreaterThan(contextStart);
    expect(
      contextMenu.match(/activatePrimaryCanvasTool\("draw", "pen"\);/gu),
    ).toHaveLength(2);
    expect(contextMenu).toContain("onSelectPen={() => {");
    expect(contextMenu).toContain("onEnableQuickShape={() => {");
  });

  it("routes mobile and keyboard primary tools through one stroke-safe transition", () => {
    const transitionStart = studioPageSource.indexOf(
      "function activatePrimaryCanvasTool(",
    );
    // Keep the pure stroke-safe transition free of inspector side effects; the
    // CSP properties reveal lives in activateDrawToolWithProperties immediately after.
    const transitionEnd = studioPageSource.indexOf(
      "function activateDrawToolWithProperties(",
      transitionStart,
    );
    const transition = studioPageSource.slice(transitionStart, transitionEnd);
    const shortcutsStart = studioPageSource.indexOf(
      'if (matchStudioShortcut(sc["tool-select"], e))',
    );
    const shortcutsEnd = studioPageSource.indexOf(
      'if (matchStudioShortcut(sc["tool-fill"], e))',
      shortcutsStart,
    );
    const shortcuts = studioPageSource.slice(shortcutsStart, shortcutsEnd);
    const escapeStart = studioPageSource.indexOf(
      '} else if (e.key === "Escape") {',
      studioPageSource.indexOf("shortcutRef.current ="),
    );
    const escapeEnd = studioPageSource.indexOf(
      "} else if (e.key ===",
      escapeStart + 1,
    );
    const escape = studioPageSource.slice(escapeStart, escapeEnd);

    expect(transitionStart).toBeGreaterThanOrEqual(0);
    expect(transitionEnd).toBeGreaterThan(transitionStart);
    expect(transition).toContain("executeStudioPrimaryCanvasToolTransition(");
    expect(transition).toContain("activeStroke: hasActiveDrawingPointerSession(),");
    expect(transition).toContain("cancelActiveStroke: discardDrawingPointerSession,");
    expect(transition).toContain("disarm: disarmAllPixelTools,");
    expect(transition).not.toContain("setZoom(");
    expect(transition).not.toContain("openInspectorRoute(");

    expect(shortcuts).toContain('activatePrimaryCanvasTool("select");');
    // Draw shortcuts surface properties via a dedicated wrapper (keep transition pure).
    expect(shortcuts).toContain('activateDrawToolWithProperties("pen");');
    expect(shortcuts).toContain('activateDrawToolWithProperties("eraser");');
    expect(studioPageSource).toContain("function activateDrawToolWithProperties(");
    expect(studioPageSource).toContain(
      'openInspectorRoute({ primary: "properties" }, isMobile ? "draw" : null)',
    );

    expect(escapeStart).toBeGreaterThanOrEqual(0);
    expect(escape).toContain("if (hasActiveDrawingPointerSession()) {");
    expect(escape).toContain("discardDrawingPointerSession();");
    expect(escape.indexOf("hasActiveDrawingPointerSession()"))
      .toBeLessThan(escape.indexOf("mobileSheet"));
  });
  // ── §15 UX 감사 회귀 고정 (docs/rewrite/ux-audit-v5.md §2.4)
  it("gives every pen/eraser/select entry point the same side effects", () => {
    // 감사 근거: 펜/지우개가 8곳에 복제되어 부수효과가 4갈래로 갈렸다(획 취소·disarm 유무).
    // 완전한 CommandRegistry 통합은 다음 웨이브 몫이고, 여기서는 "부수효과 집합이 하나"만 고정한다.
    // 부수효과 집합이 하나라는 것을 두 갈래로 고정한다: 전이의 서명이 한 곳에만 선언되고,
    // 두 진입점 중 누구도 setTool/setDrawMode 를 직접 부르지 않는다.
    expect(toolBeltSource, "tool belt").toContain(
      'activatePrimaryCanvasTool: (tool: "select" | "draw", drawMode?: DrawMode) => void;',
    );
    expect(leftToolRailClientSource, "rail client contract").toContain(
      "readonly activatePrimaryCanvasTool: (",
    );
    expect(leftToolRailClientSource, "rail client contract").toContain(
      'tool: "select" | "draw",',
    );
    expect(leftToolRailClientSource, "rail client contract").toContain(
      "drawMode?: DrawMode,",
    );
    for (const [label, source] of [
      ["rail", leftToolRailSource],
      ["tool belt", toolBeltSource],
    ] as const) {
      expect(source, label).not.toContain('setTool("draw");');
      expect(source, label).not.toContain('setDrawMode("pen");');
      expect(source, label).not.toContain('setDrawMode("eraser");');
    }

    const railDrawTool = leftToolRailSource.slice(
      leftToolRailSource.indexOf("const activateDrawTool = ("),
      leftToolRailSource.indexOf("/** Object free-transform path"),
    );
    expect(railDrawTool).toContain('activatePrimaryCanvasTool("draw", mode);');
    // disarm 이 스포이드 해제까지 책임지므로 레일이 별도로 setEyedropperActive 를 부르지 않는다.
    expect(railDrawTool).not.toContain("setEyedropperActive(false);");
    expect(railDrawTool).not.toContain("disarmAllPixelTools();");

    // 컴패니언 창도 같은 전이를 주입받는다 — 예전에는 disarm/setTool/setDrawMode 를 따로 받아
    // 진행 중인 획 취소만 이 경로에서 빠졌다.
    expect(companionToolExecutorSource).toContain(
      'actions.activatePrimaryCanvasTool("draw", "pen");',
    );
    expect(companionToolExecutorSource).toContain(
      'actions.activatePrimaryCanvasTool("draw", "eraser");',
    );
    expect(companionToolExecutorSource).not.toContain("actions.setTool(");
    expect(companionToolExecutorSource).not.toContain("actions.setDrawMode(");
    expect(studioPageSource).toContain(
      "activatePrimaryCanvasToolRef.current = activatePrimaryCanvasTool;",
    );
  });

  it("keeps the eyedropper a toggle on every surface, including the quick deck", () => {
    // 감사 근거: 키보드 I·툴레일은 토글인데 Quick Deck/라디얼만 "항상 켜기"였다.
    const start = studioPageSource.indexOf('function executeQuickAction(');
    const end = studioPageSource.indexOf("const mobileHistoryGestureRef", start);
    const quickAction = studioPageSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(quickAction).toContain("setEyedropperActive(!eyedropperActive);");
    expect(quickAction).not.toContain("setEyedropperActive(true);");
    expect(quickAction).not.toContain("setEyedropperActive((");
  });
});
