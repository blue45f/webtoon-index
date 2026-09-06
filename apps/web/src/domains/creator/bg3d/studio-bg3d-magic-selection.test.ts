import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_MAGIC_SELECTION_REASON_MESSAGES,
  resolveStudioBg3dMagicSelection,
  type ResolveStudioBg3dMagicSelectionInput,
  type StudioBg3dMagicSelectionIneligibleReason,
} from "./studio-bg3d-magic-selection";
import {
  createDefaultStudioBg3dSceneDocument,
  type StudioBg3dPrimitiveNode,
  type StudioBg3dSceneDocument,
  type StudioBg3dSceneNode,
} from "./studio-bg3d-scene-document";

function primitive(
  id = "shape-1",
  overrides: Partial<StudioBg3dPrimitiveNode> = {},
): StudioBg3dPrimitiveNode {
  return {
    id,
    name: "Magic 대상",
    kind: "primitive",
    primitiveKind: "box",
    color: "#c9a876",
    transform: {
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    parentId: null,
    visible: true,
    locked: false,
    castsShadow: true,
    receivesShadow: true,
    ...overrides,
  };
}

function documentWith(
  nodes: readonly StudioBg3dSceneNode[],
  overrides: Partial<StudioBg3dSceneDocument> = {},
): StudioBg3dSceneDocument {
  return {
    ...createDefaultStudioBg3dSceneDocument(),
    nodes,
    ...overrides,
  };
}

function input(
  overrides: Partial<ResolveStudioBg3dMagicSelectionInput> = {},
): ResolveStudioBg3dMagicSelectionInput {
  return {
    operation: "insert",
    document: documentWith([primitive()]),
    selectedIds: ["shape-1"],
    ...overrides,
  };
}

function expectFailure(
  overrides: Partial<ResolveStudioBg3dMagicSelectionInput>,
  reason: StudioBg3dMagicSelectionIneligibleReason,
): void {
  const result = resolveStudioBg3dMagicSelection(input(overrides));
  expect(result).toEqual({
    ok: false,
    reason,
    message: STUDIO_BG3D_MAGIC_SELECTION_REASON_MESSAGES[reason],
  });
  expect(Object.isFrozen(result)).toBe(true);
}

describe("resolveStudioBg3dMagicSelection", () => {
  it("returns a deeply frozen canonical selection snapshot for one visible primitive", () => {
    const result = resolveStudioBg3dMagicSelection(input());

    expect(result).toEqual({
      ok: true,
      snapshot: {
        selectedId: "shape-1",
        stableId: "obj/shape-1",
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (!result.ok) throw new Error("Expected eligible Magic selection.");
    expect(Object.isFrozen(result.snapshot)).toBe(true);
  });

  it("accepts the full canonical node-ID alphabet and maximum length", () => {
    const selectedId = `A${"a".repeat(75)}._~-`;
    const result = resolveStudioBg3dMagicSelection(input({
      document: documentWith([primitive(selectedId)]),
      selectedIds: [selectedId],
    }));

    expect(result).toMatchObject({
      ok: true,
      snapshot: { selectedId, stableId: `obj/${selectedId}` },
    });
  });

  it("rejects update/re-edit before exposing an otherwise eligible snapshot", () => {
    expectFailure({ operation: "update" }, "update-not-supported");
  });

  it.each([
    { selectedIds: [] as string[] },
    { selectedIds: ["shape-1", "shape-2"] },
  ])("requires exactly one complete selection ($selectedIds)", ({ selectedIds }) => {
    expectFailure({ selectedIds }, "selection-count");
  });

  it.each([
    "",
    " contains-space",
    "contains/slash",
    "__proto__",
    "Constructor",
    `A${"a".repeat(80)}`,
  ])("rejects a non-canonical selected ID %j", (selectedId) => {
    expectFailure({ selectedIds: [selectedId] }, "invalid-selected-id");
  });

  it("rejects a selection that is absent from the adapted document", () => {
    expectFailure({ selectedIds: ["missing"] }, "selected-node-missing");
  });

  it("rejects a hidden selected primitive", () => {
    expectFailure({
      document: documentWith([primitive("shape-1", { visible: false })]),
    }, "selected-node-hidden");
  });

  it("rejects a visible child beneath a hidden parent", () => {
    expectFailure({
      document: documentWith([
        primitive("hidden-parent", { visible: false }),
        primitive("shape-1", { parentId: "hidden-parent", visible: true }),
      ]),
    }, "selected-node-hidden");
  });

  it("rejects a visible descendant beneath any hidden ancestor", () => {
    expectFailure({
      document: documentWith([
        primitive("hidden-root", { visible: false }),
        primitive("visible-parent", { parentId: "hidden-root", visible: true }),
        primitive("shape-1", { parentId: "visible-parent", visible: true }),
      ]),
    }, "selected-node-hidden");
  });

  it("rejects an attachment-backed scene even when the selected primitive is eligible", () => {
    const attachment = {
      id: "model-1",
      name: "model.glb",
      mime: "model/gltf-binary",
      byteSize: 1,
      hash: `sha256:${"1".repeat(64)}`,
      rights: {
        status: "owned",
        commercialUse: true,
        attributionRequired: false,
      },
      source: "upload",
    } as const;
    expectFailure({
      document: documentWith([primitive()], { attachments: [attachment] }),
    }, "attachments-not-supported");
  });

  it("rejects the selected model with a specific primitive-only reason", () => {
    const selectedModel = {
      ...primitive("model-1"),
      kind: "model",
      attachmentId: "asset-1",
    } as unknown as StudioBg3dSceneNode;
    expectFailure({
      document: documentWith([selectedModel]),
      selectedIds: ["model-1"],
    }, "selected-node-not-primitive");
  });

  it("rejects any unrelated model node in a primitive selection scene", () => {
    const unrelatedModel = {
      ...primitive("model-1"),
      kind: "model",
      attachmentId: "asset-1",
    } as unknown as StudioBg3dSceneNode;
    expectFailure({
      document: documentWith([primitive(), unrelatedModel]),
    }, "model-nodes-not-supported");
  });

  it.each([
    {
      nodes: [
        { ...primitive(), id: "bad/id" },
      ],
    },
    {
      nodes: [
        primitive(),
        primitive("shape-1"),
      ],
    },
    {
      nodes: [
        { ...primitive(), kind: "custom" },
      ],
    },
  ])("fails closed for a non-canonical node collection", ({ nodes }) => {
    expectFailure({
      document: documentWith(nodes as unknown as StudioBg3dSceneNode[]),
    }, "invalid-document");
  });

  it.each([
    {
      name: "orphan parent",
      nodes: [
        primitive("shape-1", { parentId: "missing-parent" }),
      ],
    },
    {
      name: "self parent",
      nodes: [
        primitive("shape-1", { parentId: "shape-1" }),
      ],
    },
    {
      name: "parent cycle",
      nodes: [
        primitive("shape-1", { parentId: "shape-2" }),
        primitive("shape-2", { parentId: "shape-1" }),
      ],
    },
  ])("fails closed rather than repairing a $name hierarchy", ({ nodes }) => {
    expectFailure({
      document: documentWith(nodes),
    }, "invalid-document");
  });

  it("requires visible to be the canonical true boolean", () => {
    const malformed = {
      ...primitive(),
      visible: 1,
    } as unknown as StudioBg3dSceneNode;
    expectFailure({
      document: documentWith([malformed]),
    }, "invalid-document");
  });

  it("fails closed on invalid operation, selection container, and document roots", () => {
    const valid = input();
    expect(resolveStudioBg3dMagicSelection({
      ...valid,
      operation: "replace" as "insert",
    })).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(resolveStudioBg3dMagicSelection({
      ...valid,
      selectedIds: new Set(["shape-1"]) as unknown as readonly string[],
    })).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(resolveStudioBg3dMagicSelection({
      ...valid,
      document: {
        ...valid.document,
        version: 2,
      } as unknown as StudioBg3dSceneDocument,
    })).toMatchObject({ ok: false, reason: "invalid-document" });
  });
});
