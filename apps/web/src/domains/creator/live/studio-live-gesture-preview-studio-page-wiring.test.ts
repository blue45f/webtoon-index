import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const source = readStudioCuttoonEditorSource();

describe("Studio live gesture preview publisher wiring", () => {
  it("publishes exactly one begin from the authoritative pointer-start path", () => {
    expect(source).toContain(
      'import { StudioLiveGesturePreviewPublisher } from "./live/studio-live-gesture-preview-publisher";',
    );
    expect(source.match(/drawingGesturePreviewPublisherRef\.current\.begin\(\{/g)).toHaveLength(1);

    const pointerStart = source.indexOf(
      "drawingInkTimeOriginRef.current = studioInkGestureTimeOrigin(next.inkInput",
    );
    const previewBegin = source.indexOf(
      "drawingGesturePreviewPublisherRef.current.begin({",
      pointerStart,
    );
    const liveSurfaceBegin = source.indexOf("beginStudioDrawLiveSurfaces(next", pointerStart);
    expect(pointerStart).toBeGreaterThan(0);
    expect(previewBegin).toBeGreaterThan(pointerStart);
    expect(previewBegin).toBeLessThan(liveSurfaceBegin);
    expect(source.slice(previewBegin, liveSurfaceBegin)).toContain("element: next");
  });

  it("publishes only authoritative freehand suffixes and coalesced shape endpoints", () => {
    expect(source.match(/drawingGesturePreviewPublisherRef\.current\.append\(/g)).toHaveLength(1);
    const suffixFunction = source.slice(
      source.indexOf("function publishAuthoritativeFreehandSuffix"),
      source.indexOf("drawingFixedRatePumpFrameRef.current", source.indexOf("function publishAuthoritativeFreehandSuffix")),
    );
    expect(suffixFunction).toContain(
      "drawingGesturePreviewPublisherRef.current.append(authoritativeDrawing, startSample)",
    );

    expect(source.match(/drawingGesturePreviewPublisherRef\.current\.replaceShape\(/g)).toHaveLength(1);
    const shapeFunction = source.slice(
      source.indexOf("function updateActiveShapeEndpoint"),
      source.indexOf("function onStageMove", source.indexOf("function updateActiveShapeEndpoint")),
    );
    expect(shapeFunction).toContain("drawingRef.current = next");
    expect(shapeFunction).toContain("drawingGesturePreviewPublisherRef.current.replaceShape(next)");
  });

  it("ends completed strokes and cancels every destructive lifecycle boundary", () => {
    expect(source).toContain(
      "gesturePreviewFinished = drawingGesturePreviewPublisherRef.current.end(finished)",
    );
    expect(source).toContain(
      "drawingGesturePreviewPublisherRef.current.cancel(discardedId)",
    );
    expect(source).toContain(
      "drawingGesturePreviewPublisherRef.current.cancel(finishingStrokeId ?? undefined)",
    );
    expect(source).toContain("cancelStudioLiveGesturePreviewRef.current();");
    expect(source).toContain("drawingGesturePreviewPublisherRef.current.cancel();");
    expect(source).toContain(
      "drawingGesturePreviewPublisherRef.current.cancel(current.id)",
    );
  });
});
