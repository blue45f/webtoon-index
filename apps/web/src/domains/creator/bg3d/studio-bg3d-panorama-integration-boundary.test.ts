import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const background3dSource = [
  readStudioBg3dEditorSource(),
  ...[
    "./StudioBg3dShapesPanel.tsx",
    "./StudioBg3dViewPanelContent.tsx",
    "./StudioBg3dLtPanel.tsx",
  ].map((fileName) => readFileSync(new URL(fileName, import.meta.url), "utf8")),
].join("\n");
const controlFieldsSource = readFileSync(
  new URL("./studio-bg3d-control-fields.tsx", import.meta.url),
  "utf8",
);
const panoramaComponentSource = readFileSync(
  new URL("./StudioBg3dScenePanorama.tsx", import.meta.url),
  "utf8",
);
const panoramaSource = readFileSync(
  new URL("./studio-bg3d-procedural-panorama.ts", import.meta.url),
  "utf8",
);
const colorCaptureSource = readFileSync(
  new URL("./studio-bg3d-three-webgl-capture.ts", import.meta.url),
  "utf8",
);
const depthCaptureSource = readFileSync(
  new URL("./studio-bg3d-lt-three-depth.ts", import.meta.url),
  "utf8",
);

describe("Studio BG3D procedural panorama integration boundary", () => {
  it("mounts the panorama in the existing View surface with mobile-sized rotation controls", () => {
    const viewStart = background3dSource.indexOf("360° 환경 배경");
    const viewEnd = background3dSource.indexOf("공간 안개", viewStart);
    const viewControls = background3dSource.slice(viewStart, viewEnd);
    const tabTypeStart = background3dSource.indexOf("type BgPanelTab");
    const tabTypeEnd = background3dSource.indexOf(";", tabTypeStart);
    const tabType = background3dSource.slice(tabTypeStart, tabTypeEnd);

    expect(background3dSource).toContain("<StudioBg3dScenePanorama");
    expect(panoramaComponentSource).toContain("[invalidate, presetId, rotationDegrees]");
    expect(viewStart).toBeGreaterThanOrEqual(0);
    expect(viewEnd).toBeGreaterThan(viewStart);
    expect(viewControls).toContain('id="bg3d-panorama-rotation"');
    expect(viewControls).toContain("<PanoramaRotationNumberField");
    expect(controlFieldsSource).toContain(
      "export function PanoramaRotationNumberField("
    );
    expect(controlFieldsSource).toContain("min-h-11");
    expect(viewControls).toContain("정면 초기화");
    expect(tabType).not.toMatch(/panorama|sky/iu);
  });

  it("keeps generation inside the local allowlist without an image/network loading path", () => {
    expect(panoramaComponentSource).toContain("mountStudioBg3dProceduralPanorama");
    expect(`${panoramaSource}\n${panoramaComponentSource}`).not.toMatch(
      /panoramaUrl|TextureLoader|ImageLoader|loadAsync|fetch\s*\(|createObjectURL/iu,
    );
    expect(panoramaSource).toContain("new THREE.DataTexture");
  });

  it("includes skies only in opaque color output and never in packed depth", () => {
    expect(colorCaptureSource).toContain("request.background.alpha === 0");
    expect(colorCaptureSource).toContain(
      "scene.background = suppressSceneBackground ? null : capturedSceneBackground"
    );
    expect(colorCaptureSource).toContain("scene.background = capturedSceneBackground");
    expect(colorCaptureSource).toContain(
      "scene.backgroundRotation.copy(capturedSceneBackgroundRotation)"
    );
    expect(depthCaptureSource).toContain("scene.background = null");
    expect(depthCaptureSource).toContain("scene.background = previousSceneBackground");
    expect(depthCaptureSource).toContain(
      "scene.backgroundRotation.copy(previousSceneBackgroundRotation)"
    );
  });
});
