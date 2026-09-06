import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { resolveStudioWebGpuCanvasStrokes } from "./render/studio-webgpu-canvas-authority";
import { isStudioWebGpuCanvasActive } from "./render/studio-webgpu-dab-planner";
import { StudioWebGpuCanvas } from "./StudioWebGpuCanvas";

const supportedStroke = {
  id: "preview-stroke",
  points: [10, 10, 40, 40],
  color: "#7c5cff",
  size: 8,
} as const;

const webGpuCanvasSource = readFileSync(
  new URL("./StudioWebGpuCanvas.tsx", import.meta.url),
  "utf8",
);

describe("StudioWebGpuCanvas", () => {
  it("keeps pinned strokes authoritative across parent renders until the pin is released", () => {
    const initialDeclarative = [supportedStroke] as const;
    const pinned = [{
      ...supportedStroke,
      id: "pinned-live-stroke",
      points: [10, 10, 80, 90],
    }] as const;

    expect(resolveStudioWebGpuCanvasStrokes(initialDeclarative, pinned)).toBe(pinned);

    // StudioPage normally re-renders this child with a shared declarative EMPTY list while the
    // imperative live-ink feed is pinned. That render must not suspend or replace the pinned feed.
    const declarativeAfterParentRender = [] as const;
    expect(resolveStudioWebGpuCanvasStrokes(declarativeAfterParentRender, pinned)).toBe(pinned);

    // Releasing authority restores the newest declarative value, not the value from pin start.
    expect(resolveStudioWebGpuCanvasStrokes(declarativeAfterParentRender, null))
      .toBe(declarativeAfterParentRender);
  });

  it("treats an empty pinned feed as an authoritative clear rather than a released pin", () => {
    const declarative = [supportedStroke] as const;
    const pinnedClear = [] as const;

    expect(resolveStudioWebGpuCanvasStrokes(declarative, pinnedClear)).toBe(pinnedClear);
    expect(resolveStudioWebGpuCanvasStrokes(declarative, null)).toBe(declarative);
  });

  it("renders transparent WebGPU and Canvas2D surfaces without an unsupported warning overlay", () => {
    const html = renderToStaticMarkup(
      <StudioWebGpuCanvas
        width={800}
        height={1_200}
        strokes={[supportedStroke]}
      />
    );

    expect(html).toContain('data-studio-gpu-compositor="true"');
    expect(html).toContain('data-studio-gpu-active="true"');
    expect(html).toContain('data-studio-gpu-readback="disabled"');
    expect(html).toContain('data-studio-gpu-frame-authorized="false"');
    expect(html).toContain("invisible");
    expect(html).toContain("opacity-0");
    expect(html).toContain('data-studio-gpu-surface="webgpu"');
    expect(html).toContain('data-studio-gpu-surface="canvas2d"');
    expect(html).not.toContain("WebGPU 미지원");
    expect(html).not.toContain("Fallback");
  });

  it("shows the compositor only when the parent authorizes the matching frame receipt", () => {
    const html = renderToStaticMarkup(
      <StudioWebGpuCanvas
        width={800}
        height={1_200}
        strokes={[supportedStroke]}
        frameAuthorized
      />
    );

    expect(html).toContain('data-studio-gpu-frame-authorized="true"');
    expect(html).not.toContain("invisible");
    expect(html).not.toContain("opacity-0");
  });

  it("renders a bounded viewport surface instead of a full-height document surface", () => {
    const html = renderToStaticMarkup(
      <StudioWebGpuCanvas
        width={800}
        height={12_000}
        surfaceBounds={{ left: 120, top: 4_800, width: 640, height: 720 }}
        scaleX={1.875}
        scaleY={25}
        offsetX={-150}
        offsetY={-80_000}
        strokes={[supportedStroke]}
        frameAuthorized
      />
    );

    expect(html).toContain('data-studio-gpu-surface-width="640"');
    expect(html).toContain('data-studio-gpu-surface-height="720"');
    expect(html).toContain("left:120px");
    expect(html).toContain("top:4800px");
    expect(html).toContain("width:640px");
    expect(html).toContain("height:720px");
    expect(html).not.toContain("height:12000px");
    expect(html).toContain('class="overflow-hidden absolute"');
  });

  it("keeps empty and unsupported operation sets inactive", () => {
    expect(isStudioWebGpuCanvasActive([])).toBe(false);
    expect(isStudioWebGpuCanvasActive([supportedStroke])).toBe(true);
    expect(isStudioWebGpuCanvasActive([{
      ...supportedStroke,
      points: [10, 10, Number.NaN, 40],
    }])).toBe(false);

    const emptyHtml = renderToStaticMarkup(
      <StudioWebGpuCanvas width={800} height={1_200} frameAuthorized />
    );
    expect(emptyHtml).toContain('data-studio-gpu-active="false"');
    expect(emptyHtml).toContain("invisible");
    expect(emptyHtml).toContain("opacity-0");
  });

  it("exposes allocation/reuse metrics imperatively without adding render subscriptions", () => {
    expect(webGpuCanvasSource).toContain(
      "readonly getPerformanceMetrics: () => StudioGpuPerformanceMetrics",
    );
    expect(webGpuCanvasSource).toContain(
      "engineRef.current?.getPerformanceMetrics() ?? EMPTY_PERFORMANCE_METRICS",
    );
    expect(webGpuCanvasSource).not.toContain("setPerformanceMetrics");
    expect(webGpuCanvasSource).toContain(
      "readonly isBackendAvailable: () => boolean",
    );
    expect(webGpuCanvasSource).toContain(
      "engineRef.current?.isBackendAvailable() ?? false",
    );
  });

  it("exposes one atomic suffix-batch command for live symmetry groups", () => {
    expect(webGpuCanvasSource).toContain(
      "readonly appendPinnedStrokeSuffixBatch: (patch: StudioGpuStrokeSuffixBatchPatch) => void",
    );
    expect(webGpuCanvasSource).toContain(
      'queuePinnedRequest(patch.fallbackStrokes, { mode: "append-batch", patch })',
    );
    expect(webGpuCanvasSource).toContain(
      "engine.appendStrokeFeedSuffixBatch(command.patch, requestId)",
    );
  });

  it("exposes suffix-only journal commands without retaining a full replacement frame", () => {
    expect(webGpuCanvasSource).toContain(
      ") => StudioWebGpuJournalFeedOutcome",
    );
    expect(webGpuCanvasSource).toContain(
      "export interface StudioWebGpuJournalFeedOutcome",
    );
    expect(webGpuCanvasSource).toContain(
      "patch: StudioGpuStrokeJournalSuffixBatchPatch",
    );
    expect(webGpuCanvasSource).toContain(
      'queuePinnedJournalRequest({ mode: "journal-append", patch })',
    );
    expect(webGpuCanvasSource).toContain(
      'queuePinnedJournalRequest({ mode: "journal-append-batch", patch })',
    );
    expect(webGpuCanvasSource).toContain(
      "engine.replaceStrokeFeedJournalBaseline(latest.strokes, requestId)",
    );
    expect(webGpuCanvasSource).toContain(
      "engine.appendStrokeFeedJournalSuffixBatch(command.patch, requestId)",
    );
    expect(webGpuCanvasSource).toContain(
      '=== "appended" ? "accepted" : "rejected"',
    );
    expect(webGpuCanvasSource).toContain(
      '=== "replaced" ? "accepted" : "rejected"',
    );
    expect(webGpuCanvasSource).toContain(
      'status: "rejected"',
    );
    expect(webGpuCanvasSource).toContain("return { status: journalOutcome, requestId }");
    expect(webGpuCanvasSource).toContain(
      "if (receipt.requestId !== desiredRequestIdRef.current) return",
    );
    expect(webGpuCanvasSource).toContain("pinnedJournalActiveRef.current");
    expect(webGpuCanvasSource).toContain("function resumedPinnedFeedCommand(");
    expect(webGpuCanvasSource).toContain('if (journalActive) return { mode: "retain" }');
  });

  it("separates temporary compositor hiding from pinned-journal authority release", () => {
    const temporaryGateStart = webGpuCanvasSource.indexOf(
      "setPinnedPresentationVisible: (visible) => {"
    );
    const releaseGateStart = webGpuCanvasSource.indexOf(
      "setPinnedVisible: (visible) => {",
      temporaryGateStart + 1,
    );
    const temporaryGate = webGpuCanvasSource.slice(
      temporaryGateStart,
      releaseGateStart,
    );
    const releaseGate = webGpuCanvasSource.slice(releaseGateStart);

    expect(temporaryGateStart).toBeGreaterThan(-1);
    expect(releaseGateStart).toBeGreaterThan(temporaryGateStart);
    expect(temporaryGate).toContain("setPinnedVisibleState(visible)");
    expect(temporaryGate).toContain(
      'root.style.visibility = visible ? "visible" : "hidden"'
    );
    expect(temporaryGate).toContain(
      'root.style.opacity = visible ? "1" : "0"'
    );
    expect(temporaryGate).not.toContain("pinnedStrokesRef.current = null");
    expect(temporaryGate).not.toContain("issueLatestRequestRef.current");
    expect(releaseGate).toContain("pinnedStrokesRef.current = null");
    expect(releaseGate).toContain("issueLatestRequestRef.current?.()");
    expect(releaseGate.indexOf('root.style.visibility = "hidden"')).toBeLessThan(
      releaseGate.indexOf("pinnedStrokesRef.current = null")
    );
    expect(releaseGate.indexOf('root.style.opacity = "0"')).toBeLessThan(
      releaseGate.indexOf("pinnedStrokesRef.current = null")
    );
  });
});
