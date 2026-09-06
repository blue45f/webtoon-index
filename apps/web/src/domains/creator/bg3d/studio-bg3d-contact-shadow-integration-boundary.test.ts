import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

describe("Studio BG3D shared-character contact-shadow integration boundary", () => {
  it("keeps each contact shadow inside the character's existing capture-authority wrapper", () => {
    const sceneContent = source("./StudioBg3dSharedCharacterSceneContent.tsx");
    const wrapperStart = sceneContent.indexOf("<group\n        ref={!includeInCapture");
    const contactShadow = sceneContent.indexOf(
      "<LazyStudioBg3dSharedCharacterContactShadow",
    );
    const character = sceneContent.indexOf("<LazyStudioBg3dSharedVrmCharacter");
    const wrapperEnd = sceneContent.indexOf("</group>", character);

    expect(wrapperStart).toBeGreaterThanOrEqual(0);
    expect(contactShadow).toBeGreaterThan(wrapperStart);
    expect(character).toBeGreaterThan(contactShadow);
    expect(wrapperEnd).toBeGreaterThan(character);
    expect(sceneContent).toContain("grounding={groundingResults[source.runtimeKey]}");
    expect(sceneContent).toContain(
      '() => import("./StudioBg3dSharedCharacterContactShadow")',
    );
    expect(source("./StudioBg3dEditorSceneGraph.tsx")).toContain(
      "groundingResults={sharedCharacterGroundings}",
    );
  });

  it("renders beauty-only feathered geometry without becoming selectable or authored depth", () => {
    const contactShadow = source("./StudioBg3dSharedCharacterContactShadow.tsx");

    expect(contactShadow).toContain("registerStudioBg3dDepthExcludedObject");
    expect(contactShadow).not.toContain("registerStudioBg3dCaptureExcludedObject");
    expect(contactShadow).toContain("raycast={ignoreContactShadowRaycast}");
    expect(contactShadow).toContain('userData={{ studioBg3dRendererOverlay: true');
    expect(contactShadow).toContain("castShadow={false}");
    expect(contactShadow).toContain("receiveShadow={false}");
    expect(contactShadow).toContain("depthWrite={false}");
    expect(contactShadow).toContain("side={THREE.FrontSide}");
    expect(contactShadow).toContain("alphaMap={alphaMap}");
  });

  it("uses a separate identity registry for depth and rejects overlays from grounding", () => {
    const exclusion = source("./studio-bg3d-capture-exclusion.ts");
    const depth = source("./studio-bg3d-lt-three-depth.ts");
    const character = source("./StudioBg3dSharedVrmCharacter.tsx");

    expect(exclusion).toContain("const captureExcludedObjects = new WeakSet");
    expect(exclusion).toContain("const depthExcludedObjects = new WeakSet");
    expect(depth).toContain("hideStudioBg3dDepthExcludedObjects(scene)");
    expect(depth.indexOf("restoreDepthExcludedObjects();")).toBeLessThan(
      depth.indexOf("await readback;"),
    );
    expect(character).toContain("current.userData.studioBg3dRendererOverlay === true");
  });
});
