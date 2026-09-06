import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const editorSource = readStudioBg3dEditorSource();
const viewPanelSource = readFileSync(
  new URL("./StudioBg3dViewPanelContent.tsx", import.meta.url),
  "utf8",
);
const assetLibrarySource = readFileSync(
  new URL("./StudioBg3dAssetLibraryPanel.tsx", import.meta.url),
  "utf8",
);
const controlSource = readFileSync(new URL("./studio-bg3d-control-fields.tsx", import.meta.url), "utf8");
const shapesPanelSource = readFileSync(
  new URL("./StudioBg3dShapesPanel.tsx", import.meta.url),
  "utf8",
);
const ltPanelSource = readFileSync(
  new URL("./StudioBg3dLtPanel.tsx", import.meta.url),
  "utf8",
);

describe("Studio BG3D accessibility boundary", () => {
  it("keeps the camera and physics sub-tabs keyboard navigable", () => {
    expect(viewPanelSource).toContain("VIEW_EDITOR_SECTIONS");
    expect(viewPanelSource).toContain('event.key === "ArrowRight" || event.key === "ArrowDown"');
    expect(viewPanelSource).toContain('event.key === "ArrowLeft" || event.key === "ArrowUp"');
    expect(viewPanelSource).toContain('event.key === "Home"');
    expect(viewPanelSource).toContain('event.key === "End"');
    expect(viewPanelSource).toContain('id={`bg3d-view-tab-${section.id}`}');
    expect(viewPanelSource).toContain('aria-labelledby="bg3d-view-tab-physics"');
    expect(viewPanelSource).toContain('aria-labelledby="bg3d-view-tab-camera"');
    expect(viewPanelSource).toContain("?.focus();");
  });

  it("exposes Camera vNext values and gesture completion with mobile-size controls", () => {
    expect(viewPanelSource).toContain('label="근접 절단"');
    expect(viewPanelSource).toContain('label="더치 앵글"');
    expect(viewPanelSource).toContain("valueText={`${currentDutchRollDegrees}°`}");
    expect(viewPanelSource).toContain("절단 초기화");
    expect(viewPanelSource).toContain("수평 맞춤");
    expect(viewPanelSource.match(/onChangeEnd=\{finishCameraLensGesture\}/gu)).toHaveLength(3);
    expect(controlSource).toContain("aria-valuetext={valueText}");
    expect(controlSource).toContain("h-11 w-full");
    expect(controlSource).toContain("onKeyUp={onChangeEnd}");
    expect(controlSource).toContain("onPointerUp={onChangeEnd}");
  });

  it("names imported model files and template deletion with a touch-size target", () => {
    expect(assetLibrarySource).toContain('aria-label="3D 모델 및 연결 파일 선택"');
    expect(editorSource).toContain('aria-label={`${entry.name} 템플릿 삭제`}');
    expect(editorSource).toContain('title="템플릿 삭제"');
    expect(editorSource).toMatch(/템플릿 삭제[\s\S]*?className="[^"]*size-11[^"]*sm:size-7/u);
  });

  it("never removes a keyboard focus outline without a visible replacement", () => {
    for (const source of [
      editorSource,
      assetLibrarySource,
      controlSource,
      shapesPanelSource,
      viewPanelSource,
      ltPanelSource,
    ]) {
      expect(source).not.toMatch(/(?:^|\s)(?:focus:)?outline-none(?![^"\n]*focus-visible:outline)/u);
    }
    expect(controlSource).toContain("focus-visible:outline-2");
  });
});
