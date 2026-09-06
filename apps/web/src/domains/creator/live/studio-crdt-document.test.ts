import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  normalizeStudioBrushDynamicsSettings,
} from "../brush/studio-brush-dynamics";
import {
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2,
  selectStudioDynamicBrushCausalStampGrid,
  studioDynamicBrushCausalStampGridRuleOf,
} from "../brush/studio-brush-render-budget";
import {
  STUDIO_BRUSH_CATALOG_ID_MAX_LENGTH,
  STUDIO_BRUSH_CATALOG_NAME_MAX_LENGTH,
} from "../studio-element-model";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";

import {
  STUDIO_CRDT_APPEND_MAX_SAMPLES,
  STUDIO_CRDT_DELETION_ACKS_ROOT,
  STUDIO_CRDT_DELETION_OPS_ROOT,
  STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
  STUDIO_CRDT_METADATA_MAX_BYTES,
  STUDIO_CRDT_ORIGIN_LOCAL,
  STUDIO_CRDT_ORIGIN_REMOTE,
  STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
  STUDIO_CRDT_SCENE_ELEMENT_MAX_BYTES,
  STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
  StudioCrdtDocument,
  type StudioCrdtChange,
  type StudioCrdtChangeSummary,
  type StudioCrdtDrawStrokePayload,
  type StudioCrdtJsonObject,
  type StudioCrdtPageInput,
  type StudioCrdtProjectedChange,
  type StudioCrdtSceneElementInput,
  type StudioCrdtStrokeInput,
} from "./studio-crdt-document";
import {
  STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_PROTOCOL_VERSION,
  STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
  STUDIO_CRDT_UPDATE_MAX_BYTES,
  encodeStudioCrdtStateVector,
  encodeStudioCrdtSyncChunks,
} from "./studio-crdt-protocol";

function payload(
  points: number[] = [10, 20],
  overrides: Partial<StudioCrdtDrawStrokePayload> = {}
): StudioCrdtDrawStrokePayload {
  const count = points.length / 2;
  return {
    version: 1,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    stroke: "#112233",
    strokeWidth: 8,
    points,
    pressures: Array.from({ length: count }, (_, index) => 0.4 + index * 0.1),
    ...overrides,
  };
}

function r8GrainSource() {
  return {
    kind: "r8-texture-v1" as const,
    asset: {
      assetId: "paper.canvas-fine.v1",
      encodedSha256: `sha256:${"a".repeat(64)}`,
      decodedSha256: `sha256:${"b".repeat(64)}`,
      byteLength: 2_048,
      mediaType: "image/png" as const,
      width: 32,
      height: 32,
      channel: "luminance" as const,
      encoding: "r8-unorm" as const,
    },
  };
}

function stroke(
  id: string,
  pageId: string,
  points: number[] = [10, 20]
): StudioCrdtStrokeInput {
  return {
    id,
    pageId,
    layerId: "page-root",
    payload: payload(points),
  };
}

function comparable(document: StudioCrdtDocument) {
  return document.getStrokes({ includeDeleted: true }).map((record) => ({
    id: record.id,
    pageId: record.pageId,
    layerId: record.layerId,
    status: record.status,
    deleted: record.deleted,
    payload: record.payload,
    orderIndex: record.orderIndex,
  }));
}

function textElement(
  id: string,
  overrides: Record<string, string | number | boolean | null> = {}
): StudioCrdtSceneElementInput {
  return {
    id,
    pageId: "page-a",
    layerId: "lettering",
    payload: {
      version: STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
      type: "text",
      props: {
        text: "기준 대사",
        x: 10,
        y: 20,
        width: 240,
        fontSize: 28,
        fill: "#111111",
        rotation: 0,
        ...overrides,
      },
    },
  };
}

function bubbleElement(
  id: string,
  overrides: Record<string, StudioCrdtSceneElementInput["payload"]["props"][string]> = {}
): StudioCrdtSceneElementInput {
  return {
    id,
    pageId: "page-a",
    layerId: "lettering",
    payload: {
      version: STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION,
      type: "bubble",
      props: {
        variant: "round",
        text: "대사를 입력",
        x: 120,
        y: 160,
        width: 280,
        height: 180,
        fill: "#ffffff",
        textFill: "#111111",
        rotation: 0,
        ...overrides,
      },
    },
  };
}

function page(id: string, overrides: Record<string, string | number | boolean | null | string[]> = {}): StudioCrdtPageInput {
  return {
    id,
    payload: {
      version: STUDIO_CRDT_PAGE_PAYLOAD_VERSION,
      props: {
        bg: "#ffffff",
        bgGrad: null,
        canvasH: 1600,
        ...overrides,
      },
    },
  };
}

function underlyingYDoc(document: StudioCrdtDocument): Y.Doc {
  return (document as unknown as { doc: Y.Doc }).doc;
}

function setYjsClientId(document: StudioCrdtDocument, clientId: number): void {
  (underlyingYDoc(document) as unknown as { clientID: number }).clientID = clientId;
}

describe("StudioCrdtDocument", () => {
  it("does not read detached Yjs stroke types before attaching them to the document", () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const document = new StudioCrdtDocument();

    document.beginStroke({
      ...stroke("attached-stream", "page-a", []),
      payload: payload([], {
        pressures: undefined,
        extensions: { pressureModel: "linear-residual-v2" },
      }),
    });
    document.appendStrokeSamples("attached-stream", {
      points: [0, 0, 4, 2, 8, 4],
      pressures: [0.25, 0.5, 0.75],
    });
    document.finalizeStroke("attached-stream");

    expect(warningSpy).not.toHaveBeenCalledWith(
      "Invalid access: Add Yjs type to a document before reading data."
    );
    warningSpy.mockRestore();
    document.destroy();
  });

  it("keeps shape and bubble create, duplicate, drag and undo-like reconciliation free of detached Yjs reads", () => {
    const prematureAccessWarning =
      "Invalid access: Add Yjs type to a document before reading data.";
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const document = new StudioCrdtDocument();
    const observedSceneFrontiers: string[][] = [];
    const unsubscribe = document.subscribeChanges((change) => {
      observedSceneFrontiers.push(change.sceneElements.map(({ id }) => id));
    });

    try {
      // Browser reproduction: an existing ink stroke, two Quick Shape draw elements, then a
      // bubble inserted and duplicated from the top toolbar.
      document.addStroke(stroke("ink", "page-a", [10, 10, 80, 45]));
      document.addStroke({
        ...stroke("quick-rect-1", "page-a", [100, 100, 260, 100, 260, 220, 100, 220]),
        payload: payload([100, 100, 260, 100, 260, 220, 100, 220], { kind: "shape" }),
      });
      document.addStroke({
        ...stroke("quick-rect-2", "page-a", [320, 140, 480, 140, 480, 280, 320, 280]),
        payload: payload([320, 140, 480, 140, 480, 280, 320, 280], { kind: "shape" }),
      });
      document.addSceneElement(bubbleElement("bubble-source"));
      document.addSceneElement(bubbleElement("bubble-copy", { x: 152, y: 192 }));

      // Tail-anchor drag and repeated body drags publish successive partial property patches.
      const straightTail = {
        tail: "left",
        tailDirection: "bottom",
        tailXRatio: 0.5,
        tailHeight: 72,
        tailBase: 32,
        tailBend: 0,
      } as const;
      const draggedTail = {
        tail: "left",
        tailDirection: "bottom",
        tailXRatio: 0.64,
        tailHeight: 98,
        tailBase: 36,
        tailBend: 18,
      } as const;
      document.patchSceneElement("bubble-copy", { set: draggedTail });
      document.patchSceneElement("bubble-copy", { set: { x: 188, y: 210 } });
      document.patchSceneElement("bubble-copy", { set: { x: 216, y: 232 } });
      document.patchSceneElement("bubble-copy", { set: { x: 246, y: 218 } });

      // History reconciliation applies earlier snapshots as ordinary field updates/tombstones.
      document.patchSceneElement("bubble-copy", { set: { x: 216, y: 232 } });
      document.patchSceneElement("bubble-copy", { set: { x: 188, y: 210 } });
      document.patchSceneElement("bubble-copy", { set: straightTail });
      expect(document.deleteSceneElement("bubble-copy")).toBe(true);
      expect(document.restoreSceneElement("bubble-copy")).toBe(true);
      document.moveElement("bubble-copy", "quick-rect-1");

      const warningArguments = warningSpy.mock.calls.flat().map(String);
      expect(warningArguments.some((argument) => argument.includes(prematureAccessWarning)))
        .toBe(false);
      expect(document.getSceneElement("bubble-copy")).toMatchObject({
        deleted: false,
        payload: {
          type: "bubble",
          props: {
            x: 188,
            y: 210,
            ...straightTail,
          },
        },
      });
      expect(observedSceneFrontiers.length).toBeGreaterThan(0);
    } finally {
      unsubscribe();
      document.destroy();
      warningSpy.mockRestore();
    }
  });

  it("uses full fallback pressure for sparse residual V2 payloads", () => {
    const document = new StudioCrdtDocument();
    const record = document.addStroke({
      ...stroke("residual-sparse", "page-a"),
      payload: payload([0, 0, 4, 0, 8, 0], {
        pressures: undefined,
        extensions: { pressureModel: "linear-residual-v2" },
      }),
    });

    expect(record.payload.pressures).toEqual([1, 1, 1]);
    document.destroy();
  });

  it("uses the stored pressure model when streamed samples omit pressures", () => {
    const document = new StudioCrdtDocument();
    document.beginStroke({
      ...stroke("residual-stream", "page-a", []),
      payload: payload([], {
        pressures: undefined,
        extensions: { pressureModel: "linear-residual-v2" },
      }),
    });
    document.appendStrokeSamples("residual-stream", { points: [0, 0, 4, 0, 8, 0] });

    document.beginStroke({
      ...stroke("legacy-stream", "page-a", []),
      payload: payload([], { pressures: undefined }),
    });
    document.appendStrokeSamples("legacy-stream", { points: [0, 0, 4, 0, 8, 0] });

    expect(document.finalizeStroke("residual-stream").payload.pressures).toEqual([1, 1, 1]);
    expect(document.finalizeStroke("legacy-stream").payload.pressures).toEqual([0.5, 0.5, 0.5]);
    document.destroy();
  });

  it("streams V3 stationary pressure state without dropping or upgrading samples", () => {
    const document = new StudioCrdtDocument();
    document.beginStroke({
      ...stroke("residual-path-v3-stream", "page-a", []),
      payload: payload([], {
        pressures: undefined,
        sampleSpacing: 0,
        extensions: { pressureModel: "linear-residual-path-v3" },
      }),
    });
    document.appendStrokeSamples("residual-path-v3-stream", {
      points: [0, 0, 9, 0],
      pressures: [1, 1],
    });
    document.appendStrokeSamples("residual-path-v3-stream", {
      points: [9, 0, 10, 0],
      pressures: [0, 0],
    });
    const finalized = document.finalizeStroke("residual-path-v3-stream");

    expect(finalized.payload.points).toEqual([0, 0, 9, 0, 9, 0, 10, 0]);
    expect(finalized.payload.pressures).toEqual([1, 1, 0, 0]);
    expect(finalized.payload.sampleSpacing).toBe(0);
    expect(finalized.payload.extensions?.pressureModel).toBe("linear-residual-path-v3");
    document.destroy();
  });

  it("preserves zero sample spacing for fixed-rate causal ink", () => {
    const document = new StudioCrdtDocument();

    const record = document.addStroke({
      ...stroke("fixed-rate", "page-a"),
      payload: payload([10, 20, 11, 21], { sampleSpacing: 0 }),
    });

    expect(record.payload.sampleSpacing).toBe(0);
    expect(document.getStroke("fixed-rate")?.payload.sampleSpacing).toBe(0);
    document.destroy();
  });

  it("reads v1/v2/v3 strokes and accepts compatible layered-flow paint through v4", () => {
    const document = new StudioCrdtDocument();
    expect(document.addStroke(stroke("legacy-stroke", "page-a")).payload.version).toBe(1);
    const layered = payload([10, 20, 14, 20], {
      version: STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
      opacity: 0.6,
      brush: "marker",
      sampleSpacing: 0,
      extensions: { paintModel: "layered-flow-v1" },
    });
    expect(document.addStroke({
      ...stroke("layered-stroke", "page-a"),
      payload: layered,
    }).payload.extensions?.paintModel).toBe("layered-flow-v1");
    expect(document.addStroke({
      ...stroke("layered-stroke-v3-reader", "page-a"),
      payload: {
        ...layered,
        version: STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
      },
    }).payload.extensions?.paintModel).toBe("layered-flow-v1");
    expect(document.addStroke({
      ...stroke("layered-stroke-v4-reader", "page-a"),
      payload: {
        ...layered,
        version: STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
      },
    }).payload.extensions?.paintModel).toBe("layered-flow-v1");

    const invalidPayloads: StudioCrdtDrawStrokePayload[] = [
      { ...layered, version: 1 as const },
      { ...layered, mode: "eraser" as const },
      { ...layered, sampleSpacing: undefined },
      { ...layered, brush: "watercolor" },
      { ...layered, symmetry: { type: "vertical" } },
      { ...layered, extensions: {
        paintModel: "layered-flow-v1",
        stampPipeline: "causal-walker-v2",
      } },
    ];
    for (const [index, invalid] of invalidPayloads.entries()) {
      expect(() => document.addStroke({
        ...stroke(`invalid-${index}`, "page-a"),
        payload: invalid,
      })).toThrow("페인트 모델과 브러시 합성 모드가 호환되지 않습니다");
    }
    document.destroy();
  });

  it("requires v3 and a complete known snapshot for renderer-significant material pressure", () => {
    const document = new StudioCrdtDocument();
    const versioned = payload([10, 20, 14, 24], {
      version: STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
      brush: "pencil-2b",
      extensions: {
        materialPressureModel:
          STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        materialMinimumDiameterRatio: 0.72,
      },
    });

    expect(document.addStroke({
      ...stroke("material-pressure-v3", "page-a"),
      payload: versioned,
    }).payload).toMatchObject({
      version: STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
      extensions: {
        materialPressureModel:
          STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        materialMinimumDiameterRatio: 0.72,
      },
    });
    for (const legacyVersion of [
      1,
      STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
    ] as const) {
      expect(() => document.addStroke({
        ...stroke(`forged-material-pressure-v${legacyVersion}`, "page-a"),
        payload: { ...versioned, version: legacyVersion },
      })).toThrow("재질 필압 모델과 페이로드 버전이 호환되지 않습니다");
    }
    expect(() => document.addStroke({
      ...stroke("unknown-material-pressure-v3", "page-a"),
      payload: {
        ...versioned,
        extensions: {
          materialPressureModel: "canonical-material-v99",
          materialMinimumDiameterRatio: 0.72,
        },
      },
    })).toThrow("재질 필압 모델이 올바르지 않습니다");
    expect(() => document.addStroke({
      ...stroke("model-without-minimum", "page-a"),
      payload: {
        ...versioned,
        extensions: {
          materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        },
      },
    })).toThrow("재질 최소 굵기 스냅샷이 올바르지 않습니다");
    expect(() => document.addStroke({
      ...stroke("minimum-without-model", "page-a"),
      payload: {
        ...versioned,
        extensions: { materialMinimumDiameterRatio: 0.4 },
      },
    })).toThrow("재질 필압 모델이 올바르지 않습니다");
    for (const [id, extensions] of [
      ["minimum-negative", {
        materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        materialMinimumDiameterRatio: -0.01,
      }],
      ["minimum-overflow", {
        materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        materialMinimumDiameterRatio: 1.01,
      }],
      ["minimum-string", {
        materialPressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        materialMinimumDiameterRatio: "0.5",
      }],
    ] as const) {
      expect(() => document.addStroke({
        ...stroke(id, "page-a"),
        payload: {
          ...versioned,
          extensions,
        },
      })).toThrow("재질 최소 굵기 스냅샷이 올바르지 않습니다");
    }
    document.destroy();
  });

  it("requires v3 and a bounded value for dynamic-brush minimum diameter", () => {
    const document = new StudioCrdtDocument();
    const versioned = payload([10, 20, 14, 24], {
      version: STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
      brush: "dry-media",
      brushDynamics: { minimumDiameterRatio: 0.64 },
    });

    expect(document.addStroke({
      ...stroke("dynamic-minimum-v3", "page-a"),
      payload: versioned,
    }).payload.brushDynamics).toMatchObject({ minimumDiameterRatio: 0.64 });
    for (const legacyVersion of [
      1,
      STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
    ] as const) {
      expect(() => document.addStroke({
        ...stroke(`forged-dynamic-minimum-v${legacyVersion}`, "page-a"),
        payload: { ...versioned, version: legacyVersion },
      })).toThrow("동적 브러시 최소 굵기 스냅샷이 올바르지 않습니다");
    }
    for (const [id, minimumDiameterRatio] of [
      ["dynamic-minimum-negative", -0.01],
      ["dynamic-minimum-overflow", 1.01],
      ["dynamic-minimum-string", "0.5"],
    ] as const) {
      expect(() => document.addStroke({
        ...stroke(id, "page-a"),
        payload: {
          ...versioned,
          brushDynamics: { minimumDiameterRatio },
        },
      })).toThrow("동적 브러시 최소 굵기 스냅샷이 올바르지 않습니다");
    }
    document.destroy();
  });

  it("admits segmented causal deposits only in stroke payload v4", () => {
    const document = new StudioCrdtDocument();
    const versioned = payload([10, 20, 14, 24], {
      version: STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
      brush: "dry-media",
      sampleSpacing: 0,
      brushDynamics: {
        depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      },
      extensions: { paintModel: "bounded-flow-v2" },
    });

    expect(document.addStroke({
      ...stroke("segmented-causal-v4", "page-a"),
      payload: versioned,
    }).payload.version).toBe(STUDIO_CRDT_STROKE_PAYLOAD_VERSION);

    for (const legacyVersion of [
      1,
      STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
      STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
    ] as const) {
      expect(() => document.addStroke({
        ...stroke(`forged-segmented-causal-v${legacyVersion}`, "page-a"),
        payload: { ...versioned, version: legacyVersion },
      })).toThrow("분할 연속 브러시 파이프라인과 페이로드 버전이 호환되지 않습니다");
    }
    document.destroy();
  });

  it("replays a collaborator's pinned rule-v2 causal stroke to the same width-adaptive grid", () => {
    const document = new StudioCrdtDocument();
    const created = document.addStroke({
      ...stroke("causal-stamp-grid-rule-v2", "page-a"),
      payload: payload([10, 20, 200, 20], {
        version: STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
        brush: "charcoal",
        strokeWidth: 96,
        brushDynamics: {
          depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
          causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2,
          tip: { shape: "bristle", softness: 0.58 },
          width: { base: 96 },
        },
      }),
    });

    const collaborator = new StudioCrdtDocument(document.encodeStateAsUpdate());
    const replayed = collaborator.getStroke(created.id);
    expect(replayed?.payload.brushDynamics).toMatchObject({
      causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2,
    });

    // The collaborator's normalization keeps the pin, so its planner resolves the identical
    // width-adaptive lattice the author pinned at stroke start.
    const dynamics = normalizeStudioBrushDynamicsSettings(replayed?.payload.brushDynamics);
    expect(studioDynamicBrushCausalStampGridRuleOf(dynamics))
      .toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2);
    expect(selectStudioDynamicBrushCausalStampGrid({
      rule: studioDynamicBrushCausalStampGridRuleOf(dynamics),
      baseWidth: dynamics.width.base,
    })).toBe(7);

    // A replayed legacy causal stroke without the pin keeps the bounded three-sample lattice.
    const legacy = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      width: { base: 96 },
    });
    expect(studioDynamicBrushCausalStampGridRuleOf(legacy)).toBeUndefined();
    expect(selectStudioDynamicBrushCausalStampGrid({
      rule: studioDynamicBrushCausalStampGridRuleOf(legacy),
      baseWidth: legacy.width.base,
    })).toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    collaborator.destroy();
    document.destroy();
  });

  it("admits only canonical R8 grain references in stroke payload v4", () => {
    const document = new StudioCrdtDocument();
    const versioned = payload([10, 20, 14, 24], {
      version: STUDIO_CRDT_STROKE_PAYLOAD_VERSION,
      brush: "dry-media",
      brushDynamics: {
        grain: { source: r8GrainSource() },
      },
    });

    expect(document.addStroke({
      ...stroke("r8-grain-v4", "page-a"),
      payload: versioned,
    }).payload.brushDynamics).toMatchObject({
      grain: { source: r8GrainSource() },
    });
    for (const legacyVersion of [
      1,
      STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION,
      STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION,
    ] as const) {
      expect(() => document.addStroke({
        ...stroke(`forged-r8-grain-v${legacyVersion}`, "page-a"),
        payload: { ...versioned, version: legacyVersion },
      })).toThrow("R8 브러시 그레인과 페이로드 버전이 호환되지 않습니다");
    }
    expect(() => document.addStroke({
      ...stroke("malformed-r8-grain-v4", "page-a"),
      payload: {
        ...versioned,
        brushDynamics: {
          grain: {
            source: {
              ...r8GrainSource(),
              asset: { ...r8GrainSource().asset, decodedSha256: "sha256:bad" },
            },
          },
        },
      },
    })).toThrow("R8 브러시 그레인 자산 참조가 올바르지 않습니다");
    for (const invalidSource of [
      { kind: "r8-texture-v2", asset: r8GrainSource().asset },
      "r8-texture-v1",
    ]) {
      expect(() => document.addStroke({
        ...stroke(`invalid-r8-source-${typeof invalidSource}`, "page-a"),
        payload: {
          ...versioned,
          brushDynamics: {
            grain: { source: invalidSource },
          },
        },
      })).toThrow("R8 브러시 그레인 자산 참조가 올바르지 않습니다");
    }
    let sourceAccessorReads = 0;
    const accessorGrain: Record<string, unknown> = {};
    Object.defineProperty(accessorGrain, "source", {
      enumerable: true,
      get() {
        sourceAccessorReads += 1;
        return r8GrainSource();
      },
    });
    expect(() => document.addStroke({
      ...stroke("accessor-r8-grain-v4", "page-a"),
      payload: {
        ...versioned,
        brushDynamics: { grain: accessorGrain } as StudioCrdtJsonObject,
      },
    })).toThrow("R8 브러시 그레인 자산 참조가 올바르지 않습니다");
    expect(sourceAccessorReads).toBe(0);
    document.destroy();
  });

  it("round-trips and patches bounded catalog identity while rejecting non-canonical metadata", () => {
    const document = new StudioCrdtDocument();
    const created = document.addStroke({
      ...stroke("catalog-identity", "page-a"),
      payload: payload([10, 20, 20, 30], {
        brush: "ink-particle",
        brushCatalogId: "pro67:heart-stamp",
        brushCatalogName: "하트 스탬프",
      }),
    });
    expect(created.payload).toMatchObject({
      brush: "ink-particle",
      brushCatalogId: "pro67:heart-stamp",
      brushCatalogName: "하트 스탬프",
    });

    const patchedPayload = {
      ...created.payload,
      brushCatalogName: "하트 스탬프 · 굵게",
    };
    document.patchStroke(created.id, {
      payload: patchedPayload,
      changedPayloadKeys: ["brushCatalogName"],
    });
    const hydrated = new StudioCrdtDocument(document.encodeStateAsUpdate());
    expect(hydrated.getStroke(created.id)?.payload).toMatchObject({
      brush: "ink-particle",
      brushCatalogId: "pro67:heart-stamp",
      brushCatalogName: "하트 스탬프 · 굵게",
    });

    const invalidMetadata: Array<Partial<StudioCrdtDrawStrokePayload>> = [
      { brushCatalogId: ` ${"a".repeat(20)}` },
      { brushCatalogId: "pro67:\u0000heart" },
      { brushCatalogId: "a".repeat(STUDIO_BRUSH_CATALOG_ID_MAX_LENGTH + 1) },
      { brushCatalogName: "붓".repeat(STUDIO_BRUSH_CATALOG_NAME_MAX_LENGTH + 1) },
    ];
    for (const [index, metadata] of invalidMetadata.entries()) {
      expect(() => document.addStroke({
        ...stroke(`invalid-catalog-${index}`, "page-a"),
        payload: payload([0, 0], metadata),
      })).toThrow();
      expect(document.getStroke(`invalid-catalog-${index}`)).toBeNull();
    }

    hydrated.destroy();
    document.destroy();
  });

  it("streams aligned pointer samples and finalizes one immutable drawing operation", () => {
    const document = new StudioCrdtDocument();

    expect(document.beginStroke(stroke("stroke-a", "page-a")).status).toBe("drawing");
    expect(document.appendStrokeSamples("stroke-a", {
      points: [15, 25, 20, 30],
      pressures: [0.6, 0.8],
      tiltXs: [10, 12],
      tiltYs: [-4, -3],
      twists: [20, 25],
      speeds: [1.2, 1.5],
      tangentialPressures: [0.1, 0.2],
    })).toBe(3);
    const finished = document.finalizeStroke("stroke-a");

    expect(finished.status).toBe("finalized");
    expect(finished.payload.points).toEqual([10, 20, 15, 25, 20, 30]);
    expect(finished.payload.pressures).toEqual([0.4, 0.6, 0.8]);
    expect(finished.payload.tiltXs).toEqual([0, 10, 12]);
    expect(finished.payload.tangentialPressures).toEqual([0, 0.1, 0.2]);
    expect(() => document.appendStrokeSamples("stroke-a", { points: [30, 40] }))
      .toThrow("완료된 획");

    document.destroy();
  });

  it("splits the 4096-sample append boundary into publishable local Yjs updates", () => {
    const document = new StudioCrdtDocument();
    const updates: Uint8Array[] = [];
    document.subscribe((update, origin) => {
      if (origin === STUDIO_CRDT_ORIGIN_LOCAL) updates.push(update);
    });
    document.beginStroke({
      ...stroke("max-append", "page-a"),
      payload: payload([], { pressures: [] }),
    });
    updates.length = 0;
    const count = STUDIO_CRDT_APPEND_MAX_SAMPLES;
    const values = Array.from({ length: count }, (_, index) => index / 10);

    expect(document.appendStrokeSamples("max-append", {
      points: values.flatMap((value) => [value, value + 1]),
      pressures: Array<number>(count).fill(0.65),
      tiltXs: Array<number>(count).fill(12),
      tiltYs: Array<number>(count).fill(-8),
      twists: Array<number>(count).fill(45),
      speeds: Array<number>(count).fill(2.5),
      tangentialPressures: Array<number>(count).fill(0.2),
    })).toBe(count);

    expect(updates.length).toBeGreaterThan(1);
    expect(Math.max(...updates.map((update) => update.byteLength)))
      .toBeLessThanOrEqual(STUDIO_CRDT_UPDATE_MAX_BYTES);
    expect(document.getStroke("max-append")?.payload.points).toHaveLength(count * 2);
    document.destroy();
  });

  it("converges concurrent strokes and deterministic compositing order regardless of delivery order", () => {
    const left = new StudioCrdtDocument();
    const right = new StudioCrdtDocument();
    left.addStroke(stroke("left-stroke", "page-a", [0, 0, 10, 10]));
    right.addStroke(stroke("right-stroke", "page-a", [20, 20, 30, 30]));

    const leftUpdate = left.encodeStateAsUpdate();
    const rightUpdate = right.encodeStateAsUpdate();
    right.applyUpdate(leftUpdate);
    left.applyUpdate(rightUpdate);

    expect(comparable(left)).toEqual(comparable(right));
    expect(comparable(left).map((record) => record.id).sort()).toEqual([
      "left-stroke",
      "right-stroke",
    ]);

    left.destroy();
    right.destroy();
  });

  it("uses page-global CRDT order instead of grouping compositing by layerId", () => {
    const document = new StudioCrdtDocument();
    document.addStroke({ ...stroke("back", "page-a"), layerId: "z-background" });
    document.addStroke({ ...stroke("front", "page-a"), layerId: "a-foreground" });

    expect(document.getStrokes({ pageId: "page-a" }).map(({ id }) => id)).toEqual([
      "back",
      "front",
    ]);
    document.moveStroke("front", "back");
    expect(document.getStrokes({ pageId: "page-a" }).map(({ id }) => id)).toEqual([
      "front",
      "back",
    ]);
    document.destroy();
  });

  it("converges a concurrent delete and edit and retains a tombstone for late peers", () => {
    const left = new StudioCrdtDocument();
    left.addStroke(stroke("shared-stroke", "page-a", [0, 0, 10, 10]));
    const right = new StudioCrdtDocument(left.encodeStateAsUpdate());

    expect(left.deleteStroke("shared-stroke")).toBe(true);
    right.upsertStroke(
      stroke("shared-stroke", "page-a", [0, 0, 30, 30]),
      { status: "finalized" }
    );

    const leftState = left.encodeStateAsUpdate();
    const rightState = right.encodeStateAsUpdate();
    left.applyUpdate(rightState);
    right.applyUpdate(leftState);

    expect(comparable(left)).toEqual(comparable(right));
    left.deleteStroke("shared-stroke");
    right.applyUpdate(left.encodeStateAsUpdate(right.encodeStateVector()));
    expect(left.getStrokes()).toEqual([]);
    expect(right.getStrokes()).toEqual([]);
    expect(left.getStroke("shared-stroke", true)?.deleted).toBe(true);

    left.destroy();
    right.destroy();
  });

  it.each([
    { deleteClientId: 10, editClientId: 20 },
    { deleteClientId: 20, editClientId: 10 },
  ])(
    "keeps an initial-registration delete when the deleting clientID is $deleteClientId and the editing clientID is $editClientId",
    ({ deleteClientId, editClientId }) => {
      const baseline = textElement("initial-delete");
      const deletingPeer = new StudioCrdtDocument();
      const editingPeer = new StudioCrdtDocument();
      setYjsClientId(deletingPeer, deleteClientId);
      setYjsClientId(editingPeer, editClientId);

      deletingPeer.upsertSceneElement(baseline, {
        baselineProps: baseline.payload.props,
        changedProps: [],
      });
      expect(deletingPeer.deleteSceneElement("initial-delete")).toBe(true);
      editingPeer.upsertSceneElement(textElement("initial-delete", { x: 640 }), {
        baselineProps: baseline.payload.props,
        changedProps: ["x"],
      });

      const deletionUpdate = deletingPeer.encodeStateAsUpdate();
      const editUpdate = editingPeer.encodeStateAsUpdate();
      deletingPeer.applyUpdate(editUpdate);
      editingPeer.applyUpdate(deletionUpdate);

      expect(deletingPeer.getSceneElement("initial-delete")).toBeNull();
      expect(editingPeer.getSceneElement("initial-delete")).toBeNull();
      expect(deletingPeer.getSceneElement("initial-delete", true)?.payload.props.x).toBe(640);
      expect(editingPeer.getSceneElement("initial-delete", true)?.deleted).toBe(true);
      deletingPeer.destroy();
      editingPeer.destroy();
    }
  );

  it("acknowledges only observed deletes so stale restore cannot erase a concurrent delete", () => {
    const source = new StudioCrdtDocument();
    source.addSceneElement(textElement("observed-remove"));
    const baseline = source.encodeStateAsUpdate();
    const firstDeleter = new StudioCrdtDocument(baseline);
    const restorer = new StudioCrdtDocument(baseline);
    const staleDeleter = new StudioCrdtDocument(baseline);
    const staleRestorer = new StudioCrdtDocument(baseline);

    expect(firstDeleter.deleteSceneElement("observed-remove")).toBe(true);
    expect(staleRestorer.restoreSceneElement("observed-remove")).toBe(false);
    staleRestorer.upsertSceneElement(textElement("observed-remove", { x: 777 }), {
      resurrect: true,
    });
    staleRestorer.applyUpdate(firstDeleter.encodeStateAsUpdate());
    expect(staleRestorer.getSceneElement("observed-remove")).toBeNull();
    expect(staleRestorer.getSceneElement("observed-remove", true)?.payload.props.x).toBe(777);

    restorer.applyUpdate(firstDeleter.encodeStateAsUpdate());
    expect(restorer.restoreSceneElement("observed-remove")).toBe(true);
    expect(staleDeleter.deleteSceneElement("observed-remove")).toBe(true);

    const restoredState = restorer.encodeStateAsUpdate();
    const concurrentDeleteState = staleDeleter.encodeStateAsUpdate();
    for (const peer of [firstDeleter, restorer, staleDeleter]) {
      peer.applyUpdate(restoredState);
      peer.applyUpdate(concurrentDeleteState);
      expect(peer.getSceneElement("observed-remove")).toBeNull();
    }

    expect(restorer.restoreSceneElement("observed-remove")).toBe(true);
    const finalRestore = restorer.encodeStateAsUpdate();
    firstDeleter.applyUpdate(finalRestore);
    staleDeleter.applyUpdate(finalRestore);
    expect(firstDeleter.getSceneElement("observed-remove")?.deleted).toBe(false);
    expect(staleDeleter.getSceneElement("observed-remove")?.deleted).toBe(false);

    source.destroy();
    firstDeleter.destroy();
    restorer.destroy();
    staleDeleter.destroy();
    staleRestorer.destroy();
  });

  it("uses the same flat grow-only deletion protocol for strokes, scenes, pages, and groups", () => {
    const document = new StudioCrdtDocument();
    document.addStroke(stroke("delete-stroke", "page-a"));
    document.addSceneElement(textElement("delete-scene"));
    document.addPage(page("delete-page"));
    document.addLayerGroup({
      id: "delete-group",
      pageId: "page-a",
      payload: {
        version: STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
        props: { name: "삭제 그룹" },
      },
    });

    const raw = underlyingYDoc(document);
    expect((raw.getMap("strokes").get("delete-stroke") as Y.Map<unknown>).has("deleted")).toBe(false);
    expect(raw.getMap("scene-element:delete-scene").has("deleted")).toBe(false);
    expect(raw.getMap("studio-page:delete-page").has("deleted")).toBe(false);
    const groupKey = `${"page-a".length}:page-a${"delete-group".length}:delete-group`;
    expect(raw.getMap(`layer-group:${encodeURIComponent(groupKey)}`).has("deleted")).toBe(false);
    expect(raw.getMap(STUDIO_CRDT_DELETION_OPS_ROOT).size).toBe(0);
    expect(raw.getMap(STUDIO_CRDT_DELETION_ACKS_ROOT).size).toBe(0);

    expect(document.deleteStroke("delete-stroke")).toBe(true);
    expect(document.deleteSceneElement("delete-scene")).toBe(true);
    expect(document.deletePage("delete-page")).toBe(true);
    expect(document.deleteLayerGroup("page-a", "delete-group")).toBe(true);
    expect(raw.getMap(STUDIO_CRDT_DELETION_OPS_ROOT).size).toBe(4);

    expect(document.restoreStroke("delete-stroke")).toBe(true);
    expect(document.restoreSceneElement("delete-scene")).toBe(true);
    expect(document.restorePage("delete-page")).toBe(true);
    expect(document.restoreLayerGroup("page-a", "delete-group")).toBe(true);
    expect(raw.getMap(STUDIO_CRDT_DELETION_ACKS_ROOT).size).toBe(4);
    expect(document.getStroke("delete-stroke")?.deleted).toBe(false);
    expect(document.getSceneElement("delete-scene")?.deleted).toBe(false);
    expect(document.getPage("delete-page")?.deleted).toBe(false);
    expect(document.getLayerGroup("page-a", "delete-group")?.deleted).toBe(false);
    document.destroy();
  });

  it.each(["stroke", "scene", "page", "group"] as const)(
    "keeps a concurrent initial %s delete over an independent first registration",
    (kind) => {
      const deletingPeer = new StudioCrdtDocument();
      const editingPeer = new StudioCrdtDocument();
      setYjsClientId(deletingPeer, 90);
      setYjsClientId(editingPeer, 5);
      if (kind === "stroke") {
        deletingPeer.addStroke(stroke("initial-shared", "page-a"));
        editingPeer.addStroke(stroke("initial-shared", "page-a", [40, 50]));
        deletingPeer.deleteStroke("initial-shared");
      } else if (kind === "scene") {
        deletingPeer.addSceneElement(textElement("initial-shared"));
        editingPeer.addSceneElement(textElement("initial-shared", { x: 500 }));
        deletingPeer.deleteSceneElement("initial-shared");
      } else if (kind === "page") {
        deletingPeer.addPage(page("initial-shared"));
        editingPeer.addPage(page("initial-shared", { name: "동시 편집" }));
        deletingPeer.deletePage("initial-shared");
      } else {
        const input = {
          id: "initial-shared",
          pageId: "page-a",
          payload: {
            version: STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
            props: { name: "초기 그룹" },
          },
        } as const;
        deletingPeer.addLayerGroup(input);
        editingPeer.addLayerGroup({
          ...input,
          payload: { ...input.payload, props: { name: "동시 편집 그룹" } },
        });
        deletingPeer.deleteLayerGroup("page-a", "initial-shared");
      }

      const deletionState = deletingPeer.encodeStateAsUpdate();
      const editingState = editingPeer.encodeStateAsUpdate();
      deletingPeer.applyUpdate(editingState);
      editingPeer.applyUpdate(deletionState);
      const deletingRecord = kind === "stroke"
        ? deletingPeer.getStroke("initial-shared", true)
        : kind === "scene"
          ? deletingPeer.getSceneElement("initial-shared", true)
          : kind === "page"
            ? deletingPeer.getPage("initial-shared", true)
            : deletingPeer.getLayerGroup("page-a", "initial-shared", true);
      const editingRecord = kind === "stroke"
        ? editingPeer.getStroke("initial-shared", true)
        : kind === "scene"
          ? editingPeer.getSceneElement("initial-shared", true)
          : kind === "page"
            ? editingPeer.getPage("initial-shared", true)
            : editingPeer.getLayerGroup("page-a", "initial-shared", true);
      expect(deletingRecord?.deleted).toBe(true);
      expect(editingRecord?.deleted).toBe(true);
      expect(underlyingYDoc(editingPeer).getMap(STUDIO_CRDT_DELETION_OPS_ROOT).size).toBe(1);
      deletingPeer.destroy();
      editingPeer.destroy();
    }
  );

  it("merges independent fields when two peers first register the same legacy scene element", () => {
    const baseline = textElement("legacy-text");
    const left = new StudioCrdtDocument();
    const right = new StudioCrdtDocument();
    left.upsertSceneElement(textElement("legacy-text", { text: "왼쪽이 고친 대사" }), {
      baselineProps: baseline.payload.props,
      changedProps: ["text"],
    });
    right.upsertSceneElement(textElement("legacy-text", { x: 480 }), {
      baselineProps: baseline.payload.props,
      changedProps: ["x"],
    });

    const leftUpdate = left.encodeStateAsUpdate();
    const rightUpdate = right.encodeStateAsUpdate();
    left.applyUpdate(rightUpdate);
    right.applyUpdate(leftUpdate);

    expect(left.getSceneElement("legacy-text")?.payload.props).toMatchObject({
      text: "왼쪽이 고친 대사",
      x: 480,
      y: 20,
      width: 240,
    });
    expect(right.getSceneElement("legacy-text")).toEqual(left.getSceneElement("legacy-text"));
    left.destroy();
    right.destroy();
  });

  it("merges a first-registration optional-property removal with another peer's field edit", () => {
    const baseline = textElement("legacy-unset", { font: "Pretendard" });
    const withoutFont = textElement("legacy-unset");
    const left = new StudioCrdtDocument();
    const right = new StudioCrdtDocument();
    left.upsertSceneElement(withoutFont, {
      baselineProps: baseline.payload.props,
      changedProps: [],
      unsetProps: ["font"],
    });
    right.upsertSceneElement(textElement("legacy-unset", { font: "Pretendard", x: 720 }), {
      baselineProps: baseline.payload.props,
      changedProps: ["x"],
    });

    const leftUpdate = left.encodeStateAsUpdate();
    const rightUpdate = right.encodeStateAsUpdate();
    left.applyUpdate(rightUpdate);
    right.applyUpdate(leftUpdate);

    expect(left.getSceneElement("legacy-unset")?.payload.props).toMatchObject({ x: 720 });
    expect(left.getSceneElement("legacy-unset")?.payload.props).not.toHaveProperty("font");
    expect(right.getSceneElement("legacy-unset")).toEqual(left.getSceneElement("legacy-unset"));
    left.destroy();
    right.destroy();
  });

  it("resolves a same-property conflict deterministically on every peer", () => {
    const left = new StudioCrdtDocument();
    left.addSceneElement(textElement("shared-text"));
    const right = new StudioCrdtDocument(left.encodeStateAsUpdate());
    left.patchSceneElement("shared-text", { set: { text: "왼쪽 버전" } });
    right.patchSceneElement("shared-text", { set: { text: "오른쪽 버전" } });

    const leftUpdate = left.encodeStateAsUpdate();
    const rightUpdate = right.encodeStateAsUpdate();
    left.applyUpdate(rightUpdate);
    right.applyUpdate(leftUpdate);

    const resolved = left.getSceneElement("shared-text")?.payload.props.text;
    expect(["왼쪽 버전", "오른쪽 버전"]).toContain(resolved);
    expect(right.getSceneElement("shared-text")).toEqual(left.getSceneElement("shared-text"));
    left.destroy();
    right.destroy();
  });

  it("keeps a scene tombstone across a concurrent edit and requires explicit resurrection", () => {
    const left = new StudioCrdtDocument();
    left.addSceneElement(textElement("deleted-text"));
    const right = new StudioCrdtDocument(left.encodeStateAsUpdate());
    left.deleteSceneElement("deleted-text");
    right.upsertSceneElement(textElement("deleted-text", { x: 900 }));

    const leftUpdate = left.encodeStateAsUpdate();
    const rightUpdate = right.encodeStateAsUpdate();
    left.applyUpdate(rightUpdate);
    right.applyUpdate(leftUpdate);

    expect(left.getSceneElement("deleted-text")).toBeNull();
    expect(right.getSceneElement("deleted-text")).toBeNull();
    expect(left.getSceneElement("deleted-text", true)?.payload.props.x).toBe(900);
    expect(() => left.upsertSceneElement(textElement("deleted-text"))).toThrow("명시적으로 복원");
    left.upsertSceneElement(textElement("deleted-text", { x: 900 }), { resurrect: true });
    right.applyUpdate(left.encodeStateAsUpdate(right.encodeStateVector()));
    expect(right.getSceneElement("deleted-text")?.payload.props.x).toBe(900);
    left.destroy();
    right.destroy();
  });

  it("rejects oversized or unsupported scene metadata before mutating the Yjs document", () => {
    const document = new StudioCrdtDocument();
    const updates: Uint8Array[] = [];
    document.subscribe((update, origin) => {
      if (origin === STUDIO_CRDT_ORIGIN_LOCAL) updates.push(update);
    });
    const hugeText = "가".repeat(STUDIO_CRDT_SCENE_ELEMENT_MAX_BYTES);
    expect(() => document.addSceneElement(textElement("too-large", { text: hugeText })))
      .toThrow("16KiB 한도");
    expect(() => document.addSceneElement({
      ...textElement("unsupported-field"),
      payload: {
        ...textElement("unsupported-field").payload,
        props: { ...textElement("unsupported-field").payload.props, src: "data:image/png;base64,AA==" },
      },
    })).toThrow("src 속성은 동기화할 수 없습니다");
    expect(updates).toHaveLength(0);
    expect(document.getSceneElements({ includeDeleted: true })).toEqual([]);
    document.destroy();
  });

  it("shares one mixed z-order between strokes and scene elements without exceeding the wire cap", () => {
    const document = new StudioCrdtDocument();
    const updates: Uint8Array[] = [];
    document.subscribe((update, origin) => {
      if (origin === STUDIO_CRDT_ORIGIN_LOCAL) updates.push(update);
    });
    document.addStroke(stroke("ink", "page-a"));
    document.addSceneElement(textElement("caption"), "ink");

    const caption = document.getSceneElement("caption");
    const ink = document.getStroke("ink");
    expect(caption?.orderIndex).toBeLessThan(ink?.orderIndex ?? -1);
    document.moveElement("ink", "caption");
    expect(document.getStroke("ink")!.orderIndex)
      .toBeLessThan(document.getSceneElement("caption")!.orderIndex);
    document.moveElement("caption", "ink");
    expect(document.getSceneElement("caption")!.orderIndex)
      .toBeLessThan(document.getStroke("ink")!.orderIndex);
    expect(Math.max(...updates.map((update) => update.byteLength)))
      .toBeLessThanOrEqual(STUDIO_CRDT_UPDATE_MAX_BYTES);
    document.destroy();
  });

  it("creates, reorders, patches and tombstones authoritative page payloads", () => {
    const document = new StudioCrdtDocument();
    document.addPage(page("page-a", { name: "첫 페이지" }));
    document.addPage(page("page-b", { name: "둘째 페이지" }));
    document.movePage("page-b", "page-a");
    document.patchPage("page-b", { set: { canvasH: 2200, note: "원격 콘티" } });

    expect(document.getPages().map(({ id }) => id)).toEqual(["page-b", "page-a"]);
    expect(document.getPage("page-b")!.orderIndex)
      .toBeLessThan(document.getPage("page-a")!.orderIndex);
    expect(document.getPage("page-b")?.payload.props).toMatchObject({
      canvasH: 2200,
      note: "원격 콘티",
    });
    expect(document.deletePage("page-a")).toBe(true);
    expect(document.getPages().map(({ id }) => id)).toEqual(["page-b"]);
    expect(document.getPage("page-a", true)?.deleted).toBe(true);
    document.destroy();
  });

  it("merges independent first-registration page fields and resolves same-field edits deterministically", () => {
    const baseline = page("legacy-page", { name: "기준", note: "삭제할 메모" });
    const left = new StudioCrdtDocument();
    const right = new StudioCrdtDocument();
    left.upsertPage(page("legacy-page", { name: "왼쪽 제목" }), {
      baselineProps: baseline.payload.props,
      changedProps: ["name"],
      unsetProps: ["note"],
    });
    right.upsertPage(page("legacy-page", {
      bg: "#101010",
      name: "기준",
      note: "삭제할 메모",
    }), {
      baselineProps: baseline.payload.props,
      changedProps: ["bg"],
    });

    const firstLeft = left.encodeStateAsUpdate();
    const firstRight = right.encodeStateAsUpdate();
    left.applyUpdate(firstRight);
    right.applyUpdate(firstLeft);
    expect(left.getPage("legacy-page")?.payload.props).toMatchObject({
      bg: "#101010",
      name: "왼쪽 제목",
    });
    expect(left.getPage("legacy-page")?.payload.props).not.toHaveProperty("note");

    left.patchPage("legacy-page", { set: { name: "왼쪽 재수정" } });
    right.patchPage("legacy-page", { set: { name: "오른쪽 재수정" } });
    const secondLeft = left.encodeStateAsUpdate();
    const secondRight = right.encodeStateAsUpdate();
    left.applyUpdate(secondRight);
    right.applyUpdate(secondLeft);
    expect(right.getPage("legacy-page")).toEqual(left.getPage("legacy-page"));
    expect(["왼쪽 재수정", "오른쪽 재수정"])
      .toContain(left.getPage("legacy-page")?.payload.props.name);
    left.destroy();
    right.destroy();
  });

  it("batches local updates without echoing remotely applied updates", () => {
    vi.useFakeTimers();
    const document = new StudioCrdtDocument();
    const batches: Uint8Array[] = [];
    const origins: ReadonlySet<unknown>[] = [];
    const subscription = document.subscribeBatchedUpdates((batch) => {
      batches.push(batch.update);
      origins.push(batch.origins);
    });

    document.beginStroke(stroke("local-stroke", "page-a"));
    document.appendStrokeSamples("local-stroke", { points: [20, 30], pressures: [0.7] });
    vi.advanceTimersByTime(40);

    expect(batches).toHaveLength(1);
    expect(origins[0]?.has(STUDIO_CRDT_ORIGIN_LOCAL)).toBe(true);

    const remote = new StudioCrdtDocument();
    remote.addStroke(stroke("remote-stroke", "page-a"));
    document.applyUpdate(remote.encodeStateAsUpdate(), STUDIO_CRDT_ORIGIN_REMOTE);
    vi.advanceTimersByTime(50);
    expect(batches).toHaveLength(1);

    subscription.unsubscribe();
    remote.destroy();
    document.destroy();
    vi.useRealTimers();
  });

  it("replaces a long finalized stroke through bounded progressive updates", () => {
    vi.useFakeTimers();
    const document = new StudioCrdtDocument();
    const batches: Uint8Array[] = [];
    const subscription = document.subscribeBatchedUpdates(({ update }) => batches.push(update));
    const points = Array.from({ length: 4_000 }, (_, index) => index / 10);
    const count = points.length / 2;

    const replaced = document.replaceStroke({
      ...stroke("replace-stroke", "page-a", points),
      payload: payload(points, { pressures: Array<number>(count).fill(0.65) }),
    });
    vi.advanceTimersByTime(50);

    expect(replaced.status).toBe("finalized");
    expect(replaced.payload.points).toEqual(points);
    expect(replaced.payload.pressures).toHaveLength(count);
    expect(batches.length).toBeGreaterThan(1);
    expect(Math.max(...batches.map((update) => update.byteLength))).toBeLessThan(48 * 1024);

    subscription.unsubscribe();
    document.destroy();
    vi.useRealTimers();
  });

  it("expands a partial sample patch to the full aligned pointer-array group", () => {
    const document = new StudioCrdtDocument();
    document.addStroke(stroke("sample-patch", "page-a", [0, 0, 10, 10]));

    expect(() => document.patchStroke("sample-patch", {
      payload: payload([0, 0, 10, 10, 20, 20], { pressures: undefined }),
      changedPayloadKeys: ["points"],
    })).not.toThrow();

    expect(document.getStroke("sample-patch")?.payload).toMatchObject({
      points: [0, 0, 10, 10, 20, 20],
      pressures: [0.5, 0.5, 0.5],
      tiltXs: [0, 0, 0],
      tiltYs: [0, 0, 0],
      twists: [0, 0, 0],
      speeds: [0, 0, 0],
      tangentialPressures: [0, 0, 0],
    });
    document.destroy();
  });

  it("keeps full-size add/upsert replacement updates below the incremental wire cap", () => {
    const document = new StudioCrdtDocument();
    const updates: Uint8Array[] = [];
    document.subscribe((update, origin) => {
      if (origin === STUDIO_CRDT_ORIGIN_LOCAL) updates.push(update);
    });
    const count = STUDIO_CRDT_APPEND_MAX_SAMPLES;
    const points = Array.from({ length: count }, (_, index) => [index, index + 0.5]).flat();
    const fullPayload = payload(points, {
      pressures: Array<number>(count).fill(0.7),
      tiltXs: Array<number>(count).fill(1),
      tiltYs: Array<number>(count).fill(2),
      twists: Array<number>(count).fill(3),
      speeds: Array<number>(count).fill(4),
      tangentialPressures: Array<number>(count).fill(0.1),
      extensions: { inlineNote: "M".repeat(12 * 1024) },
    });

    document.addStroke({ ...stroke("bounded-upsert", "page-a"), payload: fullPayload });
    document.replaceStroke({
      ...stroke("bounded-upsert", "page-a"),
      payload: { ...fullPayload, stroke: "#abcdef" },
    });

    expect(updates.length).toBeGreaterThan(4);
    expect(Math.max(...updates.map((update) => update.byteLength)))
      .toBeLessThanOrEqual(STUDIO_CRDT_UPDATE_MAX_BYTES);
    expect(document.getStroke("bounded-upsert")?.payload.stroke).toBe("#abcdef");
    document.destroy();
  });

  it("rejects oversized inline mask metadata before begin or replacement mutates the document", () => {
    const document = new StudioCrdtDocument();
    const updates: Uint8Array[] = [];
    document.subscribe((update, origin) => {
      if (origin === STUDIO_CRDT_ORIGIN_LOCAL) updates.push(update);
    });
    const oversized = {
      maskSrc: `data:image/png;base64,${"A".repeat(60 * 1024)}`,
    };
    expect(JSON.stringify(oversized).length).toBeGreaterThan(STUDIO_CRDT_METADATA_MAX_BYTES);
    expect(() => document.beginStroke({
      ...stroke("oversized-new", "page-a"),
      payload: payload([1, 2], { extensions: oversized }),
    })).toThrow("메타데이터가 실시간 동기화 한도를 초과");
    expect(updates).toHaveLength(0);
    expect(document.getStroke("oversized-new", true)).toBeNull();

    document.addStroke(stroke("safe-existing", "page-a"));
    const before = document.getStroke("safe-existing", true);
    updates.length = 0;
    expect(() => document.replaceStroke({
      ...stroke("safe-existing", "page-a", [90, 90]),
      payload: payload([90, 90], { extensions: oversized }),
    })).toThrow("메타데이터가 실시간 동기화 한도를 초과");
    expect(updates).toHaveLength(0);
    expect(document.getStroke("safe-existing", true)).toEqual(before);
    document.destroy();
  });

  it("ignores malicious non-map Yjs roots and malformed nested records without read crashes", () => {
    const attacker = new Y.Doc();
    attacker.getMap<unknown>("strokes").set("string-stroke", "not-a-map");
    const malformed = new Y.Map<unknown>();
    malformed.set("id", "malformed-stroke");
    malformed.set("pageId", "page-a");
    malformed.set("layerId", "page-root");
    malformed.set("status", "finalized");
    malformed.set("points", "not-an-array");
    attacker.getMap<unknown>("strokes").set("malformed-stroke", malformed);
    attacker.getArray<unknown>("stroke-order").push(["not-a-map", 42]);
    attacker.getMap<boolean>("scene-elements").set("poison-scene", true);
    attacker.getArray<unknown>("scene-element:poison-scene").push(["not-a-map"]);
    attacker.getMap<boolean>("studio-pages").set("poison-page", true);
    attacker.getArray<unknown>("studio-page:poison-page").push(["not-a-map"]);

    const document = new StudioCrdtDocument();
    const changes = vi.fn();
    document.subscribeChanges(changes);
    expect(() => document.applyUpdate(Y.encodeStateAsUpdate(attacker))).not.toThrow();
    expect(() => document.getStrokes({ includeDeleted: true })).not.toThrow();
    expect(document.getStrokes({ includeDeleted: true })).toEqual([]);
    expect(document.getStroke("string-stroke", true)).toBeNull();
    expect(document.getSceneElements({ includeDeleted: true })).toEqual([]);
    expect(document.getPages(true)).toEqual([]);
    expect(changes).toHaveBeenCalled();

    document.destroy();
    attacker.destroy();
  });

  it("reports exact changed stroke IDs and filters origins before materializing changes", () => {
    const document = new StudioCrdtDocument();
    const remoteOnly = vi.fn();
    document.subscribeChanges(remoteOnly, {
      includeOrigin: (origin) => origin === STUDIO_CRDT_ORIGIN_REMOTE,
    });
    document.addStroke(stroke("local-only", "page-a"));
    expect(remoteOnly).not.toHaveBeenCalled();

    const remote = new StudioCrdtDocument();
    remote.addStroke(stroke("remote-only", "page-a"));
    document.applyUpdate(remote.encodeStateAsUpdate(), STUDIO_CRDT_ORIGIN_REMOTE);

    expect(remoteOnly).toHaveBeenCalledTimes(1);
    const change = remoteOnly.mock.calls[0]?.[0];
    expect(change.local).toBe(false);
    expect([...change.changedStrokeIds]).toEqual(["remote-only"]);

    remote.beginStroke(stroke("remote-stream", "page-a"));
    document.applyUpdate(
      remote.encodeStateAsUpdate(document.encodeStateVector()),
      STUDIO_CRDT_ORIGIN_REMOTE
    );
    remote.appendStrokeSamples("remote-stream", { points: [30, 40], pressures: [0.8] });
    document.applyUpdate(
      remote.encodeStateAsUpdate(document.encodeStateVector()),
      STUDIO_CRDT_ORIGIN_REMOTE
    );
    const streamedChange = remoteOnly.mock.calls.at(-1)?.[0];
    expect([...streamedChange.changedStrokeIds]).toEqual(["remote-stream"]);
    document.destroy();
    remote.destroy();
  });

  it("filters transaction summaries before materializing an enumerable change frontier", () => {
    const document = new StudioCrdtDocument();
    const getStrokes = vi.spyOn(document, "getStrokes");
    const getSceneElements = vi.spyOn(document, "getSceneElements");
    const getPages = vi.spyOn(document, "getPages");
    const getLayerGroups = vi.spyOn(document, "getLayerGroups");
    const readRasterSnapshot = vi.spyOn(
      document as unknown as { tryReadExactRasterDocumentSnapshot(): unknown },
      "tryReadExactRasterDocumentSnapshot"
    );
    const includeChange = vi.fn(
      (summary: StudioCrdtChangeSummary) => summary.changedSceneElementIds.size > 0
    );
    const changes: StudioCrdtChange[] = [];
    document.subscribeChanges((change) => changes.push(change), {
      includeOrigin: () => true,
      includeChange,
    });

    document.addStroke(stroke("filtered-stroke", "page-a"));

    expect(includeChange).toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(getStrokes).not.toHaveBeenCalled();
    expect(getSceneElements).not.toHaveBeenCalled();
    expect(getPages).not.toHaveBeenCalled();
    expect(getLayerGroups).not.toHaveBeenCalled();
    expect(readRasterSnapshot).not.toHaveBeenCalled();
    includeChange.mockClear();

    document.addSceneElement(textElement("included-text"));

    expect(includeChange).toHaveBeenCalled();
    expect(changes).not.toHaveLength(0);
    const includedChange = changes.at(-1)!;
    expect(includedChange.sceneElements.map(({ id }) => id)).toEqual(["included-text"]);
    expect(new Set(Object.keys(includedChange))).toEqual(new Set([
      "origin",
      "local",
      "changedStrokeIds",
      "strokes",
      "changedSceneElementIds",
      "sceneElements",
      "changedPageIds",
      "pages",
      "changedLayerGroupIds",
      "layerGroups",
      "changedRasterSurfaceIds",
      "changedRasterOperationIds",
      "changedRasterUndoOperationIds",
      "changedRasterUndoAcknowledgementIds",
      "changedRasterCheckpointIds",
      "rasterOperationLogs",
      "rasterCheckpoints",
    ]));
    expect(getStrokes).toHaveBeenCalledTimes(1);
    expect(getSceneElements).toHaveBeenCalledTimes(1);
    expect(getPages).toHaveBeenCalledTimes(1);
    expect(getLayerGroups).toHaveBeenCalledTimes(1);
    expect(readRasterSnapshot).toHaveBeenCalledTimes(1);

    document.destroy();
  });

  it("keeps each accepted change frontier fixed at its transaction", () => {
    const document = new StudioCrdtDocument();
    const changes: StudioCrdtChange[] = [];
    document.subscribeChanges((change) => changes.push(change), {
      includeOrigin: () => true,
      includeChange: ({ changedStrokeIds }) => changedStrokeIds.size > 0,
    });

    document.addStroke(stroke("first-stroke", "page-a"));
    const firstChange = changes.at(-1);
    document.addStroke(stroke("second-stroke", "page-a"));
    const secondChange = changes.at(-1);
    document.destroy();

    expect(firstChange?.strokes.map(({ id }) => id)).toEqual(["first-stroke"]);
    expect(secondChange?.strokes.map(({ id }) => id)).toEqual([
      "first-stroke",
      "second-stroke",
    ]);
  });

  it("materializes only projected snapshot fields after summary filtering", () => {
    const document = new StudioCrdtDocument();
    document.addStroke(stroke("projected-existing", "page-a"));
    document.addPage(page("projected-page"));
    const getStrokes = vi.spyOn(document, "getStrokes");
    const getSceneElements = vi.spyOn(document, "getSceneElements");
    const getPages = vi.spyOn(document, "getPages");
    const getLayerGroups = vi.spyOn(document, "getLayerGroups");
    const readRasterSnapshot = vi.spyOn(
      document as unknown as { tryReadExactRasterDocumentSnapshot(): unknown },
      "tryReadExactRasterDocumentSnapshot"
    );
    const changes: StudioCrdtProjectedChange<readonly ["strokes", "pages"]>[] = [];
    document.subscribeChanges((change) => changes.push(change), {
      includeChange: ({ changedSceneElementIds }) => changedSceneElementIds.size > 0,
      snapshotFields: ["strokes", "pages"],
    });

    document.addStroke(stroke("projected-filtered", "page-a"));

    expect(changes).toEqual([]);
    expect(getStrokes).not.toHaveBeenCalled();
    expect(getSceneElements).not.toHaveBeenCalled();
    expect(getPages).not.toHaveBeenCalled();
    expect(getLayerGroups).not.toHaveBeenCalled();
    expect(readRasterSnapshot).not.toHaveBeenCalled();

    document.addSceneElement(textElement("projected-included"));

    expect(changes).toHaveLength(1);
    expect(getStrokes).toHaveBeenCalledTimes(1);
    expect(getPages).toHaveBeenCalledTimes(1);
    expect(getSceneElements).not.toHaveBeenCalled();
    expect(getLayerGroups).not.toHaveBeenCalled();
    expect(readRasterSnapshot).not.toHaveBeenCalled();
    const includedChange = changes[0]!;
    expect(includedChange.snapshotMode).toBe("projected");
    expect(includedChange.snapshotFields).toEqual(["strokes", "pages"]);
    expect(Object.isFrozen(includedChange.snapshotFields)).toBe(true);
    expect(Object.keys(includedChange.snapshot)).toEqual(["strokes", "pages"]);
    expect(includedChange.snapshot.strokes.map(({ id }) => id)).toEqual([
      "projected-existing",
      "projected-filtered",
    ]);
    expect(includedChange.snapshot.pages.map(({ id }) => id)).toEqual(["projected-page"]);
    expect("sceneElements" in includedChange.snapshot).toBe(false);
    expect("strokes" in includedChange).toBe(false);
    type SnapshotHasNoSceneElements = "sceneElements" extends
      keyof typeof includedChange.snapshot ? never : true;
    type ChangeHasNoTopLevelStrokes = "strokes" extends keyof typeof includedChange ? never : true;
    const snapshotHasNoSceneElements: SnapshotHasNoSceneElements = true;
    const changeHasNoTopLevelStrokes: ChangeHasNoTopLevelStrokes = true;
    expect(snapshotHasNoSceneElements).toBe(true);
    expect(changeHasNoTopLevelStrokes).toBe(true);
    document.destroy();
  });

  it("keeps projected frontiers exact after later transactions and document destruction", () => {
    const document = new StudioCrdtDocument();
    const changes: StudioCrdtProjectedChange<readonly ["strokes"]>[] = [];
    document.subscribeChanges((change) => changes.push(change), {
      includeChange: ({ changedStrokeIds }) => changedStrokeIds.size > 0,
      snapshotFields: ["strokes"],
    });

    document.addStroke(stroke("projected-first", "page-a"));
    const firstChange = changes.at(-1)!;
    document.addStroke(stroke("projected-second", "page-a"));
    const secondChange = changes.at(-1)!;
    document.destroy();

    expect(firstChange.snapshot.strokes.map(({ id }) => id)).toEqual(["projected-first"]);
    expect(secondChange.snapshot.strokes.map(({ id }) => id)).toEqual([
      "projected-first",
      "projected-second",
    ]);
  });

  it("reads one shared raster frontier for projected raster fields", () => {
    const document = new StudioCrdtDocument();
    const getStrokes = vi.spyOn(document, "getStrokes");
    const getSceneElements = vi.spyOn(document, "getSceneElements");
    const getPages = vi.spyOn(document, "getPages");
    const getLayerGroups = vi.spyOn(document, "getLayerGroups");
    const readRasterSnapshot = vi.spyOn(
      document as unknown as { tryReadExactRasterDocumentSnapshot(): unknown },
      "tryReadExactRasterDocumentSnapshot"
    );
    const changes = vi.fn();
    document.subscribeChanges(changes, {
      snapshotFields: [
        "rasterOperationLogs",
        "rasterCheckpoints",
        "rasterOperationLogs",
      ],
    });

    document.addSceneElement(textElement("projected-raster-trigger"));

    expect(changes).toHaveBeenCalledTimes(1);
    expect(readRasterSnapshot).toHaveBeenCalledTimes(1);
    expect(getStrokes).not.toHaveBeenCalled();
    expect(getSceneElements).not.toHaveBeenCalled();
    expect(getPages).not.toHaveBeenCalled();
    expect(getLayerGroups).not.toHaveBeenCalled();
    const change = changes.mock.calls[0]?.[0];
    expect(Object.keys(change.snapshot)).toEqual([
      "rasterOperationLogs",
      "rasterCheckpoints",
    ]);
    expect(change.snapshot.rasterOperationLogs).toEqual([]);
    expect(change.snapshot.rasterCheckpoints).toEqual([]);
    document.destroy();
  });

  it("reports exact scene and page IDs introduced by one remote update", () => {
    const receiver = new StudioCrdtDocument();
    const changes = vi.fn();
    receiver.subscribeChanges(changes, {
      includeOrigin: (origin) => origin === STUDIO_CRDT_ORIGIN_REMOTE,
    });
    const remote = new StudioCrdtDocument();
    remote.addSceneElement(textElement("remote-text"));
    remote.addPage(page("remote-page"));

    receiver.applyUpdate(remote.encodeStateAsUpdate(), STUDIO_CRDT_ORIGIN_REMOTE);

    expect(changes).toHaveBeenCalledTimes(1);
    const change = changes.mock.calls[0]?.[0];
    expect([...change.changedStrokeIds]).toEqual([]);
    expect([...change.changedSceneElementIds]).toEqual(["remote-text"]);
    expect([...change.changedPageIds]).toEqual(["remote-page"]);
    expect(change.sceneElements.map(({ id }: { id: string }) => id)).toEqual(["remote-text"]);
    expect(change.pages.map(({ id }: { id: string }) => id)).toEqual(["remote-page"]);
    receiver.destroy();
    remote.destroy();
  });

  it("reassembles a chunked server diff once and computes the reverse offline diff", () => {
    const server = new StudioCrdtDocument();
    server.addStroke(stroke("server-stroke", "page-a", [1, 2, 3, 4]));
    const client = new StudioCrdtDocument();
    client.addStroke(stroke("client-stroke", "page-a", [5, 6, 7, 8]));

    const serverDiff = server.encodeStateAsUpdate(client.encodeStateVector());
    const chunks = encodeStudioCrdtSyncChunks(serverDiff);
    client.applySyncResponse({
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: "work-a",
      requestId: "request-a",
      transferId: "transfer-a",
      chunks,
      chunkCount: chunks.length,
      totalBytes: serverDiff.byteLength,
      serverStateVector: encodeStudioCrdtStateVector(server.encodeStateVector()),
      serverSequence: "1",
    });
    const missingOnServer = client.encodeMissingUpdate(
      encodeStudioCrdtStateVector(server.encodeStateVector())
    );
    server.applyUpdate(missingOnServer);

    expect(comparable(client)).toEqual(comparable(server));

    client.destroy();
    server.destroy();
  });

  it("rejects malformed sample alignment and cannot be used after destroy", () => {
    const document = new StudioCrdtDocument();
    expect(() => document.beginStroke({
      ...stroke("invalid-stroke", "page-a"),
      payload: payload([1, 2, 3, 4], { pressures: [0.5] }),
    })).toThrow("정렬되지 않았습니다");

    document.destroy();
    expect(() => document.getStrokes()).toThrow("이미 닫힌");
  });

  // task #25: getStrokes/getSceneElements/getPages/getLayerGroups now read from per-id caches. An
  // afterTransaction listener (reconcileRecordCaches) marks ids dirty using the changed-id sets the
  // document already tracks; actual re-decoding is deferred to the next get*() call (drainDirty*Ids)
  // instead of happening eagerly per transaction — so instead of rescanning every record on every
  // call, only the ids actually touched since the last read get re-decoded, and only once per read.
  // A freshly-constructed StudioCrdtDocument always bootstraps its caches from scratch (no incremental
  // logic involved), so replaying the same bytes into a fresh instance after every mutation and
  // diffing get*() output is a strong cross-check: any missed invalidation in the incremental path
  // would show up as a divergence.
  describe("record caches stay consistent with a fresh rescan", () => {
    function snapshotAll(document: StudioCrdtDocument) {
      return {
        strokes: document.getStrokes({ includeDeleted: true }),
        sceneElements: document.getSceneElements({ includeDeleted: true }),
        pages: document.getPages(true),
        layerGroups: document.getLayerGroups({ includeDeleted: true }),
      };
    }

    function assertMatchesFreshRescan(document: StudioCrdtDocument): void {
      const fresh = new StudioCrdtDocument(document.encodeStateAsUpdate());
      try {
        expect(snapshotAll(document)).toEqual(snapshotAll(fresh));
      } finally {
        fresh.destroy();
      }
    }

    it("matches a freshly-bootstrapped document at every step of a mixed stroke/element/page/layer-group CRUD sequence", () => {
      const document = new StudioCrdtDocument();

      document.addPage(page("page-a"));
      assertMatchesFreshRescan(document);
      document.addPage(page("page-b", { canvasH: 2000 }));
      assertMatchesFreshRescan(document);

      document.addStroke(stroke("s1", "page-a", [0, 0, 10, 10]));
      assertMatchesFreshRescan(document);
      document.addStroke(stroke("s2", "page-a", [5, 5, 15, 15]));
      assertMatchesFreshRescan(document);
      document.addStroke(stroke("s3", "page-b", [1, 1, 2, 2]));
      assertMatchesFreshRescan(document);

      // Only s2's content changes here — s1/s3 must stay correct in the cache without being
      // re-decoded (the actual regression this test targets; a full-rescan implementation would
      // trivially pass this too, so the point is pinning the *incremental* path's correctness).
      document.patchStroke("s2", {
        payload: payload([5, 5, 15, 15, 25, 25], { pressures: undefined }),
        changedPayloadKeys: ["points"],
      });
      assertMatchesFreshRescan(document);

      document.moveStroke("s1", null); // reorder only — content unchanged, orderIndex must refresh
      assertMatchesFreshRescan(document);
      document.deleteStroke("s3");
      assertMatchesFreshRescan(document);
      document.restoreStroke("s3");
      assertMatchesFreshRescan(document);

      document.addSceneElement(textElement("t1"));
      assertMatchesFreshRescan(document);
      document.addSceneElement(textElement("t2", { text: "두번째" }));
      assertMatchesFreshRescan(document);
      document.patchSceneElement("t1", { set: { text: "수정됨" } });
      assertMatchesFreshRescan(document);
      document.moveSceneElement("t2", null);
      assertMatchesFreshRescan(document);
      document.deleteSceneElement("t2");
      assertMatchesFreshRescan(document);
      document.restoreSceneElement("t2");
      assertMatchesFreshRescan(document);

      document.addLayerGroup({
        id: "lg1",
        pageId: "page-a",
        payload: {
          version: STUDIO_CRDT_LAYER_GROUP_PAYLOAD_VERSION,
          props: { name: "레이어1", hidden: false, locked: false },
        },
      });
      assertMatchesFreshRescan(document);
      document.patchLayerGroup("page-a", "lg1", { set: { hidden: true } });
      assertMatchesFreshRescan(document);
      document.deleteLayerGroup("page-a", "lg1");
      assertMatchesFreshRescan(document);
      document.restoreLayerGroup("page-a", "lg1");
      assertMatchesFreshRescan(document);

      document.patchPage("page-a", { set: { canvasH: 1800 } });
      assertMatchesFreshRescan(document);
      document.movePage("page-b", "page-a");
      assertMatchesFreshRescan(document);
      document.deletePage("page-b");
      assertMatchesFreshRescan(document);
      document.restorePage("page-b");
      assertMatchesFreshRescan(document);

      document.destroy();
    });

    it("keeps an id-format-invalid entry excluded from results after a content-root change (bootstrap has no exactText guard, refresh does)", () => {
      const document = new StudioCrdtDocument();
      document.addPage(page("page-a"));
      document.addSceneElement(textElement("valid-id"));

      // Directly poke an over-length id into the underlying scene-element-ids map the way a
      // corrupted/adversarial remote update could, bypassing the public API's validation.
      const doc = underlyingYDoc(document);
      const overLongId = "x".repeat(600);
      doc.transact(() => {
        (doc.getMap("scene-elements") as Y.Map<boolean>).set(overLongId, true);
        const root = doc.getMap<unknown>(`scene-element:${overLongId}`);
        root.set("id", overLongId);
        root.set("pageId", "page-a");
        root.set("layerId", "lettering");
        root.set("payloadVersion", STUDIO_CRDT_SCENE_ELEMENT_PAYLOAD_VERSION);
        root.set("type", "text");
        root.set("text", "corrupt");
      }, STUDIO_CRDT_ORIGIN_LOCAL);

      expect(document.getSceneElements({ includeDeleted: true }).map((r) => r.id)).not.toContain(
        overLongId
      );

      // Touch its content root again post-bootstrap — this exercises reconcileRecordCaches for an
      // id that was never exactText-valid, which must keep excluding it (not just skip it once).
      doc.transact(() => {
        doc.getMap<unknown>(`scene-element:${overLongId}`).set("text", "still corrupt");
      }, STUDIO_CRDT_ORIGIN_LOCAL);

      expect(document.getSceneElements({ includeDeleted: true }).map((r) => r.id)).not.toContain(
        overLongId
      );

      document.destroy();
    });

    it("defers sample-array decoding until a get*() call, instead of re-decoding on every local append transaction", () => {
      // Pins the fix for a regression an adversarial review caught: an earlier version of this
      // cache eagerly re-decoded + deep-froze a stroke's full sample arrays inside the
      // afterTransaction listener on every single appendStrokeSamples() call, which is exactly the
      // pointer-move-driven local live-drawing hot path this task targets — turning "decode cost
      // proportional to the current stroke length, paid once per pointer-move batch" into an O(n^2)
      // cost over the life of one long stroke, and introducing cost where the pre-optimization code
      // had none (getStrokes() was previously only ever called lazily, on read). The fix defers
      // decoding to drainDirty*Ids(), invoked at the top of get*() — so N append transactions with
      // no intervening read must decode the sample arrays at most once, not N times.
      const document = new StudioCrdtDocument();
      document.addPage(page("page-a"));
      document.beginStroke(stroke("live-draw", "page-a", []));

      const toArraySpy = vi.spyOn(Y.Array.prototype, "toArray");
      toArraySpy.mockClear();

      for (let i = 0; i < 20; i += 1) {
        document.appendStrokeSamples("live-draw", { points: [i, i] });
      }
      expect(toArraySpy).not.toHaveBeenCalled();

      document.getStrokes();
      expect(toArraySpy).toHaveBeenCalled();

      toArraySpy.mockRestore();
      document.destroy();
    });
  });
});
