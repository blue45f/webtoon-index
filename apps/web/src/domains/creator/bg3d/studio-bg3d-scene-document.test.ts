import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  STUDIO_BG3D_GLB_MAX_BYTES,
  STUDIO_BG3D_GLB_MIME,
  STUDIO_BG3D_SCENE_DOCUMENT_KIND,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS,
  STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
  STUDIO_BG3D_SHOT_ID_MAX_LENGTH,
  STUDIO_BG3D_SHOT_MAX_NODE_VISIBILITY_OVERRIDES,
  STUDIO_BG3D_SHOT_NAME_MAX_LENGTH,
  StudioBg3dSceneDocumentBudgetError,
  applyStudioBg3dShot,
  captureStudioBg3dShot,
  createDefaultStudioBg3dSceneDocument,
  duplicateStudioBg3dShot,
  migrateStudioBg3dSceneDocument,
  moveStudioBg3dShot,
  normalizeStudioBg3dGlbAttachment,
  normalizeStudioBg3dSceneDocument,
  parseStudioBg3dSceneDocument,
  removeStudioBg3dShot,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dModelAttachment,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

function hash(index = 1): string {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

function attachment(
  index = 1,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: `model-${index}`,
    name: `배경 모델 ${index}.glb`,
    mime: STUDIO_BG3D_GLB_MIME,
    byteSize: 2_000_000,
    hash: hash(index),
    rights: {
      status: "owned",
      commercialUse: true,
      attributionRequired: false,
    },
    source: "upload",
    ...overrides,
  };
}

function primitiveNode(index = 1): Record<string, unknown> {
  return {
    id: `node-${index}`,
    name: `상자 ${index}`,
    kind: "primitive",
    primitiveKind: "box",
    color: "#c9a876",
    transform: {
      position: [index, 0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    parentId: null,
    visible: true,
    locked: false,
    castsShadow: true,
    receivesShadow: true,
  };
}

function currentDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    ...overrides,
  };
}

function expectSceneBudgetError(
  operation: () => unknown,
  code: StudioBg3dSceneDocumentBudgetError["code"],
): void {
  try {
    operation();
  } catch (cause) {
    expect(cause).toBeInstanceOf(StudioBg3dSceneDocumentBudgetError);
    expect((cause as StudioBg3dSceneDocumentBudgetError).code).toBe(code);
    return;
  }
  throw new Error(`Expected Studio BG3D scene budget error: ${code}.`);
}

function schemaV1Budgets(): Record<string, unknown> {
  const current = DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets;
  return {
    complexity: {
      maxNodes: current.complexity.maxNodes,
      maxTriangles: current.complexity.maxTriangles,
      maxDrawCalls: current.complexity.maxDrawCalls,
      maxMaterials: current.complexity.maxMaterials,
      maxLights: current.complexity.maxLights,
      maxModelBytes: current.complexity.maxModelBytes,
    },
    textures: { ...current.textures },
  };
}

/** A genuine v1 fixture: it predates every animation/rig/accessor budget added by v2. */
function schemaV1Document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const candidate = currentDocument(overrides);
  const camera = { ...(candidate.camera as Record<string, unknown>) };
  delete camera.nearClip;
  delete camera.up;
  return {
    ...candidate,
    version: 1,
    camera,
    budgets: overrides.budgets ?? schemaV1Budgets(),
  };
}

function schemaV2Document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const candidate = currentDocument(overrides);
  const camera = { ...(candidate.camera as Record<string, unknown>) };
  delete camera.nearClip;
  delete camera.up;
  return {
    ...candidate,
    version: 2,
    camera,
  };
}

function nearLegacyByteCapSchemaV2Document(): Record<string, unknown> {
  const nodes = Array.from({ length: 488 }, (_, index) => ({
    id: `n${index}`,
    name: "m".repeat(80),
    kind: "model",
    attachmentId: "model-1",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parentId: null,
    visible: true,
    locked: false,
    castsShadow: true,
    receivesShadow: true,
    constraints: {
      enabled: true,
      aims: Array.from({ length: 3 }, (_, aimIndex) => ({
        jointKey: `joint-${aimIndex}`,
        target: [0, 1, 0],
        axis: "+z",
        weight: 1,
      })),
    },
  }));
  return schemaV2Document({
    attachments: [attachment(1)],
    nodes,
    budgets: {
      ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
      complexity: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
        maxNodes: STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
      },
    },
  });
}

describe("Studio BG3D scene document defaults", () => {
  it("keeps the canonical default byte-for-byte stable across repeated parse and serialize cycles", () => {
    const original = createDefaultStudioBg3dSceneDocument();
    const serialized = serializeStudioBg3dSceneDocument(original);
    const parsed = serialized ? parseStudioBg3dSceneDocument(serialized) : null;

    expect(serialized).not.toBeNull();
    expect(parsed).toEqual(original);
    expect(serializeStudioBg3dSceneDocument(parsed)).toBe(serialized);
  });

  it("provides a complete, deeply frozen, engine-neutral default", () => {
    const document = createDefaultStudioBg3dSceneDocument();

    expect(document).toEqual(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT);
    expect(document).not.toBe(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT);
    expect(document.kind).toBe(STUDIO_BG3D_SCENE_DOCUMENT_KIND);
    expect(document.version).toBe(STUDIO_BG3D_SCENE_DOCUMENT_VERSION);
    expect(document.camera).toEqual({
      position: [4, 3, 6],
      target: [0, 0.6, 0],
      fovDegrees: 50,
      projection: "perspective",
      zoom: 1,
      nearClip: 0.1,
      up: [0, 1, 0],
    });
    expect(document.quality.desktop.targetFps).toBe(60);
    expect(document.quality.mobile.targetFps).toBe(30);
    expect(document.output.line.layerType).toBe("raster");
    expect(document.output.line.hiddenLineRemoval).toBe(true);
    expect(document.output.tone).toMatchObject({ mode: "flat", type: "color", opacity: 1 });
    expect(document.background.panoramaRotation).toBe(0);
    expect(document.budgets.complexity.maxNodes).toBe(256);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.camera.position)).toBe(true);
    expect(Object.isFrozen(document.quality.mobile)).toBe(true);
    expect(Object.isFrozen(document.nodes)).toBe(true);
  });

  it("returns independent default graphs rather than shared mutable children", () => {
    const first = createDefaultStudioBg3dSceneDocument();
    const second = createDefaultStudioBg3dSceneDocument();

    expect(first).not.toBe(second);
    expect(first.camera).not.toBe(second.camera);
    expect(first.camera.position).not.toBe(second.camera.position);
    expect(first.camera.up).not.toBe(second.camera.up);
    expect(first.budgets).not.toBe(second.budgets);
  });

  it("keeps pre-Camera-vNext v3 documents byte-compatible while new cameras persist bounded orientation", () => {
    const legacy = JSON.parse(JSON.stringify(DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT)) as {
      camera: Record<string, unknown>;
    };
    delete legacy.camera.nearClip;
    delete legacy.camera.up;
    const legacyJson = JSON.stringify(legacy);
    const parsedLegacy = parseStudioBg3dSceneDocument(legacyJson);

    expect(parsedLegacy).not.toBeNull();
    expect(parsedLegacy?.camera).not.toHaveProperty("nearClip");
    expect(parsedLegacy?.camera).not.toHaveProperty("up");
    expect(serializeStudioBg3dSceneDocument(parsedLegacy)).toBe(legacyJson);

    const rolled = normalizeStudioBg3dSceneDocument(currentDocument({
      camera: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
        nearClip: 0.025,
        up: [0.6, 0.8, 0],
      },
    }));
    const serialized = serializeStudioBg3dSceneDocument(rolled);
    expect(serialized).not.toBeNull();
    expect(parseStudioBg3dSceneDocument(serialized!)?.camera).toMatchObject({
      nearClip: 0.025,
      up: [0.6, 0.8, 0],
    });

    expect(serializeStudioBg3dSceneDocument(currentDocument({
      camera: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
        nearClip: 0,
      },
    }))).toBeNull();
    expect(serializeStudioBg3dSceneDocument(currentDocument({
      camera: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
        up: [0, 0, 0],
      },
    }))).toBeNull();
  });
});

describe("Studio BG3D scene document normalization", () => {
  it("round-trips bounded engine-neutral material overrides on model instances", () => {
    const materialOverride = {
      ...DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
      colorMode: "multiply" as const,
      color: "#80c0ff",
      colorStrength: 0.65,
      opacityMultiplier: 0.72,
      roughness: 0.35,
      metalness: 0.2,
      emissiveColor: "#112233",
      emissiveIntensity: 1.4,
      wireframe: true,
      doubleSided: true,
    };
    const serialized = serializeStudioBg3dSceneDocument(currentDocument({
      attachments: [attachment(1)],
      nodes: [{
        id: "model-node-1",
        name: "편집 모델",
        kind: "model",
        attachmentId: "model-1",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        parentId: null,
        visible: true,
        locked: false,
        castsShadow: true,
        receivesShadow: true,
        materialOverride,
        animation: {
          clipIndex: 2,
          playing: true,
          loop: "ping-pong",
          timeSeconds: 1.25,
          timeScale: -0.5,
          weight: 0.8,
        },
        pose: {
          enabled: true,
          weight: 0.75,
          joints: [{
            jointKey: "skin-0:joint-2",
            rotationOffset: [0, 0.7071067811865475, 0, 0.7071067811865475],
          }],
        },
        morph: {
          enabled: true,
          weight: 0.5,
          targets: [{ targetKey: "mesh-0:target-1", weightOffset: 0.4 }],
        },
        constraints: {
          enabled: true,
          aims: [{
            jointKey: "skin-0:joint-2",
            target: [1, 2, 3],
            axis: "+z",
            weight: 0.6,
          }],
          twoBoneIks: [{
            upperJointKey: "skin-0:joint-3",
            middleJointKey: "skin-0:joint-4",
            endJointKey: "skin-0:joint-5",
            target: [0.8, 1.2, 0.4],
            poleTarget: [0, 1, 1],
            weight: 0.75,
          }],
        },
      }],
    }));
    const parsed = parseStudioBg3dSceneDocument(serialized ?? "");
    const node = parsed?.nodes[0];

    expect(node?.kind).toBe("model");
    if (!node || node.kind !== "model") throw new Error("model fixture must survive");
    expect(node.materialOverride).toEqual(materialOverride);
    expect(node.animation).toEqual({
      clipIndex: 2,
      playing: true,
      loop: "ping-pong",
      timeSeconds: 1.25,
      timeScale: -0.5,
      weight: 0.8,
    });
    expect(node.pose).toEqual({
      enabled: true,
      weight: 0.75,
      joints: [{
        jointKey: "skin-0:joint-2",
        rotationOffset: [0, 0.7071067811865475, 0, 0.7071067811865475],
      }],
    });
    expect(node.morph).toEqual({
      enabled: true,
      weight: 0.5,
      targets: [{ targetKey: "mesh-0:target-1", weightOffset: 0.4 }],
    });
    expect(node.constraints).toEqual({
      enabled: true,
      aims: [{
        jointKey: "skin-0:joint-2",
        target: [1, 2, 3],
        axis: "+z",
        weight: 0.6,
      }],
      twoBoneIks: [{
        upperJointKey: "skin-0:joint-3",
        middleJointKey: "skin-0:joint-4",
        endJointKey: "skin-0:joint-5",
        target: [0.8, 1.2, 0.4],
        poleTarget: [0, 1, 1],
        weight: 0.75,
      }],
    });
    expect(Object.isFrozen(node.materialOverride)).toBe(true);
    expect(Object.isFrozen(node.pose?.joints[0]?.rotationOffset)).toBe(true);
    expect(Object.isFrozen(node.morph?.targets[0])).toBe(true);
    expect(Object.isFrozen(node.constraints?.aims[0]?.target)).toBe(true);
    expect(Object.isFrozen(node.constraints?.twoBoneIks?.[0]?.target)).toBe(true);
    expect(Object.isFrozen(node.constraints?.twoBoneIks?.[0]?.poleTarget)).toBe(true);

    const hostile = JSON.parse(serialized ?? "{}") as { nodes: { materialOverride: { opacityMultiplier: number } }[] };
    hostile.nodes[0].materialOverride.opacityMultiplier = 2;
    expect(parseStudioBg3dSceneDocument(JSON.stringify(hostile))).toBeNull();
  });

  it("fails closed instead of silently truncating valid per-model rig collections", () => {
    const modelNode = {
      id: "model-node-1",
      name: "리그 예산 모델",
      kind: "model",
      attachmentId: "model-1",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      parentId: null,
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    };
    const cases = [
      {
        code: "pose-joint-count-budget-exceeded" as const,
        patch: {
          pose: {
            enabled: true,
            weight: 1,
            joints: Array.from({ length: 257 }, (_, index) => ({
              jointKey: `joint-${index}`,
              rotationOffset: [0, 0, 0, 1],
            })),
          },
        },
      },
      {
        code: "morph-target-count-budget-exceeded" as const,
        patch: {
          morph: {
            enabled: true,
            weight: 1,
            targets: Array.from({ length: 257 }, (_, index) => ({
              targetKey: `target-${index}`,
              weightOffset: 0.5,
            })),
          },
        },
      },
      {
        code: "aim-constraint-count-budget-exceeded" as const,
        patch: {
          constraints: {
            enabled: true,
            aims: Array.from({ length: 129 }, (_, index) => ({
              jointKey: `aim-${index}`,
              target: [0, 1, 0],
              axis: "+z",
              weight: 1,
            })),
            twoBoneIks: [],
          },
        },
      },
      {
        code: "two-bone-ik-count-budget-exceeded" as const,
        patch: {
          constraints: {
            enabled: true,
            aims: [],
            twoBoneIks: Array.from({ length: 33 }, (_, index) => ({
              upperJointKey: `upper-${index}`,
              middleJointKey: `middle-${index}`,
              endJointKey: `end-${index}`,
              target: [0, 1, 0],
              poleTarget: [0, 0, 1],
              weight: 1,
            })),
          },
        },
      },
    ];

    for (const { code, patch } of cases) {
      const candidate = currentDocument({
        attachments: [attachment(1)],
        nodes: [{ ...modelNode, ...patch }],
      });
      expectSceneBudgetError(() => normalizeStudioBg3dSceneDocument(candidate), code);
      expect(parseStudioBg3dSceneDocument(JSON.stringify(candidate))).toBeNull();
      expect(serializeStudioBg3dSceneDocument(candidate)).toBeNull();
    }
  });

  it("migrates aim-only v2 constraints and rejects ambiguous or falsely versioned IK chains", () => {
    const modelNode = {
      id: "model-node-1",
      name: "리그 모델",
      kind: "model",
      attachmentId: "model-1",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      parentId: null,
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
      constraints: {
        enabled: true,
        aims: [{
          jointKey: "skin-0:joint-0",
          target: [0, 1, 0],
          axis: "+z",
          weight: 1,
        }],
      },
    };
    const aimOnly = schemaV2Document({
      attachments: [attachment(1)],
      nodes: [modelNode],
    });
    const aimOnlyJson = JSON.stringify(aimOnly);
    expect(parseStudioBg3dSceneDocument(aimOnlyJson)).toBeNull();
    expect(serializeStudioBg3dSceneDocument(aimOnly)).toBeNull();
    const migratedAimOnly = migrateStudioBg3dSceneDocument(aimOnly);
    const migratedAimNode = migratedAimOnly?.nodes[0];
    expect(migratedAimOnly?.version).toBe(STUDIO_BG3D_SCENE_DOCUMENT_VERSION);
    expect(migratedAimNode?.kind).toBe("model");
    if (!migratedAimNode || migratedAimNode.kind !== "model") {
      throw new Error("migrated aim-only model fixture must survive");
    }
    expect(migratedAimNode.constraints).toEqual({
      ...modelNode.constraints,
      twoBoneIks: [],
    });
    expect(Object.isFrozen(migratedAimNode.constraints?.twoBoneIks)).toBe(true);

    const validIk = {
      upperJointKey: "skin-0:joint-1",
      middleJointKey: "skin-0:joint-2",
      endJointKey: "skin-0:joint-3",
      target: [1, 1, 0],
      poleTarget: [0, 0, 1],
      weight: 1,
    };
    const ambiguous = currentDocument({
      attachments: [attachment(1)],
      nodes: [{
        ...modelNode,
        constraints: {
          ...modelNode.constraints,
          twoBoneIks: [
            validIk,
            { ...validIk, upperJointKey: "skin-0:joint-4" },
            { ...validIk, endJointKey: "skin-0:joint-5", middleJointKey: "skin-0:joint-1" },
          ],
        },
      }],
    });
    const normalized = normalizeStudioBg3dSceneDocument(ambiguous);
    const normalizedNode = normalized?.nodes[0];
    expect(normalizedNode?.kind).toBe("model");
    if (!normalizedNode || normalizedNode.kind !== "model") {
      throw new Error("normalized IK model fixture must survive");
    }
    expect(normalizedNode.constraints?.twoBoneIks).toEqual([validIk]);
    expect(parseStudioBg3dSceneDocument(JSON.stringify(ambiguous))).toBeNull();
    expect(serializeStudioBg3dSceneDocument(
      ambiguous as unknown as StudioBg3dSceneDocument,
    )).toBeNull();
    expect(migrateStudioBg3dSceneDocument({
      ...aimOnly,
      nodes: [{
        ...modelNode,
        constraints: { ...modelNode.constraints, twoBoneIks: [validIk] },
      }],
    })).toBeNull();
  });

  it("preserves near-cap v2 aim scenes when v3 adds explicit empty IK collections", () => {
    const legacy = nearLegacyByteCapSchemaV2Document();
    const legacyBytes = new TextEncoder().encode(JSON.stringify(legacy)).byteLength;
    const migrated = migrateStudioBg3dSceneDocument(legacy);
    const migratedBytes = new TextEncoder().encode(JSON.stringify(migrated)).byteLength;

    expect(legacyBytes).toBeLessThanOrEqual(256 * 1024);
    expect(migratedBytes).toBeGreaterThan(256 * 1024);
    expect(migratedBytes).toBeLessThanOrEqual(STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES);
    expect(migrated?.nodes).toHaveLength(488);
    expect(migrated?.nodes.every((node) =>
      node.kind !== "model" || node.constraints?.twoBoneIks.length === 0
    )).toBe(true);

    const panoramaLegacy = {
      ...legacy,
      background: {
        ...(legacy.background as Record<string, unknown>),
        panoramaUrl: "https://legacy.invalid/near-cap-panorama.jpg",
      },
    };
    const migratedPanorama = migrateStudioBg3dSceneDocument(panoramaLegacy);
    expect(migratedPanorama?.nodes).toHaveLength(488);
    expect(Reflect.has(migratedPanorama?.background ?? {}, "panoramaUrl")).toBe(false);
  });

  it("migrates a canonical schema-v1 document to the current schema without accepting v2-only fields", () => {
    const legacy = schemaV1Document();

    expect(parseStudioBg3dSceneDocument(JSON.stringify(legacy))).toBeNull();
    expect(migrateStudioBg3dSceneDocument(legacy)).toMatchObject({
      kind: STUDIO_BG3D_SCENE_DOCUMENT_KIND,
      version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
      budgets: {
        complexity: {
          maxAnimations: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity.maxAnimations,
          maxAccessorElements:
            DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity.maxAccessorElements,
        },
      },
    });

    expect(migrateStudioBg3dSceneDocument({
      ...legacy,
      budgets: {
        ...(legacy.budgets as object),
        complexity: {
          ...((legacy.budgets as { complexity: Record<string, unknown> }).complexity),
          maxAnimations: 1,
        },
      },
    })).toBeNull();
    expect(migrateStudioBg3dSceneDocument({
      ...legacy,
      camera: {
        ...(legacy.camera as Record<string, unknown>),
        nearClip: 0.1,
      },
    })).toBeNull();
    const legacyV2 = schemaV2Document();
    expect(migrateStudioBg3dSceneDocument({
      ...legacyV2,
      camera: {
        ...(legacyV2.camera as Record<string, unknown>),
        up: [0, 1, 0],
      },
    })).toBeNull();

    const legacyWithFutureField = {
      ...legacy,
      attachments: [attachment(1)],
      nodes: [{
        id: "future-node",
        name: "future",
        kind: "model",
        attachmentId: "model-1",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        parentId: null,
        visible: true,
        locked: false,
        castsShadow: true,
        receivesShadow: true,
        materialOverride: DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
      }],
    };
    expect(migrateStudioBg3dSceneDocument(legacyWithFutureField)).toBeNull();
  });

  it("round-trips the material-color output type without degrading it to grayscale", () => {
    const candidate = currentDocument({
      output: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output,
        tone: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output.tone,
          mode: "cel",
          type: "color",
          levels: 5,
        },
      },
    });
    const serialized = serializeStudioBg3dSceneDocument(
      candidate as unknown as StudioBg3dSceneDocument
    );

    expect(serialized).not.toBeNull();
    expect(parseStudioBg3dSceneDocument(serialized!)?.output.tone).toMatchObject({
      mode: "cel",
      type: "color",
      levels: 5,
    });
  });

  it("round-trips all current engine-neutral settings and strips unknown fields", () => {
    const normalized = normalizeStudioBg3dSceneDocument(
      currentDocument({
        camera: { position: [8, 5, 12], target: [0, 1, 0], fovDegrees: 35 },
        render: {
          antialias: false,
          shadows: false,
          exposure: 1.4,
          toneMapping: "aces",
          colorSpace: "display-p3",
          renderer: "babylon",
        },
        background: {
          mode: "color",
          color: "#ABCDEF",
          skyPresetId: "night",
          panoramaRotation: 135,
        },
        lighting: {
          ambientColor: "#eeeeee",
          ambientIntensity: 0.5,
          key: { color: "#ffffff", direction: [0, 4, 0], intensity: 2, castsShadow: true },
          fill: { color: "#ffccaa", direction: [-2, 1, -3], intensity: 0.2, castsShadow: false },
        },
        output: {
          transparentBackground: true,
          exportHeight: 1280,
          line: {
            enabled: true,
            layerType: "raster",
            color: "#112233",
            widthPx: 2.5,
            strength: 0.65,
            accuracy: 0.9,
            scaleAwareAccuracy: false,
            exteriorOutlineStrength: 1.4,
            depthEnabled: true,
            depthStrength: 0.7,
            depthOutlineOnly: false,
            smoothing: 0.8,
            textureLineEnabled: false,
            textureLineStrength: 0.25,
            creaseAngleDegrees: 35,
            hiddenLineRemoval: false,
          },
          tone: {
            mode: "screentone",
            type: "pattern",
            pattern: "crosshatch",
            levels: 5,
            opacity: 0.7,
            frequency: 80,
            angleDegrees: 30,
          },
        },
        unknownRoot: "removed",
      })
    );
    const serialized = serializeStudioBg3dSceneDocument(normalized);

    expect(normalized.camera.fovDegrees).toBe(35);
    expect(normalized.render).toEqual({
      antialias: false,
      shadows: false,
      exposure: 1.4,
      toneMapping: "aces",
      colorSpace: "srgb",
    });
    expect(normalized.background.color).toBe("#abcdef");
    expect(normalized.background.panoramaRotation).toBe(135);
    expect(normalized.lighting.key.direction).toEqual([0, 1, 0]);
    expect(normalized.output.line).toMatchObject({
      layerType: "raster",
      strength: 0.65,
      accuracy: 0.9,
      scaleAwareAccuracy: false,
      exteriorOutlineStrength: 1.4,
      depthEnabled: true,
      depthStrength: 0.7,
      depthOutlineOnly: false,
      smoothing: 0.8,
      textureLineEnabled: false,
      textureLineStrength: 0.25,
    });
    expect(normalized.output.tone).toMatchObject({
      mode: "screentone",
      type: "pattern",
      pattern: "crosshatch",
    });
    expect(serialized).not.toContain("unknownRoot");
    expect(serialized).not.toContain("renderer");
    expect(parseStudioBg3dSceneDocument(serialized ?? "")).toEqual(normalized);
  });

  it("keeps canonical schema-v1 atmosphere settings parseable when a legacy fog range is inverted", () => {
    const normalized = normalizeStudioBg3dSceneDocument(
      currentDocument({
        background: {
          mode: "sky-preset",
          color: "#D8E3ED",
          skyPresetId: "clear_day",
          fogEnabled: true,
          fogColor: "#C9D6DF",
          fogNear: 70,
          fogFar: 5,
        },
      }),
    );

    expect(normalized.background).toMatchObject({
      fogEnabled: true,
      fogColor: "#c9d6df",
      fogNear: 70,
      fogFar: 5,
    });
    expect(parseStudioBg3dSceneDocument(serializeStudioBg3dSceneDocument(normalized) ?? "")?.background)
      .toEqual(normalized.background);
  });

  it("clamps camera, render, quality, output, and budget values to hard product limits", () => {
    const normalized = normalizeStudioBg3dSceneDocument(
      currentDocument({
        camera: {
          position: [-99_999, Number.NaN, 99_999],
          target: [99_999, -99_999, 0],
          fovDegrees: 500,
        },
        render: { exposure: -5, toneMapping: "hostile" },
        quality: {
          desktop: {
            targetFps: 999,
            dprMin: 9,
            dprMax: 0.1,
            maxRenderPixels: 99_999_999,
            shadowMapSize: 333,
            textureScale: 0,
            lodBias: 99,
          },
          mobile: {
            targetFps: 1,
            dprMin: 0,
            dprMax: 0,
            maxRenderPixels: 1,
            shadowMapSize: 4096,
            textureScale: 2,
            lodBias: -99,
          },
        },
        output: {
          exportHeight: 99_999,
          line: {
            layerType: "hostile",
            widthPx: 100,
            strength: 99,
            accuracy: -1,
            exteriorOutlineStrength: 99,
            depthStrength: -1,
            smoothing: 99,
            textureLineStrength: -1,
            creaseAngleDegrees: -20,
          },
          tone: {
            type: "hostile",
            pattern: "hostile",
            levels: 99,
            opacity: -1,
            frequency: 999,
            angleDegrees: 999,
          },
        },
        budgets: {
          complexity: {
            maxNodes: 99_999,
            maxTriangles: 99_999_999,
            maxDrawCalls: 99_999,
            maxMaterials: 99_999,
            maxLights: 99,
            maxAnimations: 99_999,
            maxAnimationChannels: 99_999,
            maxAnimationKeyframes: 99_999_999,
            maxAnimationValues: 99_999_999,
            maxSkins: 99_999,
            maxJoints: 99_999,
            maxMorphTargets: 99_999,
            maxAccessorElements: 999_999_999,
            maxDecodedGeometryBytes: 9_999_999_999,
            maxModelBytes: 999_999_999,
          },
          textures: {
            maxTextures: 999,
            maxTotalBytes: 999_999_999,
            maxDimension: 99_999,
          },
        },
      })
    );

    expect(normalized.camera.position).toEqual([-10_000, 3, 10_000]);
    expect(normalized.camera.target).toEqual([10_000, -10_000, 0]);
    expect(normalized.camera.fovDegrees).toBe(120);
    expect(normalized.render.exposure).toBe(0.1);
    expect(normalized.render.toneMapping).toBe("neutral");
    expect(normalized.quality.desktop).toMatchObject({
      targetFps: 120,
      dprMin: 3,
      dprMax: 3,
      maxRenderPixels: 16_777_216,
      shadowMapSize: 2048,
      textureScale: 0.25,
      lodBias: 4,
    });
    expect(normalized.quality.mobile).toMatchObject({
      targetFps: 15,
      dprMin: 0.5,
      dprMax: 0.5,
      maxRenderPixels: 320 * 240,
      shadowMapSize: 4096,
      textureScale: 1,
      lodBias: -2,
    });
    expect(normalized.output.exportHeight).toBe(4096);
    expect(normalized.output.line).toMatchObject({
      layerType: "raster",
      widthPx: 8,
      strength: 1,
      accuracy: 0,
      exteriorOutlineStrength: 2,
      depthStrength: 0,
      smoothing: 1,
      textureLineStrength: 0,
      creaseAngleDegrees: 0,
    });
    expect(normalized.output.tone).toMatchObject({
      type: "color",
      pattern: "dot",
      levels: 8,
      opacity: 0,
      frequency: 200,
      angleDegrees: 180,
    });
    expect(normalized.budgets.complexity).toEqual({
      maxNodes: STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
      maxTriangles: 10_000_000,
      maxDrawCalls: 2048,
      maxMaterials: 1024,
      maxLights: 16,
      maxAnimations: 256,
      maxAnimationChannels: 4_096,
      maxAnimationKeyframes: 4_000_000,
      maxAnimationValues: 32_000_000,
      maxSkins: 256,
      maxJoints: 8_192,
      maxMorphTargets: 1_024,
      maxAccessorElements: 160_000_000,
      maxDecodedGeometryBytes: 1024 * 1024 * 1024,
      maxModelBytes: 512 * 1024 * 1024,
    });
    expect(normalized.budgets.textures).toEqual({
      maxTextures: 256,
      maxTotalBytes: 512 * 1024 * 1024,
      maxDimension: 8192,
    });
  });

  it("repairs a camera whose position equals its target", () => {
    const normalized = normalizeStudioBg3dSceneDocument(
      currentDocument({
        camera: { position: [4, 3, 6], target: [4, 3, 6], fovDegrees: 50 },
      })
    );

    expect(normalized.camera.position).not.toEqual(normalized.camera.target);
    expect(
      Math.hypot(
        normalized.camera.position[0] - normalized.camera.target[0],
        normalized.camera.position[1] - normalized.camera.target[1],
        normalized.camera.position[2] - normalized.camera.target[2]
      )
    ).toBeGreaterThanOrEqual(0.01);
  });

  it("keeps the light budget large enough for ambient, key, and fill settings", () => {
    const normalized = normalizeStudioBg3dSceneDocument(
      currentDocument({
        budgets: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
          complexity: {
            ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
            maxLights: 0,
          },
        },
      })
    );

    expect(normalized.budgets.complexity.maxLights).toBe(3);
  });

  it("fails closed for malformed, cyclic, accessor-throwing, oversized, and unknown-version roots", () => {
    const cyclic: Record<string, unknown> = currentDocument();
    cyclic.self = cyclic;
    const accessor = currentDocument();
    Object.defineProperty(accessor, "camera", {
      enumerable: true,
      get() {
        throw new Error("hostile getter");
      },
    });
    const oversized = JSON.stringify(
      currentDocument({ padding: "가".repeat(STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES) })
    );
    const unknownVersion = JSON.stringify(currentDocument({ version: 999 }));

    for (const raw of ["{bad json", cyclic, accessor, unknownVersion]) {
      expect(
        typeof raw === "string" ? parseStudioBg3dSceneDocument(raw) : migrateStudioBg3dSceneDocument(raw)
      ).toBeNull();
      expect(normalizeStudioBg3dSceneDocument(raw)).toEqual(
        DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT
      );
    }
    expect(parseStudioBg3dSceneDocument(oversized)).toBeNull();
    expectSceneBudgetError(
      () => normalizeStudioBg3dSceneDocument(oversized),
      "input-byte-budget-exceeded",
    );
  });

  it("requires every current persistence root while keeping the interactive normalizer lenient", () => {
    const recordSections = [
      "camera",
      "render",
      "background",
      "lighting",
      "quality",
      "output",
      "budgets",
    ] as const;
    const arraySections = ["attachments", "nodes"] as const;

    for (const key of [...recordSections, ...arraySections]) {
      const missing = currentDocument();
      delete missing[key];
      expect(parseStudioBg3dSceneDocument(JSON.stringify(missing))).toBeNull();
      expect(serializeStudioBg3dSceneDocument(missing)).toBeNull();
    }
    for (const key of recordSections) {
      const wrongType = currentDocument({ [key]: [] });
      expect(parseStudioBg3dSceneDocument(JSON.stringify(wrongType))).toBeNull();
      expect(serializeStudioBg3dSceneDocument(wrongType)).toBeNull();
    }
    for (const key of arraySections) {
      const wrongType = currentDocument({ [key]: {} });
      expect(parseStudioBg3dSceneDocument(JSON.stringify(wrongType))).toBeNull();
      expect(serializeStudioBg3dSceneDocument(wrongType)).toBeNull();
    }

    const lenient = currentDocument();
    delete lenient.camera;
    delete lenient.nodes;
    expect(normalizeStudioBg3dSceneDocument(lenient)).toMatchObject({
      camera: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
      nodes: [],
    });
  });

  it("fails closed instead of byte-fitting a prefix of 512 sparse model nodes", () => {
    const nodes = Array.from({ length: STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES }, (_, index) => ({
      id: `emoji-${index}`,
      name: "😀".repeat(80),
      kind: "model",
      attachmentId: "model-1",
      // A present but sparse optional section expands to its full canonical shape.
      materialOverride: {},
    }));
    const raw = JSON.stringify(
      currentDocument({
        attachments: [attachment()],
        budgets: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
          complexity: {
            ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
            maxNodes: STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
          },
        },
        nodes,
      })
    );
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(
      STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES
    );
    expectSceneBudgetError(
      () => normalizeStudioBg3dSceneDocument(raw),
      "document-byte-budget-exceeded",
    );
    expect(parseStudioBg3dSceneDocument(raw)).toBeNull();
  });

  it("rejects every lossy nested rewrite at the strict persistence boundary", () => {
    const canonicalAttachment = attachment(1);
    const modelNode = {
      id: "model-node-1",
      name: "검증 모델",
      kind: "model",
      attachmentId: "model-1",
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      visible: true,
      locked: false,
      castsShadow: true,
      receivesShadow: true,
    };
    const cases = [
      currentDocument({ attachments: [attachment(1, { hash: "sha256:broken" })], nodes: [modelNode] }),
      currentDocument({ attachments: [attachment(1, { rights: { status: "licensed", commercialUse: true, attributionRequired: false } })] }),
      currentDocument({ attachments: [canonicalAttachment, attachment(2, { id: "model-1" })] }),
      currentDocument({ attachments: [canonicalAttachment], nodes: [{ ...modelNode, attachmentId: "missing" }] }),
      currentDocument({ nodes: [primitiveNode(1), { ...primitiveNode(2), id: "node-1" }] }),
      currentDocument({ render: { ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.render, toneMapping: "invalid" } }),
      currentDocument({ camera: { ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera, fovDegrees: 999 } }),
      currentDocument({ runtimeUrl: "blob:https://private.invalid/model" }),
    ];

    for (const candidate of cases) {
      expect(parseStudioBg3dSceneDocument(JSON.stringify(candidate))).toBeNull();
      expect(serializeStudioBg3dSceneDocument(candidate)).toBeNull();
    }
  });

  it("does not retain prototype-pollution or credential-like unknown properties", () => {
    const raw = JSON.parse(
      `{"kind":"${STUDIO_BG3D_SCENE_DOCUMENT_KIND}","version":1,"__proto__":{"polluted":true},"apiKey":"secret","camera":{"position":[4,3,6],"target":[0,0,0],"fovDegrees":50,"constructor":{"polluted":true}}}`
    ) as unknown;
    const normalized = normalizeStudioBg3dSceneDocument(raw);
    const serialized = JSON.stringify(normalized);

    expect(serialized).not.toContain("polluted");
    expect(serialized).not.toContain("secret");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("strips nested panorama URLs leniently and rejects them at strict persistence boundaries", () => {
    const panoramaUrl = "https://private.invalid/sky.webp?access_token=secret";
    const hostile = currentDocument({
      background: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
        skyPresetId: "sunset",
        panoramaRotation: -75,
        panoramaUrl,
      },
    });
    const normalized = normalizeStudioBg3dSceneDocument(hostile);
    const normalizedJson = JSON.stringify(normalized);

    expect(normalized.background).toMatchObject({
      skyPresetId: "sunset",
      panoramaRotation: -75,
    });
    expect(normalizedJson).not.toContain("panoramaUrl");
    expect(normalizedJson).not.toContain("private.invalid");
    expect(normalizedJson).not.toContain("access_token");
    expect(parseStudioBg3dSceneDocument(JSON.stringify(hostile))).toBeNull();
    expect(serializeStudioBg3dSceneDocument(hostile)).toBeNull();
  });
});

describe("Studio BG3D GLB attachment contract", () => {
  it("accepts canonical GLB metadata, lowercases hash/extension, and preserves rights provenance", () => {
    const normalized = normalizeStudioBg3dGlbAttachment(
      attachment(1, {
        name: "Licensed House.GLB",
        hash: hash(1).toUpperCase(),
        rights: {
          status: "licensed",
          commercialUse: true,
          attributionRequired: true,
          attribution: "Studio Asset Artist",
          licenseName: "Commercial Asset License",
        },
        source: "local-library",
      })
    );

    expect(normalized).toEqual({
      id: "model-1",
      name: "Licensed House.glb",
      mime: STUDIO_BG3D_GLB_MIME,
      byteSize: 2_000_000,
      hash: hash(1),
      rights: {
        status: "licensed",
        commercialUse: true,
        attributionRequired: true,
        attribution: "Studio Asset Artist",
        licenseName: "Commercial Asset License",
      },
      source: "local-library",
    });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized?.rights)).toBe(true);
  });

  it("enforces GLB-only name, MIME, byte-size, hash, source, and rights requirements", () => {
    const invalid = [
      attachment(1, { name: "scene.gltf" }),
      attachment(1, { name: "scene.obj" }),
      attachment(1, { name: "folder/scene.glb" }),
      attachment(1, { name: "https://example.com/scene.glb" }),
      attachment(1, { name: "bad\u0000name.glb" }),
      attachment(1, { id: "constructor" }),
      attachment(1, { id: "model/unsafe" }),
      attachment(1, { mime: "model/gltf+json" }),
      attachment(1, { byteSize: 0 }),
      attachment(1, { byteSize: STUDIO_BG3D_GLB_MAX_BYTES + 1 }),
      attachment(1, { byteSize: 1.5 }),
      attachment(1, { hash: "sha256:abc" }),
      attachment(1, { source: "https://cdn.example.com/model.glb" }),
      attachment(1, { rights: null }),
      attachment(1, {
        rights: {
          status: "licensed",
          commercialUse: true,
          attributionRequired: false,
        },
      }),
      attachment(1, {
        rights: {
          status: "owned",
          commercialUse: true,
          attributionRequired: true,
        },
      }),
      attachment(1, {
        rights: {
          status: "owned",
          commercialUse: true,
          attributionRequired: true,
          attribution: ["sk", "private-token-123456789"].join("-"),
        },
      }),
    ];

    for (const candidate of invalid) {
      expect(normalizeStudioBg3dGlbAttachment(candidate)).toBeNull();
    }
  });

  it("strips URL, Blob, storage-key, and credential fields instead of serializing them", () => {
    const secretUrl = "https://private.example.com/model.glb?token=secret";
    const raw = attachment(1, {
      url: secretUrl,
      objectUrl: "blob:https://app.example/id",
      blob: { byteLength: 2_000_000 },
      storageKey: "indexed-db-private-key",
      apiKey: "private-credential-value",
      rights: {
        status: "owned",
        commercialUse: true,
        attributionRequired: false,
        attribution: secretUrl,
      },
    });
    const normalized = normalizeStudioBg3dGlbAttachment(raw);
    const serialized = JSON.stringify(normalized);

    expect(normalized).not.toBeNull();
    expect(Object.keys(normalized ?? {})).toEqual([
      "id",
      "name",
      "mime",
      "byteSize",
      "hash",
      "rights",
      "source",
    ]);
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("blob:");
    expect(serialized).not.toContain("indexed-db-private-key");
    expect(serialized).not.toContain("private-credential-value");
  });

  it("forces unknown rights to non-commercial and fails closed on attachment count or total bytes", () => {
    const unknown = normalizeStudioBg3dGlbAttachment(
      attachment(1, {
        rights: {
          status: "unknown",
          commercialUse: true,
          attributionRequired: false,
        },
      })
    );
    const many = Array.from(
      { length: STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS + 1 },
      (_, index) => attachment(index + 1, { byteSize: 1 })
    );
    many.splice(2, 0, attachment(1, { id: "duplicate-id", byteSize: 1 }));
    const aggregateOverflow = currentDocument({
        budgets: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
          complexity: {
            ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
            maxModelBytes: 1 * 1024 * 1024,
          },
        },
        attachments: [
          attachment(1, { byteSize: 600_000 }),
          attachment(2, { byteSize: 600_000 }),
        ],
      });
    const countOverflow = currentDocument({
      budgets: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
        complexity: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
          maxModelBytes: 512 * 1024 * 1024,
        },
      },
      attachments: many,
    });

    expect(unknown?.rights.commercialUse).toBe(false);
    expectSceneBudgetError(
      () => normalizeStudioBg3dSceneDocument(aggregateOverflow),
      "model-byte-budget-exceeded",
    );
    expectSceneBudgetError(
      () => normalizeStudioBg3dSceneDocument(countOverflow),
      "attachment-count-budget-exceeded",
    );
    expect(serializeStudioBg3dSceneDocument(aggregateOverflow)).toBeNull();
    expect(serializeStudioBg3dSceneDocument(countOverflow)).toBeNull();
  });
});

describe("Studio BG3D scene nodes and budgets", () => {
  it("normalizes primitive/model nodes and requires a valid attachment for model placement", () => {
    const validAttachment = attachment(1);
    const normalized = normalizeStudioBg3dSceneDocument(
      currentDocument({
        attachments: [validAttachment],
        nodes: [
          {
            ...primitiveNode(1),
            name: "https://example.com/hostile-node-name",
            color: "invalid",
            transform: {
              position: [20_000, -20_000, Number.POSITIVE_INFINITY],
              rotation: [Math.PI * 4, -Math.PI * 4, Math.PI],
              scale: [-1, 0, 2_000],
            },
          },
          {
            id: "model-node",
            name: "내 배경",
            kind: "model",
            attachmentId: "model-1",
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            visible: false,
            castsShadow: true,
            receivesShadow: false,
          },
          {
            id: "orphan-model",
            kind: "model",
            attachmentId: "missing",
          },
          { ...primitiveNode(3), primitiveKind: "hostile-geometry" },
        ],
      })
    );

    expect(normalized.nodes).toHaveLength(2);
    expect(normalized.nodes[0]).toMatchObject({
      id: "node-1",
      name: "3D 요소",
      kind: "primitive",
      color: "#b8b8c2",
      transform: {
        position: [10_000, -10_000, 0],
        rotation: [0, 0, -Math.PI],
        scale: [0.001, 0.001, 1_000],
      },
    });
    expect(normalized.nodes[1]).toMatchObject({
      id: "model-node",
      kind: "model",
      attachmentId: "model-1",
      visible: false,
    });
  });

  it("deduplicates node ids but fails closed instead of truncating at the node budget", () => {
    const nodes = Array.from({ length: 20 }, (_, index) => primitiveNode(index + 1));
    nodes.splice(1, 0, primitiveNode(1));
    const candidate = currentDocument({
        budgets: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
          complexity: {
            ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
            maxNodes: 3,
          },
        },
        nodes,
      });

    expectSceneBudgetError(
      () => normalizeStudioBg3dSceneDocument(candidate),
      "node-count-budget-exceeded",
    );
    expect(serializeStudioBg3dSceneDocument(candidate)).toBeNull();
  });

  it("repairs orphan/self/cyclic parents leniently and rejects them at the strict boundary", () => {
    const cycleA = { ...primitiveNode(1), parentId: "node-2" };
    const cycleB = { ...primitiveNode(2), parentId: "node-1" };
    const orphan = { ...primitiveNode(3), parentId: "missing" };
    const self = { ...primitiveNode(4), parentId: "node-4" };
    const candidate = currentDocument({ nodes: [cycleA, cycleB, orphan, self] });

    const normalized = normalizeStudioBg3dSceneDocument(candidate);

    expect(normalized.nodes.map(({ id, parentId }) => [id, parentId])).toEqual([
      ["node-1", null],
      ["node-2", "node-1"],
      ["node-3", null],
      ["node-4", null],
    ]);
    expect(parseStudioBg3dSceneDocument(JSON.stringify(candidate))).toBeNull();
  });

  it("fails closed for exactly 513 valid nodes instead of returning a 512-node prefix", () => {
    const nodes = Array.from(
      { length: STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES + 1 },
      (_, index) => ({
        id: `n-${index}`,
        name: "n",
        kind: "primitive",
        primitiveKind: "box",
      })
    );
    const candidate = currentDocument({
        budgets: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
          complexity: {
            ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
            maxNodes: 999_999,
          },
        },
        nodes,
      });

    expectSceneBudgetError(
      () => normalizeStudioBg3dSceneDocument(candidate),
      "node-count-budget-exceeded",
    );
    expect(parseStudioBg3dSceneDocument(JSON.stringify(candidate))).toBeNull();
  });
});

describe("Studio BG3D bounded storyboard shots", () => {
  it("keeps shot-less v3 and migrated v2 documents byte-compatible", () => {
    const v3 = createDefaultStudioBg3dSceneDocument();
    const serializedV3 = serializeStudioBg3dSceneDocument(v3);
    const migratedV2 = migrateStudioBg3dSceneDocument(schemaV2Document());
    const inactiveStoryboard = currentDocument({
      shots: [{ id: "shot-a", name: "비활성 컷" }],
    });

    expect(serializedV3).toBe(JSON.stringify(v3));
    expect(parseStudioBg3dSceneDocument(serializedV3 ?? "")).toEqual(v3);
    expect(v3).not.toHaveProperty("shots");
    expect(v3).not.toHaveProperty("activeShotId");
    expect(migratedV2).not.toBeNull();
    expect(migratedV2).not.toHaveProperty("shots");
    expect(migratedV2).not.toHaveProperty("activeShotId");
    expect(serializeStudioBg3dSceneDocument(inactiveStoryboard)).not.toBeNull();
    expect(normalizeStudioBg3dSceneDocument(inactiveStoryboard)).not.toHaveProperty(
      "activeShotId",
    );
  });

  it("round-trips ordered partial camera, visibility, atmosphere, lighting, render, and LT overrides", () => {
    const candidate = currentDocument({
      nodes: [primitiveNode(1), primitiveNode(2)],
      shots: [
        {
          id: "shot-wide",
          name: "전경 와이드",
          camera: {
            position: [8, 4, 8],
            fovDegrees: 35,
            nearClip: 0.04,
            up: [0, 0.8, 0.6],
          },
          nodeVisibility: [{ nodeId: "node-2", visible: false }],
          render: { exposure: 1.5, toneMapping: "aces" },
          background: {
            skyPresetId: "sunset",
            fogEnabled: true,
            fogColor: "#112233",
          },
          lighting: { ambientIntensity: 0.4, key: { intensity: 2 } },
          output: {
            line: { layerType: "vector", widthPx: 2 },
            tone: { mode: "screentone", pattern: "crosshatch" },
          },
        },
        { id: "shot-close", name: "클로즈업", camera: { zoom: 1.4 } },
      ],
      activeShotId: "shot-wide",
    });
    const serialized = serializeStudioBg3dSceneDocument(candidate);
    const parsed = parseStudioBg3dSceneDocument(serialized ?? "");

    expect(serialized).not.toBeNull();
    expect(parsed?.shots?.map((shot) => shot.id)).toEqual(["shot-wide", "shot-close"]);
    expect(parsed?.shots?.[0]).toMatchObject({
      id: "shot-wide",
      name: "전경 와이드",
      camera: {
        position: [8, 4, 8],
        fovDegrees: 35,
        nearClip: 0.04,
        up: [0, 0.8, 0.6],
      },
      nodeVisibility: [{ nodeId: "node-2", visible: false }],
      render: { exposure: 1.5, toneMapping: "aces" },
      background: { skyPresetId: "sunset", fogEnabled: true, fogColor: "#112233" },
      lighting: { ambientIntensity: 0.4, key: { intensity: 2 } },
      output: {
        line: { layerType: "vector", widthPx: 2 },
        tone: { mode: "screentone", pattern: "crosshatch" },
      },
    });
    expect(parsed?.activeShotId).toBe("shot-wide");
    expect(Object.isFrozen(parsed?.shots)).toBe(true);
    expect(Object.isFrozen(parsed?.shots?.[0]?.camera)).toBe(true);
    expect(serializeStudioBg3dSceneDocument(currentDocument({
      shots: [{
        id: "shot-singular",
        name: "잘못된 수직 컷",
        camera: {
          position: [0, 10, 0],
          target: [0, 0, 0],
          up: [0, 1, 0],
        },
      }],
    }))).toBeNull();
  });

  it("applies a shot without mutating geometry, assets, or unspecified presentation fields", () => {
    const original = normalizeStudioBg3dSceneDocument(currentDocument({
      nodes: [primitiveNode(1), primitiveNode(2)],
      shots: [{
        id: "shot-night",
        name: "야간 컷",
        camera: {
          position: [2, 1.5, 3],
          fovDegrees: 28,
          nearClip: 0.2,
          up: [1, 0, 0],
        },
        nodeVisibility: [{ nodeId: "node-2", visible: false }],
        render: { exposure: 0.7 },
        background: { skyPresetId: "night", fogEnabled: true },
        lighting: { key: { intensity: 3.2 } },
        output: { line: { widthPx: 2.5 }, tone: { mode: "cel", levels: 3 } },
      }],
    }));
    const applied = applyStudioBg3dShot(original, "shot-night");

    expect(applied).not.toBeNull();
    expect(applied?.activeShotId).toBe("shot-night");
    expect(applied?.camera).toMatchObject({
      position: [2, 1.5, 3],
      fovDegrees: 28,
      nearClip: 0.2,
      up: [1, 0, 0],
    });
    expect(applied?.nodes.map(({ id, visible }) => [id, visible])).toEqual([
      ["node-1", true],
      ["node-2", false],
    ]);
    expect(applied?.background).toMatchObject({ skyPresetId: "night", fogEnabled: true });
    expect(applied?.lighting.key).toMatchObject({
      intensity: 3.2,
      color: original.lighting.key.color,
      direction: original.lighting.key.direction,
    });
    expect(applied?.output.line.widthPx).toBe(2.5);
    expect(applied?.output.tone).toMatchObject({ mode: "cel", levels: 3 });
    expect(applied?.nodes[0].transform).toEqual(original.nodes[0].transform);
    expect(applied?.attachments).toEqual(original.attachments);
    expect(original.nodes[1].visible).toBe(true);
    expect(original).not.toHaveProperty("activeShotId");
    expect(applyStudioBg3dShot(original, "missing-shot")).toBeNull();
  });

  it("captures and duplicates immutable full-state shot snapshots through pure helpers", () => {
    const original = normalizeStudioBg3dSceneDocument(currentDocument({
      camera: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
        fovDegrees: 42,
        nearClip: 0.05,
        up: [0, 0.8, 0.6],
      },
      background: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
        skyPresetId: "clear_day",
      },
      nodes: [primitiveNode(1), { ...primitiveNode(2), visible: false }],
    }));
    const captured = captureStudioBg3dShot(original, { id: "shot-a", name: "설정 컷" });
    const duplicated = duplicateStudioBg3dShot(
      captured,
      "shot-a",
      { id: "shot-b", name: "설정 컷 복제" },
    );

    expect(captured?.shots).toHaveLength(1);
    expect(captured?.shots?.[0]).toMatchObject({
      id: "shot-a",
      name: "설정 컷",
      camera: { fovDegrees: 42, nearClip: 0.05, up: [0, 0.8, 0.6] },
      background: { skyPresetId: "clear_day" },
      nodeVisibility: [
        { nodeId: "node-1", visible: true },
        { nodeId: "node-2", visible: false },
      ],
    });
    expect(duplicated?.shots).toHaveLength(2);
    expect(duplicated?.shots?.[1]).toEqual({
      ...duplicated?.shots?.[0],
      id: "shot-b",
      name: "설정 컷 복제",
    });
    expect(duplicated?.activeShotId).toBe("shot-b");
    expect(Object.isFrozen(duplicated?.shots?.[1]?.output?.line)).toBe(true);
    expect(Object.isFrozen(duplicated?.shots?.[1]?.camera?.up)).toBe(true);
    expect(original).not.toHaveProperty("shots");
    expect(duplicateStudioBg3dShot(captured, "shot-a", {
      id: "shot-a",
      name: "중복",
    })).toBeNull();
  });

  it("reorders and removes shots without changing their payloads or scene geometry", () => {
    const original = normalizeStudioBg3dSceneDocument(currentDocument({
      nodes: [primitiveNode(1)],
      shots: [
        { id: "shot-a", name: "첫 컷", camera: { zoom: 1.1 } },
        { id: "shot-b", name: "둘째 컷", background: { fogEnabled: true } },
        { id: "shot-c", name: "셋째 컷", output: { transparentBackground: true } },
      ],
      activeShotId: "shot-b",
    }));
    const moved = moveStudioBg3dShot(original, "shot-c", 0);
    const removedInactive = removeStudioBg3dShot(moved, "shot-a");
    const removedActive = removeStudioBg3dShot(removedInactive, "shot-b");

    expect(moved?.shots?.map((shot) => shot.id)).toEqual(["shot-c", "shot-a", "shot-b"]);
    expect(moved?.shots?.[0]).toEqual(original.shots?.[2]);
    expect(moved?.nodes).toEqual(original.nodes);
    expect(moved?.activeShotId).toBe("shot-b");
    expect(removedInactive?.shots?.map((shot) => shot.id)).toEqual(["shot-c", "shot-b"]);
    expect(removedInactive?.activeShotId).toBe("shot-b");
    expect(removedActive?.shots?.map((shot) => shot.id)).toEqual(["shot-c"]);
    expect(removedActive).not.toHaveProperty("activeShotId");
    expect(original.shots?.map((shot) => shot.id)).toEqual(["shot-a", "shot-b", "shot-c"]);
    expect(moveStudioBg3dShot(original, "missing", 0)).toBeNull();
    expect(moveStudioBg3dShot(original, "shot-a", -1)).toBeNull();
    expect(moveStudioBg3dShot(original, "shot-a", 3)).toBeNull();
    expect(removeStudioBg3dShot(original, "missing")).toBeNull();
  });

  it("fails closed for 65 shots and rejects duplicate visibility rewrites strictly", () => {
    const tooManyShots = currentDocument({
      shots: Array.from(
        { length: STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS + 1 },
        (_, index) => ({ id: `shot-${index}`, name: `컷 ${index}` }),
      ),
    });
    const nodes = Array.from(
      { length: STUDIO_BG3D_SHOT_MAX_NODE_VISIBILITY_OVERRIDES },
      (_, index) => primitiveNode(index + 1),
    );
    const tooManyVisibilityOverrides = currentDocument({
      budgets: {
        ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets,
        complexity: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.budgets.complexity,
          maxNodes: STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
        },
      },
      nodes,
      shots: [{
        id: "shot-crowded",
        name: "전체 배치",
        nodeVisibility: [
          ...nodes.map((node) => ({ nodeId: node.id, visible: false })),
          { nodeId: nodes[0].id, visible: true },
        ],
      }],
    });

    expectSceneBudgetError(
      () => normalizeStudioBg3dSceneDocument(tooManyShots),
      "shot-count-budget-exceeded",
    );
    const boundedShots = normalizeStudioBg3dSceneDocument(currentDocument({
      shots: Array.from(
        { length: STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS },
        (_, index) => ({ id: `shot-${index}`, name: `컷 ${index}` }),
      ),
    }));
    expect(captureStudioBg3dShot(boundedShots, {
      id: "shot-over-cap",
      name: "초과 컷",
    })).toBeNull();
    expect(duplicateStudioBg3dShot(
      boundedShots,
      "shot-0",
      { id: "shot-over-cap", name: "초과 복제" },
    )).toBeNull();
    expect(parseStudioBg3dSceneDocument(JSON.stringify(tooManyShots))).toBeNull();
    expect(
      normalizeStudioBg3dSceneDocument(tooManyVisibilityOverrides).shots?.[0].nodeVisibility,
    ).toHaveLength(STUDIO_BG3D_SHOT_MAX_NODE_VISIBILITY_OVERRIDES);
    expect(
      parseStudioBg3dSceneDocument(JSON.stringify(tooManyVisibilityOverrides)),
    ).toBeNull();
  });

  it("drops dangling and duplicate references leniently and rejects them strictly", () => {
    const hostile = currentDocument({
      nodes: [primitiveNode(1)],
      shots: [
        {
          id: "shot-a",
          name: "정상 컷",
          nodeVisibility: [
            { nodeId: "missing-node", visible: false },
            { nodeId: "node-1", visible: false },
            { nodeId: "node-1", visible: true },
          ],
        },
        { id: "shot-a", name: "중복 컷" },
      ],
      activeShotId: "missing-shot",
    });
    const normalized = normalizeStudioBg3dSceneDocument(hostile);

    expect(normalized.shots).toEqual([{
      id: "shot-a",
      name: "정상 컷",
      nodeVisibility: [{ nodeId: "node-1", visible: false }],
    }]);
    expect(normalized).not.toHaveProperty("activeShotId");
    expect(parseStudioBg3dSceneDocument(JSON.stringify(hostile))).toBeNull();
    expect(serializeStudioBg3dSceneDocument(hostile)).toBeNull();
  });

  it("rejects overlong ids and names at the boundary while accepting exact limits", () => {
    const bounded = currentDocument({
      shots: [{
        id: "s".repeat(STUDIO_BG3D_SHOT_ID_MAX_LENGTH),
        name: "가".repeat(STUDIO_BG3D_SHOT_NAME_MAX_LENGTH),
      }],
    });
    const overlong = currentDocument({
      shots: [
        { id: `s${"x".repeat(STUDIO_BG3D_SHOT_ID_MAX_LENGTH)}`, name: "긴 ID" },
        { id: "shot-name", name: "가".repeat(STUDIO_BG3D_SHOT_NAME_MAX_LENGTH + 1) },
      ],
    });

    expect(serializeStudioBg3dSceneDocument(bounded)).not.toBeNull();
    expect(normalizeStudioBg3dSceneDocument(overlong).shots).toEqual([]);
    expect(parseStudioBg3dSceneDocument(JSON.stringify(overlong))).toBeNull();
  });

  it("never persists geometry, bytes, data/object URLs, or unknown shot fields", () => {
    const hostile = currentDocument({
      shots: [{
        id: "shot-hostile",
        name: "안전 컷",
        camera: { fovDegrees: 40, runtimeCamera: { engine: "three" } },
        geometry: { positions: [0, 1, 2] },
        modelBytes: [103, 108, 84, 70],
        previewUrl: "data:image/png;base64,AAAA",
        runtimeUrl: "blob:https://editor.invalid/runtime",
      }],
    });
    const normalized = normalizeStudioBg3dSceneDocument(hostile);
    const normalizedJson = JSON.stringify(normalized);

    expect(normalized.shots).toEqual([{
      id: "shot-hostile",
      name: "안전 컷",
      camera: { fovDegrees: 40 },
    }]);
    expect(normalizedJson).not.toContain("positions");
    expect(normalizedJson).not.toContain("modelBytes");
    expect(normalizedJson).not.toContain("data:image");
    expect(normalizedJson).not.toContain("blob:");
    expect(parseStudioBg3dSceneDocument(JSON.stringify(hostile))).toBeNull();
  });

  it("fails closed for malicious shot JSON that exceeds the document metadata budget", () => {
    const oversized = JSON.stringify(currentDocument({
      shots: [{
        id: "shot-oversized",
        name: "초과 컷",
        unknownPadding: "가".repeat(STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES),
      }],
    }));

    expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(
      STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES,
    );
    expect(parseStudioBg3dSceneDocument(oversized)).toBeNull();
    expectSceneBudgetError(
      () => normalizeStudioBg3dSceneDocument(oversized),
      "input-byte-budget-exceeded",
    );
  });
});

describe("Studio BG3D scene migration and serialization", () => {
  it("migrates the actual legacy primitive hash payload into engine-neutral nodes", () => {
    const legacy = {
      tool: "bg3d",
      primitives: [
        {
          id: "legacy-box",
          kind: "box",
          position: [1, 0.5, 2],
          rotation: [0, Math.PI / 2, 0],
          scale: [2, 1, 3],
          color: "#123456",
        },
      ],
      customModels: [],
      skyPresetId: "sunset",
      transparentInsert: true,
    };
    const migrated = migrateStudioBg3dSceneDocument(legacy);

    expect(migrated).not.toBeNull();
    expect(migrated?.background.skyPresetId).toBe("sunset");
    expect(migrated?.output.transparentBackground).toBe(true);
    expect(migrated?.nodes).toEqual([
      expect.objectContaining({
        id: "legacy-box",
        name: "box",
        kind: "primitive",
        primitiveKind: "box",
        color: "#123456",
        transform: {
          position: [1, 0.5, 2],
          rotation: [0, Math.PI / 2, 0],
          scale: [2, 1, 3],
        },
      }),
    ]);
  });

  it("requires an explicit storage-key-to-logical-id mapping for legacy custom models", () => {
    const legacyStorageKey = "indexeddb-bg3d-model-key";
    const customModel = {
      id: "legacy-model-node",
      modelId: legacyStorageKey,
      position: [1, 0, 2],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const payload = {
      tool: "bg3d",
      primitives: [],
      customModels: [customModel],
      attachments: [attachment(1)],
    };
    const withoutMapping = migrateStudioBg3dSceneDocument(payload);
    const identityMapping = migrateStudioBg3dSceneDocument(payload, {
      attachmentIdByLegacyStorageKey: new Map([[legacyStorageKey, legacyStorageKey]]),
    });
    const withoutAttachment = migrateStudioBg3dSceneDocument(
      { ...payload, attachments: [] },
      { attachmentIdByLegacyStorageKey: new Map([[legacyStorageKey, "model-1"]]) }
    );
    const withMapping = migrateStudioBg3dSceneDocument(payload, {
      attachmentIdByLegacyStorageKey: new Map([[legacyStorageKey, "model-1"]]),
    });

    expect(withoutMapping?.nodes).toEqual([]);
    expect(identityMapping?.nodes).toEqual([]);
    expect(withoutAttachment?.nodes).toEqual([]);
    expect(withMapping?.nodes).toEqual([
      expect.objectContaining({
        id: "legacy-model-node",
        kind: "model",
        attachmentId: "model-1",
      }),
    ]);
    expect(JSON.stringify(withMapping)).not.toContain(legacyStorageKey);
  });

  it("keeps current parsing strict while migration accepts legacy documents", () => {
    const legacyJson = JSON.stringify({ tool: "bg3d", primitives: [] });

    expect(parseStudioBg3dSceneDocument(legacyJson)).toBeNull();
    expect(migrateStudioBg3dSceneDocument(legacyJson)?.kind).toBe(
      STUDIO_BG3D_SCENE_DOCUMENT_KIND
    );
    expect(migrateStudioBg3dSceneDocument({ tool: "vrm-poser", primitives: [] })).toBeNull();
  });

  it("explicitly migrates the historical schema-v1 panorama URL without losing edit data", () => {
    const original = schemaV1Document({
        camera: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.camera,
          position: [7, 5, 9],
        },
        background: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
          skyPresetId: "sunset",
          panoramaRotation: 72,
          panoramaUrl: "https://private.invalid/legacy-sky.webp?access_token=secret",
        },
        nodes: [primitiveNode(1)],
      });

    expect(parseStudioBg3dSceneDocument(JSON.stringify(original))).toBeNull();
    expect(serializeStudioBg3dSceneDocument(original)).toBeNull();

    const migrated = migrateStudioBg3dSceneDocument(original);
    expect(migrated).not.toBeNull();
    expect(migrated?.camera.position).toEqual([7, 5, 9]);
    expect(migrated?.background).toMatchObject({
      skyPresetId: "sunset",
      panoramaRotation: 72,
    });
    expect(migrated?.nodes).toHaveLength(1);
    const serialized = serializeStudioBg3dSceneDocument(migrated);
    expect(serialized).not.toBeNull();
    expect(serialized).not.toContain("panoramaUrl");
    expect(serialized).not.toContain("private.invalid");
    expect(serialized).not.toContain("access_token");
  });

  it("rejects schema-v1 panorama migration when any unrelated lossy rewrite is required", () => {
    const historical = schemaV1Document({
        background: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
          panoramaUrl: "https://private.invalid/legacy-sky.webp",
        },
      });

    expect(
      migrateStudioBg3dSceneDocument({ ...historical, runtimeUrl: "blob:hostile" })
    ).toBeNull();
    expect(
      migrateStudioBg3dSceneDocument({
        ...historical,
        background: {
          ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
          panoramaUrl: 42,
        },
      })
    ).toBeNull();
  });

  it("never lets schema-marked payloads fall through to legacy migration", () => {
    const legacy = { tool: "bg3d", primitives: [] };

    expect(
      migrateStudioBg3dSceneDocument({
        ...legacy,
        kind: STUDIO_BG3D_SCENE_DOCUMENT_KIND,
        version: 999,
      })
    ).toBeNull();
    expect(migrateStudioBg3dSceneDocument({ ...legacy, version: 0 })).toBeNull();
    expect(
      migrateStudioBg3dSceneDocument({
        ...legacy,
        kind: STUDIO_BG3D_SCENE_DOCUMENT_KIND,
      })
    ).toBeNull();
    expect(migrateStudioBg3dSceneDocument({ ...legacy, kind: "legacy-ish" })).toBeNull();
    expect(migrateStudioBg3dSceneDocument({ ...legacy, version: undefined })).toBeNull();
    expect(serializeStudioBg3dSceneDocument(legacy)).toBeNull();
  });

  it("serializes canonical deterministic JSON and rejects invalid roots", () => {
    const document = normalizeStudioBg3dSceneDocument(
      currentDocument({
        attachments: [attachment(1)],
        nodes: [primitiveNode(1)],
      })
    );
    const first = serializeStudioBg3dSceneDocument(document);
    const parsed = parseStudioBg3dSceneDocument(first ?? "");
    const second = serializeStudioBg3dSceneDocument(parsed);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect((first?.length ?? 0)).toBeLessThan(STUDIO_BG3D_SCENE_DOCUMENT_MAX_BYTES);
    expect(serializeStudioBg3dSceneDocument({ version: 999 })).toBeNull();
    expect(serializeStudioBg3dSceneDocument("{bad json")).toBeNull();
  });

  it("returns a canonical typed graph after JSON serialization", () => {
    const serialized = serializeStudioBg3dSceneDocument(
      currentDocument({ attachments: [attachment(1)], nodes: [primitiveNode(1)] })
    );
    const parsed = parseStudioBg3dSceneDocument(serialized ?? "");

    expect(parsed).not.toBeNull();
    expect(parsed?.attachments[0]).toMatchObject<Partial<StudioBg3dModelAttachment>>({
      mime: STUDIO_BG3D_GLB_MIME,
      source: "upload",
    });
    expect(parsed).toEqual(expect.objectContaining<Partial<StudioBg3dSceneDocument>>({
      kind: STUDIO_BG3D_SCENE_DOCUMENT_KIND,
      version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
    }));
  });

  it("round-trips sanitized generic3dWorkflow metadata on attachments", () => {
    const serialized = serializeStudioBg3dSceneDocument(
      currentDocument({
        attachments: [
          attachment(1, {
            generic3dWorkflow: {
              version: 1,
              classification: "character",
              sourceFormat: "obj-mtl",
            },
          }),
        ],
        nodes: [primitiveNode(1)],
      }),
    );
    const parsed = parseStudioBg3dSceneDocument(serialized ?? "");
    expect(parsed?.attachments[0]).toMatchObject({
      generic3dWorkflow: {
        version: 1,
        classification: "character",
        sourceFormat: "obj-mtl",
      },
    });

    // Invalid classification fails closed for the whole workflow block (lenient normalize drops it).
    const lenient = normalizeStudioBg3dSceneDocument(
      currentDocument({
        attachments: [
          attachment(1, {
            generic3dWorkflow: {
              version: 1,
              classification: "avatar",
            },
          }),
        ],
        nodes: [primitiveNode(1)],
      }),
    );
    expect(lenient.attachments[0]?.generic3dWorkflow).toBeUndefined();
  });
});
