import { describe, expect, it } from "vitest";

import {
  STUDIO_INK_MAX_BRUSH_SIZE,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
  isStudioInkPressureModel,
  resolveStudioInkPressure,
  resolveStudioInkPressureSamples,
  studioInkFallbackPressure,
  studioInkPressureDiameter,
  studioInkPressureRadius,
  studioInkUsesPathResidualDabSpacing,
  studioInkUsesResidualDabSpacing,
} from "./studio-ink-pressure-model";

describe("studio ink pressure model", () => {
  it("preserves the omitted legacy factor and minimum-radius contract", () => {
    expect(studioInkPressureRadius(10, 0)).toBeCloseTo(1.5, 12);
    expect(studioInkPressureRadius(10, 0.5)).toBeCloseTo(5, 12);
    expect(studioInkPressureRadius(10, 1)).toBeCloseTo(8.5, 12);
    expect(studioInkPressureRadius(0.01, 0)).toBe(0.25);
  });

  it("maps the linear-full model to the selected diameter without minimum coverage", () => {
    const model = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    expect(studioInkPressureRadius(10, 0, model)).toBe(0);
    expect(studioInkPressureRadius(10, 0.5, model)).toBe(2.5);
    expect(studioInkPressureRadius(10, 1, model)).toBe(5);
    expect(studioInkPressureDiameter(10, 0, model)).toBe(0);
    expect(studioInkPressureDiameter(10, 0.5, model)).toBe(5);
    expect(studioInkPressureDiameter(10, 1, model)).toBe(10);
  });

  it("clamps finite pressure and size at the shared renderer boundary", () => {
    const model = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    expect(studioInkPressureRadius(20, -1, model)).toBe(0);
    expect(studioInkPressureRadius(20, 2, model)).toBe(10);
    expect(studioInkPressureRadius(Number.NaN, Number.NaN, model)).toBe(0.5);
    expect(studioInkPressureRadius(Number.POSITIVE_INFINITY, 1, model)).toBe(0.5);
    expect(studioInkPressureRadius(STUDIO_INK_MAX_BRUSH_SIZE * 2, 1, model)).toBe(
      STUDIO_INK_MAX_BRUSH_SIZE / 2
    );
  });

  it("accepts only the exact persisted model identifier", () => {
    expect(isStudioInkPressureModel(STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1)).toBe(true);
    expect(isStudioInkPressureModel(STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2)).toBe(true);
    expect(isStudioInkPressureModel(STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3)).toBe(true);
    expect(isStudioInkPressureModel(undefined)).toBe(false);
    expect(isStudioInkPressureModel("linear-full-v2")).toBe(false);
    expect(isStudioInkPressureModel({ model: "linear-full-v1" })).toBe(false);
  });

  it("keeps residual pressure geometry equal to V1 while versioning placement", () => {
    const v1 = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const v2 = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const v3 = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    for (const pressure of [0, 0.25, 0.5, 1]) {
      expect(studioInkPressureDiameter(16, pressure, v2)).toBe(
        studioInkPressureDiameter(16, pressure, v1)
      );
      expect(studioInkPressureDiameter(16, pressure, v3)).toBe(
        studioInkPressureDiameter(16, pressure, v1)
      );
    }
    expect(studioInkFallbackPressure(v2)).toBe(1);
    expect(studioInkFallbackPressure(v3)).toBe(1);
    expect(studioInkUsesResidualDabSpacing(v1)).toBe(false);
    expect(studioInkUsesResidualDabSpacing(v2)).toBe(true);
    expect(studioInkUsesResidualDabSpacing(v3)).toBe(true);
    expect(studioInkUsesPathResidualDabSpacing(v2)).toBe(false);
    expect(studioInkUsesPathResidualDabSpacing(v3)).toBe(true);
  });

  it("resolves missing samples to legacy half pressure or linear full pressure", () => {
    const model = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    expect(studioInkFallbackPressure()).toBe(0.5);
    expect(studioInkFallbackPressure(model)).toBe(1);
    expect(resolveStudioInkPressure(undefined)).toBe(0.5);
    expect(resolveStudioInkPressure(Number.NaN)).toBe(0.5);
    expect(resolveStudioInkPressure(undefined, model)).toBe(1);
    expect(resolveStudioInkPressure(Number.NaN, model)).toBe(1);
    expect(resolveStudioInkPressure(-2, model)).toBe(0);
    expect(resolveStudioInkPressure(2, model)).toBe(1);
    expect(resolveStudioInkPressureSamples([0], 3, model)).toEqual([0, 1, 1]);
    expect(resolveStudioInkPressureSamples([0], 3)).toEqual([0, 0.5, 0.5]);
  });
});
