import { describe, expect, it } from "vitest";

import {
  createStudioHybridDccComponentSelection,
  mutateStudioHybridDccComponentSelection,
  type StudioHybridDccComponentSelection,
  type StudioHybridDccSelectionResult,
} from "./studio-hybrid-dcc-component-selection";
import {
  createStudioHybridDccWorkspace,
  workspaceAddUnitCube,
  workspaceCommitActiveObjectTransform,
  workspaceComponentSelectionSource,
  workspaceExtrudeRegionActive,
  workspaceReconcileSelectionAfterHistory,
  workspaceRedo,
  workspaceUndo,
} from "./studio-hybrid-dcc-workspace";

function value<T>(result: StudioHybridDccSelectionResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected a successful selection result");
  return result.value;
}

function faceSelection(
  workspace: ReturnType<typeof workspaceAddUnitCube>,
  faceIds: readonly number[],
  activeId = faceIds.at(-1) ?? null,
): StudioHybridDccComponentSelection {
  const source = workspaceComponentSelectionSource(workspace);
  if (!source) throw new Error("expected an active mesh selection source");
  return value(mutateStudioHybridDccComponentSelection(
    createStudioHybridDccComponentSelection(),
    {
      mode: "face",
      operation: "replace",
      ids: faceIds,
      activeId,
      source,
    },
  ));
}

describe("Hybrid DCC region extrude workspace selection integration", () => {
  it("atomically remaps selected and active faces onto the new region caps", () => {
    const before = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("region-selection"),
      "cube",
    );
    const beforeRecord = before.session.state.geometry.records.cube!;
    const selection = faceSelection(before, [0, 2], 2);

    const result = workspaceExtrudeRegionActive(before, selection, 0.25);
    const afterRecord = result.workspace.session.state.geometry.records.cube!;
    const expectedActive = result.receipt.capFaceIds[
      result.receipt.sourceFaceIds.indexOf(selection.activeElementId!)
    ];

    expect(result.receipt.sourceFaceIds).toEqual(selection.elementIds);
    expect(result.receipt.connectedRegionCount).toBe(1);
    expect(result.selection).toMatchObject({
      mode: "face",
      objectIds: ["cube"],
      activeObjectId: "cube",
      elementIds: result.receipt.capFaceIds,
      activeElementId: expectedActive,
      provenance: {
        assetId: "cube",
        meshRevision: beforeRecord.revision + 1,
        sourceHash: result.receipt.resultMeshHash,
      },
    });
    expect(afterRecord.meshHash).toBe(result.receipt.resultMeshHash);
    expect(afterRecord.revision).toBe(beforeRecord.revision + 1);
    expect(result.workspace.bridge.set.objects.find(({ id }) => id === "cube")?.geometryHash)
      .toBe(afterRecord.meshHash);
    expect(JSON.stringify(result.workspace.session.journal.records)).toContain(
      "geometry.extrude-region",
    );
    expect(JSON.stringify(result.workspace.session.journal.records)).toContain(
      result.receipt.sourceMeshHash,
    );
  });

  it("preserves canonical component selection across non-topology undo and redo", () => {
    const before = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("transform-history-selection"),
      "cube",
    );
    const selection = faceSelection(before, [0, 2], 2);
    const transformed = workspaceCommitActiveObjectTransform(before, {
      revision: 1,
      position: [2, -1, 3],
      rotationEulerRad: [0.1, 0.2, -0.3],
      scale: [1.2, 0.8, 1.5],
    });

    const undoneWorkspace = workspaceUndo(transformed);
    const afterUndo = workspaceReconcileSelectionAfterHistory(undoneWorkspace, selection);
    expect(afterUndo).toBe(selection);

    const redoneWorkspace = workspaceRedo(undoneWorkspace);
    const afterRedo = workspaceReconcileSelectionAfterHistory(redoneWorkspace, afterUndo);
    expect(afterRedo).toBe(selection);
    if (!selection.provenance) throw new Error("expected canonical face selection provenance");
    expect(workspaceComponentSelectionSource(redoneWorkspace)).toMatchObject(
      selection.provenance,
    );
  });

  it("clears component IDs across undo/redo instead of aliasing cap IDs onto restored faces", () => {
    const before = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("region-history-selection"),
      "cube",
    );
    const mutation = workspaceExtrudeRegionActive(before, faceSelection(before, [0, 2], 2), 0.25);

    const undoneWorkspace = workspaceUndo(mutation.workspace);
    const afterUndo = workspaceReconcileSelectionAfterHistory(
      undoneWorkspace,
      mutation.selection,
    );
    const undoneRecord = undoneWorkspace.session.state.geometry.records.cube!;
    expect(afterUndo).toMatchObject({
      mode: "face",
      objectIds: ["cube"],
      activeObjectId: "cube",
      elementIds: [],
      activeElementId: null,
      provenance: {
        meshRevision: undoneRecord.revision,
        sourceHash: undoneRecord.meshHash,
      },
    });

    const redoneWorkspace = workspaceRedo(undoneWorkspace);
    const afterRedo = workspaceReconcileSelectionAfterHistory(redoneWorkspace, afterUndo);
    const redoneRecord = redoneWorkspace.session.state.geometry.records.cube!;
    expect(afterRedo.elementIds).toEqual([]);
    expect(afterRedo.activeElementId).toBeNull();
    expect(afterRedo.provenance).toMatchObject({
      meshRevision: redoneRecord.revision,
      sourceHash: redoneRecord.meshHash,
    });
    expect(redoneRecord.meshHash).toBe(mutation.receipt.resultMeshHash);
  });

  it("rejects object-mode calls so the compatibility default cannot masquerade as face authority", () => {
    const workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("region-object-selection"),
      "cube",
    );
    expect(() => workspaceExtrudeRegionActive(
      workspace,
      createStudioHybridDccComponentSelection(),
      0.25,
    )).toThrow("non-empty face selection");
  });
});
