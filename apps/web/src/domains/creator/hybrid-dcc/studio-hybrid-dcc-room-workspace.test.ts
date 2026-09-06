import { describe, expect, it } from "vitest";

import { getStudioBg3dRoomPreset, buildStudioBg3dRoomParts } from "../bg3d/studio-bg3d-room-builder";
import { createStudioUnitCubeMesh } from "../studio-editable-half-edge-mesh";

import { hybridDccRegisterAssets } from "./studio-hybrid-dcc-document";
import { createStudioHybridDccIdentityTransform } from "./studio-hybrid-dcc-object-transform";
import { parseStudioHybridDccRoomPartMetadata } from "./studio-hybrid-dcc-room-authority";
import { workspaceLoadEditableRoomPreset } from "./studio-hybrid-dcc-room-workspace";
import {
  createStudioHybridDccWorkspace,
  workspaceRedo,
  workspaceUndo,
} from "./studio-hybrid-dcc-workspace";

describe("Hybrid DCC editable room workspace", () => {
  it("adds a classroom as separate authority objects in one command", () => {
    const empty = createStudioHybridDccWorkspace("editable-room");
    const expectedCount = buildStudioBg3dRoomParts(
      getStudioBg3dRoomPreset("classroom")!.spec,
    ).length;
    const workspace = workspaceLoadEditableRoomPreset(empty, "classroom");

    expect(workspace.session.state.commandCount).toBe(empty.session.state.commandCount + 1);
    expect(Object.keys(workspace.session.state.geometry.records)).toHaveLength(expectedCount);
    expect(workspace.bridge.set.objects).toHaveLength(expectedCount);
    expect(workspace.bridge.set.objects.some(({ id }) => id === "room-shell")).toBe(false);
    expect(workspace.bridge.set.objects.every(({ materialId }) => (
      materialId.startsWith("room-color:#")
    ))).toBe(true);
    expect(workspace.activeAssetId).toBe("room-classroom-part-001");
    expect(workspace.session.state.objectTransforms[workspace.activeAssetId!]?.scale[0])
      .toBeGreaterThan(1);
    const floorRights = workspace.session.state.rightsBom.find(
      ({ assetId }) => assetId === "room-classroom-part-001",
    );
    expect(parseStudioHybridDccRoomPartMetadata(floorRights?.derivative ?? ""))
      .toMatchObject({
        groupId: "room:classroom",
        semanticKind: "floor",
        materialId: `room-color:${getStudioBg3dRoomPreset("classroom")!.spec.floorColor}`,
      });
  });

  it("removes and restores the entire generated set with one undo/redo", () => {
    let workspace = workspaceLoadEditableRoomPreset(
      createStudioHybridDccWorkspace("room-undo"),
      "cafe",
    );
    const assetIds = Object.keys(workspace.session.state.geometry.records).sort();
    const materialByAssetId = Object.fromEntries(
      workspace.bridge.set.objects.map(({ id, materialId }) => [id, materialId]),
    );
    expect(assetIds.length).toBeGreaterThan(5);

    workspace = workspaceUndo(workspace);
    expect(Object.keys(workspace.session.state.geometry.records)).toEqual([]);
    expect(workspace.bridge.set.objects).toEqual([]);

    workspace = workspaceRedo(workspace);
    expect(Object.keys(workspace.session.state.geometry.records).sort()).toEqual(assetIds);
    expect(workspace.bridge.set.objects.map(({ id }) => id).sort()).toEqual(assetIds);
    expect(Object.fromEntries(
      workspace.bridge.set.objects.map(({ id, materialId }) => [id, materialId]),
    )).toEqual(materialByAssetId);
    expect(workspace.session.state.rightsBom.every(({ derivative }) => (
      parseStudioHybridDccRoomPartMetadata(derivative) !== null
    ))).toBe(true);
  });

  it("uses collision-free deterministic instance IDs for repeated presets", () => {
    let workspace = createStudioHybridDccWorkspace("room-repeat");
    workspace = workspaceLoadEditableRoomPreset(workspace, "studio-flat");
    workspace = workspaceLoadEditableRoomPreset(workspace, "studio-flat");
    const ids = Object.keys(workspace.session.state.geometry.records);
    expect(ids.some((id) => id.startsWith("room-studio-flat-part-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("room-studio-flat-2-part-"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("preflights existing plus batch assets before the atomic room command", () => {
    const empty = createStudioHybridDccWorkspace("room-total-budget");
    const roomPartCount = buildStudioBg3dRoomParts(
      getStudioBg3dRoomPreset("classroom")!.spec,
    ).length;
    const existingCount = 256 - roomPartCount + 1;
    const cube = createStudioUnitCubeMesh();
    const session = hybridDccRegisterAssets(
      empty.session,
      Array.from({ length: existingCount }, (_, index) => ({
        assetId: `existing-${String(index).padStart(3, "0")}`,
        mesh: cube,
        rights: {
          source: "test",
          creator: "studio",
          license: "CC0-1.0",
          useScope: "commercial",
          derivative: "original",
        },
        initialTransform: createStudioHybridDccIdentityTransform(),
      })),
    );
    const crowded = { ...empty, session };

    expect(() => workspaceLoadEditableRoomPreset(crowded, "classroom"))
      .toThrow(/256개 안전 한도/u);
    expect(crowded.session.state.commandCount).toBe(1);
    expect(Object.keys(crowded.session.state.geometry.records)).toHaveLength(existingCount);
  });
});
