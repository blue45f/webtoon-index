import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const PAGE_SOURCE = readStudioCuttoonEditorSource();
const HOKUSAI_HELPER_SOURCE = readFileSync(
  new URL("../studio-legacy-editor-runtime-helpers.ts", import.meta.url),
  "utf8",
);
const VIEWPORT_SOURCE = readStudioCanvasViewportStack(import.meta.url, "../canvas/");
const IMAGE_NODE_SOURCE = readFileSync(
  new URL("../StudioKonvaImageNode.tsx", import.meta.url),
  "utf8",
);

function sourceSection(
  source: string,
  start: string,
  end: string,
): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Missing source boundary: ${start} -> ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

describe("Studio Hokusai live UI authority wiring", () => {
  it("keeps Hokusai live behind the failed full-size promotion gate", () => {
    const admission = sourceSection(
      HOKUSAI_HELPER_SOURCE,
      "export function studioHokusaiProductLivePreset(",
      "export function studioHokusaiColor(",
    );
    expect(admission).toContain("resolveStudioHokusaiProductLiveAdmission({ brushId, catalogId })");
    expect(admission).not.toContain("explicitExperimentalOptIn: true");
    expect(PAGE_SOURCE).not.toContain("STUDIO_HOKUSAI_AUTOMATIC_PRESETS");
    expect(PAGE_SOURCE).not.toContain("studioHokusaiAutomaticPreset(");

    const begin = sourceSection(
      PAGE_SOURCE,
      "function beginStudioHokusaiLiveStroke(",
      "const [livingInkState, setLivingInkState]",
    );
    expect(begin).toContain(
      "!studioHokusaiLiveStrokeSelected(element)",
    );
    expect(begin).toContain(
      "if (!studioHokusaiProductLivePreset(brush, activeCatalogBrush.id)) return;",
    );
    expect(begin).toContain('if (route.status !== "ready") return false;');
    expect(begin).not.toContain("existing-exact-route");
  });

  it("releases the live overlay only after the exact decoded canonical PNG is drawn", () => {
    const imageReceipt = sourceSection(
      IMAGE_NODE_SOURCE,
      "const hokusaiPngHash = el.hokusaiLiveReceipt?.canonical.pngHash;",
      "const livingInkPngHash = el.livingInkReceipt?.canonicalPngSha256;",
    );
    expect(imageReceipt.indexOf("layer.drawScene();")).toBeGreaterThan(0);
    expect(imageReceipt.indexOf("onHokusaiCanonicalImageReady(el.id, hokusaiPngHash);"))
      .toBeGreaterThan(imageReceipt.indexOf("layer.drawScene();"));

    const pageReceipt = sourceSection(
      PAGE_SOURCE,
      "function onHokusaiCanonicalImageReady(",
      "function discardStudioHokusaiLiveStroke(",
    );
    expect(pageReceipt).toContain("!state.transactionCommitted");
    expect(pageReceipt).toContain("state.canonicalImageId !== elementId");
    expect(pageReceipt).toContain("state.canonicalPngHash !== pngHash");
    expect(pageReceipt).toContain("releaseStudioHokusaiLivePresentation(state);");

    const finish = sourceSection(
      PAGE_SOURCE,
      "async function finishStudioHokusaiLiveStroke(",
      "function finishDrawingPointer(",
    );
    expect(finish).toContain("state.transactionCommitted = true;");
    expect(finish).not.toContain("globalThis.requestAnimationFrame(");
    expect(PAGE_SOURCE).not.toContain("settleStudioHokusaiOverlayAfterCommit");
  });

  it("fails closed on surface replacement without painting an old-page vector shadow", () => {
    const surface = sourceSection(
      PAGE_SOURCE,
      "function setHokusaiLiveOverlaySurface(",
      "function appendStudioHokusaiAuthoritativeSuffix(",
    );
    expect(surface).toContain("if (active.transactionCommitted)");
    expect(surface).toContain("releaseStudioHokusaiLivePresentation(active);");
    expect(surface).toContain("failStudioHokusaiLiveStroke(");
    expect(PAGE_SOURCE).not.toContain("function showStudioHokusaiVectorShadow(");
    expect(PAGE_SOURCE).not.toContain("showStudioHokusaiVectorShadow(");
  });

  it("keeps retained geometry hidden until an exact Hokusai material frame owns presentation", () => {
    const shadowLifecycle = sourceSection(
      PAGE_SOURCE,
      "function clearStudioHokusaiRetainedDraftPixels(",
      "function failStudioHokusaiLiveStroke(",
    );
    expect(shadowLifecycle).toContain(
      "if (liveDraftVisualRef.current?.id === state.strokeId)",
    );
    expect(shadowLifecycle).toContain("liveDraftVisualRef.current = null;");
    expect(shadowLifecycle).toContain("liveDraftPendingRef.current = null;");
    expect(shadowLifecycle).toContain("liveDraftDirectRef.current = false;");
    expect(shadowLifecycle).toContain(
      "draftPreviewStoreRef.current.getSnapshot().active?.id === state.strokeId",
    );
    expect(shadowLifecycle).toContain("draftPreviewStoreRef.current.setActive(null);");
    expect(shadowLifecycle).toContain("liveDraftLayerRef.current?.drawScene();");

    const firstFrame = sourceSection(
      PAGE_SOURCE,
      "if (!state.overlayPresented) {",
      "      },\n    });",
    );
    expect(firstFrame.indexOf("hokusaiLiveOverlayVisibleRef.current = true;"))
      .toBeLessThan(firstFrame.indexOf("clearStudioHokusaiRetainedDraftPixels(state);"));

    const releaseCleanup = sourceSection(
      PAGE_SOURCE,
      "clearDraftPreview({ preserveInkForDeferredCommit: deferInkCleanup });",
      "// Re-rasterize the newest settled overlay stroke",
    );
    expect(releaseCleanup).toContain("canvas\n      // intentionally remains hidden");
    expect(releaseCleanup).not.toContain("showStudioHokusaiVectorShadow(");
    expect(releaseCleanup).not.toContain("refreshStudioHokusaiVectorTailShadow(");

    const directDraft = sourceSection(
      VIEWPORT_SOURCE,
      "const el = liveDraftVisualRef.current;",
      "drawLiveFreehandDraftToContext(",
    );
    expect(directDraft).not.toContain("hokusaiLiveOverlayVisibleRef.current");

    const scheduleDraft = sourceSection(
      PAGE_SOURCE,
      "const scheduleDraft = (next: DrawEl | null) => {",
      "const clearDraftPreview =",
    );
    expect(scheduleDraft).toContain("const hokusaiStroke = hokusaiLiveStrokeRef.current;");
    expect(scheduleDraft).toContain("hokusaiStroke.strokeId === next.id");
    expect(scheduleDraft.indexOf("hokusaiStroke.strokeId === next.id"))
      .toBeLessThan(scheduleDraft.indexOf("pendingDraftRef.current = next;"));
    expect(scheduleDraft).toContain("liveDraftPendingRef.current = next;");

    const directFlush = sourceSection(
      PAGE_SOURCE,
      "const flushDirectLiveDraft = () => {",
      "const flushDirectLiveDraftNow =",
    );
    expect(directFlush).toContain("hokusaiStroke.strokeId === next.id");
    expect(directFlush).toContain("liveDraftVisualRef.current = null;");
    expect(directFlush).not.toContain("refreshStudioHokusaiVectorTailShadow(");
    expect(PAGE_SOURCE).not.toContain("function studioHokusaiVectorTailShadow(");
    expect(PAGE_SOURCE).not.toContain("function showStudioHokusaiVectorShadow(");

    const specialistRelease = sourceSection(
      PAGE_SOURCE,
      "function finishStudioSpecialistStroke(",
      "function finishDrawingPointer(",
    );
    expect(specialistRelease).not.toContain("materialPresentationCaughtUp");
    expect(specialistRelease).toContain("void finishStudioHokusaiLiveStroke(hokusaiStroke, finished);");
    expect(specialistRelease).toContain("session.finish()");
  });

  it("keeps explicitly admitted canonical materialization in drawing chrome", () => {
    const finish = sourceSection(
      PAGE_SOURCE,
      "async function finishStudioHokusaiLiveStroke(",
      "function finishDrawingPointer(",
    );
    expect(finish).toContain("setSelectedId(null);");
    expect(finish).not.toContain("setSelectedId(transaction.transaction.selectionId);");
  });

  it("keeps prediction samples out of Hokusai and makes cancel/unmount fail closed", () => {
    const publish = sourceSection(
      PAGE_SOURCE,
      "function publishAuthoritativeFreehandSuffix(",
      "drawingFixedRatePumpFrameRef.current =",
    );
    expect(publish).toContain(
      "appendStudioHokusaiAuthoritativeSuffix(authoritativeDrawing, startSample);",
    );

    const predicted = sourceSection(
      PAGE_SOURCE,
      "drawingPredictionPreviewRef.current = true;",
      "drawingPredictionPreviewRef.current = false;",
    );
    expect(predicted).not.toContain("appendStudioHokusaiAuthoritativeSuffix");

    const finish = sourceSection(
      PAGE_SOURCE,
      "async function finishStudioHokusaiLiveStroke(",
      "function finishDrawingPointer(",
    );
    expect(finish).toContain(
      "state.abortController.signal.aborted && hokusaiLiveStrokeRef.current !== state",
    );
    expect(PAGE_SOURCE).toContain("discardStudioHokusaiLiveStroke(discardedId);");
    expect(PAGE_SOURCE).toContain("if (hasActiveDrawingPointerSession()) discardDrawingPointerSession();");
  });

  it("owns a DPR-correct overlay surface and wires its canonical receipt through the viewport", () => {
    expect(VIEWPORT_SOURCE).toContain("data-studio-hokusai-live-overlay");
    expect(VIEWPORT_SOURCE).toContain("Math.min(4, globalThis.devicePixelRatio || 1)");
    expect(VIEWPORT_SOURCE).toContain(
      "onHokusaiCanonicalImageReady={onHokusaiCanonicalImageReady}",
    );
    expect(PAGE_SOURCE).toContain("const hokusaiLiveOverlayVisibleRef = useRef(false);");
  });
});
