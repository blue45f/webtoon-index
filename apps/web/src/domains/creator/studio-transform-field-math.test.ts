import { describe, expect, it } from "vitest";

import {
  formatStudioTransformFieldValue,
  resolveStudioTransformFieldDraft,
  stepStudioTransformFieldValue,
} from "./studio-transform-field-math";

describe("studio transform field math", () => {
  it("accepts units, relative assignments, one safe expression, and relative percentages", () => {
    expect(resolveStudioTransformFieldDraft("120px", 40)).toBe(120);
    expect(resolveStudioTransformFieldDraft("+= 10", 40)).toBe(50);
    expect(resolveStudioTransformFieldDraft("*=1.5", 40)).toBe(60);
    expect(resolveStudioTransformFieldDraft("100 / 4", 40)).toBe(25);
    expect(resolveStudioTransformFieldDraft("150%", 40)).toBe(60);
  });

  it("treats percentages as displayed absolute values for opacity", () => {
    expect(
      resolveStudioTransformFieldDraft("60%", 25, { min: 0, max: 100, percentMode: "absolute" }),
    ).toBe(60);
  });

  it("rejects code, empty drafts, division by zero, and non-finite output", () => {
    expect(resolveStudioTransformFieldDraft("", 10)).toBeNull();
    expect(resolveStudioTransformFieldDraft("window.alert(1)", 10)).toBeNull();
    expect(resolveStudioTransformFieldDraft("10 / 0", 10)).toBeNull();
    expect(resolveStudioTransformFieldDraft("*=1e999", 10)).toBeNull();
  });

  it("clamps before publishing and removes negative zero", () => {
    expect(resolveStudioTransformFieldDraft("-10", 50, { min: 1 })).toBe(1);
    expect(resolveStudioTransformFieldDraft("140", 50, { max: 100 })).toBe(100);
    expect(formatStudioTransformFieldValue(-0)).toBe("0");
  });

  it("uses Shift for coarse and Alt for fine arrow drafts", () => {
    expect(stepStudioTransformFieldValue({ current: 20, direction: 1, step: 1 })).toBe(21);
    expect(
      stepStudioTransformFieldValue({
        current: 20,
        direction: 1,
        step: 1,
        coarseStep: 15,
        shiftKey: true,
      }),
    ).toBe(35);
    expect(
      stepStudioTransformFieldValue({
        current: 20,
        direction: -1,
        step: 1,
        fineStep: 0.1,
        altKey: true,
      }),
    ).toBe(19.9);
  });

  it("continues from the current local draft and remains bounded", () => {
    expect(
      stepStudioTransformFieldValue({
        current: 20,
        draft: "30",
        direction: 1,
        shiftKey: true,
        min: 0,
        max: 35,
      }),
    ).toBe(35);
  });
});
