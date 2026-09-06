import { describe, expect, it } from "vitest";

import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
} from "../brush/studio-ink-pressure-model";

import { StudioCrdtDocument } from "./studio-crdt-document";
import {
  STUDIO_RASTER_TEST_SEMANTIC_SHA256,
  nextStudioRasterLogicalClock,
  planStudioRasterDrawPromotion,
  planStudioRasterOverlayHandoff,
  publishStudioRasterHistoryTransition,
  studioRasterDrawPromotionSourceMatches,
  studioRasterBrushSurface,
} from "./studio-crdt-raster-ui-bridge";

import {
  STUDIO_RASTER_CRDT_VERSION,
  STUDIO_RASTER_KERNEL,
  createStudioRasterOperationLog,
  studioRasterUndoneOperationIds,
  type StudioRasterOperation,
  type StudioRasterOperationLog,
} from "@/shared/lib/studio-crdt-raster-ops";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function operation(actorId = "artist-a"): StudioRasterOperation {
  return {
    version: STUDIO_RASTER_CRDT_VERSION,
    operationId: uuid(1),
    order: { logicalClock: "9", actorId },
    pageId: "page-a",
    layerId: "page-root",
    intent: "paint",
    kernel: STUDIO_RASTER_KERNEL,
    semanticParametersSha256: STUDIO_RASTER_TEST_SEMANTIC_SHA256,
    patches: [{
      tileX: 0,
      tileY: 0,
      region: { x: 0, y: 0, width: 1, height: 1 },
      effect: {
        kind: "composite",
        blendMode: "source-over",
        payload: {
          scope: "work",
          assetId: "a".repeat(64),
          sha256: "a".repeat(64),
          byteLength: 68,
          mediaType: "image/png",
          width: 1,
          height: 1,
        },
      },
    }],
  };
}

function log(actorId = "artist-a"): StudioRasterOperationLog {
  return createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: studioRasterBrushSurface("page-a", 800, 1_200),
    operations: [operation(actorId)],
    undoOperations: [],
    undoAcknowledgements: [],
  });
}

describe("studio CRDT raster UI bridge", () => {
  it("increments the global decimal Lamport frontier without IEEE-754 or BigInt", () => {
    expect(nextStudioRasterLogicalClock([])).toBe("1");
    const nearMaximum = log();
    const changed = createStudioRasterOperationLog({
      ...nearMaximum,
      operations: [{
        ...nearMaximum.operations[0]!,
        order: { ...nearMaximum.operations[0]!.order, logicalClock: "18446744073709551614" },
      }],
    });
    expect(nextStudioRasterLogicalClock([changed])).toBe("18446744073709551615");
    expect(() => nextStudioRasterLogicalClock([createStudioRasterOperationLog({
      ...changed,
      operations: [{
        ...changed.operations[0]!,
        order: { ...changed.operations[0]!.order, logicalClock: "18446744073709551615" },
      }],
    })])).toThrow(/최대값/u);
  });

  it("promotes only exact round source-over pens and preserves the fallback UUID", () => {
    const id = uuid(12);
    const plan = planStudioRasterDrawPromotion({
      element: {
        id,
        type: "draw",
        kind: "freehand",
        mode: "pen",
        points: [10, 10, 30, 30],
        pressures: [0.5, 1],
        stroke: "#112233",
        strokeWidth: 8,
        opacity: 1,
        brush: "pen",
        sampleSpacing: 0,
      },
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    });

    expect(plan).toMatchObject({
      operationId: id,
      intent: "paint",
      surface: { surfaceId: "raster:page-a:ink", tileSize: 512 },
      stroke: { id, composite: "normal", color: "#112233", size: 8 },
    });
    expect(plan?.semanticParameters).toContain("round-pen");
    expect(planStudioRasterDrawPromotion({
      element: {
        id,
        type: "draw",
        kind: "freehand",
        mode: "eraser",
        points: [10, 10, 30, 30],
        pressures: [0.5, 1],
        stroke: "#112233",
        strokeWidth: 8,
      },
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    })).toBeNull();
  });

  it("binds the exact pressure model into GPU pixels and canonical raster semantics", () => {
    const id = uuid(13);
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const plan = planStudioRasterDrawPromotion({
      element: {
        id,
        type: "draw",
        kind: "freehand",
        mode: "pen",
        points: [10, 10, 30, 30],
        pressures: [0],
        stroke: "#112233",
        strokeWidth: 8,
        opacity: 1,
        brush: "pen",
        pressureModel,
      },
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    });
    const causalDefaultModel = planStudioRasterDrawPromotion({
      element: {
        id,
        type: "draw",
        kind: "freehand",
        mode: "pen",
        points: [10, 10, 30, 30],
        pressures: [0, 1],
        stroke: "#112233",
        strokeWidth: 8,
        opacity: 1,
        brush: "pen",
        sampleSpacing: 0,
      },
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    });

    expect(plan?.stroke.pressureModel).toBe(pressureModel);
    expect(plan?.stroke.pressures).toEqual([0, 1]);
    expect(JSON.parse(plan!.semanticParameters).stroke.pressureModel).toBe(pressureModel);
    expect(Object.hasOwn(causalDefaultModel!.stroke, "pressureModel")).toBe(false);
    expect(JSON.parse(causalDefaultModel!.semanticParameters).stroke.pressureModel)
      .toBe("studio-gpu-pressure-radius-v1");
    expect(plan?.semanticParameters).not.toBe(causalDefaultModel?.semanticParameters);
  });

  it("falls back a legacy pen stroke with no causal geometry instead of promoting it", () => {
    // No sampleSpacing and no pressureModel means Konva would render this through the legacy
    // lineTo/quadraticCurveTo segment path, which the dab-based rasterizer never reproduces.
    const id = uuid(13);
    expect(planStudioRasterDrawPromotion({
      element: {
        id,
        type: "draw",
        kind: "freehand",
        mode: "pen",
        points: [10, 10, 30, 30],
        pressures: [0, 1],
        stroke: "#112233",
        strokeWidth: 8,
        opacity: 1,
        brush: "pen",
      },
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    })).toBeNull();
  });

  it("promotes no-spacing explicit-model points without legacy smoothing", () => {
    const id = uuid(14);
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const points = [0, 0, 1, 1, 8, 4, 15, 10];
    const plan = planStudioRasterDrawPromotion({
      element: {
        id,
        type: "draw",
        kind: "freehand",
        mode: "pen",
        points,
        pressures: [0],
        stroke: "#112233",
        strokeWidth: 8,
        opacity: 1,
        brush: "pen",
        pressureModel,
      },
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    });

    expect(plan?.stroke).toMatchObject({
      points,
      pressures: [0, 1, 1, 1],
      pressureModel,
    });
    expect(JSON.parse(plan!.semanticParameters).stroke.pointPipeline)
      .toBe("studio-causal-dabs-v1");
  });

  it("versions V3 path-phase pixels separately from the frozen V2 raster pipeline", () => {
    const id = uuid(15);
    const element = {
      id,
      type: "draw" as const,
      kind: "freehand",
      mode: "pen" as const,
      points: [0, 0, 4, 0, 4, 4],
      pressures: [1, 1, 1],
      stroke: "#112233",
      strokeWidth: 16,
      opacity: 1,
      brush: "pen",
      sampleSpacing: 0,
    };
    const dimensions = { pageId: "page-a", documentWidth: 800, documentHeight: 1_200 };
    const v2Element = {
      ...element,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    };
    const v3Element = {
      ...element,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
    };
    const v2 = planStudioRasterDrawPromotion({ element: v2Element, ...dimensions })!;
    const v3 = planStudioRasterDrawPromotion({ element: v3Element, ...dimensions })!;

    expect(JSON.parse(v2.semanticParameters).stroke).toMatchObject({
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
      pointPipeline: "studio-causal-dabs-v1",
    });
    expect(JSON.parse(v3.semanticParameters).stroke).toMatchObject({
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
      pointPipeline: "studio-causal-polyline-residual-v3",
    });
    expect(v3.semanticParameters).not.toBe(v2.semanticParameters);
    expect(studioRasterDrawPromotionSourceMatches({
      plan: v3,
      element: v3Element,
      ...dimensions,
      layerId: "page-root",
      panelClipped: false,
    })).toBe(true);
    expect(studioRasterDrawPromotionSourceMatches({
      plan: v3,
      element: v2Element,
      ...dimensions,
      layerId: "page-root",
      panelClipped: false,
    })).toBe(false);
  });

  it("cancels an async promotion after the fallback is deleted, edited, clipped, or regrouped", () => {
    const id = uuid(12);
    const element = {
      id,
      type: "draw" as const,
      kind: "freehand",
      mode: "pen" as const,
      points: [10, 10, 30, 30],
      pressures: [0.5, 1],
      stroke: "#112233",
      strokeWidth: 8,
      opacity: 1,
      brush: "pen",
      sampleSpacing: 0,
    };
    const plan = planStudioRasterDrawPromotion({
      element,
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    })!;
    const matches = (overrides: Partial<Parameters<typeof studioRasterDrawPromotionSourceMatches>[0]>) =>
      studioRasterDrawPromotionSourceMatches({
        plan,
        element,
        pageId: "page-a",
        layerId: "page-root",
        documentWidth: 800,
        documentHeight: 1_200,
        panelClipped: false,
        ...overrides,
      });

    expect(matches({})).toBe(true);
    expect(matches({ element: null })).toBe(false);
    expect(matches({ element: { ...element, points: [10, 10, 40, 40] } })).toBe(false);
    expect(matches({ panelClipped: true })).toBe(false);
    expect(matches({ element: { ...element, groupId: "ink" } })).toBe(false);
    expect(matches({
      element: {
        ...element,
        pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
      },
    })).toBe(false);
  });

  it("hands off only an exact topmost scene suffix in deterministic raster replay order", () => {
    const firstId = uuid(21);
    const secondId = uuid(22);
    const draw = (id: string, color: string) => ({
      id,
      type: "draw" as const,
      kind: "freehand",
      mode: "pen" as const,
      points: [10, 10, 30, 30],
      pressures: [0.5, 1],
      stroke: color,
      strokeWidth: 8,
      opacity: 1,
      brush: "pen",
      sampleSpacing: 0,
      panelClip: "none" as const,
    });
    const rasterLog = createStudioRasterOperationLog({
      version: STUDIO_RASTER_CRDT_VERSION,
      surface: studioRasterBrushSurface("page-a", 800, 1_200),
      operations: [
        { ...operation(), operationId: firstId, order: { logicalClock: "1", actorId: "artist-a" } },
        { ...operation(), operationId: secondId, order: { logicalClock: "2", actorId: "artist-a" } },
      ],
      undoOperations: [],
      undoAcknowledgements: [],
    });
    const elements = [
      { id: "background", type: "image", panelClip: "none" as const },
      draw(firstId, "#111111"),
      draw(secondId, "#222222"),
    ];

    const ready = planStudioRasterOverlayHandoff({
      log: rasterLog,
      elements,
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    });
    expect(ready.status).toBe("ready");
    if (ready.status === "ready") {
      expect(ready.sourceOperations.map(({ operationId }) => operationId))
        .toEqual([firstId, secondId]);
    }

    expect(planStudioRasterOverlayHandoff({
      log: rasterLog,
      elements: [...elements, { id: "bubble", type: "bubble", panelClip: "none" }],
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    })).toMatchObject({ status: "ineligible", reason: "scene-order" });
    expect(planStudioRasterOverlayHandoff({
      log: rasterLog,
      elements: [elements[0]!, elements[2]!, elements[1]!],
      pageId: "page-a",
      documentWidth: 800,
      documentHeight: 1_200,
    })).toMatchObject({ status: "ineligible", reason: "scene-order" });
  });

  it("mirrors one page undo and redo into owner-only immutable undo/ack events", () => {
    const document = new StudioCrdtDocument();
    document.mergeRasterOperationLog(log());
    const ids = [uuid(2), uuid(3)];
    const nextUuid = () => ids.shift()!;
    const present = [{ elements: [{ id: uuid(1), type: "draw" }] }];
    const absent = [{ elements: [] }];

    expect(publishStudioRasterHistoryTransition({
      document,
      previousPages: present,
      nextPages: absent,
      actorId: "artist-a",
      uuid: nextUuid,
    })).toEqual({ undoOperationIds: [uuid(2)], acknowledgementIds: [] });
    expect(studioRasterUndoneOperationIds(document.getRasterOperationLogs()[0]!))
      .toEqual(new Set([uuid(1)]));

    expect(publishStudioRasterHistoryTransition({
      document,
      previousPages: absent,
      nextPages: present,
      actorId: "artist-a",
      uuid: nextUuid,
    })).toEqual({ undoOperationIds: [], acknowledgementIds: [uuid(3)] });
    expect(studioRasterUndoneOperationIds(document.getRasterOperationLogs()[0]!))
      .toEqual(new Set());
    expect(document.getRasterOperationLogs()[0]!.undoAcknowledgements[0]!.order.logicalClock)
      .toBe("11");
  });

  it("does not let a collaborator page transition undo another actor's raster operation", () => {
    const document = new StudioCrdtDocument();
    document.mergeRasterOperationLog(log("artist-a"));
    const result = publishStudioRasterHistoryTransition({
      document,
      previousPages: [{ elements: [{ id: uuid(1), type: "draw" }] }],
      nextPages: [{ elements: [] }],
      actorId: "artist-b",
      uuid: () => uuid(9),
    });
    expect(result).toEqual({ undoOperationIds: [], acknowledgementIds: [] });
    expect(document.getRasterOperationLogs()[0]!.undoOperations).toEqual([]);
  });

  it("invalidates a promoted raster operation when the same fallback ID is edited", () => {
    const document = new StudioCrdtDocument();
    document.mergeRasterOperationLog(log());
    const ids = [uuid(7)];
    const before = [{
      elements: [{ id: uuid(1), type: "draw", points: [1, 1, 2, 2], stroke: "#111111" }],
    }];
    const after = [{
      elements: [{ id: uuid(1), type: "draw", points: [1, 1, 3, 3], stroke: "#111111" }],
    }];

    expect(publishStudioRasterHistoryTransition({
      document,
      previousPages: before,
      nextPages: after,
      actorId: "artist-a",
      uuid: () => ids.shift()!,
    })).toEqual({ undoOperationIds: [uuid(7)], acknowledgementIds: [] });
    expect(studioRasterUndoneOperationIds(document.getRasterOperationLogs()[0]!))
      .toEqual(new Set([uuid(1)]));
  });
});
