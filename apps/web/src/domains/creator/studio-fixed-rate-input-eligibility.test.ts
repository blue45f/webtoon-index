import { describe, expect, it } from "vitest";

import {
  isStudioCausalInkInputEligible,
  isStudioFixedRateInputEligible,
  resolveStudioCausalInkInputPlan,
  type StudioFixedRateInputEligibility,
} from "./studio-fixed-rate-input-eligibility";

const STANDARD_PEN: StudioFixedRateInputEligibility = {
  stabilizerMode: "standard",
  stabilizerStrength: 0,
  drawMode: "pen",
  brushFamily: "pen",
};
const FILTERED_PEN: StudioFixedRateInputEligibility = {
  ...STANDARD_PEN,
  stabilizerStrength: 3.4,
};

describe("studio fixed-rate input eligibility", () => {
  it.each([
    {
      name: "ordinary marker with a filtered stabilizer strength",
      input: { ...FILTERED_PEN, brushFamily: "marker" },
    },
    {
      name: "causal G-pen with a filtered stabilizer strength",
      input: { ...FILTERED_PEN, brushFamily: "gpen" },
    },
    {
      name: "causal watercolor v2",
      input: {
        ...FILTERED_PEN,
        brushFamily: "watercolor",
        causalWatercolorV2: true,
      },
    },
    {
      name: "causal stamp v2 from a specialty family",
      input: {
        ...FILTERED_PEN,
        brushFamily: "airbrush",
        causalStampV2: true,
      },
    },
    {
      name: "eraser",
      input: {
        ...FILTERED_PEN,
        drawMode: "eraser",
        brushFamily: "other",
      },
    },
  ])("accepts $name", ({ input }) => {
    expect(isStudioFixedRateInputEligible(input)).toBe(true);
    expect(resolveStudioCausalInkInputPlan(input)).toEqual({
      mode: "fixed-rate",
      sampleSpacing: 0,
      usesFixedRateClock: true,
      quantizeImmediately: false,
    });
  });

  it.each([
    { name: "zero", stabilizerStrength: 0 },
    { name: "negative", stabilizerStrength: -1 },
    { name: "missing", stabilizerStrength: undefined },
    { name: "NaN", stabilizerStrength: Number.NaN },
    { name: "infinite", stabilizerStrength: Number.POSITIVE_INFINITY },
  ])("bypasses the fixed-rate clock for $name strength", ({ stabilizerStrength }) => {
    const input = { ...STANDARD_PEN, stabilizerStrength };
    expect(isStudioCausalInkInputEligible(input)).toBe(true);
    expect(isStudioFixedRateInputEligible(input)).toBe(false);
    expect(resolveStudioCausalInkInputPlan(input).mode).toBe("immediate");
  });

  it.each([
    { name: "pen", input: STANDARD_PEN },
    { name: "marker", input: { ...STANDARD_PEN, brushFamily: "marker" } },
    { name: "G-pen", input: { ...STANDARD_PEN, brushFamily: "gpen" } },
    {
      name: "eraser",
      input: { ...STANDARD_PEN, drawMode: "eraser", brushFamily: "other" },
    },
    {
      name: "causal stamp v2",
      input: { ...STANDARD_PEN, brushFamily: "airbrush", causalStampV2: true },
    },
    {
      name: "causal watercolor v2",
      input: {
        ...STANDARD_PEN,
        brushFamily: "watercolor",
        causalWatercolorV2: true,
      },
    },
  ])("routes zero-strength $name through immediate causal input", ({ input }) => {
    expect(resolveStudioCausalInkInputPlan(input)).toEqual({
      mode: "immediate",
      sampleSpacing: 0,
      usesFixedRateClock: false,
      quantizeImmediately: true,
    });
  });

  it("treats the smallest finite positive strength as fixed-rate", () => {
    expect(resolveStudioCausalInkInputPlan({
      ...STANDARD_PEN,
      stabilizerStrength: 0.001,
    }).mode).toBe("fixed-rate");
  });

  it.each([
    {
      name: "adaptive pen",
      input: { ...FILTERED_PEN, stabilizerMode: "adaptive" },
    },
    {
      name: "precision pen",
      input: { ...FILTERED_PEN, stabilizerMode: "precision" },
    },
    {
      name: "shape",
      input: { ...FILTERED_PEN, drawMode: "shape" },
    },
    {
      name: "pixel pencil",
      input: { ...FILTERED_PEN, drawMode: "pixel" },
    },
    {
      name: "lasso fill",
      input: { ...FILTERED_PEN, drawMode: "lasso-fill" },
    },
    {
      name: "whole-stroke dynamics pen",
      input: { ...FILTERED_PEN, hasBrushDynamics: true },
    },
    {
      name: "dynamics eraser fails closed too",
      input: {
        ...FILTERED_PEN,
        drawMode: "eraser",
        hasBrushDynamics: true,
      },
    },
    {
      name: "legacy watercolor",
      input: { ...FILTERED_PEN, brushFamily: "watercolor" },
    },
    {
      name: "unversioned specialty stamp",
      input: { ...FILTERED_PEN, brushFamily: "airbrush" },
    },
    {
      name: "causal watercolor flag on the wrong family",
      input: {
        ...FILTERED_PEN,
        brushFamily: "oil",
        causalWatercolorV2: true,
      },
    },
    {
      name: "unknown stabilizer mode",
      input: { ...FILTERED_PEN, stabilizerMode: "future-mode" },
    },
    {
      name: "unknown draw mode",
      input: { ...FILTERED_PEN, drawMode: "future-tool" },
    },
  ])("rejects $name", ({ input }) => {
    expect(isStudioFixedRateInputEligible(input)).toBe(false);
    expect(resolveStudioCausalInkInputPlan(input)).toEqual({
      mode: "legacy",
      sampleSpacing: null,
      usesFixedRateClock: false,
      quantizeImmediately: false,
    });
  });

  it("lets dynamics exclusion override every causal capability flag", () => {
    expect(isStudioFixedRateInputEligible({
      ...FILTERED_PEN,
      brushFamily: "watercolor",
      causalStampV2: true,
      causalWatercolorV2: true,
      hasBrushDynamics: true,
    })).toBe(false);
  });

  it("keeps causal capability independent from positive stabilizer strength", () => {
    expect(isStudioCausalInkInputEligible(STANDARD_PEN)).toBe(true);
    expect(isStudioCausalInkInputEligible({
      ...STANDARD_PEN,
      brushFamily: "watercolor",
      causalWatercolorV2: true,
    })).toBe(true);
    expect(isStudioCausalInkInputEligible({
      ...STANDARD_PEN,
      stabilizerMode: "adaptive",
    })).toBe(false);
  });
});
