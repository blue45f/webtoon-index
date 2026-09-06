import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const source = readStudioBg3dEditorSource();
const runtimeHintsSource = readFileSync(
  new URL("../studio-generic-3d-runtime-hints.ts", import.meta.url),
  "utf8",
);
const admissionSource = readFileSync(
  new URL("./studio-bg3d-model-runtime-admission.ts", import.meta.url),
  "utf8",
);
// 2026-08-21 intentional change: handleUploadModelFiles and handleDeleteModelFromLibrary moved
// out of StudioBackground3D.tsx into studio-bg3d-editor-model-import-actions.ts (editor split).
// Their markers resolve in that module now; the module tail replaces the old end marker.
const modelImportActionsSource = readFileSync(
  new URL("./studio-bg3d-editor-model-import-actions.ts", import.meta.url),
  "utf8",
);
const MODEL_IMPORT_ACTIONS_TAIL =
  "return { handleDeleteModelFromLibrary, handleUploadModelFiles };";

function sourceBetweenIn(haystack: string, startNeedle: string, endNeedle: string): string {
  const start = haystack.indexOf(startNeedle);
  const end = haystack.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return haystack.slice(start, end);
}

function sourceBetween(startNeedle: string, endNeedle: string): string {
  return sourceBetweenIn(source, startNeedle, endNeedle);
}

function expectInOrder(haystack: string, needles: readonly string[]): void {
  let cursor = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle, cursor + 1);
    expect(index, `Expected ${JSON.stringify(needle)} after ${cursor}`).toBeGreaterThan(cursor);
    cursor = index;
  }
}

describe("Studio BG3D generic model mode integration boundary", () => {
  it("owns an explicit generic 3D tab without coupling it to a VRM runtime", () => {
    expect(source).toContain('{ id: "models", label: "에셋"');
    expect(source).toContain("aria-label={tab.label}");
    expect(source).toContain("<StudioGeneric3dModelModePanel");
    expect(source).toContain("VRM 별도");
    expect(source).toContain("VRM 아바타의 humanoid·표정·이용 조건과 섞지 않고");
    expect(source).not.toContain('from "../vrm/StudioVrmPoser"');
    expect(source).not.toContain('from "./studio-vrm');
  });

  it("records the original GLB, glTF, or OBJ/MTL boundary only after canonical admission", () => {
    const upload = sourceBetweenIn(
      modelImportActionsSource,
      "async function handleUploadModelFiles(",
      "async function handleDeleteModelFromLibrary(",
    );

    expectInOrder(upload, [
      "deriveStudioBg3dGlbValidationPolicy(sceneBaseDocument, deviceQuality)",
      "modelImportRuntime.planStudioBg3dModelImports(files)",
      'item.format === "gltf"',
      'item.format === "obj"',
      'hasSelectedMtl ? "obj-mtl" : "obj"',
      "modelImportRuntime.convertStudioBg3dModelFilesToGlb(files",
      "profile: policy.profile",
      "budgets: policy.budgets",
      "await importVerifiedBg3dModelsAtomically(",
      "withStudioGeneric3dWorkflowMetadata(",
      "await admitAndCacheModel({",
      "mergeStudioGeneric3dWorkflowMaps(previous, importedFormats)",
      "uploadCommitted = true",
    ]);
    expect(source).toContain('from "../studio-generic-3d-workflow-metadata"');
    expect(admissionSource).toContain("attachStudioGeneric3dWorkflowMetadata");
    expect(source).toContain("parseStudioGeneric3dWorkflowMetadata");
    expect(upload.match(/executionBackend: "worker"/gu)).toHaveLength(2);
  });

  it("profiles renderer structure once while keeping unsupported child transforms read-only", () => {
    const admission = sourceBetweenIn(
      admissionSource,
      "export async function admitAndCacheStudioBg3dModel(",
      "export function disposeStudioBg3dModelCache(",
    );

    expect(admissionSource).toContain('from "../studio-generic-3d-runtime-hints"');
    expect(runtimeHintsSource).toContain("function inspectStudioGeneric3dRuntimeHints(");
    expect(runtimeHintsSource).toContain("partTransformsSupported: false");
    expect(runtimeHintsSource).toContain("renderable.isSkinnedMesh === true");
    expect(runtimeHintsSource).toContain("mapped.normalMap?.isTexture");
    expect(runtimeHintsSource).toContain(
      "new Set(joints.map((joint) => joint.canonicalKey)).size",
    );
    expectInOrder(admission, [
      "loadVerifiedStudioBg3dGlbWithThree",
      "assertStudioBg3dModelPlacementAdmission({",
      "const joints = collectStudioBg3dThreeJoints(loaded.root)",
      "genericHints: inspectStudioGeneric3dRuntimeHints(loaded.root, joints)",
      "args.cache.set(args.record.id, entry)",
    ]);
  });

  it("builds the selected manifest from the verified record and current admitted profile", () => {
    const selection = sourceBetween(
      "const selectedModelCacheEntry = selectedCustomModel",
      "const selectedJointByKey = new Map",
    );

    expect(selection).toContain("createStudioGeneric3dVerifiedManifest({");
    expect(selection).toContain("sourceFormat: genericModelSourceFormats.get(selectedCustomModel.modelId) ?? \"glb\"");
    expect(selection).toContain("profile: deviceQuality.profile");
    expect(selection).toContain("contentHash: selectedModelCacheEntry.record.contentHash");
    expect(selection).toContain("metrics: selectedModelCacheEntry.record.validatorMetrics");
    expect(selection).toContain("createStudioGeneric3dRightsFromAttachment(selectedModelCacheEntry.record.rights)");
    expect(selection).toContain("...selectedModelCacheEntry.genericHints");
    expect(selection).toContain("createStudioGeneric3dPoseProxies({");
    expect(selection).toContain("isBone: true");
  });

  it("connects a bone proxy selection to the existing model-owned pose selection", () => {
    const selectProxy = sourceBetween(
      "function selectGenericModelProxy(",
      "const selectedJointByKey = new Map",
    );
    expectInOrder(selectProxy, [
      "setGenericModelSelectedProxyId(proxyId)",
      "selectedGenericModelProxies.find",
      'proxy?.operation === "bone-rotate"',
      "setPoseJointSelection({ modelId: selectedCustomModel.id, key: proxy.targetKey })",
    ]);
  });

  it("persists classification changes onto attachment workflow metadata", () => {
    const change = sourceBetween(
      "function changeSelectedGenericModelClassification(",
      "function changeGenericModelControlMode(",
    );
    expectInOrder(change, [
      "normalizeStudioGeneric3dClassification(classification)",
      "withStudioGeneric3dWorkflowMetadata(existing, {",
      "mergeStudioGeneric3dWorkflowMaps(previous, new Map([[storageId, normalized]]))",
    ]);
  });

  it("removes session-only source and classification metadata with persistent deletion", () => {
    const remove = sourceBetweenIn(
      modelImportActionsSource,
      "async function handleDeleteModelFromLibrary(",
      MODEL_IMPORT_ACTIONS_TAIL,
    );
    expectInOrder(remove, [
      "preflightAndDeleteStudioBg3dPersistedModel({",
      "commitSceneEntityRemoval(plan, { resetHistory: true })",
      "setGenericModelSourceFormats((previous) =>",
      "next.delete(id)",
      "setGenericModelClassifications((previous) =>",
      "next.delete(id)",
    ]);
  });
});
