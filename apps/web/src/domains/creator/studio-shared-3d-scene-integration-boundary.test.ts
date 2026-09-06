import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./bg3d/read-studio-bg3d-editor-source";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const stackSource = readFileSync(
  new URL("./StudioThreeDPreviewPanelStack.tsx", import.meta.url),
  "utf8",
);
const backgroundSource = readStudioBg3dEditorSource();
const characterSceneContentSource = readFileSync(
  new URL("./bg3d/StudioBg3dSharedCharacterSceneContent.tsx", import.meta.url),
  "utf8",
);
const characterStatusSource = readFileSync(
  new URL("./bg3d/StudioBg3dSharedCharacterStatusOverlay.tsx", import.meta.url),
  "utf8",
);
const characterStatusHookSource = readFileSync(
  new URL("./useStudioBg3dSharedCharacterStatus.ts", import.meta.url),
  "utf8",
);
const characterPlacementPanelSource = readFileSync(
  new URL("./bg3d/StudioBg3dSharedCharacterPlacementPanel.tsx", import.meta.url),
  "utf8",
);
const sharedSceneRuntimeSource = readFileSync(
  new URL("./studio-shared-3d-scene-runtime.ts", import.meta.url),
  "utf8",
);
const characterSource = readFileSync(
  new URL("./bg3d/StudioBg3dSharedVrmCharacter.tsx", import.meta.url),
  "utf8",
);
const appearanceRuntimeSource = readFileSync(
  new URL("./bg3d/StudioBg3dSharedVrmAppearanceRuntime.tsx", import.meta.url),
  "utf8",
);
const characterRuntimeSource = readFileSync(
  new URL("./bg3d/studio-bg3d-shared-vrm-runtime.ts", import.meta.url),
  "utf8",
);
const appearancePlanSource = readFileSync(
  new URL("./vrm/studio-vrm-linked-appearance-projection-plan.ts", import.meta.url),
  "utf8",
);

const pageSource = readStudioCuttoonEditorSource();

describe("shared character/background 3D scene integration boundary", () => {
  it("derives a bounded session from live page elements and hands it to the BG3D stage", () => {
    expect(stackSource).toContain("createStudioShared3dSceneSessionFromElements(");
    expect(stackSource).toContain("const sourceElements = masterEditMode ? [] : activePageElements");
    expect(stackSource).toContain("sharedSceneSession={shared3dSceneSession}");
  });

  it("loads the character renderer only inside the shared background scene", () => {
    expect(backgroundSource).toContain("StudioBg3dSharedCharacterSceneContent");
    expect(characterSceneContentSource).toContain(
      '() => import("./StudioBg3dSharedVrmCharacter")',
    );
    expect(backgroundSource).not.toContain("StudioBg3dSharedVrmCharacter");
    expect(characterSceneContentSource.match(
      /["']\.\/StudioBg3dSharedVrmCharacter["']/gu,
    )).toHaveLength(1);
    expect(backgroundSource).toContain("{sharedCharacterSceneContent}");
    expect(characterStatusSource).toContain("studio-bg3d-shared-characters-status");
    expect(characterStatusSource).toContain("포즈 원본은 각 캐릭터 레이어에 그대로 보존돼요");
    // The main View is a single stable owner in both single and quad layouts. Capture must never
    // move the character beneath another parent and restart its VRM/appearance generation.
    expect(backgroundSource.match(/\{sharedCharacterSceneContent\}/gu)).toHaveLength(1);
    const topView = backgroundSource.slice(
      backgroundSource.indexOf("<View track={viewTopRef"),
      backgroundSource.indexOf("<View track={viewFrontRef"),
    );
    const frontView = backgroundSource.slice(
      backgroundSource.indexOf("<View track={viewFrontRef"),
      backgroundSource.indexOf("<View track={viewRightRef"),
    );
    const rightView = backgroundSource.slice(
      backgroundSource.indexOf("<View track={viewRightRef"),
      backgroundSource.indexOf('<View\n                    key="studio-bg3d-main-view"'),
    );
    expect(topView).not.toContain("sharedCharacterSceneContent");
    expect(frontView).not.toContain("sharedCharacterSceneContent");
    expect(rightView).not.toContain("sharedCharacterSceneContent");
    expect(backgroundSource).toContain(
      "const mainViewTrackRef = effectiveIsQuadView ? viewPerspRef : viewportHostRef;",
    );
    expect(backgroundSource).toContain(
      "&& !placementActive\n    && !immersiveSceneActive;",
    );
  });

  it("keeps the initial background renderer on the lightweight shared-stage runtime", () => {
    expect(backgroundSource).toContain(
      'from "../studio-shared-3d-scene-runtime";',
    );
    expect(characterStatusHookSource).toContain(
      'from "./studio-shared-3d-scene-runtime";',
    );
    expect(characterPlacementPanelSource).toContain(
      'from "../studio-shared-3d-scene-runtime";',
    );
    expect(sharedSceneRuntimeSource).not.toContain("studio-vrm-avatar-forge");
    expect(sharedSceneRuntimeSource).not.toContain(
      "studio-vrm-linked-appearance-projection-plan",
    );
    expect(sharedSceneRuntimeSource).not.toContain("studio-vrm-wardrobe");
    expect(sharedSceneRuntimeSource).toContain(
      'import type {\n  StudioVrmSceneDocument,',
    );
  });

  it("keeps capture and viewport authority exclusively inside the stable main View", () => {
    const sceneContentStart = backgroundSource.indexOf("const sceneContent = (");
    const mainViewStart = backgroundSource.indexOf(
      '<View\n                    key="studio-bg3d-main-view"',
    );
    const mainViewEnd = backgroundSource.indexOf("</View>", mainViewStart);
    expect(sceneContentStart).toBeGreaterThanOrEqual(0);
    expect(mainViewStart).toBeGreaterThan(sceneContentStart);
    const sceneContent = backgroundSource.slice(sceneContentStart, mainViewStart);
    const mainView = backgroundSource.slice(mainViewStart, mainViewEnd);
    expect(sceneContent).not.toContain("<CaptureBridge");
    expect(sceneContent).not.toContain("<BgViewportController");
    expect(mainView.match(/<CaptureBridge/gu)).toHaveLength(1);
    expect(mainView.match(/<BgViewportController/gu)).toHaveLength(1);
  });

  it("reuses the loaded VRM until the linked model identity changes", () => {
    expect(characterSceneContentSource).toContain(
      "<Suspense key={source.modelRuntimeKey} fallback={null}>",
    );
    expect(characterSceneContentSource).not.toContain(
      "<Suspense key={source.runtimeKey}",
    );
  });

  it("owns one pristine proportion runtime before projecting pose, fit, or attachments", () => {
    const runtimeCreation = characterSource.indexOf(
      "createStudioBg3dLinkedVrmRuntimeOwner(",
    );
    const costumeCollection = characterSource.indexOf("collectStudioVrmCostumeMeshes(loaded)");
    const assetAdmission = characterSource.indexOf("setAsset({ vrm: loaded");
    expect(runtimeCreation).toBeGreaterThan(0);
    expect(costumeCollection).toBeGreaterThan(runtimeCreation);
    expect(assetAdmission).toBeGreaterThan(costumeCollection);
    expect(characterRuntimeSource).toContain("measureStudioVrmProportionHeadLength(vrm)");
    expect(characterRuntimeSource).toContain("createStudioVrmProportionRigRuntime(adapter");
    expect(characterRuntimeSource).toContain("createStudioVrmProportionFitTransaction(");
    expect(characterRuntimeSource).toContain("runtime.apply(forge.proportions)");
    expect(characterRuntimeSource).toContain("preparedIdentityKey");
    expect(characterSource).toContain("<StudioBg3dSharedVrmAppearanceRuntime");
  });

  it("keeps the two-frame receipt gate inside the already-lazy character leaf", () => {
    expect(appearanceRuntimeSource).toContain("StudioVrmPropAttachment");
    expect(appearanceRuntimeSource).toContain("StudioVrmWardrobeAttachment");
    expect(appearanceRuntimeSource).toContain("StudioVrmRuntimeCommit");
    expect(appearanceRuntimeSource).toContain('kind: "runtime-commit"');
    expect(appearanceRuntimeSource).toContain('kind: "post-commit"');
    expect(appearanceRuntimeSource).toContain("frame > current.commitFrame");
    expect(appearanceRuntimeSource.match(/invalidate\(\)/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(characterSceneContentSource).not.toContain(
      "StudioBg3dSharedVrmAppearanceRuntime",
    );
  });

  it("gates attachments on the prepared rig identity and disposes runtime before its VRM", () => {
    expect(appearanceRuntimeSource).toContain(
      "runtimeOwner.prepare(preparedSource, identityKey",
    );
    expect(appearanceRuntimeSource).toContain("preparedForIdentity");
    expect(appearanceRuntimeSource).toContain(
      "rigRevision={preparedForIdentity.rigRevision}",
    );
    expect(appearanceRuntimeSource).toContain(
      "result.prepared.receipt.modelGeneration !== runtimeOwner.modelGeneration",
    );

    const cleanup = characterSource.slice(characterSource.indexOf("return () => {"));
    expect(cleanup.indexOf("ownedRuntime.dispose()")).toBeGreaterThan(0);
    expect(cleanup.indexOf("disposeStudioVrmAsset(ownedVrm)"))
      .toBeGreaterThan(cleanup.indexOf("ownedRuntime.dispose()"));
  });

  it("keeps appearance planning pure and outside the heavy renderer boundary", () => {
    expect(appearancePlanSource).not.toMatch(/from ["'](?:react|three|@react-three\/fiber)/u);
    expect(appearancePlanSource).not.toContain("StudioVrmPoser");
    expect(appearancePlanSource).toContain("inspectVrmPropsDocumentForProjection");
    expect(characterSceneContentSource).not.toContain(
      "studio-vrm-linked-appearance-projection-plan",
    );
  });

  it("resolves both bundled and content-addressed VRM sources without schema conversion", () => {
    expect(characterRuntimeSource).toContain("selectableSampleVrmUrl(scene.model.id)");
    expect(characterRuntimeSource).toContain("getStoredVrmModelByHash(scene.model.hash)");
    expect(characterRuntimeSource).toContain("applyPoseToVrm(");
    expect(characterRuntimeSource).toContain("applyExpressionWeightsToVrm");
    expect(characterRuntimeSource).not.toContain("StudioBg3dModelNode");
  });

  it("hides only receipt-confirmed sources in the same Studio document transition", () => {
    expect(pageSource).toContain("planStudioShared3dCapturedSourceLayerVisibility({");
    expect(pageSource).toContain("let nextElements = [...sharedCharacterVisibility.nextElements]");
    expect(pageSource).toContain("hiddenElementIds.length > 0");
  });
});
