import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const source = [
  "./StudioBackground3D.tsx",
  "./read-studio-bg3d-editor-source.ts",
  "./studio-bg3d-editor-shot-host.ts",
  "./studio-bg3d-editor-capture-host.ts",
  "./studio-bg3d-editor-insert-host.ts",
  "./useStudioBg3dEditorEffects.ts",
  "./useStudioBg3dEditorState.ts",
  "./useStudioBg3dEditorRestoreEffects.ts",
  "./StudioBg3dEditorViewport.tsx",
  "./studio-bg3d-editor-layout-view-model.ts",
  // 2026-08-21 intentional change: BgViewportController.readView moved into StudioBg3dSceneNodes.tsx.
  "./StudioBg3dSceneNodes.tsx",
  "./StudioBg3dShapesPanel.tsx",
  "./StudioBg3dViewPanelContent.tsx",
  "./StudioBg3dLtPanel.tsx",
].map((fileName) => readFileSync(new URL(fileName, import.meta.url), "utf8")).join("\n")
  + "\n" + readStudioBg3dEditorSource();
const cameraApplicationSource = readFileSync(
  new URL("./studio-bg3d-camera-application.ts", import.meta.url),
  "utf8",
);
// 2026-08-21 intentional change: the shot batch orchestration moved out of StudioBackground3D.tsx
// into studio-bg3d-shot-batch-export-run.ts during the editor split. The `exportSavedShotsAsZip`
// marker still resolves — it now lives in that module, so the slice reads it there instead.
const shotBatchExportSource = readFileSync(
  new URL("./studio-bg3d-shot-batch-export-run.ts", import.meta.url),
  "utf8",
);

function exportedFunctionSlice(moduleSource: string, name: string): string {
  const start = moduleSource.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return moduleSource.slice(start);
}

function functionSlice(name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function expectInOrder(haystack: string, needles: readonly string[]): void {
  let cursor = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle, cursor + 1);
    expect(index, `Expected ${JSON.stringify(needle)} after source offset ${cursor}`).toBeGreaterThan(
      cursor,
    );
    cursor = index;
  }
}

describe("Studio BG3D shot UI integration boundary", () => {
  it("loads the asset writer only after the user starts a guarded library save", () => {
    const handler = functionSlice("handleSaveToLibrary", "handleInsert");

    expect(source).not.toContain('import { saveAsset } from "../studio-asset-library";');
    expectInOrder(handler, [
      "captureInFlightRef.current = true",
      "setIsCapturing(true)",
      'const { saveAsset } = await import("../studio-asset-library")',
      "const captureAdapter = await acquireStudioBg3dCaptureAdapterAfterViewTransition({",
      "const captured = await captureStudioBg3dRaster(captureAdapter",
      "await saveAsset({",
      "} finally {",
      "captureInFlightRef.current = false",
    ]);
  });

  it("captures the current canonical runtime view as one undoable command", () => {
    const handler = functionSlice("captureCurrentShot", "applySavedShot");

    expect(handler).toContain("readCurrentCanonicalSceneForShot()");
    expect(handler).toContain("captureStudioBg3dShot(currentDocument");
    expect(handler.match(/commitImmediateHistoryTransition/gu)).toHaveLength(1);
    expect(handler).toContain("setSceneBaseDocument(captured)");
    expect(source).toContain("onClick={captureCurrentShot}");
  });

  it("reads a complete canonical camera, including projection, zoom, and active lens shift", () => {
    expect(source).toContain('projection: camera instanceof THREE.OrthographicCamera ? "orthographic" : "perspective"');
    expect(source).toContain("zoom: camera.zoom");
    expect(source).toContain("camera.view.offsetX / camera.view.fullWidth");
    expect(source).toContain("camera.view.offsetY / camera.view.fullHeight");
    expect(source).toContain("...(lensShift ? { lensShift } : {})");
  });

  it("projects visibility and applies the persisted camera before exposing a shot", () => {
    const handler = functionSlice("commitAppliedShot", "captureCurrentShot");

    expect(handler).toContain("projectStudioBg3dShotVisibilityToRuntime(");
    expect(handler.indexOf("if (!projected)")).toBeGreaterThanOrEqual(0);
    expect(handler.match(/commitImmediateHistoryTransition/gu)).toHaveLength(1);
    expect(handler).toContain("setPrimitives(projected.primitives)");
    expect(handler).toContain("setCustomModels(projected.customModels)");
    expect(handler).toContain("viewportApiRef.current?.applyView(appliedDocument.camera)");
    expect(handler).toContain("collectStudioBg3dEffectivelyVisibleEntityIds(appliedDocument.nodes)");
    expect(source).toContain("onClick={() => applySavedShot(shot.id)}");
    expect(source).toContain(': selectedEntities.every((entity) => !effectivelyVisibleLayerIds.has(entity.id))');
  });

  it("batch-renders selected shots and passes without recording temporary scene states in history", () => {
    const handler = exportedFunctionSlice(shotBatchExportSource, "exportSavedShotsAsZip");

    expect(handler.indexOf("if (shotBatchBlockedReason)")).toBeLessThan(
      handler.indexOf("readCurrentCanonicalSceneForShot()"),
    );
    expect(handler).toContain("if (captureInFlightRef.current)");
    expect(handler.match(/await assertRecoveryAccess\(\)/gu)).toHaveLength(8);

    // Runtime code splitting must not leave the editor mutable while the async chunk is loading.
    expectInOrder(handler, [
      "const sharedCharacterAuthorityResult = acquireSharedCharacterCaptureAuthority()",
      "const sharedCharacterAuthorityLease = sharedCharacterAuthorityResult.lease",
      "const controller = new AbortController()",
      "shotBatchAbortRef.current = controller",
      "shotBatchRecoveryScopeRef.current = { controller, scope: recoveryScope }",
      "setIsCapturing(true)",
      "shotBatchRuntime = await loadStudioBg3dShotBatchRuntime(controller.signal)",
      "if (!componentActiveRef.current || controller.signal.aborted)",
    ]);
    expect(source).toContain("const previous = shotBatchRecoveryScopeRef.current?.scope ??");
    expect(source).toContain("shotBatchAbortRef.current?.abort()");
    expect(handler).toContain("if (shotBatchRecoveryScopeRef.current?.controller === controller)");
    const runtimeInitialization = handler.slice(
      handler.indexOf("let shotBatchRecoveryStore:"),
      handler.indexOf("let recoveryAccessRevoked"),
    );
    expect(runtimeInitialization).toContain("try {");
    expect(runtimeInitialization).toContain("createStudioBg3dShotBatchRecoveryStore()");
    expect(runtimeInitialization).toContain("} catch (cause) {");
    expect(runtimeInitialization).toContain("finishShotBatchBeforeSession(");

    // Capture keeps the stable main View alive; the planning adapter/API must therefore be reused
    // instead of waiting for a replacement that would restart linked character generations.
    expectInOrder(handler, [
      "const transitionedViewport = await applyStudioBg3dViewportAfterTransition({",
      "requireReplacement: false",
      "const planningAdapter = await acquireStudioBg3dCaptureAdapterAfterViewTransition({",
      "const sourceSize = await getStudioBg3dCaptureSourceSize(planningAdapter)",
      "const captureSpecs:",
      "const batchPlanResult = await createStudioBg3dShotBatchPlan(shots, {",
      "backend: planningAdapter.backend",
      "engineId: planningAdapter.engineId",
      "engineRevision: planningAdapter.engineVersion",
      "implementationRevision: planningAdapter.implementationRevision",
      "graphicsApi: planningAdapter.graphicsApi",
      "profileId: planningAdapter.profileId",
      "sourceWidth: sourceSize.width",
      "sourceHeight: sourceSize.height",
      "shots: captureSpecs",
      "recoverySession = await shotBatchRecoveryStore.acquire(batchPlan, batchSourceRevision, {",
      "signal: controller.signal",
      "provisionalRecoverySession = recoverySession",
      "await assertRecoveryAccess()",
      "shotBatchRecoveryRef.current = recoverySession",
    ]);
    expect(handler).toContain("selectedShotIds: shotBatchSelectedIds");
    expect(handler).toContain("passes: selectedShotBatchPasses");
    expect(handler).toContain("scope: recoveryScope");
    expect(handler).toContain("deviceProfile: captureQuality.profile");
    expect(handler).toContain("textureScale: captureQuality.textureScale");
    expect(handler).toContain("lodBias: captureQuality.lodBias");
    expect(handler).toContain("ltPipelineId: STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1");
    expect(handler).toContain("pngEncodingId: STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1");
    expect(handler).toContain("psdEncodingId: STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1");
    expect(handler).toContain("contactSheet: shotBatchIncludeContactSheet");
    const acquireIndex = handler.indexOf(
      "recoverySession = await shotBatchRecoveryStore.acquire(batchPlan, batchSourceRevision, {",
    );
    expect(handler.lastIndexOf("await assertRecoveryAccess()", acquireIndex)).toBeGreaterThan(
      handler.indexOf("batchPlan = batchPlanResult.plan"),
    );

    // Every selected shot is fenced by the recovery store and rendered only from frozen Plan values.
    expect(handler).toContain("for (let index = 0; index < batchPlan.shots.length; index += 1)");
    expect(handler).toContain('if (queueItem?.status === "succeeded") continue');
    expect(handler).toContain("waitForStudioBg3dBatchDocumentVisible(document");
    const startShotIndex = handler.indexOf(
      "activeRunToken = await shotBatchRecoveryStore.startShot(recoverySession, shot.shotId)",
    );
    expect(handler.lastIndexOf("await assertRecoveryAccess()", startShotIndex)).toBeGreaterThan(
      handler.indexOf("await waitForStudioBg3dBatchDocumentVisible(document"),
    );
    expectInOrder(handler, [
      "activeRunToken = await shotBatchRecoveryStore.startShot(recoverySession, shot.shotId)",
      "applyStudioBg3dShot(currentDocument, shot.shotId)",
      "freezeStudioBg3dShotAnimationsForBatch(appliedShot)",
      "plannedBackground.color.toLowerCase() !== shot.capture.background.color.toLowerCase()",
      "appliedCaptureQuality.shadows !== shot.capture.shadows",
      "const projectionChanged = renderedProjection !== applied.camera.projection",
      "view: applied.camera",
      "const captureAdapter = await acquireStudioBg3dCaptureAdapterAfterViewTransition({",
      "const sourceSize = await getStudioBg3dCaptureSourceSize(captureAdapter)",
      "const captureOwnerMismatches = [",
      "captureAdapter.backend === batchPlan.captureOwner.backend",
      "captureAdapter.engineId === batchPlan.captureOwner.engineId",
      "captureAdapter.engineVersion === batchPlan.captureOwner.engineRevision",
      "captureAdapter.implementationRevision ===",
      "captureAdapter.graphicsApi === batchPlan.captureOwner.graphicsApi",
      "captureAdapter.profileId === batchPlan.captureOwner.profileId",
      "sourceSize.width === batchPlan.captureOwner.sourceWidth",
      "sourceSize.height === batchPlan.captureOwner.sourceHeight",
      "if (captureOwnerMismatches.length > 0)",
      'verifySharedCharacterCaptureAuthority(\n              sharedCharacterAuthorityLease,\n              "raster"',
      "captured = await captureStudioBg3dRaster(",
      "width: shot.capture.width",
      "height: shot.capture.height",
      "background: shot.capture.background",
      "includeDepth: shot.capture.includeDepth",
      'verifySharedCharacterCaptureAuthority(\n          sharedCharacterAuthorityLease,\n          "receipt"',
      "const shotArtifacts = await buildStudioBg3dShotArtifacts({",
      "captured,",
      "passes: batchPlan.passes",
      "includeLayeredPsd: shotBatchIncludeLayeredPsd",
      "committedArtifactBytes: accumulatedArtifactBytes",
    ]);
    expect(handler).toContain("previousApi: previousViewportApi");
    expect(handler).toContain("requireReplacement: projectionChanged");
    expect(handler).not.toContain("firstShotRequiresViewportReplacement");
    expect(handler).not.toContain("pendingInitialCameraRef.current = isQuadView");
    expect(handler).toContain("signal: controller.signal");
    expect(handler).toContain("timeoutMs: 30_000");
    expect(handler).not.toContain("renderStudioBg3dLtLayersInWorker(");
    expect(handler).not.toContain("encodeStudioBg3dLtCompositeToPngBlob(");
    expect(handler).not.toContain("buildStudioBg3dShotLayeredPsdInWorker(");

    // A shot becomes locally archive-visible only after its validated artifacts commit atomically.
    expectInOrder(handler, [
      "const shotArtifacts = await buildStudioBg3dShotArtifacts({",
      "await shotBatchRecoveryStore.completeShot(recoverySession, activeRunToken, {",
      "images.push(...shotArtifacts.images)",
      "skippedArtifacts.push(...shotArtifacts.skippedArtifacts)",
      "layeredPsds.push(...shotArtifacts.layeredPsds)",
      "psdFallbacks.push(...shotArtifacts.psdFallbacks)",
    ]);
    const completeShotIndex = handler.indexOf(
      "await shotBatchRecoveryStore.completeShot(recoverySession, activeRunToken, {",
    );
    expect(handler.lastIndexOf("await assertRecoveryAccess()", completeShotIndex)).toBeGreaterThan(
      handler.indexOf("if (!activeRunToken)"),
    );
    expectInOrder(handler.slice(completeShotIndex), [
      "psdFallbacks: shotArtifacts.psdFallbacks",
      "signal: controller.signal",
      "authorizeBeforeCommit: async () => {",
      "await assertRecoveryAccess()",
      "const authorizedAt = Date.now()",
      "isLocallyCurrent: () => componentActiveRef.current",
      "images.push(...shotArtifacts.images)",
    ]);
    expect(handler).toContain("if (activeRunToken && !recoveryAccessRevoked)");
    expectInOrder(handler, [
      "if (activeRunToken && !recoveryAccessRevoked)",
      "await shotBatchRecoveryStore.resetInterrupted(recoverySession)",
      "const recoveryRelease = shotBatchRecoveryStore.release(recoverySession)",
    ]);
    expect(handler).toContain("STUDIO_BG3D_SHOT_CONTACT_SHEET_PASS_PRIORITY");
    expect(handler).toContain("await buildStudioBg3dShotContactSheetsInWorker(");
    expect(handler).toContain('contactSheetFallback = "source-unavailable"');

    // The public ZIP manifest deliberately excludes the scoped local recovery key.
    expect(handler).toContain(
      "const archive = await buildStudioBg3dShotBatchArchiveInWorker(images, archiveOptions)",
    );
    expect(handler).not.toContain("buildStudioBg3dShotBatchArchive(images");
    expect(handler).not.toContain("isStudioBg3dShotBatchWorkerUnavailableError");
    expect(handler).not.toContain('cause.code === "timeout"');
    expect(handler).not.toContain('cause.code === "worker-failed"');
    expect(handler).not.toContain('cause.code === "archive-invalid"');
    expect(handler).toContain("publicRenderPlan: await projectStudioBg3dShotBatchPlanForPublicArchive(batchPlan");
    expect(handler).toContain("appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1");
    expect(handler).toContain("sourceRevision: batchSourceRevision");
    expect(handler).not.toContain("requestedPasses: batchPlan.passes");
    expect(handler).not.toContain("layeredPsdRequested:");
    expect(handler).not.toContain("contactSheetRequested:");
    expect(handler).not.toContain("resumeKey:");
    expect(handler).not.toContain("isStudioBg3dShotBatchQueueCompatible(");
    expect(handler).not.toContain("retryStudioBg3dShotBatchQueue(");
    expect(handler).not.toContain("succeedStudioBg3dShotBatchQueueItem(");
    expectInOrder(handler, [
      "await commitStudioBg3dShotBatchDownload({",
      "signal: controller.signal",
      "isActive: () => componentActiveRef.current",
      "assertAccess: assertRecoveryAccess",
      "markDownloadRequested: () =>",
      "shotBatchRecoveryStore.markDownloadRequested(recoverySession)",
      "download: () => anchor.click()",
    ]);

    expect(handler).not.toContain("commitImmediateHistoryTransition");
    expect(handler).toContain("const originalSceneBaseDocument = sceneBaseDocument");
    expect(handler).toContain("const originalLiveView = originalViewportApi?.readView()");
    const outerFinally = handler.lastIndexOf("} finally {");
    expect(outerFinally).toBeGreaterThanOrEqual(0);
    expectInOrder(handler.slice(outerFinally), [
      "setSceneBaseDocument(originalSceneBaseDocument)",
      "view: originalLiveView",
      "const recoveryRelease = shotBatchRecoveryStore.release(recoverySession)",
      "await Promise.race([",
      "shotBatchRecoveryRef.current = null",
      "shotBatchRecoveryScopeRef.current = null",
      "setIsCapturing(false)",
    ]);
    expect(handler).toContain(
      "pendingInitialCameraRef.current = restoreFailed ? originalLiveView : null",
    );
    expect(source).toContain("if (isRestoringScene || isBatchRenderingShots) return;");
    expect(source).toContain("onClick={() => shotBatchAbortRef.current?.abort()}");
    expect(source).toContain("setShotBatchExcludedIds");
    expect(source).toContain("STUDIO_BG3D_SHOT_BATCH_PASS_LABELS[pass]");
    expect(source).toContain("shotBatchBlockedReason !== null ||");
    expect(source).toContain("불러오기에 실패한 3D 모델이 있어 컷 배치 출력을 막았습니다.");
    expect(source).toContain("3D 모델 렌더 복제본을 준비하는 중입니다.");
    expect(source).toContain("3D 장면 복원 오류를 해결하기 전에는");
  });

  it("reapplies the complete camera only after a replacement viewport becomes ready", () => {
    const transitionStart = cameraApplicationSource.indexOf(
      "export async function applyStudioBg3dViewportAfterTransition(",
    );
    expect(transitionStart).toBeGreaterThanOrEqual(0);
    const transition = cameraApplicationSource.slice(transitionStart);

    expect(transition).toContain("input.requireReplacement && api === input.previousApi");
    expect(transition.indexOf("await waitForStudioBg3dCapturePhase(input.waitForPaintFrame()")).toBeLessThan(
      transition.indexOf("api.applyView(input.view)"),
    );
    expect(transition.lastIndexOf("await waitForStudioBg3dCapturePhase(input.waitForPaintFrame()")).toBeGreaterThan(
      transition.indexOf("api.applyView(input.view)"),
    );
    expect(source).toContain("onReady={handleViewportReady}");
    expect(source).toContain("if (api && pendingView)");
    expect(source).toContain(
      "applyOrDeferStudioBg3dHistoryCamera(api, pendingInitialCameraRef, pendingView)",
    );
    expect(cameraApplicationSource).not.toContain("camera.copy(projection, false)");
  });
});