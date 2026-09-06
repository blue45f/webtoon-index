import { describe, expect, it } from "vitest";

import { studioBrushDynamicsSettingsForBrushId } from "./studio-brush-dynamics";
import { materializeStudioBrushPackSelection } from "./studio-brush-pack-runtime";
import {
  analyzeStudioBrushPressureCurveSamples,
  profileStudioBrushPressureCurve,
  STUDIO_BRUSH_PRESSURE_MIN_DISTINCT_STATES,
  STUDIO_BRUSH_PRESSURE_PROBE_LEVELS,
  type StudioBrushPressureCurveSample,
} from "./studio-brush-pressure-curve-quality";

function profile(id: string) {
  const packSelection = materializeStudioBrushPackSelection(id);
  const settings = packSelection?.brushDynamics
    ?? studioBrushDynamicsSettingsForBrushId(id);
  if (!settings) throw new Error(`${id}: missing dynamic settings fixture`);
  return profileStudioBrushPressureCurve({
    catalogId: id,
    runtimeBrushId: id,
    defaultWidth: packSelection?.defaultWidth ?? (id === "airbrush" ? 48 : 18),
    defaultOpacity: packSelection?.defaultOpacity ?? (id === "airbrush" ? 0.5 : 0.8),
    settings,
    seed: 73,
  });
}

function syntheticSample(
  pressure: number,
  response: number,
): StudioBrushPressureCurveSample {
  return {
    pressure,
    dabCount: 16,
    meanSizeRatio: response,
    meanOpacity: response,
    meanFlow: response,
    meanDeposit: response * response,
    meanSpacingRatio: 0.2,
    meanScatterRatio: 0,
    meanScatterOffsetRatio: 0,
    meanRoundness: 1,
    meanAngleCos: 1,
    meanAngleSin: 0,
  };
}

describe("Studio dynamic brush pressure curve quality", () => {
  it("samples the complete stylus range through the real deterministic planner", () => {
    const result = profile("airbrush");
    expect(result.samples.map(({ pressure }) => pressure)).toEqual(
      STUDIO_BRUSH_PRESSURE_PROBE_LEVELS,
    );
    expect(result.samples.every((sample) => (
      Object.values(sample).every(Number.isFinite)
    ))).toBe(true);
    expect(result.analysis).toMatchObject({
      responsive: true,
      coarseResponse: false,
      abruptResponse: false,
    });
    expect(result.analysis.distinctStateCount).toBeGreaterThanOrEqual(
      STUDIO_BRUSH_PRESSURE_MIN_DISTINCT_STATES,
    );
    expect(result.analysis.pathDistance).toBeGreaterThan(0);
    expect(result.analysis.continuityScore).toBeGreaterThan(0);
  });

  it("is deterministic for the same settings, seed and authored defaults", () => {
    expect(profile("dry-media")).toEqual(profile("dry-media"));
  });

  it("proves an intentionally fixed-pressure dynamic preset remains fixed", () => {
    const result = profile("web-pressure-flat");
    expect(result.analysis).toMatchObject({
      responsive: false,
      distinctStateCount: 1,
      coarseResponse: false,
      abruptResponse: false,
      pathDistance: 0,
      endpointDistance: 0,
      maxStepShare: 0,
      continuityScore: 1,
    });
  });

  it("classifies binary switch behavior as both coarse and abrupt", () => {
    const levels = STUDIO_BRUSH_PRESSURE_PROBE_LEVELS;
    const samples = levels.map((pressure, index) => syntheticSample(
      pressure,
      index === levels.length - 1 ? 1 : 0,
    ));
    const result = analyzeStudioBrushPressureCurveSamples(samples);
    expect(result).toMatchObject({
      responsive: true,
      distinctStateCount: 2,
      coarseResponse: true,
      abruptResponse: true,
      maxStepShare: 1,
      continuityScore: 0,
    });
  });

  it("rewards a continuous full-range response", () => {
    const samples = STUDIO_BRUSH_PRESSURE_PROBE_LEVELS.map((pressure) => (
      syntheticSample(pressure, pressure)
    ));
    const result = analyzeStudioBrushPressureCurveSamples(samples);
    expect(result).toMatchObject({
      responsive: true,
      coarseResponse: false,
      abruptResponse: false,
    });
    expect(result.distinctStateCount).toBe(STUDIO_BRUSH_PRESSURE_PROBE_LEVELS.length);
    expect(result.maxStepShare).toBeLessThan(0.25);
    expect(result.continuityScore).toBeGreaterThan(0.8);
  });
});
