import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
} from "./brush/studio-brush-dynamics";
import {
  planStudioDeferredStrokePostprocess,
  replaceStudioPendingStrokePostprocess,
} from "./studio-deferred-stroke-postprocess";
import { STUDIO_PIXEL_PENCIL_RENDER_MODE } from "./studio-pixel-pencil";

import type { DrawEl } from "./studio-element-model";

function stroke(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "stroke-1",
    type: "draw",
    stroke: "#111111",
    strokeWidth: 4,
    mode: "pen",
    kind: "freehand",
    points: Array.from({ length: 4_096 }, (_, index) => index / 10),
    ...overrides,
  };
}

describe("planStudioDeferredStrokePostprocess", () => {
  it("admits only a worker-worthy ordinary freehand stroke", () => {
    const plan = planStudioDeferredStrokePostprocess({
      stroke: stroke(),
      strength: 10,
      causalStateSealed: false,
      quickShapeActive: false,
      workerAvailable: true,
    });

    expect(plan?.kind).toBe("worker");
    expect(plan?.pointCount).toBe(2_048);
  });

  it.each([
    ["quick shape", { quickShapeActive: true }],
    ["sealed causal correction", { causalStateSealed: true }],
    ["no worker", { workerAvailable: false }],
  ])("keeps %s on the synchronous release path", (_label, override) => {
    expect(planStudioDeferredStrokePostprocess({
      stroke: stroke(),
      strength: 10,
      causalStateSealed: false,
      quickShapeActive: false,
      workerAvailable: true,
      ...override,
    })).toBeNull();
  });

  it.each([
    ["short stroke", stroke({ points: [0, 0, 1, 1, 2, 2] })],
    ["eraser", stroke({ mode: "eraser" })],
    ["shape", stroke({ kind: "line" })],
    ["pixel pencil", stroke({ brush: STUDIO_PIXEL_PENCIL_RENDER_MODE })],
    ["stamp walker", stroke({ stampPipeline: "causal-walker-v2" })],
    ["watercolor walker", stroke({ watercolorPipeline: "causal-walker-v2" })],
    [
      "v2 causal dynamic deposit",
      stroke({
        brushDynamics: normalizeStudioBrushDynamicsSettings({
          depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
        }),
      }),
    ],
    [
      "v3 segmented causal dynamic deposit",
      stroke({
        brushDynamics: normalizeStudioBrushDynamicsSettings({
          depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
        }),
      }),
    ],
  ])("keeps a %s out of the Worker boundary", (_label, candidate) => {
    expect(planStudioDeferredStrokePostprocess({
      stroke: candidate,
      strength: 10,
      causalStateSealed: false,
      quickShapeActive: false,
      workerAvailable: true,
    })).toBeNull();
  });
});

describe("replaceStudioPendingStrokePostprocess", () => {
  it("replaces exactly the still-pending stroke without mutating the source array", () => {
    const source = [0, 0, 10, 4, 20, 0];
    const pending = stroke({ points: source });
    const batch = { pageId: "page-1", strokes: [pending] };

    expect(replaceStudioPendingStrokePostprocess(
      batch,
      { pageId: "page-1", strokeId: pending.id, sourcePoints: source },
      [0, 0, 10, 2, 20, 0],
    )).toBe("replaced");
    expect(source).toEqual([0, 0, 10, 4, 20, 0]);
    expect(batch.strokes[0]?.points).toEqual([0, 0, 10, 2, 20, 0]);
    expect(batch.strokes[0]?.points).not.toBe(source);
  });

  it("rejects stale, missing, and malformed results", () => {
    const source = [0, 0, 10, 4, 20, 0];
    const pending = stroke({ points: source });
    const target = { pageId: "page-1", strokeId: pending.id, sourcePoints: source };

    expect(replaceStudioPendingStrokePostprocess(null, target, source)).toBe("missing-batch");
    expect(replaceStudioPendingStrokePostprocess(
      { pageId: "page-2", strokes: [pending] },
      target,
      source,
    )).toBe("missing-batch");
    expect(replaceStudioPendingStrokePostprocess(
      { pageId: "page-1", strokes: [{ ...pending, points: [...source] }] },
      target,
      source,
    )).toBe("stale-stroke");
    expect(replaceStudioPendingStrokePostprocess(
      { pageId: "page-1", strokes: [pending] },
      target,
      [0, Number.NaN],
    )).toBe("invalid-result");
  });
});
