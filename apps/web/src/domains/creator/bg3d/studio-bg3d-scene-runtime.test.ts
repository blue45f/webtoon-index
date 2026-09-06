import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  STUDIO_BG3D_GLB_MIME,
  STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS,
  captureStudioBg3dShot,
  normalizeStudioBg3dGlbAttachment,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dModelAttachment,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  StudioBg3dRuntimeAdapterError,
  adaptStudioBg3dRuntimeToDocument,
  hydrateStudioBg3dDocumentToRuntime,
  tryAdaptStudioBg3dRuntimeToDocument,
} from "./studio-bg3d-scene-runtime";

import type { BgCustomModelInstance } from "../studio-background-3d-model";
import type { BgPrimitive } from "../studio-background-3d-primitives";

function hash(index: number): string {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

function attachment(
  id: string,
  index: number,
  overrides: Record<string, unknown> = {}
): StudioBg3dModelAttachment {
  const normalized = normalizeStudioBg3dGlbAttachment({
    id,
    name: `검증된 배경 ${index}.glb`,
    mime: STUDIO_BG3D_GLB_MIME,
    byteSize: 1_000_000 + index,
    hash: hash(index),
    rights: {
      status: "owned",
      commercialUse: true,
      attributionRequired: false,
    },
    source: "local-library",
    ...overrides,
  });
  if (!normalized) throw new Error("Invalid attachment test fixture.");
  return normalized;
}

function primitive(id: string, offset = 0): BgPrimitive {
  return {
    id,
    kind: "box",
    position: [offset, 0.5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#C9A876",
    parentId: null,
    name: undefined,
  };
}

function customModel(
  id: string,
  modelId: string,
  offset = 0
): BgCustomModelInstance {
  return {
    id,
    modelId,
    position: [offset, 0, 1],
    rotation: [0, Math.PI / 2, 0],
    scale: [1, 2, 1],
    parentId: null,
    name: undefined,
  };
}

function canonicalDocument(
  overrides: Partial<StudioBg3dSceneDocument>
): StudioBg3dSceneDocument {
  const serialized = serializeStudioBg3dSceneDocument({
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    ...overrides,
  });
  const parsed = parseStudioBg3dSceneDocument(serialized ?? "");
  if (!parsed) {
    const raw = JSON.parse(serialized ?? "{}");
    throw new Error("Invalid canonical document test fixture. Serialized:\n" + JSON.stringify(raw, null, 2));
  }
  return parsed;
}

function diagnosticCodes(
  diagnostics: readonly { readonly code: string }[]
): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

function expectRuntimeAdapterError(
  operation: () => unknown,
  code: StudioBg3dRuntimeAdapterError["code"],
): void {
  try {
    operation();
  } catch (cause) {
    expect(cause).toBeInstanceOf(StudioBg3dRuntimeAdapterError);
    expect((cause as StudioBg3dRuntimeAdapterError).code).toBe(code);
    return;
  }
  throw new Error(`Expected Studio BG3D runtime adapter error: ${code}.`);
}

describe("Studio BG3D runtime to document adapter", () => {
  it("preserves canonical storyboard shots while refreshing runtime nodes", () => {
    const source = adaptStudioBg3dRuntimeToDocument({
      primitives: [primitive("shot-node")],
      customModels: [],
      attachmentByStorageModelId: new Map(),
    });
    const withShot = captureStudioBg3dShot(source.document, {
      id: "shot-runtime-roundtrip",
      name: "전경 컷",
    });
    expect(withShot).not.toBeNull();

    const refreshed = adaptStudioBg3dRuntimeToDocument({
      primitives: [{ ...primitive("shot-node"), visible: false }],
      customModels: [],
      attachmentByStorageModelId: new Map(),
      baseDocument: withShot ?? undefined,
    });

    expect(refreshed.diagnostics).toEqual([]);
    expect(refreshed.document.shots).toEqual(withShot?.shots);
    expect(refreshed.document.activeShotId).toBe("shot-runtime-roundtrip");
    expect(refreshed.document.nodes[0]?.visible).toBe(false);
  });

  it("fails closed instead of silently repairing a shot that references a removed runtime node", () => {
    const source = adaptStudioBg3dRuntimeToDocument({
      primitives: [primitive("kept-node"), primitive("removed-node", 2)],
      customModels: [],
      attachmentByStorageModelId: new Map(),
    });
    const withShot = captureStudioBg3dShot(source.document, {
      id: "shot-with-removed-node",
      name: "삭제 전 컷",
    });
    expect(withShot?.shots?.[0]?.nodeVisibility?.map((entry) => entry.nodeId)).toContain("removed-node");

    expectRuntimeAdapterError(
      () => adaptStudioBg3dRuntimeToDocument({
        primitives: [primitive("kept-node")],
        customModels: [],
        attachmentByStorageModelId: new Map(),
        baseDocument: withShot ?? undefined,
      }),
      "lossy-shot-repair",
    );
  });

  it("fails closed instead of dropping nodes when the persistence byte budget is tight", () => {
    const base = canonicalDocument({
      budgets: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
        complexity: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
          maxNodes: 512,
        },
      },
    });
    const nodes = Array.from({ length: 512 }, (_, index) =>
      primitive(`budget-node-${index}`, index % 20));
    const source = adaptStudioBg3dRuntimeToDocument({
      primitives: nodes,
      customModels: [],
      attachmentByStorageModelId: new Map(),
      baseDocument: base,
    });
    let withShots = source.document;
    for (let index = 0; index < 4; index += 1) {
      const captured = captureStudioBg3dShot(withShots, {
        id: `budget-shot-${index}`,
        name: `예산 컷 ${index}`,
      });
      expect(captured).not.toBeNull();
      withShots = captured ?? withShots;
    }

    expectRuntimeAdapterError(
      () => adaptStudioBg3dRuntimeToDocument({
        primitives: nodes.map((node, index) => ({
          ...node,
          name: `표준화확장-${"각".repeat(70)}-${index}`,
          visible: true,
        })),
        customModels: [],
        attachmentByStorageModelId: new Map(),
        baseDocument: withShots,
      }),
      "persistence-byte-budget-exceeded",
    );
  });

  it("preserves per-instance material edits across runtime/document hydration", () => {
    const storageId = "idb-material-model";
    const model = {
      ...customModel("material-node", storageId),
      materialOverride: {
        ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
        colorMode: "replace" as const,
        color: "#ff8844",
        colorStrength: 0.8,
        opacityMultiplier: 0.6,
        roughness: 0.25,
        wireframe: true,
      },
      animation: {
        clipIndex: 1,
        playing: true,
        loop: "repeat" as const,
        timeSeconds: 0.75,
        timeScale: 1.5,
        weight: 0.9,
      },
      pose: {
        enabled: true,
        weight: 0.6,
        joints: [{
          jointKey: "skin-0:joint-4",
          rotationOffset: [0.7071067811865475, 0, 0, 0.7071067811865475] as const,
        }],
      },
      morph: {
        enabled: true,
        weight: 0.7,
        targets: [{ targetKey: "mesh-1:target-0", weightOffset: -0.25 }],
      },
      constraints: {
        enabled: true,
        aims: [{
          jointKey: "skin-0:joint-4",
          target: [1, 2, 3] as const,
          axis: "+z" as const,
          weight: 0.8,
        }],
        twoBoneIks: [{
          upperJointKey: "skin-0:joint-1",
          middleJointKey: "skin-0:joint-2",
          endJointKey: "skin-0:joint-3",
          target: [0.5, 1.25, 0.2] as const,
          poleTarget: [0, 1, 1] as const,
          weight: 0.7,
        }],
      },
    };
    const adapted = adaptStudioBg3dRuntimeToDocument({
      primitives: [],
      customModels: [model],
      attachmentByStorageModelId: new Map([[storageId, attachment("material-attachment", 17)]]),
    });
    const hydrated = hydrateStudioBg3dDocumentToRuntime({
      document: adapted.document,
      storageModelIdByAttachmentId: new Map([["material-attachment", storageId]]),
    });

    expect(adapted.diagnostics).toEqual([]);
    expect(adapted.document.nodes[0]).toMatchObject({
      kind: "model",
      materialOverride: model.materialOverride,
      animation: model.animation,
      pose: model.pose,
      morph: model.morph,
      constraints: model.constraints,
    });
    expect(hydrated.ok).toBe(true);
    expect(hydrated.customModels[0]?.materialOverride).toEqual(model.materialOverride);
    expect(hydrated.customModels[0]?.materialOverride).not.toBe(model.materialOverride);
    expect(hydrated.customModels[0]?.animation).toEqual(model.animation);
    expect(hydrated.customModels[0]?.animation).not.toBe(model.animation);
    expect(hydrated.customModels[0]?.pose).toEqual(model.pose);
    expect(hydrated.customModels[0]?.pose).not.toBe(model.pose);
    expect(hydrated.customModels[0]?.pose?.joints[0]).not.toBe(model.pose.joints[0]);
    expect(hydrated.customModels[0]?.morph).toEqual(model.morph);
    expect(hydrated.customModels[0]?.morph?.targets[0]).not.toBe(model.morph.targets[0]);
    expect(hydrated.customModels[0]?.constraints).toEqual(model.constraints);
    expect(hydrated.customModels[0]?.constraints?.aims[0]).not.toBe(model.constraints.aims[0]);
    expect(hydrated.customModels[0]?.constraints?.aims[0]?.target).not.toBe(model.constraints.aims[0].target);
    expect(hydrated.customModels[0]?.constraints?.twoBoneIks?.[0])
      .not.toBe(model.constraints.twoBoneIks[0]);
    expect(hydrated.customModels[0]?.constraints?.twoBoneIks?.[0]?.target)
      .not.toBe(model.constraints.twoBoneIks[0].target);
    expect(hydrated.customModels[0]?.constraints?.twoBoneIks?.[0]?.poleTarget)
      .not.toBe(model.constraints.twoBoneIks[0].poleTarget);
  });

  it("fails the model boundary instead of silently truncating excess IK constraints", () => {
    const storageId = "idb-over-budget-rig";
    const model: BgCustomModelInstance = {
      ...customModel("over-budget-rig", storageId),
      constraints: {
        enabled: true,
        aims: [],
        twoBoneIks: Array.from(
          { length: STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS + 1 },
          (_, index) => ({
            upperJointKey: `skin-0:joint-${index * 3}`,
            middleJointKey: `skin-0:joint-${index * 3 + 1}`,
            endJointKey: `skin-0:joint-${index * 3 + 2}`,
            target: [1, 1, 0] as const,
            poleTarget: [0, 0, 1] as const,
            weight: 1,
          }),
        ),
      },
    };

    const adapted = adaptStudioBg3dRuntimeToDocument({
      primitives: [],
      customModels: [model],
      attachmentByStorageModelId: new Map([[storageId, attachment("over-budget", 18)]]),
    });

    expect(adapted.document.nodes).toEqual([]);
    expect(adapted.counts.droppedCustomModels).toBe(1);
    expect(diagnosticCodes(adapted.diagnostics)).toContain(
      "lossy-custom-model-normalization"
    );
  });

  it("fails closed and accounts for every lenient nested-payload repair", () => {
    const storageId = "idb-lossy-payload";
    const binding = new Map([[storageId, attachment("lossy-payload-attachment", 20)]]);
    const canonicalAnimation = {
      clipIndex: 0,
      playing: false,
      loop: "repeat" as const,
      timeSeconds: 0,
      timeScale: 1,
      weight: 1,
    };
    const cases: readonly [string, Partial<BgCustomModelInstance>][] = [
      ["material out of range", {
        materialOverride: {
          ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
          colorStrength: 99,
        },
      }],
      ["animation out of range", {
        animation: { ...canonicalAnimation, weight: 99 },
      }],
      ["animation NaN", {
        animation: { ...canonicalAnimation, timeSeconds: Number.NaN },
      }],
      ["pose Infinity", {
        pose: { enabled: true, weight: Number.POSITIVE_INFINITY, joints: [] },
      }],
      ["morph out of range", {
        morph: {
          enabled: true,
          weight: 1,
          targets: [{ targetKey: "mesh-0:target-0", weightOffset: -5 }],
        },
      }],
      ["constraint null target", {
        constraints: {
          enabled: true,
          aims: [{
            jointKey: "skin-0:joint-1",
            target: null as unknown as readonly [number, number, number],
            axis: "+z" as const,
            weight: 1,
          }],
          twoBoneIks: [],
        },
      }],
      ["constraint component NaN", {
        constraints: {
          enabled: true,
          aims: [],
          twoBoneIks: [{
            upperJointKey: "skin-0:joint-1",
            middleJointKey: "skin-0:joint-2",
            endJointKey: "skin-0:joint-3",
            target: [0, Number.NaN, 0],
            poleTarget: [0, 0, 1],
            weight: 1,
          }],
        },
      }],
    ];

    for (const [label, overrides] of cases) {
      const model = {
        ...customModel(`lossy-${label.replaceAll(" ", "-")}`, storageId),
        ...overrides,
      } as BgCustomModelInstance;
      const first = adaptStudioBg3dRuntimeToDocument({
        primitives: [],
        customModels: [model],
        attachmentByStorageModelId: binding,
      });
      const second = adaptStudioBg3dRuntimeToDocument({
        primitives: [],
        customModels: [model],
        attachmentByStorageModelId: binding,
      });

      expect(first.document.nodes, label).toEqual([]);
      expect(first.document.attachments, label).toEqual([]);
      expect(first.counts, label).toEqual({
        inputPrimitives: 0,
        inputCustomModels: 1,
        emittedPrimitives: 0,
        emittedCustomModels: 0,
        droppedPrimitives: 0,
        droppedCustomModels: 1,
      });
      expect(first.diagnostics, label).toEqual([{
        direction: "runtime-to-document",
        code: "lossy-custom-model-normalization",
        source: "custom-model",
        sourceIndex: 0,
        nodeId: model.id,
        count: 1,
      }]);
      expect(second.diagnostics, label).toEqual(first.diagnostics);
      expect(second.counts, label).toEqual(first.counts);
      expect(second.serialized, label).toBe(first.serialized);
    }
  });

  it("rejects hostile JSON payloads without throwing or dropping later valid models", () => {
    const firstStorageId = "idb-before-hostile";
    const hostileStorageId = "idb-hostile";
    const lastStorageId = "idb-after-hostile";
    const cyclicAnimation = {
      clipIndex: 0,
      playing: false,
      loop: "repeat",
      timeSeconds: 0,
      timeScale: 1,
      weight: 1,
    } as Record<string, unknown>;
    cyclicAnimation.self = cyclicAnimation;
    const hostile = {
      ...customModel("hostile-cyclic-model", hostileStorageId),
      animation: cyclicAnimation,
    } as unknown as BgCustomModelInstance;
    const input = {
      primitives: [],
      customModels: [
        customModel("valid-before-hostile", firstStorageId),
        hostile,
        customModel("valid-after-hostile", lastStorageId),
      ],
      attachmentByStorageModelId: new Map([
        [firstStorageId, attachment("before-hostile-attachment", 21)],
        [hostileStorageId, attachment("hostile-attachment", 22)],
        [lastStorageId, attachment("after-hostile-attachment", 23)],
      ]),
    };

    expect(() => adaptStudioBg3dRuntimeToDocument(input)).not.toThrow();
    const result = adaptStudioBg3dRuntimeToDocument(input);

    expect(result.document.nodes.map((node) => node.id)).toEqual([
      "valid-before-hostile",
      "valid-after-hostile",
    ]);
    expect(result.counts).toEqual({
      inputPrimitives: 0,
      inputCustomModels: 3,
      emittedPrimitives: 0,
      emittedCustomModels: 2,
      droppedPrimitives: 0,
      droppedCustomModels: 1,
    });
    expect(result.diagnostics).toEqual([{
      direction: "runtime-to-document",
      code: "invalid-custom-model",
      source: "custom-model",
      sourceIndex: 1,
      nodeId: "hostile-cyclic-model",
      count: 1,
    }]);
  });

  it("upgrades aim-only v2 runtime constraints and rejects hostile shapes without throwing", () => {
    const storageId = "idb-legacy-aim-model";
    const legacyAimOnly = {
      ...customModel("legacy-aim-node", storageId),
      constraints: {
        enabled: true,
        aims: [{
          jointKey: "skin-0:joint-1",
          target: [0, 1, 0] as const,
          axis: "+z" as const,
          weight: 1,
        }],
      },
    } as unknown as BgCustomModelInstance;
    const attachmentMap = new Map([[storageId, attachment("legacy-aim-attachment", 19)]]);

    const adapted = adaptStudioBg3dRuntimeToDocument({
      primitives: [],
      customModels: [legacyAimOnly],
      attachmentByStorageModelId: attachmentMap,
    });
    expect(adapted.diagnostics).toEqual([]);
    expect(adapted.document.nodes[0]).toMatchObject({
      kind: "model",
      constraints: {
        enabled: true,
        aims: legacyAimOnly.constraints?.aims,
        twoBoneIks: [],
      },
    });

    const hostileConstraints = [
      { enabled: true, aims: "not-an-array" },
      { enabled: true, aims: [], twoBoneIks: "not-an-array" },
      null,
    ];
    for (const [index, constraints] of hostileConstraints.entries()) {
      const hostile = {
        ...customModel(`hostile-${index}`, storageId),
        constraints,
      } as unknown as BgCustomModelInstance;
      expect(() => adaptStudioBg3dRuntimeToDocument({
        primitives: [],
        customModels: [hostile],
        attachmentByStorageModelId: attachmentMap,
      })).not.toThrow();
      const rejected = adaptStudioBg3dRuntimeToDocument({
        primitives: [],
        customModels: [hostile],
        attachmentByStorageModelId: attachmentMap,
      });
      expect(rejected.counts.droppedCustomModels).toBe(1);
      expect(diagnosticCodes(rejected.diagnostics)).toContain("invalid-custom-model");
    }
  });

  it("preserves settings, maps runtime order deterministically, and never persists storage ids", () => {
    const firstStorageId = "idb-private-storage-key-alpha";
    const secondStorageId = "idb-private-storage-key-beta";
    const firstAttachment = attachment("scene-attachment-a", 1);
    const secondAttachment = attachment("scene-attachment-b", 2);
    const primitives = [primitive("primitive-a", 1), primitive("primitive-b", 2)];
    const customModels = [
      customModel("model-node-a", firstStorageId, 3),
      customModel("model-node-b", secondStorageId, 4),
    ];
    const base = canonicalDocument({
      camera: { ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera, position: [9, 4, 7], target: [0, 1, 0], fovDegrees: 42 },
      background: { ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background, mode: "color", color: "#223344", skyPresetId: "night" },
      output: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output,
        exportHeight: 1280,
      },
    });
    const primitiveSnapshot = JSON.stringify(primitives);
    const modelSnapshot = JSON.stringify(customModels);
    const baseSnapshot = serializeStudioBg3dSceneDocument(base);
    const bindings = new Map([
      [firstStorageId, firstAttachment],
      [secondStorageId, secondAttachment],
    ]);

    const first = adaptStudioBg3dRuntimeToDocument({
      primitives,
      customModels,
      attachmentByStorageModelId: bindings,
      baseDocument: base,
    });
    const second = adaptStudioBg3dRuntimeToDocument({
      primitives,
      customModels,
      attachmentByStorageModelId: bindings,
      baseDocument: base,
    });

    expect(first.serialized).toBe(second.serialized);
    expect(first.document.nodes.map((node) => node.id)).toEqual([
      "primitive-a",
      "primitive-b",
      "model-node-a",
      "model-node-b",
    ]);
    expect(first.document.attachments.map((item) => item.id)).toEqual([
      "scene-attachment-a",
      "scene-attachment-b",
    ]);
    expect(first.document.camera.fovDegrees).toBe(42);
    expect(first.document.background.color).toBe("#223344");
    expect(first.document.output.exportHeight).toBe(1280);
    expect(first.document.nodes[0]).toMatchObject({
      kind: "primitive",
      primitiveKind: "box",
      color: "#c9a876",
      transform: { position: [1, 0.5, 0] },
    });
    expect(first.serialized).not.toContain(firstStorageId);
    expect(first.serialized).not.toContain(secondStorageId);
    expect(parseStudioBg3dSceneDocument(first.serialized)).toEqual(first.document);
    expect(serializeStudioBg3dSceneDocument(first.document)).toBe(first.serialized);
    expect(first.counts).toEqual({
      inputPrimitives: 2,
      inputCustomModels: 2,
      emittedPrimitives: 2,
      emittedCustomModels: 2,
      droppedPrimitives: 0,
      droppedCustomModels: 0,
    });
    expect(first.diagnostics).toEqual([]);
    expect(JSON.stringify(primitives)).toBe(primitiveSnapshot);
    expect(JSON.stringify(customModels)).toBe(modelSnapshot);
    expect(serializeStudioBg3dSceneDocument(base)).toBe(baseSnapshot);
    expect(first.document.nodes[0]?.transform.position).not.toBe(primitives[0]?.position);
  });

  it("drops unresolved, invalid, and identity bindings with bounded diagnostics", () => {
    const validStorageId = "idb-valid-model";
    const repeatedStorageId = "idb-valid-model-alias";
    const invalidStorageId = "idb-invalid-model";
    const identityStorageId = "same-as-attachment";
    const validAttachment = attachment("logical-attachment", 10);
    const bindings = new Map<string, StudioBg3dModelAttachment>([
      [validStorageId, validAttachment],
      [repeatedStorageId, validAttachment],
      [identityStorageId, attachment(identityStorageId, 11)],
    ]);
    bindings.set(
      invalidStorageId,
      { ...validAttachment, mime: "model/gltf+json" } as unknown as StudioBg3dModelAttachment
    );
    const result = adaptStudioBg3dRuntimeToDocument({
      primitives: [],
      customModels: [
        customModel("unresolved-node", "idb-missing"),
        customModel("invalid-node", invalidStorageId),
        customModel("identity-node", identityStorageId),
        customModel("valid-node", validStorageId),
        customModel("valid-node-2", repeatedStorageId),
      ],
      attachmentByStorageModelId: bindings,
    });

    expect(result.document.nodes.map((node) => node.id)).toEqual([
      "valid-node",
      "valid-node-2",
    ]);
    expect(result.document.attachments).toHaveLength(1);
    expect(result.counts.droppedCustomModels).toBe(3);
    expect(diagnosticCodes(result.diagnostics)).toEqual(expect.arrayContaining([
      "unresolved-storage-model",
      "invalid-attachment-binding",
      "unsafe-identity-binding",
    ]));
    expect(result.diagnostics.every((diagnostic) => !("modelId" in diagnostic))).toBe(true);
  });

  it("rejects conflicting attachment ids, hashes, duplicate node ids, and invalid primitives", () => {
    const first = attachment("logical-a", 21);
    const sameIdConflict = attachment("logical-a", 22);
    const sameHashConflict = attachment("logical-b", 21);
    const result = adaptStudioBg3dRuntimeToDocument({
      primitives: [
        primitive("shared-node"),
        { ...primitive("invalid/node"), color: "not-a-color" },
      ],
      customModels: [
        customModel("valid-model", "idb-valid"),
        customModel("same-id-conflict", "idb-same-id"),
        customModel("same-hash-conflict", "idb-same-hash"),
        customModel("shared-node", "idb-valid"),
      ],
      attachmentByStorageModelId: new Map([
        ["idb-valid", first],
        ["idb-same-id", sameIdConflict],
        ["idb-same-hash", sameHashConflict],
      ]),
    });

    // The first encountered metadata is determined by runtime order; later conflicting values drop.
    expect(result.document.nodes.map((node) => node.id)).toEqual([
      "shared-node",
      "valid-model",
    ]);
    expect(result.document.attachments.map((item) => item.hash)).toEqual([hash(21)]);
    expect(result.counts).toMatchObject({
      droppedPrimitives: 1,
      droppedCustomModels: 3,
    });
    expect(diagnosticCodes(result.diagnostics)).toEqual(expect.arrayContaining([
      "invalid-primitive",
      "conflicting-attachment-hash",
      "duplicate-node-id",
      "conflicting-attachment-id",
    ]));
  });

  it("honors the canonical node budget without returning the earliest-record prefix", () => {
    const base = canonicalDocument({
      budgets: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
        complexity: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
          maxNodes: 3,
        },
      },
    });
    expectRuntimeAdapterError(
      () => adaptStudioBg3dRuntimeToDocument({
        primitives: [
          primitive("p-1"),
          primitive("p-2"),
          primitive("p-3"),
          primitive("p-4"),
        ],
        customModels: [customModel("m-1", "idb-model")],
        attachmentByStorageModelId: new Map([["idb-model", attachment("logical", 30)]]),
        baseDocument: base,
      }),
      "node-budget-exceeded",
    );
  });

  it("exposes typed budget rejection to product callers without throwing or returning a prefix", () => {
    const base = canonicalDocument({
      budgets: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
        complexity: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
          maxNodes: 1,
        },
      },
    });
    const attempt = tryAdaptStudioBg3dRuntimeToDocument({
      primitives: [primitive("p-1"), primitive("p-2")],
      customModels: [],
      attachmentByStorageModelId: new Map(),
      baseDocument: base,
    });

    expect(attempt).toMatchObject({
      ok: false,
      error: {
        code: "node-budget-exceeded",
        source: "primitive",
        sourceIndex: 1,
        nodeId: "p-2",
      },
    });
  });

  it("falls back to default settings for a hostile base without mutating input arrays", () => {
    const frozenPrimitive = Object.freeze({
      ...primitive("safe-node"),
      position: Object.freeze([0, 0.5, 0]) as unknown as [number, number, number],
      rotation: Object.freeze([0, 0, 0]) as unknown as [number, number, number],
      scale: Object.freeze([1, 1, 1]) as unknown as [number, number, number],
    });
    const primitives = Object.freeze([frozenPrimitive]);
    const hostileBase = {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
      camera: null,
    } as unknown as StudioBg3dSceneDocument;
    const result = adaptStudioBg3dRuntimeToDocument({
      primitives,
      customModels: [],
      attachmentByStorageModelId: new Map(),
      baseDocument: hostileBase,
    });

    expect(result.document.camera).toEqual(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera);
    expect(diagnosticCodes(result.diagnostics)).toContain("invalid-base-document");
    expect(primitives[0]?.position).toEqual([0, 0.5, 0]);
  });
});

describe("Studio BG3D document to runtime adapter", () => {
  it("hydrates fresh arrays through explicit attachment bindings without mutating the document", () => {
    const firstStorageId = "device-idb-key-one";
    const secondStorageId = "device-idb-key-two";
    const source = adaptStudioBg3dRuntimeToDocument({
      primitives: [primitive("primitive-a")],
      customModels: [
        customModel("model-a", "source-idb-one"),
        customModel("model-b", "source-idb-two"),
      ],
      attachmentByStorageModelId: new Map([
        ["source-idb-one", attachment("attachment-a", 40)],
        ["source-idb-two", attachment("attachment-b", 41)],
      ]),
    });
    const documentSnapshot = source.serialized;
    const hydrated = hydrateStudioBg3dDocumentToRuntime({
      document: source.document,
      storageModelIdByAttachmentId: new Map([
        ["attachment-a", firstStorageId],
        ["attachment-b", secondStorageId],
      ]),
    });

    expect(hydrated.ok).toBe(true);
    expect(hydrated.primitives).toEqual([
      { ...primitive("primitive-a"), color: "#c9a876", visible: true, locked: false, parentId: null, name: undefined },
    ]);
    expect(hydrated.customModels.map((model) => [model.id, model.modelId])).toEqual([
      ["model-a", firstStorageId],
      ["model-b", secondStorageId],
    ]);
    expect(hydrated.counts.droppedCustomModels).toBe(0);
    expect(hydrated.primitives[0]?.position).not.toBe(
      source.document.nodes[0]?.transform.position
    );
    expect(serializeStudioBg3dSceneDocument(source.document)).toBe(documentSnapshot);
  });

  it("drops missing, identity, invalid, and conflicting storage bindings deterministically", () => {
    const source = adaptStudioBg3dRuntimeToDocument({
      primitives: [],
      customModels: [
        customModel("model-a", "source-a"),
        customModel("model-b", "source-b"),
        customModel("model-c", "source-c"),
        customModel("model-d", "source-d"),
      ],
      attachmentByStorageModelId: new Map([
        ["source-a", attachment("attachment-a", 50)],
        ["source-b", attachment("attachment-b", 51)],
        ["source-c", attachment("attachment-c", 52)],
        ["source-d", attachment("attachment-d", 53)],
      ]),
    });
    const sharedStorageId = "shared-idb-key";
    const hydrated = hydrateStudioBg3dDocumentToRuntime({
      document: source.document,
      storageModelIdByAttachmentId: new Map([
        ["attachment-a", sharedStorageId],
        ["attachment-b", sharedStorageId],
        ["attachment-c", "attachment-c"],
        ["attachment-d", "bad\u0000storage-key"],
      ]),
    });

    expect(hydrated.customModels.map((model) => model.id)).toEqual(["model-a"]);
    expect(hydrated.counts.droppedCustomModels).toBe(3);
    expect(diagnosticCodes(hydrated.diagnostics)).toEqual(expect.arrayContaining([
      "conflicting-storage-binding",
      "unsafe-identity-binding",
      "invalid-storage-binding",
    ]));

    const missing = hydrateStudioBg3dDocumentToRuntime({
      document: source.document,
      storageModelIdByAttachmentId: new Map(),
    });
    expect(missing.customModels).toEqual([]);
    expect(missing.counts.droppedCustomModels).toBe(4);
    expect(diagnosticCodes(missing.diagnostics)).toContain("unresolved-attachment");
  });

  it("fails closed for an incomplete current document", () => {
    const result = hydrateStudioBg3dDocumentToRuntime({
      document: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
        nodes: null,
      } as unknown as StudioBg3dSceneDocument,
      storageModelIdByAttachmentId: new Map(),
    });

    expect(result.ok).toBe(false);
    expect(result.primitives).toEqual([]);
    expect(result.customModels).toEqual([]);
    expect(diagnosticCodes(result.diagnostics)).toEqual(["invalid-scene-document"]);
  });
});
