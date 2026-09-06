import { describe, expect, it } from "vitest";

import {
  STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY,
  STUDIO_GENERIC_3D_WORKFLOW_METADATA_VERSION,
  attachStudioGeneric3dWorkflowMetadata,
  mergeStudioGeneric3dWorkflowMaps,
  normalizeStudioGeneric3dClassification,
  normalizeStudioGeneric3dSourceFormat,
  normalizeStudioGeneric3dWorkflowId,
  parseStudioGeneric3dWorkflowMetadata,
  type StudioGeneric3dClassification,
  type StudioGeneric3dSourceFormat,
} from "./studio-generic-3d-workflow-metadata";

describe("normalizeStudioGeneric3dClassification", () => {
  it("accepts the closed classification enum", () => {
    expect(normalizeStudioGeneric3dClassification("character")).toBe("character");
    expect(normalizeStudioGeneric3dClassification("creature")).toBe("creature");
    expect(normalizeStudioGeneric3dClassification("prop")).toBe("prop");
  });

  it("fails closed on unknown labels, control characters, and non-strings", () => {
    expect(normalizeStudioGeneric3dClassification("avatar")).toBeNull();
    expect(normalizeStudioGeneric3dClassification("character\u0000")).toBeNull();
    expect(normalizeStudioGeneric3dClassification(" prop ")).toBeNull();
    expect(normalizeStudioGeneric3dClassification(1)).toBeNull();
    expect(normalizeStudioGeneric3dClassification(null)).toBeNull();
  });
});

describe("normalizeStudioGeneric3dSourceFormat", () => {
  it("accepts generic formats and rejects VRM/other formats", () => {
    expect(normalizeStudioGeneric3dSourceFormat("glb")).toBe("glb");
    expect(normalizeStudioGeneric3dSourceFormat("gltf")).toBe("gltf");
    expect(normalizeStudioGeneric3dSourceFormat("obj")).toBe("obj");
    expect(normalizeStudioGeneric3dSourceFormat("obj-mtl")).toBe("obj-mtl");
    expect(normalizeStudioGeneric3dSourceFormat("vrm")).toBeNull();
    expect(normalizeStudioGeneric3dSourceFormat("fbx")).toBeNull();
    expect(normalizeStudioGeneric3dSourceFormat("glb\n")).toBeNull();
  });
});

describe("normalizeStudioGeneric3dWorkflowId", () => {
  it("accepts safe attachment-style ids and drops unsafe ones", () => {
    expect(normalizeStudioGeneric3dWorkflowId("model.hero-01")).toBe("model.hero-01");
    expect(normalizeStudioGeneric3dWorkflowId("__proto__")).toBeNull();
    expect(normalizeStudioGeneric3dWorkflowId("constructor")).toBeNull();
    expect(normalizeStudioGeneric3dWorkflowId("bad id")).toBeNull();
    expect(normalizeStudioGeneric3dWorkflowId("a".repeat(81))).toBeNull();
    expect(normalizeStudioGeneric3dWorkflowId("x\u0001y")).toBeNull();
  });
});

describe("attach / parse StudioGeneric3dWorkflowMetadata", () => {
  it("round-trips through JSON under the versioned key", () => {
    const attached = attachStudioGeneric3dWorkflowMetadata(
      { id: "att-1", name: "Hero Prop" },
      { classification: "character", sourceFormat: "glb" }
    );
    expect(attached).toMatchObject({
      id: "att-1",
      name: "Hero Prop",
      [STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY]: {
        version: STUDIO_GENERIC_3D_WORKFLOW_METADATA_VERSION,
        classification: "character",
        sourceFormat: "glb",
      },
    });
    expect(Object.isFrozen(attached[STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY])).toBe(true);

    const wire = JSON.stringify(attached);
    const restored = JSON.parse(wire) as Record<string, unknown>;
    const parsed = parseStudioGeneric3dWorkflowMetadata(restored);
    expect(parsed).toEqual({
      classification: "character",
      sourceFormat: "glb",
    });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("omits invalid optional fields while still writing version 1", () => {
    const attached = attachStudioGeneric3dWorkflowMetadata(
      { id: "att-2" },
      { classification: "not-a-class", sourceFormat: "obj-mtl" }
    );
    expect(attached[STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY]).toEqual({
      version: 1,
      sourceFormat: "obj-mtl",
    });
    expect(parseStudioGeneric3dWorkflowMetadata(attached)).toEqual({
      classification: null,
      sourceFormat: "obj-mtl",
    });
  });

  it("preserves unrelated attachment fields via shallow copy", () => {
    const source = { id: "att-3", rights: { status: "owned" }, nested: { keep: true } };
    const attached = attachStudioGeneric3dWorkflowMetadata(source, {
      classification: "prop",
    });
    expect(attached.rights).toBe(source.rights);
    expect(attached.nested).toBe(source.nested);
    expect(attached).not.toBe(source);
    expect(source).not.toHaveProperty(STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY);
  });

  it("fails closed on unknown keys, wrong versions, and invalid stored values", () => {
    expect(
      parseStudioGeneric3dWorkflowMetadata({
        [STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY]: {
          version: 1,
          classification: "character",
          extra: true,
        },
      })
    ).toBeNull();
    expect(
      parseStudioGeneric3dWorkflowMetadata({
        [STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY]: {
          version: 2,
          classification: "character",
        },
      })
    ).toBeNull();
    expect(
      parseStudioGeneric3dWorkflowMetadata({
        [STUDIO_GENERIC_3D_WORKFLOW_METADATA_KEY]: {
          version: 1,
          classification: "avatar",
        },
      })
    ).toBeNull();
    expect(parseStudioGeneric3dWorkflowMetadata(null)).toBeNull();
    expect(parseStudioGeneric3dWorkflowMetadata({})).toBeNull();
  });
});

describe("mergeStudioGeneric3dWorkflowMaps", () => {
  it("lets patch win and drops invalid ids from both sides", () => {
    const current = new Map<string, StudioGeneric3dClassification>([
      ["model.a", "prop"],
      ["model.b", "creature"],
      ["__proto__", "character"],
      ["bad id", "prop"],
    ]);
    const patch = new Map<string, StudioGeneric3dClassification>([
      ["model.b", "character"],
      ["model.c", "prop"],
      ["constructor", "creature"],
    ]);
    const merged = mergeStudioGeneric3dWorkflowMaps(current, patch);
    expect([...merged.entries()]).toEqual([
      ["model.a", "prop"],
      ["model.b", "character"],
      ["model.c", "prop"],
    ]);
  });

  it("works for source-format maps the same way", () => {
    const current = new Map<string, StudioGeneric3dSourceFormat>([["asset.1", "obj"]]);
    const patch = new Map<string, StudioGeneric3dSourceFormat>([["asset.1", "obj-mtl"]]);
    const merged = mergeStudioGeneric3dWorkflowMaps(current, patch);
    expect(merged.get("asset.1")).toBe("obj-mtl");
  });
});
