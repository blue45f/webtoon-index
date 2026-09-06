import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

const poserSource = readStudioVrmPoserImplementationSource();
// 2026-08-21 의도적 변경: BONE_CATEGORIES 등 정적 카탈로그가 StudioVrmPoser.tsx에서
// studio-vrm-poser-catalogs.ts로 분리됐다. 마커만 옮기고 검증 대상(시선/턱 카테고리가
// leftEye/rightEye/jaw를 덮는다)은 그대로 유지한다.
const catalogsSource = readFileSync(
  new URL("./studio-vrm-poser-catalogs.ts", import.meta.url),
  "utf8",
);
const panelSource = readFileSync(
  new URL("./StudioVrmPoseMaterialPanel.tsx", import.meta.url),
  "utf8",
);
const bakeSource = readFileSync(new URL("./studio-vrm-pose-bake.ts", import.meta.url), "utf8");
const runtimeSource = readFileSync(
  new URL("./studio-vrm-poser-utils.ts", import.meta.url),
  "utf8",
);

describe("Studio VRM portable pose-material production boundary", () => {
  it("connects the strict material core to the live poser through a dedicated runtime adapter", () => {
    expect(poserSource).toContain('from "./studio-vrm-pose-material-adapter"');
    expect(poserSource).toContain("<StudioVrmPoseMaterialPanel");
    expect(poserSource).toContain("captureStudioVrmPoseMaterial(currentVrm, options)");
    expect(poserSource).toContain("applyStudioVrmPoseMaterial(currentVrm, material, {");
    expect(poserSource).toContain("lockedBones: portableLockedPoseBones()");
    expect(poserSource).toContain("...(strength !== undefined ? { strength } : {})");
    expect(poserSource).toContain('const poseId = `pose-material:${result.materialId}`');
    expect(panelSource).toContain("적용 강도");
    expect(panelSource).toContain("onApply(material, scope, applyStrength)");
  });

  it("records one immediate before/after undo command and preserves non-pose state", () => {
    const beforeIndex = poserSource.indexOf("const before = captureFullState()");
    const applyIndex = poserSource.indexOf("const result = applyStudioVrmPoseMaterial", beforeIndex);
    const historyIndex = poserSource.indexOf(
      "commitStudioVrmFullStateHistoryTransaction(",
      applyIndex,
    );
    const stateIndex = poserSource.indexOf("setCustomBones(result.bones)", historyIndex);

    expect(beforeIndex).toBeGreaterThan(-1);
    expect(applyIndex).toBeGreaterThan(beforeIndex);
    expect(historyIndex).toBeGreaterThan(applyIndex);
    expect(stateIndex).toBeGreaterThan(historyIndex);
    expect(poserSource).toContain("...before,");
    expect(poserSource).toContain("fingerOverrides: result.fingerEdits");
    expect(poserSource).toContain("yOffset: customYOffset");
    expect(poserSource).toContain(
      "setCanRedo(nextHistory.index < nextHistory.entries.length - 1)",
    );
  });

  it("uses the shared 55-bone allowlist for both runtime application and scene bake", () => {
    expect(runtimeSource).toContain(
      "export const STUDIO_VRM_APPLIED_HUMANOID_BONES = STUDIO_HUMANOID_BONE_NAMES",
    );
    expect(runtimeSource).toContain("PRE_DIRECTION_ROTATION_BONE_ORDER.forEach");
    expect(runtimeSource).toContain("POST_DIRECTION_ROTATION_BONE_ORDER.forEach");
    expect(bakeSource).toContain("STUDIO_HUMANOID_BONE_NAMES;");
    expect(catalogsSource).toContain('{ id: "gaze", label: "시선/턱", bones: ["leftEye", "rightEye", "jaw"] }');
  });

  it("keeps future/corrupt rows read-only, uses SQLite merge, and separates legacy Euler poses", () => {
    expect(panelSource).toContain('["future", "corrupt", "read-error", "unavailable"]');
    expect(panelSource).toContain("legacyStorageSeam ? storageAdapter : inMemoryStorage(panelState.payload)");
    expect(panelSource).toContain("repository.save(optimisticPayload)");
    expect(panelSource).toContain('json,\n        "merge",');
    expect(panelSource).not.toContain('json,\n        "replace",');
    expect(panelSource).toContain("onMaterialReplaced?.(material.id)");
    expect(poserSource).toContain("mergeStudioVrmFingerRotationsIntoBones(customBones, fingerEdits)");
    expect(poserSource).toContain('activePoseId.startsWith("pose-material:")');
    expect(poserSource).toContain("findPoseById(activePoseId) === null");
  });
});
