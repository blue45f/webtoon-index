import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

interface ModuleFacts {
  imports: string[];
  source: string;
}

function moduleFacts(fileName: string): ModuleFacts {
  const fileUrl = new URL(fileName, import.meta.url);
  const rawSource = readFileSync(fileUrl, "utf8");
  const source = fileName.endsWith("StudioPage.tsx") || fileName.endsWith("StudioCuttoonEditorHost.tsx")
    ? readStudioCuttoonEditorSource()
    : rawSource;
  const file = ts.createSourceFile(
    fileUrl.pathname,
    rawSource,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const imports: string[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return { imports, source };
}

function expectTokenOrder(value: string, tokens: readonly string[]): void {
  let cursor = -1;
  for (const token of tokens) {
    const index = value.indexOf(token, cursor + 1);
    expect(index, `missing or out-of-order token: ${token}`).toBeGreaterThan(cursor);
    cursor = index;
  }
}

describe("studio draw pointer-release planning ownership boundary", () => {
  it("keeps the planner pure and free of pointer, renderer, collaboration, and history I/O", () => {
    const planner = moduleFacts("./studio-draw-pointer-release-plan.ts");

    expect(planner.imports).toEqual([
      "../studio-brush",
      "../studio-pixel-pencil",
      "../studio-quickshape-release-promotion",
      "./studio-draw-completion",
      "../studio-element-model",
      "../studio-smart-shape-brush-effect",
    ]);
    expect(planner.source).not.toMatch(/from\s+["'](?:react|konva|react-konva)/u);
    expect(planner.source).not.toMatch(
      /\b(?:window|document|globalThis|PointerEvent|MouseEvent|TouchEvent|CanvasRenderingContext2D)\b/u
    );
    for (const pageOwnedAction of [
      "drawingRef",
      "studioCrdt",
      "appendStrokeSamples(",
      "deleteStroke(",
      "queueDeferredStrokeCommit(",
      "commit(",
      "draftPreviewStoreRef",
      "liveInkOverlayRendererRef",
      "webGpuCanvasHandleRef",
      "pendingStrokeCommitsRef",
      "announceDrawingShortcut(",
      "setError(",
    ]) {
      expect(planner.source).not.toContain(pageOwnedAction);
    }
    expect(planner.source.split("\n").length).toBeLessThanOrEqual(180);
  });

  it("leaves release capture, CRDT sealing, surfaces, commit recovery, and cleanup in StudioPage", () => {
    const page = moduleFacts("../StudioCuttoonEditorHost.tsx").source;
    const start = page.indexOf("function finishDrawingPointer");
    const end = page.indexOf("function onStagePointerCancel", start);
    const finish = page.slice(start, end);
    const sealStart = page.indexOf("function sealStudioDrawReleaseInput");
    const sealEnd = page.indexOf("function finishStudioSpecialistStroke", sealStart);
    const sealInput = page.slice(sealStart, sealEnd);
    const specialistEnd = page.indexOf("function finishDrawingPointer", sealEnd);
    const specialistRelease = page.slice(sealEnd, specialistEnd);

    expect(page).toMatch(/from ["'].*brush\/studio-draw-pointer-release-plan["']/);
    expect(finish).toContain("planStudioDrawPointerRelease({");
    expect(finish).not.toContain("promoteFreehandQuickShapeOnRelease(");
    expect(finish).not.toContain("smoothStrokePoints(");
    expect(finish).not.toContain("isStudioImmediateFreehandCommit(");
    expect(finish).not.toContain("let finished = drawingRef.current");
    expect(finish.split("\n").length).toBeLessThanOrEqual(420);
    expect(sealStart).toBeGreaterThan(-1);
    expectTokenOrder(sealInput, [
      "updateActiveShapeEndpoint(stage, pointerEvent, false)",
      "consumeFreehandPointerBatch(stage, pointerEvent, false",
      'transitionFixedRateStrokeFilter(fixedRateState, { type: "release" })',
      "appendDrawingCrdtSampleSuffix(drawingRef.current, crdtReleaseSampleStart)",
      "sealCausalPostCorrectionState(drawingRef.current)",
      "authoritativeLiveStroke = drawingRef.current",
      "flushDirectLiveDraftNow(authoritativeLiveStroke)",
    ]);
    expect(specialistRelease).toContain("finishStudioLivingInkStroke(livingInkStroke, finished)");
    expect(specialistRelease).toContain("finishStudioHokusaiLiveStroke(hokusaiStroke, finished)");

    expectTokenOrder(finish, [
      "stopFixedRateStrokePump()",
      "authoritativeLiveStroke = sealStudioDrawReleaseInput(",
      "isCompleteStudioDrawOp(drawingRef.current)",
      "const overlayRenderer = liveInkOverlayRendererRef.current",
      "planStudioDrawPointerRelease({",
      "announceDrawingShortcut(`스마트 도형",
      "finishStudioSpecialistStroke(finished)",
      'releasePlan.commitMode === "deferred"',
      "queueDeferredStrokeCommit(finished)",
      "const committed = commit([...baseElements, finished])",
      "restorePendingStrokeCommits({",
      "studioCrdtDocumentRef.current?.deleteStroke(drawingRef.current.id)",
      "finally {",
      "releaseDrawingPointerSession()",
      "clearDraftPreview({ preserveInkForDeferredCommit: deferInkCleanup })",
      "reauthorLastSettledFromDocumentPoints",
      "liveBrushPressureSamplesFor(releaseAuthoritativeStroke)",
      "endLiveResourceEdit()",
    ]);
    // Reauthor must feed alias-mapped live pressures, not raw DrawEl.pressures — otherwise
    // fineliner/marker strokes flash a different dab radius at stroke complete.
    const reauthorCall = finish.slice(
      finish.indexOf("reauthorLastSettledFromDocumentPoints")
    );
    expect(reauthorCall).toContain("liveBrushPressureSamplesFor(releaseAuthoritativeStroke)");
    expect(reauthorCall).not.toContain("pressures: releaseAuthoritativeStroke.pressures");
  });

  it("keeps a short Living Ink stroke hidden until its own receipt without a vector substitute", () => {
    const page = moduleFacts("../StudioCuttoonEditorHost.tsx").source;
    const clearStart = page.indexOf("function clearStudioLivingInkRetainedDraftPixels");
    const failStart = page.indexOf("function failStudioLivingInkStroke", clearStart);
    const discardStart = page.indexOf("function discardStudioLivingInkStroke", failStart);
    const releaseStart = page.indexOf("function releaseStudioLivingInkPresentation", discardStart);
    const releaseEnd = page.indexOf("function armStudioLivingInkCanonicalHandoffTimeout", releaseStart);
    const finishStart = page.indexOf("function finishDrawingPointer");
    const finishEnd = page.indexOf("function onStagePointerCancel", finishStart);

    expect(clearStart).toBeGreaterThan(-1);
    expect(failStart).toBeGreaterThan(clearStart);
    expect(discardStart).toBeGreaterThan(failStart);
    expect(releaseStart).toBeGreaterThan(discardStart);
    expect(releaseEnd).toBeGreaterThan(releaseStart);
    expect(finishEnd).toBeGreaterThan(finishStart);

    const clearShadow = page.slice(clearStart, failStart);
    const discardStroke = page.slice(discardStart, releaseStart);
    const releasePresentation = page.slice(releaseStart, releaseEnd);
    const finishPointer = page.slice(finishStart, finishEnd);

    expectTokenOrder(clearShadow, [
      "liveDraftVisualRef.current?.id === state.strokeId",
      "liveDraftVisualRef.current = null",
      "liveDraftPendingRef.current = null",
      "liveDraftDirectRef.current = false",
    ]);
    expectTokenOrder(discardStroke, [
      "livingInkOverlaySurfaceRef.current?.renderer.clear()",
      "clearStudioLivingInkRetainedDraftPixels(state)",
      "livingInkStrokeRef.current = null",
    ]);
    expectTokenOrder(releasePresentation, [
      'if (!handoff || handoff.kind === "stroke")',
      "const state = livingInkStrokeRef.current",
      "if (state) clearStudioLivingInkRetainedDraftPixels(state)",
      "livingInkStrokeRef.current = null",
    ]);
    expect(finishPointer).toContain(
      "pointer-up never restores a Konva vector shadow",
    );
    expect(finishPointer).not.toContain("showStudioLivingInkVectorShadow(");
    expect(page).not.toContain("function showStudioLivingInkVectorShadow(");
    const liveFlush = page.slice(
      page.indexOf("const flushDirectLiveDraft ="),
      page.indexOf("const flushDirectLiveDraftNow ="),
    );
    expect(liveFlush).toContain("liveDraftVisualRef.current = null;");
    expect(liveFlush).not.toContain("studioLivingInkVectorShadowElement");
  });
});
