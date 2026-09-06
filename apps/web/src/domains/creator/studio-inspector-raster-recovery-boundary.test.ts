import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "./read-studio-inspector-aside-source";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";


const asideSource = readStudioInspectorAsideSurface();
const pageSource = readStudioCuttoonEditorSource();
const railSource = readFileSync(
  new URL("./StudioLeftToolRail.tsx", import.meta.url),
  "utf8",
);

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const nextFunction = source.indexOf("\n  function ", start + 1);
  return source.slice(start, nextFunction < 0 ? undefined : nextFunction);
}

describe("Studio inspector raster recovery boundary", () => {
  it("keeps professional pixel routes discoverable without pretending a raster target exists", () => {
    expect(asideSource).toContain(
      "selectedSupportsImageInspectorTabs || unselectedImageToolsVisible",
    );
    expect(asideSource).toContain('aria-label="전문 픽셀 도구"');
    expect(asideSource).toContain("resolveStudioRasterToolAvailability");
    expect(asideSource).toContain("<StudioInspectorFilterLauncher");
    expect(asideSource).toContain("<StudioRasterToolRecoveryPanel");
    expect(asideSource).toContain("canToggleSelectedReference={false}");
    expect(asideSource).not.toContain("advancedFillInspectorRouteWithoutImageSelection");
  });

  it("preserves explicit image-tool deep links when no raster layer is selected", () => {
    expect(asideSource).toContain(
      'route.primary === "properties" && route.image !== undefined',
    );
    expect(asideSource).toContain('if (inspectorDrawing) activateCanvasTool("select")');
    expect(asideSource).toContain("!selectedSupportsImageInspectorTabs");
    expect(asideSource).toContain("setUnselectedImageToolsVisible(true)");
    expect(asideSource).toContain(
      'if (inspectorDrawing) setUnselectedImageToolsVisible(false)',
    );
    expect(asideSource).not.toContain(
      'if (inspectorContentMode !== "empty") setUnselectedImageToolsVisible(false)',
    );
  });

  it("wires one real non-destructive raster-copy action through the lazy inspector seam", () => {
    const implementation = functionBody(pageSource, "createEditableRasterCopyForInspector");

    expect(implementation).toContain('"pixel-selection"');
    expect(implementation).toContain("prepareAndRenderStudioEditableRasterCopy");
    expect(implementation).toContain("prepareStudioVectorReferenceExport");
    expect(implementation).toContain("renderPreparedStudioVectorReference");
    expect(implementation).toContain('rasterExecutionBackend: "offscreen-worker"');
    expect(implementation).not.toContain("planStudioEditableRasterCopy");
    expect(implementation).not.toContain("renderStudioEditableRasterCopy");
    expect(implementation).not.toContain("isStudioEditableRasterCopyPlanCurrent");
    expect(implementation).toContain("applyStudioEditableRasterCopy");
    expect(implementation).toContain("flushSync(() => {");
    expect(implementation).toContain("commit(applied.elements");
    expect(implementation).toContain("setSelectedId(composite.id)");
    expect(implementation).toContain("resolveStudioRasterToolResumePlan");
    expect(implementation).toContain("attachPendingRasterRetouchTarget");
    expect(implementation).toContain('case "arm-retouch"');
    expect(implementation).toContain('case "start-crop"');
    expect(implementation).toContain('case "activate-selection"');
    expect(pageSource).toContain("createEditableRasterCopyForInspector,");
    expect(pageSource).toContain("studioFilterPreparationBusy={studioFilterPreparationBusy}");
    expect(pageSource).toContain("timelinePlaying={timelinePlaying}");
  });

  it("coalesces raster commit, selection authority and retouch arm before replay", () => {
    const implementation = functionBody(pageSource, "createEditableRasterCopyForInspector");
    const flushStart = implementation.indexOf("flushSync(() => {");
    const commitIndex = implementation.indexOf(
      "rasterCopyCommitted = commit(applied.elements, undefined, pageId);",
      flushStart,
    );
    const successGuard = implementation.indexOf(
      "if (!rasterCopyCommitted) return;",
      commitIndex,
    );
    const flushEnd = implementation.indexOf("\n      });", successGuard);
    const attachIndex = implementation.indexOf("attachPendingRasterRetouchTarget", flushEnd);

    expect(flushStart).toBeGreaterThanOrEqual(0);
    expect(commitIndex).toBeGreaterThan(flushStart);
    expect(successGuard).toBeGreaterThan(commitIndex);
    expect(flushEnd).toBeGreaterThan(successGuard);
    for (const successOnlyMutation of [
      "pixelSelectionAutoTargetRef.current = composite.id",
      "cropAutoTargetRef.current = composite.id",
      "resetPixelSelectionHistoryState(composite.id, null)",
      "expectStudioRasterImagePresentation({ elementId: composite.id, src: composite.src })",
      "setMarqueeIds((current) => current.length === 0 ? current : [])",
      "setSelectedId(composite.id)",
      "setPixelForceCircle(false)",
      "setPixelTool(null)",
      "setSmudgeActive(true)",
      "setDodgeBurnActive(true)",
      "setWetMixActive(true)",
      "setLiquifyActive(true)",
    ]) {
      const mutationIndex = implementation.indexOf(successOnlyMutation, successGuard);
      expect(mutationIndex, successOnlyMutation).toBeGreaterThan(successGuard);
      expect(mutationIndex, successOnlyMutation).toBeLessThan(flushEnd);
    }

    expect(attachIndex).toBeGreaterThan(flushEnd);
    expect(implementation.indexOf("setCropRect(initialCropRect())", flushEnd))
      .toBeGreaterThan(flushEnd);
    expect(implementation.indexOf("applyPixelSelectionActivation", flushEnd))
      .toBeGreaterThan(flushEnd);
  });

  it.each([
    "applySmudgeStroke",
    "applyDodgeBurnStroke",
    "applyWetMixStroke",
    "applyLiquifyStroke",
    "bakeHealCloneDragStroke",
  ])("expects an exact presentation only after %s commits its new src", (functionName) => {
    const implementation = functionBody(pageSource, functionName);
    const patchIndex = implementation.indexOf("patchEl(target.id, { src }");
    const expectationIndex = implementation.indexOf(
      "expectStudioRasterImagePresentation({ elementId: target.id, src })",
    );

    expect(patchIndex).toBeGreaterThanOrEqual(0);
    expect(expectationIndex).toBeGreaterThan(patchIndex);
    expect(implementation.slice(patchIndex, expectationIndex)).toContain(")) {");
  });

  it("journals and replays the first retouch gesture drawn during vector raster preparation", () => {
    const stageDown = functionBody(pageSource, "onStageDown");
    const stageMove = functionBody(pageSource, "onStageMove");
    const pendingEnd = functionBody(pageSource, "finishPendingRasterRetouchGesture");
    const nodeInteractionBegin = functionBody(pageSource, "nodeInteractionBegin");

    expect(stageDown).toContain("studioRasterRetouchPreparationRef.current");
    expect(stageDown).toContain("journalPendingRasterRetouchGesture");
    expect(stageMove).toContain("appendStudioPendingRasterRetouchGesturePoint");
    expect(pendingEnd).toContain("endStudioPendingRasterRetouchGesture");
    expect(pendingEnd).toContain("queuePendingRasterRetouchGesture");
    expect(pageSource).toContain("normalizeStudioPendingRasterRetouchGesture");
    expect(pageSource).toContain("applyQueuedRasterRetouchReplayRef.current");
    const replayStart = pageSource.indexOf(
      "applyQueuedRasterRetouchReplayRef.current = ({",
    );
    const replayEnd = pageSource.indexOf(
      "\n  // ── 레이어 마스크 브러시 스트로크 굽기",
      replayStart,
    );
    const replay = pageSource.slice(replayStart, replayEnd);
    expect(replay).toContain(
      "const bakePoints = thinStudioRasterRetouchPointsForApply(points)",
    );
    expect(replay).toContain('applySmudgeStroke(targetId, bakePoints)');
    expect(replay).toContain('applyDodgeBurnStroke(targetId, bakePoints)');
    expect(replay).toContain('applyWetMixStroke(targetId, bakePoints)');
    expect(replay).toContain(
      "applyLiquifyStroke(targetId, points, replayLiquifyMode)",
    );
    expect(nodeInteractionBegin).toContain("studioRasterRetouchPreparationRef.current");
    expect(nodeInteractionBegin.indexOf("studioRasterRetouchPreparationRef.current"))
      .toBeLessThan(nodeInteractionBegin.indexOf("canvasInteractionUnitIds(elementId)"));
  });

  it("cancels raster preparation before tool disarm or Escape can expose stale replay authority", () => {
    const cancellation = functionBody(pageSource, "cancelStudioRasterPreparation");
    const disarm = functionBody(pageSource, "disarmAllPixelTools");
    const preparation = functionBody(pageSource, "createEditableRasterCopyForInspector");
    const escapeStart = pageSource.indexOf('} else if (e.key === "Escape") {');
    const escapeEnd = pageSource.indexOf('\n      } else if (', escapeStart + 1);
    const escapeBranch = pageSource.slice(escapeStart, escapeEnd);

    expect(cancellation).toContain("studioFilterPreparationRunIdRef.current += 1");
    expect(cancellation).toContain("studioFilterPreparationAbortRef.current?.abort()");
    expect(cancellation).toContain("pendingRasterRetouchCaptureTargetRef.current !== null");
    expect(cancellation).toContain("studioRasterRetouchPreparationRef.current = null");
    expect(cancellation).toContain("queuedRasterRetouchReplayRef.current = null");
    expect(cancellation).toContain("clearPendingRasterRetouchGesture()");
    expect(cancellation).toContain("setStudioFilterPreparationBusy(false)");
    expect(disarm.indexOf("cancelStudioRasterPreparation()"))
      .toBeLessThan(disarm.indexOf("cancelLiquifyPointerSession()"));
    expect(escapeBranch).toContain("if (cancelStudioRasterPreparation())");
    expect(escapeBranch.indexOf("cancelStudioRasterPreparation()"))
      .toBeLessThan(escapeBranch.indexOf("groupResizeRef.current"));
    expect(escapeBranch).toContain("편집용 래스터 준비를 취소했습니다");

    const flushStart = preparation.indexOf("flushSync(() => {");
    const finalPreCommitAuthorityGuard = preparation.slice(0, flushStart).lastIndexOf(
      "runId !== studioFilterPreparationRunIdRef.current",
    );
    expect(finalPreCommitAuthorityGuard).toBeGreaterThanOrEqual(0);
    expect(flushStart).toBeGreaterThan(finalPreCommitAuthorityGuard);
    expect(preparation.indexOf("attachPendingRasterRetouchTarget"))
      .toBeGreaterThan(flushStart);
  });

  it.each([
    ["toggleSmudgeTool", "smudgeActive", "smudge"],
    ["toggleLiquifyTool", "liquifyActive", "liquify"],
    ["toggleDodgeBurnTool", "dodgeBurnActive", "dodge-burn"],
    ["toggleWetMixTool", "wetMixActive", "wet-mix"],
  ])(
    "lets %s exit before target validation when selection or lock state changed",
    (name, activeState, toolId) => {
      const body = functionBody(pageSource, name);
      const activeCheck = body.indexOf(`if (${activeState})`);
      const targetCheck = body.indexOf(
        `ensureOrPrepareRasterRetouchTarget("${toolId}"`,
      );

      expect(activeCheck).toBeGreaterThanOrEqual(0);
      expect(targetCheck).toBeGreaterThan(activeCheck);
    },
  );

  it.each([
    ["openSelectedLayerCrop", "crop"],
    ["toggleSmudgeTool", "smudge"],
    ["toggleLiquifyTool", "liquify"],
    ["toggleDodgeBurnTool", "dodge-burn"],
    ["toggleWetMixTool", "wet-mix"],
  ])(
    "lets %s auto-prepare a faithful page composite and resume %s",
    (name, toolId) => {
      const body = functionBody(pageSource, name);

      expect(body).toContain(`ensureOrPrepareRasterRetouchTarget("${toolId}"`);
    },
  );

  it("keeps image-only transform and frame animation off the page-composite shortcut", () => {
    const transform = functionBody(pageSource, "openPixelSelectionTransform");
    const frameAnimation = functionBody(pageSource, "openFrameAnimationForSelected");

    // Free-transform: strokes/objects first; image content transform still uses pixel target.
    expect(transform).toContain('selected?.type === "draw"');
    expect(transform).toContain('ensurePixelToolTarget("내용 변형")');
    expect(transform).toContain("selectAllPixels");
    expect(transform).not.toContain("ensureOrPrepareRasterRetouchTarget");
    expect(frameAnimation).not.toContain("ensureOrPrepareRasterRetouchTarget");
  });

  it("keeps active retouch buttons available as explicit exit controls", () => {
    expect(railSource).toContain("disabled={!smudgeActive && !rasterRetouchCanStart}");
    expect(railSource).toContain("disabled={!wetMixActive && !rasterRetouchCanStart}");
    expect(railSource).toContain("disabled={!dodgeBurnActive && !rasterRetouchCanStart}");
    expect(railSource).toContain("disabled={!liquifyActive && !rasterRetouchCanStart}");
  });
});
