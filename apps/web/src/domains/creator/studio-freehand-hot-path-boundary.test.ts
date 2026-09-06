import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const source = readStudioCuttoonEditorSource();

function functionBody(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Studio freehand hot-path boundary", () => {
  it("rejects replay-only batches before mapping and shares one frame mapper for real work", () => {
    const consume = functionBody(
      "function consumeFreehandPointerBatch(",
      "function publishAuthoritativeFreehandSuffix("
    );
    const replayExit = consume.indexOf(
      "if (batch.authoritative.length === 0 && batch.predicted.length === 0) return false"
    );
    const mapper = consume.indexOf(
      "stagePointerFrameMapperCacheRef.current?.mapperFor(stage)"
    );

    expect(replayExit).toBeGreaterThan(-1);
    expect(mapper).toBeGreaterThan(replayExit);
    expect(consume).toContain("snapshotStudioStagePointerBatchMapper(stage)");
    expect(consume).toContain("coordinateMapper.pointFor(sample)");
    expect(consume).not.toContain("stage.setPointersPositions(sample)");
    expect(consume.match(/stage\.setPointersPositions\(pointerEvent\)/gu)).toHaveLength(1);
    expect(consume.indexOf("shouldSynchronizeStudioStagePointerPosition(")).toBeLessThan(
      consume.indexOf("stage.setPointersPositions(pointerEvent)")
    );
  });

  it("owns a coalesced batch from the active mutable surface instead of the model flag", () => {
    const consume = functionBody(
      "function consumeFreehandPointerBatch(",
      "function publishAuthoritativeFreehandSuffix("
    );
    const policyStart = consume.indexOf("const mutableDirectSurfaceActive =");
    const policyEnd = consume.indexOf("if (immediateBatchMutation", policyStart);
    const policyBlock = consume.slice(policyStart, policyEnd);

    expect(policyStart).toBeGreaterThan(-1);
    expect(policyBlock).toContain("liveInkOverlayRendererRef.current.isActive");
    expect(policyBlock).toContain("isStudioPixelPencilRenderMode(activeDrawing.brush)");
    expect(policyBlock).toContain("liveStampOverlayRendererRef.current.isActive");
    expect(policyBlock).toContain("mutableDirectSurfaceActive,");
    expect(policyBlock).not.toContain(
      "directInkSurfaceActive: liveDraftDirectRef.current"
    );
  });

  it("proves useful ink before mapping and coalesces the contact cursor with the same mapper", () => {
    const transport = functionBody(
      "onAuthoritativeMove: (pointerEvent) => {",
      "onDiscard: () => {"
    );
    const consumeIndex = transport.indexOf("consumeFreehandPointerBatch(");
    const mapperIndex = transport.indexOf("pointerMapperCache.mapperFor(stage)");
    const contactIndex = transport.indexOf(".pointFor(pointerEvent)");
    const cursorIndex = transport.indexOf(
      "updateBrushCursor(stage, pointerEvent, contactPoint, true)"
    );

    expect(consumeIndex).toBeGreaterThan(-1);
    expect(mapperIndex).toBeGreaterThan(consumeIndex);
    expect(contactIndex).toBeGreaterThan(mapperIndex);
    expect(cursorIndex).toBeGreaterThan(-1);
    expect(cursorIndex).toBeGreaterThan(contactIndex);
    expect(transport).toContain("if (!consumeFreehandPointerBatch(");
    expect(transport).toContain("contactPoint, true");
    expect(transport).toContain("canCollectStudioPointerPredictionsForActiveTail(");
    expect(transport).toContain("predictedInkTailStateRef.current !== null");
    expect(transport).toContain("noteQuickShapePointerMoved(contactPoint)");
  });

  it("returns from the duplicate Konva route before unrelated active-tool branches", () => {
    const stageMove = functionBody(
      "function onStageMove(",
      "function appendFixedRateStrokeSamples("
    );
    const nativeOwnership = stageMove.indexOf("const nativeFreehandMoveOwnsStage =");
    const earlyReturn = stageMove.indexOf("if (nativeFreehandMoveOwnsStage) return;");
    const unrelatedBranch = stageMove.indexOf("if (advancedFillTapGestureRef.current)");

    expect(nativeOwnership).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(nativeOwnership);
    expect(unrelatedBranch).toBeGreaterThan(earlyReturn);
    expect(stageMove).toContain("studioLiveRoomRef.current?.publishCursorWhenDue(() => {");
    expect(stageMove).toContain("resolveStudioLivePublishedCursorTool({");
    expect(stageMove).toContain("tool: publishedTool,");
    expect(stageMove).not.toContain("erase:");
    expect(stageMove.indexOf("pts.slice(-64)")).toBeGreaterThan(
      stageMove.indexOf("publishCursorWhenDue(() => {")
    );
    expect(stageMove).toContain("if (colorWheelTimerRef.current && colorWheelPressRef.current)");
    expect(stageMove).not.toContain("nativeFreehandMoveOwnsCursor");
  });

  it("skips raw pen coordinate mapping when prediction, cursor, and guide have no consumer", () => {
    const rawPreview = functionBody(
      "onRawPreviewMove: (pointerEvent) => {",
      "onDiscard: () => {"
    );
    const earlyReturnIndex = rawPreview.indexOf(
      "if (!rawState && !rawCursorWanted && !rawGuideWanted) return"
    );
    const stageIndex = rawPreview.indexOf("const stage = stageRef.current");
    const mapperIndex = rawPreview.indexOf(
      "const coordinateMapper = pointerMapperCache.mapperFor(stage)"
    );

    expect(earlyReturnIndex).toBeGreaterThan(-1);
    expect(earlyReturnIndex).toBeLessThan(stageIndex);
    expect(earlyReturnIndex).toBeLessThan(mapperIndex);
    expect(rawPreview).toContain("rawPenInkPreviewStateRef.current");
    expect(rawPreview).toContain('brushCursorStyle !== "none"');
    expect(rawPreview).toContain("general.showStrokeGuide");
    expect(rawPreview).toContain("drawingInputSettingsRef.current?.stabilizer ?? stabilizer");
  });

  it("coalesces active cursor draws to one latest-position frame while hover stays immediate", () => {
    const cursorDrawing = functionBody(
      "function drawBrushCursorLayer(",
      "function hideSmudgeCursor("
    );

    expect(cursorDrawing).toContain("if (!deferToFrame)");
    expect(cursorDrawing).toContain("globalThis.cancelAnimationFrame(brushCursorDrawRafRef.current)");
    expect(cursorDrawing).toContain(
      "(brushCursorRef.current?.getLayer() ?? strokeGuideRef.current?.getLayer())?.drawScene()"
    );
    expect(cursorDrawing).toContain("if (brushCursorDrawRafRef.current !== null) return");
    expect(cursorDrawing).toContain("globalThis.requestAnimationFrame(() =>");
    expect(cursorDrawing).toContain("drawBrushCursorLayer(deferToFrame)");
  });

  it("keeps prediction mutation private and skips unused GPU planning on Canvas2D", () => {
    const appendPoint = functionBody(
      "function appendFreehandStrokePoint(",
      "function appendDrawingCrdtSampleSuffix("
    );
    const mutableAppendStart = appendPoint.indexOf("if (canAppendDirectly) {");
    const immutableAppendStart = appendPoint.indexOf("const next: DrawEl =", mutableAppendStart);
    const mutableAppend = appendPoint.slice(mutableAppendStart, immutableAppendStart);

    expect(mutableAppendStart).toBeGreaterThan(-1);
    expect(immutableAppendStart).toBeGreaterThan(mutableAppendStart);
    expect(mutableAppend).toMatch(
      /if \(\s*!drawingImmediateBatchMutationRef\.current\s*&& !drawingPredictionPreviewRef\.current\s*\) scheduleDraft\(current\);/u
    );
    expect(mutableAppend.match(/scheduleDraft\(current\)/gu)).toHaveLength(1);
    expect(source).toContain("drawingPredictionBatchMutationRef.current = true");
    expect(source).toContain("pressures: predictedPressures");
    const gpuStart = functionBody(
      "const gpuStartEligible =",
      "const liveInkBackendDecision ="
    );
    expect(gpuStart).toContain("const gpuStartEligible = gpuSelected");
    expect(gpuStart).toContain('webGpuBackendRef.current === "webgpu"');
    expect(gpuStart).toContain(
      "const gpuStartPlan = gpuStartEligible ? buildGpuLiveStrokePlan(next) : null"
    );
  });

  // What this pins is an *invariant*, not a spelling: a freehand pointer frame
  // must reach the screen as exactly one retained preview commit that is painted
  // inside the same coalesced frame, and it must land in the isolated draft
  // preview store rather than in StudioPage state. `flushSync` is how that
  // "commit and paint in one frame" part is currently spelled — changing the
  // spelling is allowed, dropping the invariant is not.
  //
  // Source text alone cannot see the invariant being broken through some other
  // code path (the measured pan regression re-rendered the whole editor every
  // frame while every assertion in this file still passed), so the runtime
  // counterpart is `tests/benchmarks/harness/studio-runtime-commit-gate.ts` with
  // budgets in `studio-hot-path-commit-budget.ts`: `stroke:pen-paced` allows the
  // per-frame store commits this test protects, and zero editor renders.
  it("commits one retained freehand preview and paints it inside the same coalesced frame", () => {
    const schedule = functionBody(
      "const scheduleDraft =",
      "const clearDraftPreview ="
    );

    expect(schedule).toContain("globalThis.requestAnimationFrame(() =>");
    expect(schedule).toContain('(pending.kind ?? "freehand") === "freehand"');
    expect(schedule).toContain("KonvaRuntime.autoDrawEnabled = false");
    expect(schedule).toContain("flushSync(() => {");
    expect(schedule).toContain("draftPreviewStoreRef.current.setActive(pending)");
    expect(schedule).toContain("KonvaRuntime.autoDrawEnabled = autoDrawEnabled");
    expect(schedule).toContain("resolveStudioDraftPreviewActiveLane(pending)");
    expect(schedule).toMatch(
      /if \(activeLane === "dynamic"\) \{\s*draftPreviewDynamicLayerRef\.current\?\.drawScene\(\);\s*\} else if \(activeLane === "normal"\) \{\s*draftPreviewNormalLayerRef\.current\?\.drawScene\(\);\s*\}/u,
    );
    expect(schedule).not.toContain("const dynamicDraft");
  });

  it("presents local ink and schedules CRDT encoding behind a paint opportunity", () => {
    const publish = functionBody(
      "function publishAuthoritativeFreehandSuffix(",
      "drawingFixedRatePumpFrameRef.current ="
    );

    expect(publish.indexOf("flushDirectLiveDraftNow(authoritativeDrawing)")).toBeLessThan(
      publish.indexOf("appendDrawingCrdtSampleSuffix(authoritativeDrawing, startSample)")
    );
    expect(source).toContain("new StudioCrdtLiveStrokePublisher<DrawEl>");
    expect(source).toContain("drawingCrdtPublisherRef.current.flush(authoritativeLiveStroke.id)");
  });
});
