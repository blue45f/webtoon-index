import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const backgroundSource = readStudioBg3dEditorSource();
const pageSource = readFileSync(
  new URL("../StudioCuttoonEditorHost.tsx", import.meta.url),
  "utf8",
);
const previewStackSource = readFileSync(
  new URL("../StudioThreeDPreviewPanelStack.tsx", import.meta.url),
  "utf8",
);

describe("BG3D current-shot AI Method reference integration boundary", () => {
  it("captures a clean bounded frame and hands off a fragment-free PNG", () => {
    expect(backgroundSource).toContain("async function handleUseAsAiMethodReference()");
    expect(backgroundSource).toContain("setLineArtPreview(false)");
    expect(backgroundSource).toContain("maxPixels: Math.min(deviceQuality.maxRenderPixels, 2_000_000)");
    expect(backgroundSource).toContain('canvas.toDataURL("image/png").split("#", 1)[0]');
    expect(backgroundSource).toContain("createStudioBg3dAiMethodReferenceCapture({");
  });

  it("keeps provider execution outside the heavyweight 3D editor chunk", () => {
    expect(backgroundSource).not.toContain("generateImageWithRoleReferences");
    expect(backgroundSource).not.toContain("runWithAiNotice");
    expect(previewStackSource).toContain(
      "onUseAsAiMethodReference={useBg3dFrameAsAiMethodReference}",
    );
  });

  it("saves the shot locally, installs the Method reference, then opens review", () => {
    expect(pageSource).toContain("useBg3dFrameAsAiMethodReference: async (");
    expect(pageSource).toContain('kind: "bg3d-ai-method"');
    expect(pageSource).toContain("applyStudioBg3dAiMethodReference(");
    expect(pageSource).toContain("setScenarioImageReferenceDocument(application.document)");
    expect(pageSource).toContain("setBg3dOpen(false)");
    expect(pageSource).toContain("setScenarioOpen(true)");
  });
});
