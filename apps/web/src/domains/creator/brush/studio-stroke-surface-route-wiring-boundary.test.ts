import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const PAGE_SOURCE = readStudioCuttoonEditorSource();
const ROUTE_SOURCE = readFileSync(
  new URL("./studio-stroke-surface-route.ts", import.meta.url),
  "utf8",
);

function sourceSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Missing source boundary: ${start} -> ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

describe("Studio stroke surface route wiring boundary", () => {
  it("selects exactly one product route before side effects and fails closed", () => {
    const pointerDown = sourceSection(
      PAGE_SOURCE,
      "function beginStudioDrawLiveSurfaces(",
      "function onStageDown(",
    );
    const selectionAndAdmissions = [
      "const livingInkSelected =",
      "const hokusaiSelected = !livingInkSelected",
      "const stampSelected = !livingInkSelected",
      "const wetMediaSelected = !livingInkSelected",
      "const retainedMediaSelected = !livingInkSelected",
      "const dynamicSelected = !livingInkSelected",
      "const genericDirectSelected = !livingInkSelected",
      "const gpuSelected = genericDirectSelected",
      "const canvas2dSelected = genericDirectSelected",
      "const livingInkAdmitted = livingInkSelected",
      "beginStudioLivingInkStroke(next, pointerSample)",
      "if (livingInkSelected && !livingInkAdmitted)",
      "const hokusaiPinned = hokusaiSelected",
      "beginStudioHokusaiLiveStroke(next)",
      "if (hokusaiSelected && !hokusaiPinned)",
      "const stampDirect = Boolean(stampSelected",
      "liveStampOverlayRendererRef.current.begin(",
      "if (stampSelected && !stampDirect)",
      "const gpuStartEligible = gpuSelected",
      "if (gpuSelected && liveInkBackendDecision.status !== \"ready\")",
      "beginLiveStrokeBackendAudit(next.id, \"webgpu\")",
      "if (canvas2dSelected",
      "liveInkOverlayRendererRef.current.begin(",
      // 명시 선택된 2D 표면은 오버레이가 애초에 자격이 있었을 때만 "시작 실패"로 거절한다.
      "if (canvas2dSelected && liveInkOverlayEligible && !liveInkOverlayStarted)",
      "const wetInkOverlayStarted = wetMediaSelected",
      "liveWetInkOverlayRendererRef.current.begin(next",
      "if (wetMediaSelected && !wetInkOverlayStarted)",
      "const dynamicBrushDirect = dynamicSelected",
      "liveDynamicBrushOverlayRendererRef.current.begin(next)",
      "if (dynamicSelected && !dynamicBrushDirect)",
      "resolveStudioStrokeSurfaceRoute({",
    ] as const;

    let previous = -1;
    for (const admission of selectionAndAdmissions) {
      const index = pointerDown.indexOf(admission);
      expect(index, `missing explicit route boundary: ${admission}`).toBeGreaterThan(previous);
      previous = index;
    }
    expect(pointerDown).not.toContain("strokeRouteTournamentGate");
    expect(pointerDown).not.toContain("resolveStudioStrokeRoutePointerDownGate");
    expect(pointerDown).not.toContain("STUDIO_STROKE_ROUTE_TOURNAMENT_LANES");
    expect(pointerDown).not.toContain("peekBootedStudioTournamentRuntime");
    expect(pointerDown).not.toContain("relinquishGpuLiveInkToKonva");
    expect(pointerDown).not.toContain("promotePendingGpuAuthoritiesToKonva");
    expect(pointerDown).toContain("return rejectSelectedSurface(");
    expect(pointerDown).toContain("studioStrokeSurfaceRouteRef.current = strokeSurfaceRoute");
    expect(pointerDown).toContain("livingInkCoordinatorRef.current.pinActiveRoute(");
    expect(pointerDown).toContain("strokeSurfaceRoute = resolveStudioStrokeSurfaceRoute({");
  });

  it("keeps canonical stroke/action handoff token-scoped and input-exclusive", () => {
    const livingInkBoundary = sourceSection(
      PAGE_SOURCE,
      "function releaseStudioLivingInkPresentation(",
      "function livingInkSelectionSnapshot(",
    );
    expect(livingInkBoundary).toContain("handoff?.token !== expectedToken");
    expect(livingInkBoundary).toContain('handoff?.kind === "stroke"');
    expect(livingInkBoundary).toContain("handoff.token !== `${routeKey}:canonical`");
    expect(livingInkBoundary).toContain("releaseStudioLivingInkPresentation(handoff.token)");

    const action = sourceSection(
      PAGE_SOURCE,
      "async function applyStudioLivingInkAction(",
      "const studioOptionsBarsHandlers =",
    );
    expect(action).toContain("studioLivingInkProductAdmissionBlocked({");
    expect(action).toContain('kind: "action"');
    expect(action).toContain("kind,");
    expect(action).toContain('void applyStudioLivingInkAction("fix")');
    expect(action).toContain('void applyStudioLivingInkAction("clear")');
    expect(action).toContain("if (!transactionCommitted) setLivingInkBusy(false)");
    expect(PAGE_SOURCE).toContain(
      'fixAvailable: livingInkPersistedLayer && livingInkState === "ready"',
    );
    expect(PAGE_SOURCE).not.toContain("fixAvailable: false");

    const history = sourceSection(
      PAGE_SOURCE,
      "function undo()",
      "const studioBrushCatalogHandlers =",
    );
    expect(history).toContain("pendingLivingInkHandoff");
    expect(history).toContain("releaseStudioLivingInkPresentation(pendingLivingInkHandoff.token)");
  });

  it("revokes physical editing authority if document acceptance fails after commit", () => {
    expect(PAGE_SOURCE).toContain("if (!livingInkCoordinatorRef.current.acceptFinishedStroke(work))");
    expect(PAGE_SOURCE).toContain("if (!livingInkCoordinatorRef.current.acceptAction(work))");
    expect(PAGE_SOURCE.match(/livingInkCoordinatorRef\.current\.failClosed\(message\)/gu)?.length)
      .toBeGreaterThanOrEqual(3);
  });

  it("keeps every current surface and lifecycle phase explicit in the pure contract", () => {
    for (const kind of [
      "living-ink",
      "hokusai",
      "stamp",
      "gpu",
      "live-ink",
      "wet-ink",
      "dynamic",
      "konva",
    ] as const) {
      expect(ROUTE_SOURCE).toContain(`"${kind}"`);
    }
    for (const phase of ["append", "finish", "cancel", "handoff"] as const) {
      expect(ROUTE_SOURCE).toContain(`| "${phase}"`);
    }

    const finish = sourceSection(
      PAGE_SOURCE,
      "function finishDrawingPointer(",
      "function onStagePointerCancel(",
    );
    const specialistFinish = sourceSection(
      PAGE_SOURCE,
      "function finishStudioSpecialistStroke(",
      "function finishDrawingPointer(",
    );
    expect(PAGE_SOURCE).toContain("appendStudioLivingInkAuthoritativeSuffix(authoritativeDrawing, startSample)");
    expect(specialistFinish).toContain("finishStudioLivingInkStroke");
    expect(specialistFinish).toContain("finishStudioHokusaiLiveStroke");
    expect(finish).toContain("finishStudioSpecialistStroke(finished)");
    expect(finish).toContain("gpuLiveInkPinnedRef.current");
    expect(finish).toContain("overlayRenderer.isActive");
    expect(finish).toContain("liveWetInkOverlayRendererRef.current.isActive");
    expect(finish).toContain("liveDynamicBrushOverlayRendererRef.current.isActive");
    expect(finish).toContain("queueCommittedStrokeSurfaceHandoff");
    for (const phase of ["append", "finish", "cancel", "handoff"] as const) {
      expect(PAGE_SOURCE).toContain(`phase: "${phase}"`);
    }
  });
});
