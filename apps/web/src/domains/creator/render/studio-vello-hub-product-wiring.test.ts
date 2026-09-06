import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";



const viewportSource = readStudioCanvasViewportStack(import.meta.url, "../canvas/");
const canvasTargetSource = readFileSync(
  new URL("./studio-vello-hub-canvas-target.ts", import.meta.url),
  "utf8",
);
const hubSource = readFileSync(
  new URL("./studio-vello-hub.ts", import.meta.url),
  "utf8",
);
const verifierSource = readFileSync(
  new URL("../../../../../../scripts/verify-studio-vello-candidate.mts", import.meta.url),
  "utf8",
);

describe("VelloHub /studio product wiring", () => {
  it("mounts the hub from the real StudioCanvasViewport call site", () => {
    expect(viewportSource).toContain(
      'import { StudioRenderSurface } from "../render/StudioRenderSurface"',
    );
    expect(viewportSource).toContain("<StudioRenderSurface");
    expect(viewportSource).toContain("elements={elements}");
    expect(viewportSource).toContain(
      "documentTransform={velloSceneDocumentTransform}",
    );
    expect(viewportSource).toContain("sceneRevision={velloSceneRevision}");
    expect(viewportSource).toContain("enabled={velloDocumentSurfaceEnabled}");
    expect(viewportSource).toContain("width={stageViewLayout.width}");
    expect(viewportSource).toContain("height={stageViewLayout.height}");
    expect(viewportSource).toContain("isPenDown={readVelloHubPenDown}");
    expect(viewportSource).toContain("() => drawingRef.current !== null");
    expect(viewportSource).toContain(
      'data-studio-vello-hub-authority={velloHubAuthority.status}',
    );
  });

  it("keeps one document owner and enables Pixi only at the explicit legacy boundary", () => {
    expect(viewportSource).toContain(
      '!velloHubCapability.enabled\n              || velloHubAuthority.status === "legacy"',
    );
    expect(viewportSource).toContain('velloHubAuthority.status === "unavailable"');
    expect(viewportSource).toContain('data-studio-vello-unavailable="true"');
    expect(viewportSource).toContain("같은 작업을 다른 엔진으로 재실행하지 않았습니다");
    expect(canvasTargetSource).toContain(
      'dataset.studioVelloHubPrimary = "true"',
    );
    expect(canvasTargetSource).toContain("holdLastGood(reason)");
    expect(canvasTargetSource).not.toContain("getImageData(");
    expect(canvasTargetSource).not.toContain("readPixels");
    expect(canvasTargetSource).toContain("One visible canvas");
    expect(canvasTargetSource).toContain("studio-frame-graph-retained");
    expect(canvasTargetSource).toContain("requestAnimationFrame");
    expect(canvasTargetSource).not.toContain('style.zIndex = "6"');
  });

  it("gives FrameGraph document pixels while Konva keeps pointer routing", () => {
    const shadowAt = viewportSource.indexOf(
      "name={STUDIO_KONVA_DOCUMENT_SHADOW_NAME}",
    );
    const documentAt = viewportSource.indexOf(
      "<StudioCanvasViewportDocumentLayer {...documentLayerProps} />",
      shadowAt,
    );
    const shadowOpening = viewportSource.slice(shadowAt, documentAt);

    expect(canvasTargetSource).toContain('canvas.style.pointerEvents = "none"');
    expect(viewportSource).toContain("data-studio-frame-graph-document");
    expect(viewportSource).toContain("frameGraphOwnsDocumentPixels");
    expect(viewportSource).toContain("velloEligibleDocumentIds");
    expect(viewportSource).toContain("name={STUDIO_KONVA_DOCUMENT_SHADOW_NAME}");
    expect(viewportSource).toContain("opacity={frameGraphOwnsDocumentPixels ? 0 : 1}");
    expect(viewportSource).toContain(
      "<StudioCanvasViewportDocumentLayer {...documentLayerProps} />",
    );
    expect(shadowAt).toBeGreaterThan(-1);
    expect(documentAt).toBeGreaterThan(shadowAt);
    expect(shadowOpening).not.toContain("listening={false}");
    expect(viewportSource).not.toContain("const documentLayer = (");
    expect(viewportSource).toContain(
      "velloHubAuthority.sceneRevision === velloSceneRevision",
    );
    expect(viewportSource).not.toContain(
      'canvas.style.opacity = frameGraphOwnsDocumentPixels ? "0" : "1"',
    );
    expect(viewportSource).toContain("<Stage");
    expect(viewportSource).toContain("onPointerDown={onStageDown}");
    expect(viewportSource).toContain("onPointerMove={onStageMove}");
    expect(viewportSource).toContain("onPointerUp={onStageUp}");
  });

  it("keeps CPU/comparison as explicit QA APIs and schedules no product shadow work", () => {
    expect(hubSource).toContain("async renderReference(");
    expect(hubSource).toContain("async compareToReferenceForQa(");
    expect(hubSource).toContain('referenceOnly: true');
    expect(hubSource).not.toContain("scheduleClassicShadow");
    expect(hubSource).not.toContain("runClassicShadow");
    expect(hubSource).not.toContain("flushShadowWork");
    expect(hubSource).not.toContain("recoverGpuIslandToCpu");
    expect(hubSource).not.toContain("forceCpu");
    expect(hubSource).not.toContain("onUnrecoverableFallback");
  });

  it("verifies the bounded product seam instead of enforcing blanket research-only", () => {
    expect(verifierSource).toContain("STUDIO_VELLO_HUB_PRODUCT_CAPABILITY");
    expect(verifierSource).toContain("product seam active:");
    expect(verifierSource).not.toContain(
      "Vello must remain research-only until every promotion gate passes",
    );
    expect(verifierSource).not.toContain(
      "Vello runtime activation is forbidden by the current evidence",
    );
  });
});
