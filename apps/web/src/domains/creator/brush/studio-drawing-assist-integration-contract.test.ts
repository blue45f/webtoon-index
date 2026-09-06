import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";
import { readStudioInspectorAsideSurface } from "../read-studio-inspector-aside-source";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const source = readStudioCuttoonEditorSource();
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "../canvas/");
const guideSource = readFileSync(new URL("../canvas/StudioCanvasGuideLayers.tsx", import.meta.url), "utf8");
const inspectorSource = readStudioInspectorAsideSurface();
const isometricPanelSource = readFileSync(
  new URL("../StudioIsometricGridPanel.tsx", import.meta.url),
  "utf8"
);

describe("StudioPage drawing-assist integration contract", () => {
  it("consumes both guide handles before the Stage can begin an ink stroke", () => {
    const stageDown = source.slice(
      source.indexOf("function onStageDown"),
      source.indexOf("function onStageMove")
    );
    expect(stageDown).toContain('e.target.name() === "vp-handle"');
    expect(stageDown).toContain('e.target.name() === "isometric-origin-handle"');
  });

  it("keeps panel and canvas guide interactions behind the same edit locks", () => {
    expect(inspectorSource).toContain(
      "const drawingAssistControlsDisabled = inspectorInteractionPolicy.page.disabled"
    );
    expect(inspectorSource).toContain(
      "const drawingAssistDisabledReason = inspectorInteractionPolicy.page.reason"
    );
    expect(inspectorSource).toMatch(/<StudioPerspectivePanel[\s\S]*?disabled=\{drawingAssistControlsDisabled\}/u);
    expect(inspectorSource).toMatch(/<StudioIsometricGridPanel[\s\S]*?disabled=\{drawingAssistControlsDisabled\}/u);
    expect(viewportSource).toMatch(
      /<StudioCanvasGuideOverlayLayers[\s\S]*?drawingAssistDisabled=\{activeSurfaceReviewLocked \|\| saving \|\| masterEditMode\}/u
    );
    expect(guideSource).toMatch(
      /<StudioPerspectiveOverlay[\s\S]*?disabled=\{drawingAssistDisabled\}/u
    );
    expect(guideSource).toMatch(
      /<StudioIsometricGridOverlay[\s\S]*?disabled=\{drawingAssistDisabled\}/u
    );
  });

  it("routes every guide drag through preview, one final commit, and explicit cancellation", () => {
    expect(viewportSource).toMatch(
      /<StudioCanvasGuideOverlayLayers[\s\S]*?onPreviewVanishingPoint=\{previewVanishingPointById\}[\s\S]*?onCommitVanishingPoint=\{moveVanishingPointById\}[\s\S]*?onPreviewIsometricOrigin=\{previewIsometricOrigin\}[\s\S]*?onCommitIsometricOrigin=\{commitIsometricOrigin\}[\s\S]*?onCancelDrawingAssistPreview=\{cancelStudioDrawingAssistPreview\}/u
    );
    expect(guideSource).toMatch(
      /<StudioPerspectiveOverlay[\s\S]*?onPreviewPoint=\{onPreviewVanishingPoint\}[\s\S]*?onCommitPoint=\{onCommitVanishingPoint\}[\s\S]*?onCancelPoint=\{onCancelDrawingAssistPreview\}/u
    );
    expect(guideSource).toMatch(
      /<StudioIsometricGridOverlay[\s\S]*?onPreviewOrigin=\{onPreviewIsometricOrigin\}[\s\S]*?onCommitOrigin=\{onCommitIsometricOrigin\}[\s\S]*?onCancelOrigin=\{onCancelDrawingAssistPreview\}/u
    );
    expect(inspectorSource).toMatch(
      /<StudioIsometricGridPanel[\s\S]*?onPreviewOrigin=\{previewIsometricOrigin\}[\s\S]*?onCommitOrigin=\{commitIsometricOrigin\}/u
    );
  });

  it("inserts every isometric primitive face in one commit and selects the complete batch", () => {
    const primitiveStart = source.indexOf("function insertIsometricPrimitive");
    const legacyStart = source.indexOf("function insertIsometricSolid", primitiveStart);
    const primitiveInsertion = source.slice(primitiveStart, legacyStart);
    const legacyInsertion = source.slice(
      legacyStart,
      source.indexOf("function patchElCoalesced", legacyStart)
    );

    expect(primitiveInsertion).toContain("planStudioIsometricPrimitive({");
    expect(primitiveInsertion).toContain("...spec,");
    expect(primitiveInsertion).toContain("originX: isometricOriginX");
    expect(primitiveInsertion).toContain("originY: isometricOriginY");
    expect(primitiveInsertion).toContain("angleDeg: isometricAngleDeg");
    expect(primitiveInsertion).toContain("const ids = plan.faces.map(() => uid())");
    expect(primitiveInsertion).toContain("createStudioIsometricPrimitiveElements(plan");
    expect(primitiveInsertion).toContain("const targetPageId = activePage.id");
    expect(primitiveInsertion).toContain("const currentHistory = pagesHistoryRef.current");
    expect(primitiveInsertion).toContain("const targetPage = currentPages.find");
    expect(primitiveInsertion).toContain(
      "commit([...targetPage.elements, ...faces], undefined, targetPageId)"
    );
    expect(primitiveInsertion.match(/\bcommit\(/gu)).toHaveLength(1);
    expect(primitiveInsertion).toContain("setSelectedId(ids[ids.length - 1]!)");
    expect(primitiveInsertion).toContain("setMarqueeIds(ids)");
    expect(legacyInsertion).toMatch(
      /insertIsometricPrimitive\(\{[\s\S]*?kind: "box"[\s\S]*?width: unit \* 3[\s\S]*?depth: unit \* 3[\s\S]*?height: unit \* 3/u
    );
    expect(inspectorSource).toMatch(
      /<StudioIsometricGridPanel[\s\S]*?onInsertPrimitive=\{insertIsometricPrimitive\}[\s\S]*?onInsertSolid=\{insertIsometricSolid\}/u
    );
  });

  it("keeps heavy primitive geometry behind one literal activation-time import", () => {
    expect(source).toContain('await import("./studio-isometric-solid")');
    expect(source).not.toMatch(/from "\.\.\/studio-isometric-solid"/u);
    expect(inspectorSource).not.toMatch(/from "\.\/studio-isometric-solid"/u);
    expect(isometricPanelSource).not.toMatch(/from "\.\/studio-isometric-solid"/u);
    expect(isometricPanelSource).toContain('from "./studio-isometric-primitive-contract"');
  });
});
