import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

function source(fileName: string): string {
  if (fileName.endsWith("StudioPage.tsx") || fileName.endsWith("StudioCuttoonEditorHost.tsx")) return readStudioCuttoonEditorSource();
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

function expectInOrder(value: string, fragments: readonly string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = value.indexOf(fragment, cursor + 1);
    expect(next, `Expected ${JSON.stringify(fragment)} after index ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("Studio advanced WebGPU live-ink integration", () => {
  it("keeps the engine provider immutable and allows Canvas2D only by explicit selection", () => {
    const engine = source("./studio-webgpu-engine.ts");
    const canvas = source("../StudioWebGpuCanvas.tsx");
    const renderStart = engine.indexOf("private renderPreparedStrokes(");
    const renderEnd = engine.indexOf("public clear(): void", renderStart);
    const renderSource = engine.slice(renderStart, renderEnd);
    const unavailableStart = renderSource.indexOf("this.pendingWebGpuRender = null;");
    const unavailableSource = renderSource.slice(unavailableStart);
    const deviceLossStart = engine.indexOf("private handleDeviceLost(");
    const deviceLossEnd = engine.indexOf("private ensureSelectedCanvas2d(", deviceLossStart);
    const deviceLossSource = engine.slice(deviceLossStart, deviceLossEnd);

    expect(engine).toContain('this.backend = options.selectedBackend ?? "webgpu"');
    expect(engine).toContain("readonly canvas2dCanvas: HTMLCanvasElement");
    expect(engine).not.toContain("fallbackCanvas");
    expect(engine).toContain('if (this.backend !== "canvas2d") return null');
    expect(engine).not.toContain("activateCanvas2d");
    expect(engine).not.toContain('setBackend("canvas2d")');
    expect(renderSource).toContain('if (this.backend === "canvas2d") {');
    expect(renderSource).toContain("this.markSelectedBackendUnavailable({");
    expect(renderSource).toContain("revokeInitializationReplay: false");
    expect(unavailableStart).toBeGreaterThan(-1);
    expect(unavailableSource).not.toContain(
      "this.renderCanvas2d(strokeSnapshot, requestId, frameGeneration)"
    );
    expect(deviceLossSource).toContain("this.markSelectedBackendUnavailable()");
    expect(deviceLossSource).not.toContain("this.renderCanvas2d(");
    expect(deviceLossSource).not.toContain("this.render(this.lastStrokes");
    expect(canvas).toContain('selectedBackend: "webgpu"');
  });

  it("pins one exactly prepared provider and rejects it without a runtime substitute", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");

    expect(page).toContain('import("./render/studio-webgpu-live-stroke-plan")');
    expect(page).not.toContain('import { planStudioGpuLiveStroke } from "./studio-webgpu-stroke"');
    expect(page).toContain("preparedStroke: gpuStartPlan?.preparation");
    expect(page).toContain("direct: overlayCandidate && gpuStartPlan !== null");
    expect(page).toContain('webGpuBackendRef.current === "webgpu"');
    expect(page).toContain("const direct =");
    expect(page).toContain("|| liveInkOverlayStarted");
    expect(page).toContain("|| wetInkOverlayStarted");
    expect(page).toContain("|| gpuPin");
    expect(page).toContain("|| dynamicBrushDirect");
    const liveSurfaceStart = page.slice(
      page.indexOf("function beginStudioDrawLiveSurfaces("),
      page.indexOf("function onStageDown("),
    );
    expect(liveSurfaceStart).toContain("overlayCandidate");
    for (const exclusiveSelection of [
      "const livingInkSelected =",
      "const hokusaiSelected = !livingInkSelected",
      "const stampSelected = !livingInkSelected",
      "const wetMediaSelected = !livingInkSelected",
      "const retainedMediaSelected = !livingInkSelected",
      "const dynamicSelected = !livingInkSelected",
      "const genericDirectSelected = !livingInkSelected",
    ]) {
      expect(liveSurfaceStart).toContain(exclusiveSelection);
    }
    expect(page).toContain('destination: "transparent-overlay"');
    const gpuEligibilityStart = liveSurfaceStart.indexOf("const gpuStartEligible =");
    const gpuEligibility = liveSurfaceStart.slice(
      gpuEligibilityStart,
      liveSurfaceStart.indexOf("gpuLiveOperationOrderKeyRef.current =", gpuEligibilityStart),
    );
    expectInOrder(gpuEligibility, [
      "gpuSelected",
      'webGpuBackendRef.current === "webgpu"',
      "webGpuCanvasHandleRef.current?.isBackendAvailable() === true",
      "gpuLiveStrokePlannerRef.current !== null",
    ]);
    expect(liveSurfaceStart).not.toContain("strokeRouteTournamentGate");
    expect(liveSurfaceStart).toContain("pendingGpuAuthorityBlocksNewSurface");
    expect(liveSurfaceStart).not.toContain("promotePendingGpuAuthoritiesToKonva");
  });

  it("never selects the WebGPU lane for a style it would then refuse", () => {
    // 실측 회귀: GPU 가 있는 브라우저에서 마커(불투명도 0.6) 같은 반투명 직접잉크 브러시가
    // 0px 를 그렸다 — GPU 를 선택해 놓고 "선택 거부 사유: opacity" 로 획 자체를 거절했다.
    // 헤드리스 셸은 GPU 를 아예 못 골라서 장획 게이트가 이 경로를 밟지 못했다.
    const page = source("../StudioCuttoonEditorHost.tsx");
    const liveSurfaceStart = page.slice(
      page.indexOf("function beginStudioDrawLiveSurfaces("),
      page.indexOf("function onStageDown("),
    );
    expectInOrder(liveSurfaceStart, [
      "const gpuSelected = genericDirectSelected && studioLiveInkLaneSelectsGpu({",
      "explicitBackend: import.meta.env.VITE_STUDIO_LIVE_INK_BACKEND",
      "hardwareReady:",
      "rolloutPrefersGpu:",
      "const canvas2dSelected = genericDirectSelected && !gpuSelected",
    ]);
    // The style gate decides BEFORE the lane is entered, so this remains a selection rule rather
    // than a hand-over after a GPU failure — the refusal below still owns real GPU failures.
    expect(liveSurfaceStart.indexOf("studioLiveInkLaneSelectsGpu({"))
      .toBeLessThan(liveSurfaceStart.indexOf("const gpuStartEligible ="));
    expect(liveSurfaceStart).toContain('rejectSelectedSurface(\n          "WebGPU 라이브 잉크"');
    // The rule itself lives next to the decision it mirrors.
    const admission = source("../live/studio-live-ink-lane-admission.ts");
    expectInOrder(admission, [
      "export function studioLiveInkLaneAdmitsStyle",
      "(element.opacity ?? 1) >= 0.999",
      'element.mode !== "eraser"',
      "!element.fill",
      '(element.symmetry?.type ?? "none") === "none"',
      "export function studioLiveInkLaneSelectsGpu",
      'input.explicitBackend === "canvas2d"',
      "studioLiveInkLaneAdmitsStyle(input.element)",
    ]);
  });

  it("commits a pending WebGPU authority at admission instead of refusing the next stroke", () => {
    // 실측 회귀: WebGPU 획 뒤 0.6초 만에 그은 두 번째 획이 100% 거절됐다("획을 시작하지
    // 않았습니다"). 대기 배치의 2초 유휴 타이머가 큐를 붙들고 있었을 뿐인데, 진입 가드는 그
    // 큐가 비지 않으면 새 표면 작업을 통째로 막는다. 새 획이 시작된 이상 이전 획의 유휴 창은
    // 끝났으므로, 가드를 읽기 전에 그 커밋을 동기적으로 끝낸다.
    const page = source("../StudioCuttoonEditorHost.tsx");
    const liveSurfaceStart = page.slice(
      page.indexOf("function beginStudioDrawLiveSurfaces("),
      page.indexOf("function onStageDown("),
    );
    const flushIndex = liveSurfaceStart.indexOf("commitPendingStrokeBatchForAdmission(");
    const guardIndex = liveSurfaceStart.indexOf("const pendingGpuAuthorityBlocksNewSurface =");
    expect(flushIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(flushIndex);
    expectInOrder(liveSurfaceStart.slice(flushIndex, guardIndex), [
      "pendingGpuStrokesRef.current.length > 0",
      "pendingGpuDrawAuthoritiesRef.current.length > 0",
      "strokeAdmissionCommitFlushRef",
      "flushSync(() => flushPendingStrokeCommitsRef.current())",
    ]);
    const admissionModule = source("../live/studio-live-ink-lane-admission.ts");
    expectInOrder(admissionModule, [
      "export function commitPendingStrokeBatchForAdmission",
      "if (!pendingGpuAuthority) return;",
      "admissionFlushRef.current = true;",
      "flushPendingStrokeCommitsSync();",
      "admissionFlushRef.current = false;",
    ]);
    // The flush keeps its own mid-stroke guard: only this admission path may bypass it, and the
    // exact terminal receipt gate inside the flush is untouched, so an unreceipted WebGPU stroke
    // still refuses honestly rather than committing retained geometry.
    expect(page).toContain(
      "if (drawingRef.current && !strokeAdmissionCommitFlushRef.current) {",
    );
    expect(page).toContain("pendingBatchAwaitsSelectedGpuFinalReceipt(pendingBeforeReceiptGate)");
  });

  it("keeps Canvas hidden for a WebGPU-selected operation until an exact GPU receipt", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const viewport = readStudioCanvasViewportStack(import.meta.url, "../canvas/");
    const applyStart = page.indexOf(
      "function applyLiveStrokeBackendPresentationEffects()"
    );
    const applyEnd = page.indexOf(
      "function retireLiveStrokeBackendAudit",
      applyStart,
    );
    const applySource = page.slice(applyStart, applyEnd);

    expect(page).toContain("const gpuCanvasShadowVisibleRef = useRef(false)");
    expect(viewport).toContain("gpuCanvasShadowVisibleRef.current");
    expect(viewport).toContain("gpuLiveInkPinnedRef.current");
    expect(viewport).toContain("!gpuCanvasShadowVisibleRef.current");
    expect(applySource).toContain("activeGpuReceiptExact");
    expect(applySource).toContain("activeSnapshot.gpuOverlayVisible");
    expect(applySource).toContain('activeSnapshot.pinnedBackend === "canvas2d"');
    expect(applySource).toContain("liveDraftLayerRef.current?.drawScene()");
    expect(applySource.indexOf("liveDraftLayerRef.current?.drawScene()"))
      .toBeLessThan(applySource.indexOf(
        "webGpuCanvasHandleRef.current?.setPinnedPresentationVisible(gpuOverlayVisible)"
      ));
    expect(applySource).not.toContain(".setPinnedVisible(");
    // The append-continuity clause must be tied to the current surface, or a sealed previous
    // stroke — which keeps its overlay flag and expected request on purpose — reopens the next
    // stroke's rewritten surface before that stroke's first receipt.
    expectInOrder(applySource, [
      "const appendContinuedSessionVisible = currentSurfaceRequestId !== null && [",
      "if (snapshot.expectedGpuRequest?.requestId !== currentSurfaceRequestId) return false;",
      "gpuPinReceiptWatchdogRef.current?.hasExactReceipt(accepted.requestId) === true",
    ]);
    // Submission continuity is declared by the caller and defaults to the fail-closed `rewrite`,
    // so a new call site cannot silently inherit "keep presenting" for a destructive submission.
    expectInOrder(page, [
      "function prepareLiveStrokeGpuSubmission(",
      "strokeId: string,",
      'surfaceContinuity: StudioLiveStrokeGpuSurfaceContinuity = "rewrite"',
    ]);
    expect(page).toContain(
      "webGpuCanvasHandleRef.current?.setPinnedPresentationVisible(false)"
    );
    // Only the suffix-append path may keep the presented prefix up; it grows the retained journal
    // in place. Hiding it there once per pointer sample is what blanked the live pen stroke.
    expect(page).toContain('if (!prepareLiveStrokeGpuSubmission(el.id, "append")) {');
    expect(page).toContain(
      'if (!registerLiveStrokeGpuRequest(el.id, outcome.requestId, "append")) {'
    );
    // Baseline replacement destroys the presented pixels, so it must NOT declare continuity.
    expect(page).toContain("if (!prepareLiveStrokeGpuSubmission(el.id)) return false");
    expect(page).not.toContain('replacePinnedJournalBaseline(nextGpuStrokes, "append")');
    expect(page).toContain(
      "if (!prepareLiveStrokeGpuSubmission(activeDrawing.id))"
    );
    expect(page).toContain("active: liveStrokeBackendAuditActiveIdRef.current");
    expect(page).toContain("if (!auditReceipt.active) {");
    const blocking = page.indexOf(
      "const pendingGpuAuthorityBlocksNewSurface ="
    );
    const stampStart = page.indexOf(
      "const stampDirect = Boolean(",
      blocking,
    );
    expect(blocking).toBeGreaterThan(-1);
    expect(stampStart).toBeGreaterThan(blocking);
    expect(page).not.toContain("promotePendingGpuAuthoritiesToKonva");
    expect(page.indexOf("const gpuStartEligible =", stampStart)).toBeGreaterThan(stampStart);
    expect(page).toContain(
      "webGpuCanvasHandleRef.current?.setPinnedPresentationVisible(false)"
    );
    expect(page).toContain(
      "same stroke to Canvas2D/Konva"
    );
  });

  it("starts one compact journal root and submits every symmetry suffix atomically", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");

    expect(page).toContain(
      'if (outcome.status === "rejected") {'
    );
    expect(page).toContain("handle.appendPinnedJournalSuffixBatch({");
    expect(page).toContain("previousPointCount: suffix.previousRenderedPointCount");
    expect(page).toContain("suffixPoints: suffix.points");
    expect(page).toContain("suffixPressures: suffix.pressures");
    expect(page).not.toContain("handle.appendPinnedStrokeSuffixBatch({");
    expect(page).not.toContain("handle.appendPinnedStrokeSuffix({");
    expect(page).not.toContain("fallbackStrokes");
    expect(page).not.toContain("gpuLiveInkExposedPointsRef");
    expect(page).not.toContain("gpuLiveInkExposedPressuresRef");
    const flushStart = page.indexOf("const flushDirectLiveDraft = () => {");
    const flushEnd = page.indexOf("const flushDirectLiveDraftNow", flushStart);
    expect(flushStart).toBeGreaterThan(-1);
    expect(flushEnd).toBeGreaterThan(flushStart);
    expect(page.slice(flushStart, flushEnd)).not.toContain("buildGpuLiveStrokePlan(next)");
    expect(page.slice(flushStart, flushEnd)).not.toContain(".slice(previousPointCount");
    expect(page).toContain("...settled.strokes");
    expect(page).toContain("...activeGpuPlan.strokes");
    expect(page).toContain(
      'if (!outcome || outcome.status === "rejected") {'
    );
    expect(page).toContain("pendingGpuStrokesRef.current.length - reserved.gpu");
  });

  it("seals the release endpoint and rejects without publishing a Konva draft", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");

    expect(page).toContain("appendGpuLiveSourceJournalSuffix(source, true)");
    const settleStart = page.indexOf("const settleGpuLiveStroke =");
    const settleEnd = page.indexOf("const flushDirectLiveDraft =", settleStart);
    const settleSource = page.slice(settleStart, settleEnd);
    expect(settleSource).toContain('failSelectedGpuLiveInk("request-failed", finished.id)');
    expect(settleSource).not.toContain("draftPreviewStoreRef.current.settle(finished)");
    expect(page).not.toContain("relinquishGpuLiveInkToKonva");
    expect(page).toContain(
      "webGpuCanvasHandleRef.current?.setPinnedPresentationVisible(false)"
    );
    expect(page).not.toContain("handle?.replacePinnedStrokes(pendingGpu)");
    expect(page).toContain("appendGpuLiveSourceJournalSuffix(next)");
    expect(page).toContain("never falls through to the Canvas2D/Konva draw below");
  });

  it("fails closed synchronously when the selected engine rejects a compact command", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const viewport = readStudioCanvasViewportStack(import.meta.url, "../canvas/");

    expect(page).toContain('if (outcome.status === "rejected") {');
    expect(page).toContain("gpuLiveSourceJournalRef.current = advanced.state");
    expect(page).toContain('failSelectedGpuLiveInk("request-failed", el.id)');
    expect(page).not.toContain("relinquishGpuLiveInkToKonva");
    // A finished stroke's terminal receipt gets its own budget: the live-latency deadline was
    // deleting completed strokes whenever a commit render overran a frame.
    expect(page).toContain(
      "armGpuPinnedRequestWatchdog(outcome.requestId, STUDIO_GPU_TERMINAL_RECEIPT_TIMEOUT_MS)",
    );
    expect(page).toContain("STUDIO_GPU_PIN_REQUEST_TIMEOUT_MS");
    expect(page).toContain("new StudioGpuPinReceiptWatchdog({");
    expect(page).toContain("gpuPinReceiptWatchdog().receipt(receipt.requestId)");
    expect(page).toContain("gpuLiveAcceptedRequestIdRef.current = outcome.requestId");
    expect(page).toContain(
      "beginGpuPinnedReceiptEpoch(gpuLiveAcceptedRequestIdRef.current)"
    );
    expect(viewport).toContain("onFrameInvalid={onWebGpuFrameInvalid}");
    expect(viewport).toContain("onFrameRequest={onWebGpuFrameRequest}");
    expect(page).toContain(
      "function onWebGpuFrameRequest(request: StudioWebGpuSurfaceFrameRequest)"
    );
    expect(page).toContain(
      "!registerLiveStrokeGpuRequest(activeStrokeId, request.requestId)"
    );
    expect(page).toContain(
      "session.gpuRequest?.requestId === requestId"
    );
    expect(page).toContain(
      "liveStrokeBackendAuditGpuOwnersRef.current.get(requestId) === session"
    );
    expect(page).toContain("armGpuPinnedRequestWatchdog(request.requestId)");
    expect(page).toContain(
      "const gpuOverlayVisible = receiptedSessionVisible"
    );
    expect(page).toContain("onSelectedEngineUnavailable");
  });

  it("cancels selected wet, dynamic, and retained-media operations without a Konva publish", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const flushStart = page.indexOf("const flushDirectLiveDraft = () => {");
    const flushEnd = page.indexOf("const flushDirectLiveDraftNow", flushStart);
    const flushSource = page.slice(flushStart, flushEnd);

    for (const provider of ["습식 매체", "동적 브러시", "리테인드 매체"]) {
      expect(flushSource).toContain(`rejectActiveSelectedLiveSurface(\n          "${provider}"`);
    }
    expect(flushSource).toContain("다른 렌더러로 전환하지 않습니다.");
    const selectedProviderSource = flushSource.slice(
      flushSource.indexOf("if (liveWetInkDraftDirectRef.current)"),
      flushSource.indexOf("if (liveStampDraftDirectRef.current)"),
    );
    expect(selectedProviderSource).not.toContain("draftPreviewStoreRef.current.setActive(next)");
    expect(selectedProviderSource).not.toContain("draftPreviewNormalLayerRef.current?.drawScene()");
    expect(selectedProviderSource).not.toContain("draftPreviewDynamicLayerRef.current?.drawScene()");
  });

  it("assigns live operations a monotonic terminal key independent of random element ids", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");

    expect(page).toContain('const STUDIO_GPU_LIVE_OPERATION_ORDER_PREFIX = "\\uffffstudio-live:"');
    expect(page).toContain("nextGpuLiveOperationOrderKey()");
    expect(page).toContain('String(nextSequence).padStart(16, "0")');
    expect(page).toContain("orderKey: gpuLiveOperationOrderKeyRef.current ?? el.id");
    expect(page).not.toContain("orderKey: el.id,");
  });

  it("gates pointer-up commit and durability on the exact terminal WebGPU receipt", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const settleStart = page.indexOf("const settleGpuLiveStroke =");
    const settleEnd = page.indexOf("const flushDirectLiveDraft =", settleStart);
    const settleSource = page.slice(settleStart, settleEnd);
    const finishStart = page.indexOf("function finishDrawingPointer(");
    const finishEnd = page.indexOf("function onStagePointerCancel", finishStart);
    const finishSource = page.slice(finishStart, finishEnd);
    const sealStart = page.indexOf("function sealStudioDrawReleaseInput(");
    const sealEnd = page.indexOf("function finishStudioSpecialistStroke(", sealStart);
    const sealSource = page.slice(sealStart, sealEnd);
    const clearStart = page.indexOf("const clearDraftPreview =");
    const clearEnd = page.indexOf("const DEFERRED_STROKE_COMMIT_IDLE_MS", clearStart);
    const clearSource = page.slice(clearStart, clearEnd);
    const flushStart = page.indexOf("flushPendingStrokeCommitsRef.current = () => {");
    const flushEnd = page.indexOf("discardPendingStrokeCommitsRef.current =", flushStart);
    const flushSource = page.slice(flushStart, flushEnd);

    expect(settleStart).toBeGreaterThan(-1);
    expect(settleEnd).toBeGreaterThan(settleStart);
    expect(settleSource).toContain("gpuFinalReceiptStrokeRef.current = finished");
    expect(settleSource).toContain("gpuFinalReceiptRequestIdRef.current = finalRequestId");
    expect(settleSource).toContain(
      "gpuFinalReceiptRequestIdsRef.current.set(finished.id, finalRequestId)",
    );
    expect(settleSource).toContain("handle.replacePinnedJournalBaseline(nextPendingGpuStrokes)");
    expect(settleSource).toContain("registerLiveStrokeGpuRequest(finished.id, outcome.requestId)");
    expect(settleSource).toContain("pendingGpuDrawAuthoritiesRef.current = [");
    expectInOrder(finishSource, [
      "const gpuPinnedAtRelease = gpuLiveInkPinnedRef.current",
      "!settleGpuLiveStroke(authoritativeLiveStroke ?? finished, finished)",
      "discardDrawingPointerSession()",
      'releasePlan.commitMode === "deferred" || gpuPinnedAtRelease',
      "queueDeferredStrokeCommit(finished)",
    ]);
    expect(sealSource).toContain("if (gpuLiveInkPinnedRef.current)");
    expect(sealSource).toContain(
      "drawingCrdtPublisherRef.current.cancel(authoritativeLiveStroke.id)",
    );
    expect(sealSource).toContain("selectedGpuFinalCrdtFlushDeferred = true");
    expect(sealSource).toContain(
      "drawingRef.current && !selectedGpuFinalCrdtFlushDeferred",
    );
    expect(clearSource).toContain("hasExactSelectedGpuFinalReceipt(finalGpuReceiptStroke.id)");
    expect(clearSource).not.toContain('failSelectedGpuLiveInk("surface-lost"');
    expect(flushSource).toContain(
      "pendingBatchAwaitsSelectedGpuFinalReceipt(pendingBeforeReceiptGate)",
    );
    expect(flushSource.indexOf("pendingBatchAwaitsSelectedGpuFinalReceipt"))
      .toBeLessThan(flushSource.indexOf("takePendingStrokeCommits()"));
    expect(page).toContain("selectedGpuStrokeRequiresFinalReceipt(finished.id)");
    expect(page).toContain("persistAcceptedSelectedGpuFinalReceipt(");
    expect(page).toContain("gpuFinalCrdtPublishedRequestIdsRef.current.get(strokeId)");
    expect(page).toContain("studioCrdtDocumentRef.current?.replaceStroke(");
    expect(page.indexOf("hasExactSelectedGpuFinalReceipt(strokeId)"))
      .toBeLessThan(page.indexOf("studioCrdtDocumentRef.current?.replaceStroke("));
    // The rejection still removes the uncommitted operation; since 2026-09-02 it carries the
    // provider reason so the parked recovery record can explain itself in the reliability rail.
    expect(page).toContain("cancelRejectedSelectedGpuPendingStroke(strokeId, reason)");
    expect(page).toContain("drawingCrdtPublisherRef.current.cancel(strokeId)");
    expect(page).toContain("studioCrdtDocumentRef.current?.deleteStroke(strokeId)");
    expect(page).not.toContain("promotePendingGpuAuthoritiesToKonva");
    expect(page).toContain("releaseStudioGpuPendingAuthorityPrefix(");
    expect(page).toContain("webGpuCanvasHandleRef.current?.setPinnedVisible(false)");
  });

  it("marks surface loss unavailable without handing authority to Canvas or Konva", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const handleStart = page.indexOf("function setWebGpuCanvasHandle(");
    const handleEnd = page.indexOf("function onWebGpuBackendChange", handleStart);
    const handleSource = page.slice(handleStart, handleEnd);

    expect(handleStart).toBeGreaterThan(-1);
    expect(page).toContain("pendingGpuDrawAuthoritiesRef.current.length > 0");
    expect(page).toContain("pendingGpuStrokesRef.current.length > 0");
    expect(page).not.toContain("relinquishGpuLiveInkToKonva");
    expect(page).not.toContain("promotePendingGpuAuthoritiesToKonva");
    expect(handleSource).toContain('reportAllLiveStrokeGpuAuditFailures("surface-lost")');
    expect(handleSource).toContain("handle.setPinnedPresentationVisible(false)");
    expect(handleSource).not.toContain("replacePinnedStrokes(");
    expect(handleSource).not.toContain("setPinnedVisible(true)");

    const deviceLostStart = page.indexOf("function onWebGpuDeviceLost()");
    const deviceLostEnd = page.indexOf("function onWebGpuFrameReady", deviceLostStart);
    const deviceLostSource = page.slice(deviceLostStart, deviceLostEnd);
    expect(deviceLostSource).toContain('reportAllLiveStrokeGpuAuditFailures("device-lost")');
    expect(deviceLostSource).not.toContain('publishStudioRenderBackend("canvas2d")');
  });

  it("normalizes symmetry releases and preserves the original handoff queue on invariant failure", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const releaseStart = page.indexOf("function releaseCommittedInkSurfaceCounts(");
    const releaseEnd = page.indexOf("function scheduleCommittedInkSurfaceHandoffRetry", releaseStart);
    const releaseSource = page.slice(releaseStart, releaseEnd);

    expect(releaseStart).toBeGreaterThan(-1);
    expect(releaseEnd).toBeGreaterThan(releaseStart);
    expect(releaseSource).toContain("availableGpuStrokeCount: pendingGpuStrokesRef.current.length");
    expect(releaseSource).toContain("completeElementIds: completeGpuElementIds");
    expect(releaseSource).toContain('if (releasedAuthorities?.status === "rejected") {');
    expect(releaseSource).toContain('status: "retained", reason: "gpu-authority-release-rejected"');
    expect(releaseSource).not.toContain("relinquishGpuLiveInkToKonva");
    expect(releaseSource).not.toContain(
      'releasedAuthorities.status === "released"\n        ? [...releasedAuthorities.remaining]\n        : []'
    );
    expect(releaseSource).toContain("releasedAuthorities.releasedGpuStrokeCount");
    const firstSurfaceCountRead = releaseSource.indexOf("released.overlay > overlayRenderer.settledStrokeCount");
    const gpuAuthorityPlan = releaseSource.indexOf("releaseStudioGpuPendingAuthorityPrefix({");
    expect(firstSurfaceCountRead).toBeGreaterThan(-1);
    expect(firstSurfaceCountRead).toBeLessThan(gpuAuthorityPlan);
    expect(releaseSource.indexOf("replacePinnedJournalBaseline(nextGpuStrokes)")).toBeLessThan(
      releaseSource.indexOf("overlayRenderer.releaseSettledPrefix(released.overlay)")
    );
    expect(releaseSource).not.toContain("syncPinnedStrokes(nextGpuStrokes)");
    expect(releaseSource).not.toContain("setPinnedVisible(true)");
    expect(releaseSource).toContain("postContactRemainderBlocksRelease");
    expect(releaseSource).toContain('reason: "post-contact-rebaseline-forbidden"');
    expect(releaseSource.match(/released\.overlay > overlayRenderer\.settledStrokeCount/g)).toHaveLength(2);
    expect(releaseSource).toContain(
      "const releasedOverlayCount = overlayRenderer.releaseSettledPrefix(released.overlay)"
    );
    expect(releaseSource).toContain(
      "const releasedDraftCount = draftPreviewStore.releaseSettledPrefix(released.draft)"
    );
    const exactSurfaceReceipt = releaseSource.indexOf(
      "releasedOverlayCount !== released.overlay"
    );
    expect(exactSurfaceReceipt).toBeGreaterThan(-1);
    expect(exactSurfaceReceipt).toBeLessThan(
      releaseSource.indexOf("pendingGpuDrawAuthoritiesRef.current = [...releasedAuthorities.remaining]")
    );
    expect(exactSurfaceReceipt).toBeLessThan(
      releaseSource.indexOf("pendingGpuStrokesRef.current = nextPendingGpuStrokes")
    );
    expect(releaseSource).toContain('reason: "surface-release-mismatch"');
    expect(page).not.toContain("consumeStudioGpuHandoffReservationPrefix(");
    expect(page).toContain("committedInkSurfaceHandoffsRef.current = [...queue]");
    expect(page).toContain('if (releaseOutcome.status === "released") {');
    expect(page).not.toContain('releaseOutcome.status === "promoted"');
    expect(page).toContain(
      "liveInkOverlayRendererRef.current.suppressSettledPrefix(released.overlay)"
    );
    expect(page).toContain(
      "draftPreviewStoreRef.current.suppressSettledPrefix(released.draft)"
    );
  });

  it("schedules a post-commit handoff pass after installing the ref-only queue", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const queueStart = page.indexOf("function queueCommittedStrokeSurfaceHandoff(");
    const queueEnd = page.indexOf("function queueDeferredStrokeCommit(", queueStart);
    const queueSource = page.slice(queueStart, queueEnd);
    const install = queueSource.indexOf(
      "committedInkSurfaceHandoffsRef.current = [...pending, queued]",
    );
    const retry = queueSource.indexOf("scheduleCommittedInkSurfaceHandoffRetry()", install);

    expect(queueStart).toBeGreaterThan(-1);
    expect(queueEnd).toBeGreaterThan(queueStart);
    expect(install).toBeGreaterThan(-1);
    expect(retry).toBeGreaterThan(install);
  });

  it("requires the full active journal identity before rebaselining a settled prefix", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const matchStart = page.indexOf("function activeGpuLiveSourceJournalMatchesPlan(");
    const matchEnd = page.indexOf("function beginGpuLiveSourceJournal(", matchStart);
    const matchSource = page.slice(matchStart, matchEnd);

    expect(matchStart).toBeGreaterThan(-1);
    expect(matchEnd).toBeGreaterThan(matchStart);
    expect(matchSource).toContain("studioBrushSymmetryTransforms(el.symmetry)");
    expect(matchSource).toContain("journal.identity.epoch");
    expect(matchSource).toContain("id: plan.strokes[index]!.id");
    expect(matchSource).toContain("sameStudioGpuLiveSourceJournalIdentity(journal.identity, identity)");
    expect(page).toContain("activeGpuLiveSourceJournalMatchesPlan(activeDrawing, activeGpuPlan, activeJournal)");
  });

  it("keeps a ready retained head installed and retries it with a bounded invariant epoch", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const processStart = page.indexOf("processCommittedInkSurfaceHandoffsRef.current = () => {");
    const processEnd = page.indexOf("useLayoutEffect(() => {", processStart);
    const processSource = page.slice(processStart, processEnd);
    const releasedBranch = processSource.indexOf('if (releaseOutcome.status === "released") {');
    const queueInstall = processSource.indexOf("committedInkSurfaceHandoffsRef.current = [...queue]");
    const retainedRetry = processSource.indexOf("scheduleCommittedInkRetainedRetry(");

    expect(processStart).toBeGreaterThan(-1);
    expect(processEnd).toBeGreaterThan(processStart);
    expect(releasedBranch).toBeGreaterThan(-1);
    expect(queueInstall).toBeGreaterThan(releasedBranch);
    expect(retainedRetry).toBeGreaterThan(queueInstall);
    expect(processSource.slice(retainedRetry)).toContain("return;");
    expect(processSource.slice(retainedRetry)).not.toContain(
      "committedInkSurfaceHandoffsRef.current = [...queue]"
    );
    expect(page).toContain("planStudioCommittedInkRetainedRetry(");
    expect(page).toContain("studioRevisionProjectGenerationRef.current");
    expect(page).toContain("original handoffs and visible authority remain installed");
  });

  it("keeps the mutable source private so coalesced GPU input does not copy its full prefix", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");

    expect(page).toContain(
      "const ownsCurrentArrays = !mutateDirectly\n      && current.points === drawingFixedRateOwnedPointsRef.current;"
    );
    expect(page).toContain(
      "const immediateBatchMutation = !compactGpuSourceJournalActive"
    );
    expect(page).toContain(
      "&& gpuLiveInkPinnedRef.current\n            && gpuLiveSourceJournalRef.current !== null"
    );
    expect(page).toContain("points: ownsCurrentArrays ? current.points : [...current.points]");
    expect(page).not.toContain("current.points !== gpuLiveInkExposedPointsRef.current");
  });

  it("does not let a transparent GPU overlay impersonate retained-layer erasing", () => {
    const policy = source("../live/studio-live-ink-backend.ts");

    expect(policy).toContain('composite === "erase" && prepared.destination !== "retained-layer"');
    expect(policy).toContain('return unavailable("eraser")');
    expect(policy).not.toContain('backend: "canvas2d", reason: "eraser"');
  });
});
