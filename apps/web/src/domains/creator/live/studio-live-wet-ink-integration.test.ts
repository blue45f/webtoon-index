import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioCuttoonEditorSource();
const viewportSource = readFileSync(
  new URL("../canvas/StudioCanvasViewport.tsx", import.meta.url),
  "utf8",
);
const viewportDomOverlaysSource = readFileSync(
  new URL("../canvas/StudioCanvasViewportDomOverlays.tsx", import.meta.url),
  "utf8",
);
const viewportTypesSource = readFileSync(
  new URL("../canvas/StudioCanvasViewportTypes.ts", import.meta.url),
  "utf8",
);
const hostSource = readFileSync(
  new URL("./StudioLiveInkHosts.tsx", import.meta.url),
  "utf8",
);
const lazyUiSource = readFileSync(
  new URL("../studio-page-lazy-ui.ts", import.meta.url),
  "utf8",
);
const overlaySource = readFileSync(
  new URL("./studio-live-wet-ink-overlay.ts", import.meta.url),
  "utf8",
);

describe("live wet-ink product boundary", () => {
  it("mounts independent active/settled native surfaces through the lazy viewport host", () => {
    expect(hostSource).toContain("StudioLiveWetInkOverlayHost");
    expect(hostSource).toContain('data-studio-live-wet-ink-active="true"');
    expect(hostSource).toContain('data-studio-live-wet-ink-settled="true"');
    expect(lazyUiSource).toContain("mod.StudioLiveWetInkOverlayHost");
    expect(viewportTypesSource).toContain(
      "liveWetInkOverlayRenderer: StudioLiveWetInkOverlayRenderer",
    );
    expect(viewportSource).toContain("<StudioCanvasViewportStageHost");
    expect(viewportDomOverlaysSource).toContain(
      "<StudioLiveWetInkOverlayHost",
    );
  });

  it("owns begin/append/end and every destructive pointer/page lifecycle explicitly", () => {
    expect(studioPageSource).toContain(
      "liveWetInkOverlayRendererRef.current.begin(next",
    );
    expect(studioPageSource).toContain(
      "renderer.appendFrom(next,",
    );
    expect(studioPageSource).toContain(
      "liveWetInkOverlayRendererRef.current.end(finished",
    );
    expect(studioPageSource).toContain(
      "liveWetInkOverlayRendererRef.current.resetActive()",
    );
    expect(studioPageSource).toContain(
      "liveWetInkOverlayRendererRef.current.clear()",
    );
    expect(studioPageSource).toContain(
      "pageEpoch: currentPageId",
    );
  });

  it("uses the committed wet-ink runtime as its exact pointer-up handoff authority", () => {
    expect(overlaySource).toContain("planStudioWetInkBrushReplay");
    expect(overlaySource).toContain('phase: "live"');
    expect(overlaySource).toContain("fieldDigest: exact.value.fieldDigest");
    expect(overlaySource).toContain("revision: exact.value.revision");
    expect(overlaySource).toContain("seed: exact.value.seed");
    expect(overlaySource).toContain("consumeStudioWetInkDirtyBounds");
    expect(overlaySource).not.toContain('status: "fallback"');
  });

  it("uses a causal tiled Beer-Lambert InkWash preview without running Stam", () => {
    const suffixStart = overlaySource.indexOf("private paintInkwashSuffix(");
    const suffixEnd = overlaySource.indexOf("private paintInkwashLivePolyline(");
    expect(suffixStart).toBeGreaterThan(0);
    expect(suffixEnd).toBeGreaterThan(suffixStart);
    const suffix = overlaySource.slice(suffixStart, suffixEnd);
    expect(suffix).toContain("paintInkwashPreviewSamples");
    expect(suffix).toContain("planStudioInkwashFluidPreviewStamps");
    expect(suffix).toContain("resolveStudioInkwashFluidDisplay");
    expect(suffix).toContain("INKWASH_PREVIEW_TILE_SIZE");
    expect(suffix).not.toContain("growInkwashWash");
    expect(suffix).not.toContain("depositStudioInkwashFluidStroke");
    expect(suffix).not.toContain("stepStudioInkwashFluid");
    expect(suffix).not.toContain("markStudioInkwashWashDeposited");
    expect(overlaySource).toContain("private settleInkwashStroke(");
  });

  it("requires wet-ink seal before commit and never settles a rejected/unavailable operation", () => {
    const beginStart = studioPageSource.indexOf("const wetInkOverlayStarted =");
    const beginEnd = studioPageSource.indexOf("const retainedMediaDirect =", beginStart);
    const begin = studioPageSource.slice(beginStart, beginEnd);
    expect(begin).toContain("if (wetMediaSelected && !wetInkOverlayStarted)");
    expect(begin).toContain('return rejectSelectedSurface("습식 매체"');

    const finishStart = studioPageSource.indexOf("function finishDrawingPointer(");
    const finishEnd = studioPageSource.indexOf("function onStagePointerCancel", finishStart);
    const finish = studioPageSource.slice(finishStart, finishEnd);
    const seal = finish.indexOf("liveWetInkOverlayRendererRef.current.end(finished");
    const sealGuard = finish.indexOf(
      'selectedOverlaySeal.result.status !== "settled"',
      seal,
    );
    const discard = finish.indexOf("discardDrawingPointerSession();", sealGuard);
    const deferredCommit = finish.indexOf("queueDeferredStrokeCommit(finished)", seal);
    const immediateCommit = finish.indexOf("commit([...baseElements, finished])", seal);

    expect(seal).toBeGreaterThan(0);
    expect(sealGuard).toBeGreaterThan(seal);
    expect(discard).toBeGreaterThan(sealGuard);
    expect(deferredCommit).toBeGreaterThan(discard);
    expect(immediateCommit).toBeGreaterThan(discard);
    expect(finish.slice(sealGuard, deferredCommit)).toContain("return;");

    const clearStart = studioPageSource.indexOf("const clearDraftPreview =");
    const clearEnd = studioPageSource.indexOf(
      "const DEFERRED_STROKE_COMMIT_IDLE_MS",
      clearStart,
    );
    const clear = studioPageSource.slice(clearStart, clearEnd);
    const wetStart = clear.indexOf("if (wasWetInkDirect)");
    const wet = clear.slice(wetStart, clear.indexOf("if (gpuLiveInkPinnedRef.current)", wetStart));
    const settle = clear.indexOf(
      "draftPreviewStoreRef.current.settle(finalWetInkStroke)",
      wetStart,
    );
    const flushReceipt = clear.lastIndexOf("flushSync(() => {", settle);
    const release = clear.indexOf("renderer.releaseSettledPrefix(1)", settle);

    expect(wet).toContain("!renderer.isActive && renderer.hasSettledStrokes");
    expect(wet).not.toContain("renderer.end(finalWetInkStroke");
    expect(flushReceipt).toBeGreaterThan(wetStart);
    expect(settle).toBeGreaterThan(flushReceipt);
    expect(release).toBeGreaterThan(settle);
    expect(clear.slice(settle, release)).not.toContain(
      "draftPreviewNormalLayerRef.current?.drawScene()",
    );
  });

  it("fails closed without committing a vector when a canonical Living Ink frame is blank", () => {
    const rejection = studioPageSource.slice(
      studioPageSource.indexOf("function rejectStudioLivingInkFailedStroke"),
      studioPageSource.indexOf("async function finishStudioLivingInkStroke"),
    );
    const finish = studioPageSource.slice(
      studioPageSource.indexOf("async function finishStudioLivingInkStroke"),
      studioPageSource.indexOf("async function finishStudioHokusaiLiveStroke"),
    );
    expect(finish).toContain("studioLivingInkCoverageIntersectsStroke({");
    expect(finish).not.toContain("원본 벡터를 유지합니다");
    expect(rejection).toContain("다른 렌더러로 자동 전환하지 않습니다");
    expect(rejection).not.toContain("commit(");
    expect(rejection).not.toContain("draftPreviewStoreRef.current.settle");
    expect(rejection).not.toContain("restorePendingStrokeCommits");
  });

  it("fails closed when Hokusai finalization fails instead of publishing its vector shadow", () => {
    const rejection = studioPageSource.slice(
      studioPageSource.indexOf("function rejectStudioHokusaiFailedStroke"),
      studioPageSource.indexOf("function completeStudioLivingInkRejectedNoop"),
    );
    const finishRouting = studioPageSource.slice(
      studioPageSource.indexOf("function finishStudioSpecialistStroke"),
      studioPageSource.indexOf("api.releaseEndpointPointerSample"),
    );
    expect(rejection).toContain("다른 렌더러로 자동 전환하지 않습니다");
    expect(rejection).not.toContain("commit(");
    expect(rejection).not.toContain("draftPreviewStoreRef.current.settle");
    expect(rejection).not.toContain("restorePendingStrokeCommits");
    expect(finishRouting).toContain("rejectStudioHokusaiFailedStroke(");
    expect(finishRouting).toContain('return "handled";');
  });

  it("does not restore a Konva shadow for a fast Living Ink contact", () => {
    const finish = studioPageSource.slice(
      studioPageSource.indexOf("function finishDrawingPointer"),
      studioPageSource.indexOf("function onStagePointerCancel"),
    );
    const clear = finish.indexOf(
      "clearDraftPreview({ preserveInkForDeferredCommit: deferInkCleanup })",
    );
    expect(clear).toBeGreaterThan(0);
    expect(finish.slice(clear)).toContain("canvas\n      // intentionally remains hidden");
    expect(finish.slice(clear)).not.toContain("showStudioLivingInkVectorShadow(");
    expect(finish.slice(clear)).not.toContain("showStudioHokusaiVectorShadow(");
  });
});
