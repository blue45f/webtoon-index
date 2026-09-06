import { describe, expect, it } from "vitest";

import {
  restoreStudioHybridDccStateFromSnapshot,
  snapshotStudioHybridDccState,
} from "./studio-hybrid-dcc-document";
import {
  workspaceAddActiveModifier,
  workspaceRedoWithModifierPreviews,
  workspaceRefreshModifierPreviews,
  workspaceUndoWithModifierPreviews,
} from "./studio-hybrid-dcc-modifier-workspace";
import {
  createStudioHybridDccWorkspace,
  workspaceAddUnitCube,
  workspaceCommitActiveObjectTransform,
  workspaceExportActiveMesh,
} from "./studio-hybrid-dcc-workspace";

describe("Hybrid DCC modifier cache workspace integrity", () => {
  it("preserves the validated presentation hash across common bridge sync and deterministic restore", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("cache-sync"),
      "hero",
    );
    workspace = await workspaceAddActiveModifier(workspace, "array");
    const previewRecord = workspace.session.state.geometry.records.hero!;
    const previewHash = previewRecord.renderCache!.derivedFromHash;
    const authorityRevision = previewRecord.revision;
    const stateHash = workspace.session.state.stateHash;

    workspace = workspaceCommitActiveObjectTransform(workspace, {
      revision: 1,
      position: [3, 1, -2],
      rotationEulerRad: [0, 0.5, 0],
      scale: [1, 1, 1],
    });
    expect(workspace.session.state.geometry.records.hero!.revision).toBe(authorityRevision);
    expect(workspace.bridge.set.objects.find(({ id }) => id === "hero")?.geometryHash)
      .toBe(previewHash);

    const undone = await workspaceUndoWithModifierPreviews(workspace);
    expect(undone.session.state.stateHash).toBe(stateHash);
    expect(undone.session.state.geometry.records.hero!.revision).toBe(authorityRevision);
    expect(undone.session.state.geometry.records.hero!.renderCache?.derivedFromHash).toBe(previewHash);
    expect(undone.bridge.set.objects.find(({ id }) => id === "hero")?.geometryHash)
      .toBe(previewHash);

    const redone = await workspaceRedoWithModifierPreviews(undone);
    expect(redone.session.state.geometry.records.hero!.revision).toBe(authorityRevision);
    expect(redone.session.state.geometry.records.hero!.renderCache?.derivedFromHash).toBe(previewHash);
    expect(redone.bridge.set.objects.find(({ id }) => id === "hero")?.geometryHash)
      .toBe(previewHash);

    const snapshot = snapshotStudioHybridDccState(redone.session.state);
    const restoredState = restoreStudioHybridDccStateFromSnapshot(snapshot);
    expect(restoredState.geometry.records.hero!.renderCache).toBeNull();
    const cold = await workspaceRefreshModifierPreviews({
      ...redone,
      session: { ...redone.session, state: restoredState },
    });
    expect(cold.session.state.stateHash).toBe(restoredState.stateHash);
    expect(cold.session.state.geometry.records.hero!.revision).toBe(authorityRevision);
    expect(cold.session.state.geometry.records.hero!.renderCache?.derivedFromHash).toBe(previewHash);
    expect(cold.bridge.set.objects.find(({ id }) => id === "hero")?.geometryHash)
      .toBe(previewHash);
  });

  it("blocks synchronous mesh export instead of silently exporting the source cage", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("cache-export-gate"),
      "array-prop",
    );
    workspace = await workspaceAddActiveModifier(workspace, "array");

    expect(() => workspaceExportActiveMesh(workspace, "obj"))
      .toThrow(/비파괴 변형.*원본 케이지/u);
    expect(workspace.lastExport).toBeNull();
  });
});
