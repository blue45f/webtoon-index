import { describe, expect, it } from "vitest";

import {
  resolveStudioCapturedBrushDynamicsPresetId,
  studioBrushDynamicsSettingsForBrushId,
} from "./studio-brush-dynamics";
import {
  STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2,
  STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1,
  isStudioBoundedFlowPaintModelCompatible,
  isStudioStrokePaintModelCompatible,
  isStudioStrokePaintModel,
  resolveStudioLayeredFlowDepositionAlpha,
  resolveStudioLayeredFlowFinalAlpha,
  resolveStudioLayeredFlowOverlapAlpha,
  resolveStudioLegacyPerDabAlpha,
  resolveStudioLegacyPerDabOverlapAlpha,
  resolveStudioRepeatedSourceOverAlpha,
} from "./studio-stroke-paint-model";

describe("studio stroke paint model", () => {
  it("requires a versioned wet snapshot and keeps saved watercolor walkers on legacy pixels", () => {
    const brushDynamics = studioBrushDynamicsSettingsForBrushId("ink-wash");
    expect(brushDynamics).not.toBeNull();
    const captured = {
      paintModel: STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2,
      kind: "freehand",
      mode: "pen",
      brush: "ink-wash",
      sampleSpacing: 0.5,
      brushDynamics,
    };

    expect(resolveStudioCapturedBrushDynamicsPresetId(captured)).toBe("airbrush");
    expect(isStudioBoundedFlowPaintModelCompatible(captured)).toBe(true);
    expect(resolveStudioCapturedBrushDynamicsPresetId({
      ...captured,
      paintModel: undefined,
    })).toBeNull();
    expect(isStudioBoundedFlowPaintModelCompatible({
      ...captured,
      brushDynamics: undefined,
    })).toBe(false);

    const legacy = {
      ...captured,
      paintModel: undefined,
      brushDynamics: undefined,
      watercolorPipeline: "causal-walker-v2",
    };
    expect(resolveStudioCapturedBrushDynamicsPresetId(legacy)).toBeNull();
    expect(isStudioBoundedFlowPaintModelCompatible(legacy)).toBe(false);
    expect(resolveStudioCapturedBrushDynamicsPresetId({
      ...captured,
      watercolorPipeline: "causal-walker-v2",
    })).toBeNull();
  });

  it("accepts only the two exact persisted paint contracts", () => {
    expect(isStudioStrokePaintModel(STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1)).toBe(true);
    expect(isStudioStrokePaintModel(STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2)).toBe(true);
    expect(isStudioStrokePaintModel(undefined)).toBe(false);
    expect(isStudioStrokePaintModel("layered-flow-v2")).toBe(false);
    expect(isStudioStrokePaintModel({ paintModel: "layered-flow-v1" })).toBe(false);
  });

  it("admits bounded-flow-v2 only for snapshotted dynamics and bounded symmetry", () => {
    const base = {
      paintModel: STUDIO_STROKE_PAINT_MODEL_BOUNDED_FLOW_V2,
      kind: "freehand",
      mode: "pen",
      brush: "airbrush",
      sampleSpacing: 0.5,
      brushDynamics: { version: 1 },
    };
    expect(isStudioBoundedFlowPaintModelCompatible(base)).toBe(true);
    expect(isStudioStrokePaintModelCompatible({
      ...base,
      symmetry: {
        type: "kaleidoscope",
        centerX: 100,
        centerY: 200,
        radialCount: 32,
      },
    })).toBe(true);
    expect(isStudioStrokePaintModelCompatible({ ...base, brush: "marker" })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({ ...base, brushDynamics: undefined })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({
      ...base,
      symmetry: {
        type: "radial",
        centerX: 0,
        centerY: 0,
        radialCount: 33,
      },
    })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({
      ...base,
      symmetry: { type: "future-symmetry" },
    })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({ ...base, stampPipeline: "causal-walker-v2" }))
      .toBe(false);
  });

  it("allows ordinary ink and named low-density erasers without admitting generic erasers", () => {
    const base = {
      paintModel: STUDIO_STROKE_PAINT_MODEL_LAYERED_FLOW_V1,
      kind: "freehand",
      mode: "pen",
      brush: "marker",
      sampleSpacing: 0,
    };
    expect(isStudioStrokePaintModelCompatible(base)).toBe(true);
    expect(isStudioStrokePaintModelCompatible({ ...base, brush: "fineliner" })).toBe(true);
    expect(isStudioStrokePaintModelCompatible({ ...base, mode: "eraser" })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({
      ...base,
      mode: "eraser",
      brush: "kneaded-eraser",
    })).toBe(true);
    expect(isStudioStrokePaintModelCompatible({
      ...base,
      mode: "eraser",
      brush: undefined,
    })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({ ...base, fill: "#fff" })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({ ...base, brush: "watercolor" })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({ ...base, brushDynamics: {} })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({ ...base, stampPipeline: "causal-walker-v2" })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({ ...base, symmetry: { type: "vertical" } })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({ ...base, sampleSpacing: undefined })).toBe(false);
    expect(isStudioStrokePaintModelCompatible({ ...base, paintModel: undefined })).toBe(false);
  });

  it("clamps flow and dab opacity independently before depositing pigment", () => {
    expect(resolveStudioLayeredFlowDepositionAlpha(0.4, 0.5)).toBe(0.2);
    expect(resolveStudioLayeredFlowDepositionAlpha(2, 0.25)).toBe(0.25);
    expect(resolveStudioLayeredFlowDepositionAlpha(0.25, 2)).toBe(0.25);
    expect(resolveStudioLayeredFlowDepositionAlpha(-1, 1)).toBe(0);
    expect(resolveStudioLayeredFlowDepositionAlpha(1, Number.NaN)).toBe(0);
    expect(resolveStudioLayeredFlowDepositionAlpha(Number.POSITIVE_INFINITY, 1)).toBe(1);
  });

  it("applies clamped stroke opacity once to clamped deposited coverage", () => {
    expect(resolveStudioLayeredFlowFinalAlpha(0.6, 0.5)).toBe(0.3);
    expect(resolveStudioLayeredFlowFinalAlpha(0.6, 2)).toBe(0.6);
    expect(resolveStudioLayeredFlowFinalAlpha(2, 0.5)).toBe(0.5);
    expect(resolveStudioLayeredFlowFinalAlpha(-1, 1)).toBe(0);
    expect(resolveStudioLayeredFlowFinalAlpha(1, Number.NaN)).toBe(0);
  });

  it("keeps the omitted-model legacy oracle as opacity times flow per dab", () => {
    expect(resolveStudioLegacyPerDabAlpha(0.6, 0.25)).toBe(0.15);
    expect(resolveStudioLegacyPerDabAlpha(0.6, 0.25, 0.5)).toBe(0.075);
    expect(resolveStudioLegacyPerDabAlpha(2, 0.25, 2)).toBe(0.25);
    expect(resolveStudioLegacyPerDabAlpha(Number.NaN, 1, 1)).toBe(0);
  });

  it("uses the Porter-Duff source-over recurrence as the overlap oracle", () => {
    expect(resolveStudioRepeatedSourceOverAlpha(0.25, 0)).toBe(0);
    expect(resolveStudioRepeatedSourceOverAlpha(0.25, 1)).toBe(0.25);
    expect(resolveStudioRepeatedSourceOverAlpha(0.25, 2)).toBe(0.4375);
    expect(resolveStudioRepeatedSourceOverAlpha(0.25, 4)).toBeCloseTo(0.68359375, 12);
    expect(resolveStudioRepeatedSourceOverAlpha(0.25, 4.9)).toBeCloseTo(0.68359375, 12);
  });

  it("keeps a 60% opacity, 100% flow marker at 60% across repeated self-overlap", () => {
    for (const count of [1, 2, 3, 4, 6]) {
      expect(resolveStudioLayeredFlowOverlapAlpha(0.6, 1, count)).toBeCloseTo(0.6, 12);
    }

    const legacyByCount = [1, 2, 3, 4, 6].map((count) =>
      resolveStudioLegacyPerDabOverlapAlpha(0.6, 1, count));
    expect(legacyByCount[0]).toBeCloseTo(0.6, 12);
    expect(legacyByCount[1]).toBeCloseTo(0.84, 12);
    expect(legacyByCount[2]).toBeCloseTo(0.936, 12);
    expect(legacyByCount[3]).toBeCloseTo(0.9744, 12);
    expect(legacyByCount[4]).toBeCloseTo(0.995904, 12);
  });

  it("separates 25% flow deposition from 60% whole-stroke opacity over four dabs", () => {
    expect(resolveStudioLayeredFlowOverlapAlpha(0.6, 0.25, 4)).toBeCloseTo(
      0.41015625,
      12,
    );
    expect(resolveStudioLegacyPerDabOverlapAlpha(0.6, 0.25, 4)).toBeCloseTo(
      0.47799375,
      12,
    );
  });
});
