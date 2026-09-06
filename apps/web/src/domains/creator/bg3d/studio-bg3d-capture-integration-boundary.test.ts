import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";


import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const background3dSource = readStudioBg3dEditorSource();
const actionFooterSource = readFileSync(
  new URL("./StudioBg3dActionFooter.tsx", import.meta.url),
  "utf8",
);
const studioPageSource = readStudioPageCompositionSource();
const studioLazyPanelStackSource = readFileSync(
  new URL("../StudioThreeDPreviewPanelStack.tsx", import.meta.url),
  "utf8"
);

describe("Studio 3D asynchronous capture integration boundary", () => {
  it("keeps adapter registration stable when capture UI state rerenders", () => {
    const start = background3dSource.indexOf("function CaptureBridge(");
    const end = background3dSource.indexOf("type StudioBg3dImmersiveStageSuccess", start);
    const bridge = background3dSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(bridge).toContain("useEffectEvent(onCaptureUpdate)");
    expect(bridge).toContain("}, [camera, gl, scene]);");
    expect(bridge).not.toContain("[camera, gl, scene, onCaptureUpdate]");
  });

  it("keeps the stable main adapter and fences every raster with exact character authority", () => {
    const saveStart = background3dSource.indexOf("async function handleSaveToLibrary()");
    const aiReferenceStart = background3dSource.indexOf(
      "async function handleUseAsAiMethodReference()",
      saveStart,
    );
    const insertStart = background3dSource.indexOf("async function handleInsert()");
    const handleEnd = background3dSource.indexOf("// 선택된 것이 도형", insertStart);
    const handlers = [
      background3dSource.slice(saveStart, aiReferenceStart),
      background3dSource.slice(aiReferenceStart, insertStart),
      background3dSource.slice(insertStart, handleEnd),
    ];
    const staleGuard = "captureRef.current.adapter !== captureAdapter";

    expect(saveStart).toBeGreaterThanOrEqual(0);
    expect(aiReferenceStart).toBeGreaterThan(saveStart);
    expect(insertStart).toBeGreaterThan(aiReferenceStart);
    expect(handleEnd).toBeGreaterThan(insertStart);
    for (const handler of handlers) {
      const authorityAcquire = handler.indexOf(
        "acquireSharedCharacterCaptureAuthority()",
      );
      const transitionStart = handler.indexOf("setIsCapturing(true)");
      const adapterAcquire = handler.indexOf(
        "await acquireStudioBg3dCaptureAdapterAfterViewTransition"
      );
      const rasterAuthority = handler.indexOf(
        'verifySharedCharacterCaptureAuthority(\n        sharedCharacterAuthorityLease,\n        "raster"',
      );
      const rasterCapture = handler.indexOf("await captureStudioBg3dRaster(captureAdapter");
      const receiptAuthority = handler.indexOf(
        'verifySharedCharacterCaptureAuthority(\n        sharedCharacterAuthorityLease,\n        "receipt"',
      );
      expect(authorityAcquire).toBeGreaterThanOrEqual(0);
      expect(transitionStart).toBeGreaterThanOrEqual(0);
      expect(transitionStart).toBeGreaterThan(authorityAcquire);
      expect(adapterAcquire).toBeGreaterThan(transitionStart);
      expect(rasterAuthority).toBeGreaterThan(adapterAcquire);
      expect(rasterCapture).toBeGreaterThan(adapterAcquire);
      expect(rasterCapture).toBeGreaterThan(rasterAuthority);
      expect(receiptAuthority).toBeGreaterThan(rasterCapture);
      expect(handler.split(staleGuard)).toHaveLength(2);
    }
  });

  it("pins one background snapshot and rejects capture re-entry until cleanup", () => {
    const handleStart = background3dSource.indexOf("async function handleInsert()");
    const handleEnd = background3dSource.indexOf("// 선택된 것이 도형", handleStart);
    const handleInsert = background3dSource.slice(handleStart, handleEnd);

    expect(handleInsert).toContain("captureInFlightRef.current || isCapturing");
    expect(handleInsert).toContain("createStudioBg3dCaptureBackgroundSnapshot");
    expect(handleInsert).toContain("setCaptureBackgroundSnapshot(backgroundSnapshot)");
    expect(handleInsert).toContain(
      "background: studioBg3dCaptureBackgroundRequestFromSnapshot(backgroundSnapshot)",
    );
    expect(handleInsert).toContain("captureInFlightRef.current = false");
    expect(background3dSource).toContain("inert={isCapturing}");
    expect(background3dSource).toContain("aria-busy={isCapturing || undefined}");
    expect(background3dSource).toContain(
      "captureBackgroundSnapshot?.skyPresetId ?? skyPresetId"
    );
    expect(background3dSource).toContain(
      "captureBackgroundSnapshot?.panoramaRotation ?? panoramaRotation"
    );
  });

  it("blocks every user close control while a capture transaction owns the renderer", () => {
    const closeGuardStart = background3dSource.indexOf("function requestUserClose()");
    const closeGuardEnd = background3dSource.indexOf(
      "async function handleSaveToLibrary()",
      closeGuardStart
    );
    const closeGuard = background3dSource.slice(closeGuardStart, closeGuardEnd);

    expect(closeGuardStart).toBeGreaterThanOrEqual(0);
    expect(closeGuardEnd).toBeGreaterThan(closeGuardStart);
    expect(closeGuard).toContain("if (captureInFlightRef.current) return;");
    expect(closeGuard).toContain("onClose();");
    expect(background3dSource.match(/disabled=\{isCapturing\}[\s\S]{0,120}onClick=\{requestUserClose\}/gu))
      .toHaveLength(1);
    expect(actionFooterSource).toMatch(
      /disabled=\{isCapturing\}[\s\S]{0,120}onClick=\{onClose\}/u,
    );
  });

  it("keeps document settings in the same debounced scene undo timeline", () => {
    const historyStart = background3dSource.indexOf("// 편집이 멈추면(디바운스)");
    const historyEnd = background3dSource.indexOf("const addPrimitive", historyStart);
    const history = background3dSource.slice(historyStart, historyEnd);

    expect(history).toContain("document: sceneBaseDocument");
    expect(history).toContain(
      "[customModels, isBatchRenderingShots, isRestoringScene, primitives, sceneBaseDocument]"
    );
    expect(history).toContain("if (isRestoringScene || isBatchRenderingShots) return;");
    expect(history.match(/setSceneBaseDocument\(snap\.document\)/gu)).toHaveLength(2);
    expect(history).toContain("studioBg3dHistoryDocumentAtView(previousLast.document, liveView)");
    expect(history).toContain("const commandChangesCamera");
    expect(history).not.toContain("setLineArtPreview(snap.document.output.line.enabled)");
    expect(background3dSource).not.toContain("setSkyPresetId");
    expect(background3dSource).not.toContain("setTransparentInsert");
  });

  it("returns insertion rejection so stale, locked, or failed plans keep the modal open", () => {
    const modalStart = studioLazyPanelStackSource.indexOf("<StudioBackground3D");
    const modalEnd = studioLazyPanelStackSource.indexOf("</Suspense>", modalStart);
    const modal = studioLazyPanelStackSource.slice(modalStart, modalEnd);

    expect(modalStart).toBeGreaterThanOrEqual(0);
    expect(modalEnd).toBeGreaterThan(modalStart);
    expect(studioPageSource).toContain("insertBg3dResult: (result) => {");
    expect(studioPageSource).toContain("return applyStudioBg3dInsertResult({");
    expect(modal).toContain("onInsert={insertBg3dResult}");

    const handleStart = background3dSource.indexOf("async function handleInsert()");
    const handleEnd = background3dSource.indexOf("// 선택된 것이 도형", handleStart);
    const handleInsert = background3dSource.slice(handleStart, handleEnd);
    expect(handleInsert).toContain("if (accepted === false)");
    expect(handleInsert).toContain("편집 문서가 변경되었거나 현재 페이지에 삽입할 수 없습니다.");
  });
});
