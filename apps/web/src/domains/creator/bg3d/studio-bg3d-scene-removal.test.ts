import { describe, expect, it, vi } from "vitest";

import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";
import {
  planStudioBg3dDeletedAttachmentReconciliation,
  preflightAndDeleteStudioBg3dPersistedModel,
} from "./studio-bg3d-scene-removal";
import { calculateStudioBg3dThreeWorldMatrix } from "./studio-bg3d-three-hierarchy";

import type { BgCustomModelInstance } from "../studio-background-3d-model";
import type { BgPrimitive } from "../studio-background-3d-primitives";
import type {
  StudioBg3dModelAttachment,
  StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

const ATTACHMENT: StudioBg3dModelAttachment = {
  id: "attachment-model-a",
  name: "model-a.glb",
  mime: "model/gltf-binary",
  byteSize: 64,
  hash: `sha256:${"a".repeat(64)}`,
  rights: {
    status: "owned",
    commercialUse: true,
    attributionRequired: false,
  },
  source: "local-library",
};

function parentModel(): BgCustomModelInstance {
  return {
    id: "model-parent",
    modelId: "storage-model-a",
    position: [5, 2, -3],
    rotation: [0, Math.PI / 2, 0],
    scale: [1, 1, 1],
  };
}

function childPrimitive(): BgPrimitive {
  return {
    id: "child-box",
    kind: "box",
    position: [1, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#ffffff",
    parentId: "model-parent",
  };
}

function sceneDocument(): StudioBg3dSceneDocument {
  const parent = parentModel();
  const child = childPrimitive();
  return {
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    attachments: [ATTACHMENT],
    nodes: [
      {
        id: parent.id,
        name: "Parent model",
        kind: "model",
        attachmentId: ATTACHMENT.id,
        transform: {
          position: parent.position,
          rotation: parent.rotation,
          scale: parent.scale,
        },
        visible: true,
        locked: false,
        castsShadow: true,
        receivesShadow: true,
      },
      {
        id: child.id,
        name: "Child box",
        kind: "primitive",
        primitiveKind: "box",
        color: child.color,
        parentId: parent.id,
        transform: {
          position: child.position,
          rotation: child.rotation,
          scale: child.scale,
        },
        visible: true,
        locked: false,
        castsShadow: true,
        receivesShadow: true,
      },
    ],
    shots: [{
      id: "shot-main",
      name: "Main",
      nodeVisibility: [
        { nodeId: parent.id, visible: false },
        { nodeId: child.id, visible: true },
      ],
    }],
  };
}

describe("Studio BG3D persistent model scene-removal preflight", () => {
  it("preserves retained child world transforms and removes every dangling document reference", async () => {
    const parent = parentModel();
    const child = childPrimitive();
    const document = sceneDocument();
    const deletePersistedModel = vi.fn(async () => undefined);
    const beforeWorld = calculateStudioBg3dThreeWorldMatrix([parent, child], child.id);

    const result = await preflightAndDeleteStudioBg3dPersistedModel({
      snapshot: { primitives: [child], customModels: [parent], document },
      storageModelId: parent.modelId,
      attachmentId: ATTACHMENT.id,
      deletePersistedModel,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deletePersistedModel).toHaveBeenCalledExactlyOnceWith(parent.modelId);
    expect(result.snapshot.customModels).toEqual([]);
    expect(result.snapshot.primitives).toHaveLength(1);
    expect(result.snapshot.primitives[0]?.parentId).toBeNull();
    const afterWorld = calculateStudioBg3dThreeWorldMatrix(
      result.snapshot.primitives,
      child.id,
    );
    expect(afterWorld?.elements).toEqual(beforeWorld?.elements);
    expect(result.snapshot.document.attachments).toEqual([]);
    expect(result.snapshot.document.nodes.map((node) => node.id)).toEqual([child.id]);
    expect(result.snapshot.document.nodes[0]?.parentId).toBeNull();
    expect(result.snapshot.document.nodes[0]?.transform.position).toEqual(
      result.snapshot.primitives[0]?.position,
    );
    expect(result.snapshot.document.shots?.[0]?.nodeVisibility).toEqual([
      { nodeId: child.id, visible: true },
    ]);
  });

  it("replays a durable deletion receipt before hydration with the same lossless detachment", () => {
    const child = childPrimitive();
    const beforeWorld = calculateStudioBg3dThreeWorldMatrix(
      [parentModel(), child],
      child.id,
    );

    const result = planStudioBg3dDeletedAttachmentReconciliation({
      document: sceneDocument(),
      attachmentIds: new Set([ATTACHMENT.id]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.document.attachments).toEqual([]);
    expect(result.snapshot.document.nodes.map((node) => node.id)).toEqual([child.id]);
    const retainedNode = result.snapshot.document.nodes[0];
    expect(retainedNode?.parentId).toBeNull();
    const afterWorld = retainedNode && calculateStudioBg3dThreeWorldMatrix(
      [{
        ...child,
        parentId: retainedNode.parentId,
        position: [...retainedNode.transform.position],
        rotation: [...retainedNode.transform.rotation],
        scale: [...retainedNode.transform.scale],
      }],
      child.id,
    );
    expect(afterWorld?.elements).toEqual(beforeWorld?.elements);
    expect(result.snapshot.document.shots?.[0]?.nodeVisibility).toEqual([
      { nodeId: child.id, visible: true },
    ]);
  });

  it("does not begin IndexedDB deletion when exact child detachment cannot be preflighted", async () => {
    const parent = parentModel();
    const child = childPrimitive();
    const snapshot = {
      primitives: [child],
      customModels: [parent],
      document: sceneDocument(),
    };
    const deletePersistedModel = vi.fn(async () => undefined);

    const result = await preflightAndDeleteStudioBg3dPersistedModel({
      snapshot,
      storageModelId: parent.modelId,
      attachmentId: ATTACHMENT.id,
      deletePersistedModel,
      resolveReparentTransform: () => null,
    });

    expect(result).toEqual({
      ok: false,
      reason: "detach-transform-unavailable",
      entityId: child.id,
    });
    expect(deletePersistedModel).not.toHaveBeenCalled();
    expect(snapshot.customModels).toEqual([parent]);
    expect(snapshot.primitives).toEqual([child]);
    expect(snapshot.document.attachments).toEqual([ATTACHMENT]);
  });
});
