import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Studio live retained-media overlay integration", () => {
  it("seals oil/pencil before commit and waits for the committed-draw receipt", () => {
    const page = source("../StudioCuttoonEditorHost.tsx");
    const editor = readStudioCuttoonEditorSource();
    const finish = editor.slice(
      editor.indexOf("function finishDrawingPointer("),
      editor.indexOf("function onStagePointerCancel"),
    );
    const seal = finish.indexOf("liveRetainedMediaOverlayRendererRef.current.end(finished)");
    const reject = finish.indexOf(
      'selectedOverlaySeal.result.status !== "settled"',
      seal,
    );
    const deferredCommit = finish.indexOf("queueDeferredStrokeCommit(finished)", seal);
    const immediateCommit = finish.indexOf("commit([...baseElements, finished])", seal);
    expect(seal).toBeGreaterThan(-1);
    expect(reject).toBeGreaterThan(seal);
    expect(deferredCommit).toBeGreaterThan(reject);
    expect(immediateCommit).toBeGreaterThan(reject);

    const clear = page.slice(
      page.indexOf("const clearDraftPreview ="),
      page.indexOf("const DEFERRED_STROKE_COMMIT_IDLE_MS"),
    );
    const retainedStart = clear.indexOf("if (wasRetainedMediaDirect)");
    const retained = clear.slice(
      retainedStart,
      clear.indexOf("if (wasWetInkDirect)", retainedStart),
    );
    expect(retained).not.toContain("renderer.end(finalRetainedMediaStroke)");
    expect(retained).toContain("renderer.hasSettledStrokes");
    expect(retained).not.toContain("renderer.releaseSettledPrefix(1)");
    expect(retained).not.toContain("draftPreviewStoreRef.current.settle(finalRetainedMediaStroke)");

    const queue = page.slice(
      page.indexOf("function queueCommittedStrokeSurfaceHandoff"),
      page.indexOf("function queueDeferredStrokeCommit"),
    );
    expect(queue).toContain("liveRetainedMediaOverlayRendererRef.current.settledStrokeCount");

    // Intentional change: releaseCommittedInkSurfaceCounts moved into
    // studio-cuttoon-editor/studio-deferred-stroke-commit.ts — scan the composed editor surface.
    const release = editor.slice(
      editor.indexOf("function releaseCommittedInkSurfaceCounts("),
      editor.indexOf("function scheduleCommittedInkSurfaceHandoffRetry"),
    );
    expect(release).toContain("retainedMediaOverlayRenderer.releaseSettledPrefix(retainedOverlayBudget)");
    expect(release).toContain("dynamicBrushOverlayRenderer.releaseSettledPrefix(dynamicOverlayBudget)");
  });
});
