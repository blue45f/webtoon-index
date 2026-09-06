import { readFileSync } from "node:fs";


import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";
import { readStudioPageCompositionSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";



const pageSource = readStudioPageCompositionSource();
// Intentional change: the live-room rotation callbacks moved from StudioPage.tsx into the
// extracted collaboration wiring hook — the rotation-ordering pins now scan that file.
const collaborationWiringSource = readFileSync(
  new URL("./studio-collaboration-wiring.ts", import.meta.url),
  "utf8",
);
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "../canvas/");
const liveOverlaySource = readFileSync(
  new URL("./StudioLiveCanvasOverlay.tsx", import.meta.url),
  "utf8",
);
const lazyUiSource = readFileSync(
  new URL("../studio-page-lazy-ui.ts", import.meta.url),
  "utf8",
);

describe("Studio live gesture preview viewport wiring", () => {
  it("keeps the high-frequency subscription inside the viewport leaf", () => {
    expect(pageSource).toContain("new StudioLiveGesturePreviewRoomAdapter()");
    expect(pageSource).toContain(
      "studioLiveGesturePreviewAdapter={studioLiveGesturePreviewAdapter}",
    );
    expect(pageSource).not.toContain(
      "useSyncExternalStore(\n    studioLiveGesturePreviewAdapter.subscribe",
    );
    expect(viewportSource).toContain(
      "useSyncExternalStore(\n    studioLiveGesturePreviewAdapter.subscribe",
    );

    // Intentional change: the rotation body now lives in the module-level
    // rotateStudioLiveCollaborationRoom helper (react-compiler rejects mutating injected
    // hook-argument refs inside the compiled hook), so the ordering pins scan that function.
    const roomRotation = collaborationWiringSource.slice(
      collaborationWiringSource.indexOf("function rotateStudioLiveCollaborationRoom("),
      collaborationWiringSource.indexOf("interface StudioCollaborationAccessGeneration"),
    );
    expect(roomRotation.indexOf("cancelStudioLiveGesturePreviewRef.current()"))
      .toBeLessThan(roomRotation.indexOf("studioLiveGesturePreviewAdapter.setRoom(room)"));
    expect(roomRotation.indexOf("studioLiveGesturePreviewAdapter.setRoom(room)"))
      .toBeLessThan(roomRotation.indexOf("studioLiveRoomRef.current = room"));
    const lifecycleDisposal = collaborationWiringSource.slice(
      collaborationWiringSource.indexOf("const handleStudioLiveRoomChange"),
      collaborationWiringSource.indexOf("const handleStudioCrdtAuthoritativeSaveBarrierChange"),
    );
    expect(lifecycleDisposal).toContain(
      "const lifecycle = studioLiveGesturePreviewLifecycleGenerationRef.current",
    );
    // Intentional change: the shared-object generation bump moved into a module-level helper
    // (react-compiler rejects mutating an alias derived from an injected hook argument).
    expect(lifecycleDisposal).toContain("advanceStudioLiveGesturePreviewLifecycle(lifecycle)");
    expect(lifecycleDisposal).toContain("globalThis.queueMicrotask(() => {");
    expect(lifecycleDisposal).toContain("lifecycle.generation !== lifecycleGeneration");
    expect(lifecycleDisposal).toContain("studioLiveGesturePreviewAdapter.dispose()");
  });

  it("fails closed across every document capture and hydration boundary", () => {
    const gateStart = viewportSource.indexOf(
      "const studioLiveGesturePreviewVisible =",
    );
    const gateEnd = viewportSource.indexOf(
      "const studioLiveGesturePreviewPageId",
      gateStart,
    );
    const gate = viewportSource.slice(gateStart, gateEnd);

    expect(gate).toContain("!masterEditMode");
    expect(gate).toContain("!isExporting");
    expect(gate).toContain("!saving");
    expect(gate).toContain("!timelapseCapturing");
    expect(gate).toContain("!sourceHydrationPending");
    expect(gate).toContain("!collaborationDocumentUnavailable");
    expect(gate).toContain("studioCrdtOperationSyncReady");
    expect(viewportSource).toContain(
      "const studioLiveGesturePreviewRenderSnapshot = studioLiveGesturePreviewVisible",
    );
    expect(viewportSource).toContain(
      "? studioLiveGesturePreviewSnapshot.filter(",
    );
    expect(viewportSource).toContain(
      "studioLiveGesturePreviewReservedElementIds,\n  );",
    );
    expect(viewportSource).toContain(
      ": studioLiveGesturePreviewAuthoritativeElementIds",
    );
  });

  it("uses one non-interactive active-draft slot in the retained main layer", () => {
    // Post-split the draft-slot rendering spans DocumentLayer (plan → elements) while the
    // retained layers live in StageHost/ToolLayers, so locality is asserted on the stack.
    const mainLayer = viewportSource;

    expect(mainLayer).toContain("studioLiveGesturePreviewRenderPlan.elements.map");
    expect(mainLayer).toContain("...studioLiveGesturePreviewRenderPlan.elements");
    expect(mainLayer).toContain(
      "studioLiveGesturePreviewRenderPlan.previewElementIds.has(el.id)",
    );
    expect(mainLayer).toContain("|| isLiveGesturePreview");
    expect(mainLayer).toContain("activeDraft={isLiveGesturePreview}");
    expect(mainLayer).toContain(
      "studioLiveGesturePreviewRenderPlan.previewSequenceByElementId.get(el.id)",
    );
    expect(mainLayer).toContain(
      "studioLiveGesturePreviewRenderPlan.previewSequenceByElementId.get(base.id)",
    );
    expect(mainLayer).not.toContain("StudioRemoteEraserOverlay");
    expect(viewportSource).not.toContain("StudioRemoteEraserOverlay");
    expect(lazyUiSource).not.toContain("StudioRemoteEraserOverlay");
  });

  it("keeps cursor presence but suppresses the duplicate SVG trail per rendering peer", () => {
    expect(viewportSource).toContain(
      "trailSuppressedSessionIds={studioLiveGesturePreviewTrailSuppressedSessionIds}",
    );
    expect(liveOverlaySource).toContain(
      "trailSuppressedSessionIds?.has(value.participant.sessionId)",
    );
    expect(liveOverlaySource).toContain(
      // The suppression is a ternary on the cursor field, so the branch is its own line.
      "? { ...value.cursor, points: undefined }",
    );
  });

  it("retires a preview only after the authoritative layer draw receipt", () => {
    const handoffStart = viewportSource.indexOf(
      "studioLiveGesturePreviewRenderPlan.authoritativeHandoffToken === \"[]\"",
    );
    const handoffEnd = viewportSource.indexOf(
      "// Document paper grain preview",
      handoffStart,
    );
    const handoff = viewportSource.slice(handoffStart, handoffEnd);

    expect(handoff).toContain("globalThis.requestAnimationFrame");
    expect(handoff).toContain("layer.draw()");
    expect(handoff).toContain(
      "studioLiveGesturePreviewAdapter.markAuthoritativeProjection(",
    );
    expect(handoff.indexOf("layer.draw()"))
      .toBeLessThan(handoff.indexOf("markAuthoritativeProjection("));
    expect(handoff).toContain("globalThis.cancelAnimationFrame(frameHandle)");
  });
});
