import { describe, expect, it } from "vitest";

import { studioEditableMeshToTriangleSoup } from "../studio-editable-half-edge-mesh";

import { restoreStudioHybridDccStateFromSnapshot, snapshotStudioHybridDccState } from "./studio-hybrid-dcc-document";
import {
  workspaceAddActiveModifier,
  workspaceApplyActiveModifierStack,
  workspaceMoveActiveModifier,
  workspacePatchActiveModifier,
  workspaceRedoWithModifierPreviews,
  workspaceToggleActiveModifier,
  workspaceUndoWithModifierPreviews,
} from "./studio-hybrid-dcc-modifier-workspace";
import {
  createStudioHybridDccWorkspace,
  workspaceAddUnitCube,
  workspaceCommitObjectTransform,
  workspaceSelectAsset,
} from "./studio-hybrid-dcc-workspace";

describe("Hybrid DCC non-destructive modifier workspace", () => {
  it("adds an evaluator-supported bevel and clamps unavailable multi-segment patches", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("modifier-bevel-default"),
      "beveled-cube",
    );

    workspace = await workspaceAddActiveModifier(workspace, "bevel");
    const added = workspace.session.state.geometry.records["beveled-cube"]!;
    const modifier = added.modifierStack.modifiers[0]!;
    expect(modifier).toMatchObject({ kind: "bevel", segments: 1 });
    expect(added.renderCache).not.toBeNull();

    workspace = await workspacePatchActiveModifier(workspace, modifier.id, { segments: 8 });
    expect(workspace.session.state.geometry.records["beveled-cube"]!
      .modifierStack.modifiers[0]).toMatchObject({ kind: "bevel", segments: 1 });
  });

  it("keeps the source mesh authoritative while previewing and undoing a stack edit", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("modifier-preview"),
      "hero",
    );
    const source = workspace.session.state.geometry.records.hero!;
    const sourceHash = source.meshHash;
    const sourceMesh = source.mesh;

    workspace = await workspaceAddActiveModifier(workspace, "mirror");
    const preview = workspace.session.state.geometry.records.hero!;
    expect(preview.mesh).toBe(sourceMesh);
    expect(preview.meshHash).toBe(sourceHash);
    expect(preview.modifierStack.modifiers).toHaveLength(1);
    expect(preview.renderCache).not.toBeNull();
    expect(preview.renderCache?.derivedFromHash).not.toBe(sourceHash);
    expect(workspace.bridge.set.objects.find(({ id }) => id === "hero")?.geometryHash)
      .toBe(preview.renderCache?.derivedFromHash);

    workspace = await workspaceUndoWithModifierPreviews(workspace);
    const undone = workspace.session.state.geometry.records.hero!;
    expect(undone.meshHash).toBe(sourceHash);
    expect(undone.modifierStack.modifiers).toHaveLength(0);

    workspace = await workspaceRedoWithModifierPreviews(workspace);
    const redone = workspace.session.state.geometry.records.hero!;
    expect(redone.meshHash).toBe(sourceHash);
    expect(redone.modifierStack.modifiers).toHaveLength(1);
    expect(redone.renderCache).not.toBeNull();
  });

  it("edits, reorders, toggles, and serializes the exact stack", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("modifier-order"),
      "prop",
    );
    workspace = await workspaceAddActiveModifier(workspace, "solidify");
    workspace = await workspaceAddActiveModifier(workspace, "array");
    let stack = workspace.session.state.geometry.records.prop!.modifierStack;
    const solidifyId = stack.modifiers[0]!.id;
    const arrayId = stack.modifiers[1]!.id;

    workspace = await workspacePatchActiveModifier(workspace, arrayId, {
      count: 7,
      offset: { x: 0.75, y: 0.1, z: -0.25 },
    });
    workspace = await workspaceMoveActiveModifier(workspace, arrayId, "up");
    workspace = await workspaceToggleActiveModifier(workspace, solidifyId);
    stack = workspace.session.state.geometry.records.prop!.modifierStack;
    expect(stack.modifiers.map(({ id }) => id)).toEqual([arrayId, solidifyId]);
    expect(stack.modifiers[0]).toMatchObject({ kind: "array", count: 7 });
    expect(stack.modifiers[1]).toMatchObject({ kind: "solidify", enabled: false });

    const snapshot = snapshotStudioHybridDccState(workspace.session.state);
    const restored = restoreStudioHybridDccStateFromSnapshot(snapshot);
    expect(restored.stateHash).toBe(workspace.session.state.stateHash);
    expect(restored.geometry.records.prop!.modifierStack.modifiers)
      .toEqual(stack.modifiers);
  });

  it("applies evaluated geometry and clears the stack in one undoable command", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("modifier-apply"),
      "shell",
    );
    const sourceHash = workspace.session.state.geometry.records.shell!.meshHash;
    workspace = await workspaceAddActiveModifier(workspace, "solidify");
    const previewCommandCount = workspace.session.state.commandCount;
    const previewHash = workspace.session.state.geometry.records.shell!.renderCache!.derivedFromHash;

    workspace = await workspaceApplyActiveModifierStack(workspace);
    const applied = workspace.session.state.geometry.records.shell!;
    expect(workspace.session.state.commandCount).toBe(previewCommandCount + 1);
    expect(applied.modifierStack.modifiers).toHaveLength(0);
    expect(applied.meshHash).toBe(previewHash);
    expect(applied.meshHash).not.toBe(sourceHash);

    workspace = await workspaceUndoWithModifierPreviews(workspace);
    const restoredPreview = workspace.session.state.geometry.records.shell!;
    expect(restoredPreview.meshHash).toBe(sourceHash);
    expect(restoredPreview.modifierStack.modifiers).toHaveLength(1);
    expect(restoredPreview.renderCache?.derivedFromHash).toBe(previewHash);

    workspace = await workspaceRedoWithModifierPreviews(workspace);
    const reapplied = workspace.session.state.geometry.records.shell!;
    expect(reapplied.meshHash).toBe(previewHash);
    expect(reapplied.modifierStack.modifiers).toHaveLength(0);
  });

  it("evaluates the cutter stack in active-local TRS and preserves its rights lineage on apply", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("modifier-boolean-lineage"),
      "hero",
    );
    workspace = workspaceAddUnitCube(workspace, "cutter");
    workspace = workspaceCommitObjectTransform(workspace, "hero", {
      revision: 1,
      position: [10, 5, 0],
      rotationEulerRad: [0, 0, Math.PI / 2],
      scale: [2, 2, 1],
    });
    workspace = workspaceCommitObjectTransform(workspace, "cutter", {
      revision: 1,
      position: [10, 5, 0],
      rotationEulerRad: [0, 0, 0],
      scale: [1, 1, 1],
    });
    workspace = workspaceSelectAsset(workspace, "cutter");
    workspace = await workspaceAddActiveModifier(workspace, "array");
    const cutterArray = workspace.session.state.geometry.records.cutter!
      .modifierStack.modifiers[0]!;
    workspace = await workspacePatchActiveModifier(workspace, cutterArray.id, {
      count: 2,
      offset: { x: 3, y: 0, z: 0 },
    });

    const cutterSourceSoup = studioEditableMeshToTriangleSoup(
      workspace.session.state.geometry.records.cutter!.mesh,
    );
    workspace = workspaceSelectAsset(workspace, "hero");
    workspace = await workspaceAddActiveModifier(workspace, "boolean");
    const booleanModifier = workspace.session.state.geometry.records.hero!
      .modifierStack.modifiers[0]!;
    expect(booleanModifier.kind).toBe("boolean");
    if (booleanModifier.kind !== "boolean") return;
    expect(booleanModifier.operand.positions.length).toBe(cutterSourceSoup.positions.length * 2);
    expect(Array.from(booleanModifier.operand.positions.slice(0, 3))).toEqual([
      -0.25,
      0.25,
      -0.5,
    ]);

    const beforeApplyHash = workspace.session.state.stateHash;
    const beforeRightsHash = workspace.session.state.rightsBom.find(
      ({ assetId }) => assetId === "hero",
    )?.contentHash;
    workspace = await workspaceApplyActiveModifierStack(workspace);
    const heroRights = workspace.session.state.rightsBom.find(
      ({ assetId }) => assetId === "hero",
    );
    expect(workspace.session.state.stateHash).not.toBe(beforeApplyHash);
    expect(heroRights?.contentHash).not.toBe(beforeRightsHash);
    expect(heroRights?.provenance).toEqual([
      expect.objectContaining({
        role: "boolean-operand",
        assetId: "cutter",
        modifierId: booleanModifier.id,
        operation: "difference",
        source: "primitive",
        license: "CC0-1.0",
      }),
    ]);
    expect(workspace.session.state.dependencies).toContainEqual({
      fromId: "cutter",
      toId: "hero",
      kind: "geometry",
    });

    const restored = restoreStudioHybridDccStateFromSnapshot(
      snapshotStudioHybridDccState(workspace.session.state),
    );
    expect(restored.stateHash).toBe(workspace.session.state.stateHash);
    expect(restored.rightsBom.find(({ assetId }) => assetId === "hero")?.provenance)
      .toEqual(heroRights?.provenance);
  });

  it("forks journals for rapid async modifier branches without mutating their shared input", async () => {
    const workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("modifier-async-branches"),
      "hero",
    );
    const rootJournal = workspace.session.journal;
    const rootRecords = rootJournal.records;

    const [mirrorBranch, solidifyBranch] = await Promise.all([
      workspaceAddActiveModifier(workspace, "mirror"),
      workspaceAddActiveModifier(workspace, "solidify"),
    ]);

    expect(workspace.session.journal).toBe(rootJournal);
    expect(workspace.session.journal.records).toEqual(rootRecords);
    expect(workspace.session.state.geometry.records.hero?.modifierStack.modifiers)
      .toHaveLength(0);
    expect(mirrorBranch.session.journal).not.toBe(rootJournal);
    expect(solidifyBranch.session.journal).not.toBe(rootJournal);
    expect(mirrorBranch.session.journal).not.toBe(solidifyBranch.session.journal);
    expect(mirrorBranch.session.journal.records).toHaveLength(rootRecords.length + 1);
    expect(solidifyBranch.session.journal.records).toHaveLength(rootRecords.length + 1);
    expect(mirrorBranch.session.state.commandCount).toBe(workspace.session.state.commandCount + 1);
    expect(solidifyBranch.session.state.commandCount).toBe(
      workspace.session.state.commandCount + 1,
    );
  });

  it("adds and patches the modeling wave modifiers with a live render cache", async () => {
    let workspace = workspaceAddUnitCube(
      createStudioHybridDccWorkspace("modifier-modeling-wave"),
      "hero",
    );

    workspace = await workspaceAddActiveModifier(workspace, "subdivision");
    const subdivided = workspace.session.state.geometry.records.hero!;
    expect(subdivided.modifierStack.modifiers[0]).toMatchObject({
      kind: "subdivision",
      levels: 1,
      smooth: true,
    });
    expect(subdivided.renderCache).not.toBeNull();

    workspace = await workspacePatchActiveModifier(workspace, "modifier-subdivision", {
      levels: 2,
      smooth: false,
    });
    expect(workspace.session.state.geometry.records.hero!
      .modifierStack.modifiers[0]).toMatchObject({ levels: 2, smooth: false });

    workspace = await workspacePatchActiveModifier(workspace, "modifier-subdivision", {
      levels: 9,
    });
    expect(workspace.session.state.geometry.records.hero!
      .modifierStack.modifiers[0]).toMatchObject({ levels: 3 });

    workspace = await workspaceAddActiveModifier(workspace, "simple-deform");
    expect(workspace.session.state.geometry.records.hero!
      .modifierStack.modifiers[1]).toMatchObject({ kind: "simple-deform", mode: "twist" });

    workspace = await workspacePatchActiveModifier(workspace, "modifier-simple-deform", {
      mode: "taper",
      factor: 0.4,
    });
    expect(workspace.session.state.geometry.records.hero!
      .modifierStack.modifiers[1]).toMatchObject({ mode: "taper", factor: 0.4 });

    // Applying the stack must stay atomic and clear it in the same undo step.
    const applied = await workspaceApplyActiveModifierStack(workspace);
    const appliedRecord = applied.session.state.geometry.records.hero!;
    expect(appliedRecord.modifierStack.modifiers).toHaveLength(0);
    expect(appliedRecord.mesh.faces.length).toBeGreaterThan(12);
  });
});
