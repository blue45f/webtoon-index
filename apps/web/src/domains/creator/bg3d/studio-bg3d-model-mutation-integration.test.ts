import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const source = readStudioBg3dEditorSource();
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

describe("Studio BG3D model placement and persistent deletion integration", () => {
  it("admits additive UI mutations before advancing the authoritative live scene", () => {
    const additive = sourceBetween(
      "const canAdmitSceneNodes = (",
      "const applyMultiSelectDelta = (",
    );
    expect(additive).toContain("live.primitives.length + live.customModels.length > nodeLimit - additionalNodeCount");
    expect(additive).toContain("if (!canAdmitSceneNodes(1)) return");
    expect(additive).toContain("if (parts.length === 0 || !canAdmitSceneNodes(parts.length)) return");
    expectInOrder(additive, [
      "if (!canAdmitSceneNodes(primitivePairs.length + modelPairs.length)) return",
      "physicsRuntimeSourceRef.current = {",
      "setPrimitives(nextPrimitives)",
      "setCustomModels(nextCustomModels)",
    ]);
  });

  it("threads revocable leases through decode, cache ownership, and destructive persistence", () => {
    const admission = sourceBetweenIn(
      admissionSource,
      "export async function admitAndCacheStudioBg3dModel(",
      "export function disposeStudioBg3dModelCache(",
    );
    const add = sourceBetween(
      "async function ensureModelRootCached(",
      "function publishPlacementSession(",
    );
    const remove = sourceBetweenIn(
      modelImportActionsSource,
      "async function handleDeleteModelFromLibrary(",
      MODEL_IMPORT_ACTIONS_TAIL,
    );

    expectInOrder(admission, [
      "const task = studioBg3dGlobalAssetLoadGate.run(",
      "async (lease)",
      "lease.throwIfRevoked()",
      "const combinedSignal = combineStudioBg3dAbortSignals(",
      "signal: combinedSignal.signal",
      "if (!lease.isCurrent() || !args.isActive())",
      "loaded.dispose()",
      "args.cache.set(args.record.id, entry)",
      "combinedSignal.dispose()",
    ]);
    expect(add).toContain(
      "isActive: () => isModalAssetSessionCurrent(session) && isOperationCurrent()",
    );
    expectInOrder(remove, [
      "async (lease) =>",
      "lease.throwIfRevoked()",
      "deleteStoredBg3dModel(storageModelId, { signal: lease.signal })",
      "commitSceneEntityRemoval(plan, { resetHistory: true })",
      "authoritativePersistence: true",
    ]);
  });

  it("runs cheap live-scene admission on every cache hit while caching only profile attestation", () => {
    const cachedBranch = sourceBetweenIn(
      admissionSource,
      "const cached = args.cache.get(args.record.id);",
      "const pending = args.pending.get(args.record.id);",
    );
    expectInOrder(cachedBranch, [
      "assertStudioBg3dModelPlacementAdmission({",
      "if (!cached.admittedProfiles.has(policy.profile))",
      "admitStoredBg3dModelForRendering(args.record.id",
      "cached.admittedProfiles.add(policy.profile)",
    ]);
    expect(cachedBranch.match(/assertStudioBg3dModelPlacementAdmission/gu)).toHaveLength(1);
  });

  it("calculates a queued add from the authoritative live ref rather than render closures", () => {
    const ensure = sourceBetween(
      "async function ensureModelRootCached(",
      "async function addCustomModelToScene(",
    );
    expectInOrder(ensure, [
      "const live = physicsRuntimeSourceRef.current",
      "calculateStudioBg3dPlacedModelBytes(",
      "live.customModels",
      "document: live.document",
    ]);
    expect(ensure).not.toContain("calculateStudioBg3dPlacedModelBytes(\n      customModels");
  });

  it("re-admits distinct attachments and bytes before single, template, and bulk authority advances", () => {
    const ensure = sourceBetween(
      "async function ensureModelRootCached(",
      "function publishPlacementSession(",
    );
    const commit = sourceBetween(
      "function commitCustomModelPlacement(",
      "async function addCustomModelToScene(",
    );
    const upload = sourceBetweenIn(
      modelImportActionsSource,
      "async function handleUploadModelFiles(",
      "async function handleDeleteModelFromLibrary(",
    );
    const template = sourceBetween(
      "async function applyUserTemplate(",
      "function reportLtUserPresetMutationFailure(",
    );
    expectInOrder(ensure, [
      "const live = physicsRuntimeSourceRef.current",
      "assertStudioBg3dModelAttachmentAdmission({",
      "await admitAndCacheModel({",
      "if (!bindModelAttachment({",
    ]);
    expectInOrder(commit, [
      "assertStudioBg3dModelAttachmentAdmission({",
      "maximumCumulativeBytes: runtime.document.budgets.complexity.maxModelBytes",
      "commitImmediateHistoryTransition(",
      "physicsRuntimeSourceRef.current =",
    ]);
    const templateCommit = template.lastIndexOf("assertStudioBg3dModelAttachmentAdmission({");
    expect(templateCommit).toBeGreaterThan(-1);
    expectInOrder(template.slice(templateCommit), [
      "models: current.customModels",
      "candidateAttachments: preparedAttachments",
      "maximumCumulativeBytes: current.document.budgets.complexity.maxModelBytes",
      "attachmentByStorageModelIdRef.current.clear()",
      "physicsRuntimeSourceRef.current =",
    ]);
    expectInOrder(upload, [
      "assertStudioBg3dModelAttachmentAdmission({",
      "const stagedAttachments = new Map",
      "const nextAttachmentByStorageId = new Map",
    ]);
    const uploadCommit = upload.lastIndexOf("assertStudioBg3dModelAttachmentAdmission({");
    expect(uploadCommit).toBeGreaterThan(-1);
    expectInOrder(upload.slice(uploadCommit), [
      "models: current.customModels",
      "candidateAttachments",
      "maximumCumulativeBytes: current.document.budgets.complexity.maxModelBytes",
      "attachmentByStorageModelIdRef.current.clear()",
      "physicsRuntimeSourceRef.current =",
    ]);
  });

  it("preflights detachment before IndexedDB delete and advances one snapshot before React state", () => {
    const handler = sourceBetweenIn(
      modelImportActionsSource,
      "async function handleDeleteModelFromLibrary(",
      MODEL_IMPORT_ACTIONS_TAIL,
    );
    const commit = sourceBetween(
      "const commitSceneEntityRemoval = (",
      "const removeSceneEntities = (",
    );
    expectInOrder(handler, [
      "preflightAndDeleteStudioBg3dPersistedModel({",
      "snapshot: physicsRuntimeSourceRef.current",
      "deletePersistedModel: (storageModelId) =>",
      "deleteStoredBg3dModel(storageModelId, { signal: lease.signal })",
      "commitSceneEntityRemoval(plan, { resetHistory: true })",
      "attachmentByStorageModelIdRef.current.delete(id)",
      "modelRootCacheRef.current.delete(id)",
      "authoritativePersistence: true",
    ]);
    expect(handler).not.toContain("removeSceneEntities(removedInstanceIds)");
    expectInOrder(commit, [
      "physicsRuntimeSourceRef.current = {",
      "setPrimitives(next.primitives)",
      "setCustomModels(next.customModels)",
      "setSceneBaseDocument(next.document)",
    ]);
    expect(commit).toContain("historyRef.current = [createStudioBg3dHistorySnapshot(next)]");
  });

  it("waits for a prior destructive lane and replays its durable journal before hydration", () => {
    const restoration = sourceBetween(
      "await studioBg3dModalOperationCoordinator.waitForSceneMutationLane()",
      "}, [open, initialDataUrl, initialScene, modelRenderer]);",
    );
    expectInOrder(restoration, [
      "await studioBg3dModalOperationCoordinator.waitForSceneMutationLane()",
      "resolveBg3dModelHash(attachment.hash",
      "const record = resolution.record",
      "if (resolution.deletionReceipt)",
      "planStudioBg3dDeletedAttachmentReconciliation({",
      "hydrateStudioBg3dDocumentToRuntime({",
      "document: restoredDocument",
    ]);
  });

  it("hands undo and redo camera compositions to a replacement projection controller", () => {
    const undoRedo = sourceBetween("const doUndo = () => {", "const addPrimitive = (");
    expect(undoRedo.match(/applyOrDeferStudioBg3dHistoryCamera\(/gu)).toHaveLength(2);
    expect(undoRedo.match(/pendingInitialCameraRef/gu)).toHaveLength(2);
    expect(undoRedo.match(/snap\.document\.camera/gu)).toHaveLength(2);
    expect(undoRedo.match(/physicsRuntimeSourceRef\.current =/gu)).toHaveLength(2);
  });
});
