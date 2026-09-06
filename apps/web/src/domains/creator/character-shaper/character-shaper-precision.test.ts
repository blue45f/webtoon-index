import { describe, expect, it } from "vitest";

import {
  characterRangeSpec, characterStepDigits, clampCharacterValue, finalizeCharacterValue,
  formatCharacterNumber, formatCharacterValue, normalizeCharacterHex, nudgeCharacterValue,
  parseCharacterNumber, previewCharacterEdit, snapCharacterValue,
} from "./character-shaper-precision";

describe("character shaper precision", () => {
  it.each([
    [0.01, 2], [0.001, 3], [1e-7, 7], [2.5e-7, 8], [10, 0], [NaN, 0], [0, 0],
  ])("counts decimal places for %s", (step, expected) => {
    expect(characterStepDigits(step)).toBe(expected);
  });

  it.each([
    ["1.05", 1.05], ["1,05", 1.05], ["１．０５", 1.05], [" −0,5 ", -0.5],
    ["1,234.5", 1234.5], ["1.234,5", 1234.5], ["1,234,567", 1234567],
    ["1.234.567", 1234567], ["1 234,5", 1234.5], ["1_234.5", 1234.5],
    [".5", 0.5], ["-.5", -0.5], ["1.", 1], ["０", 0],
  ])("parses %s without guessing", (raw, expected) => {
    expect(parseCharacterNumber(raw)).toBe(expected);
  });

  it.each(["", " ", "1,2,3", "1..2", "12 34", "1 2", "1,23.4", "1.234,5,6", "--1", "여덟", "NaN", "Infinity", "=1+2", "1e3", ".", ","])(
    "rejects ambiguous or invalid input %s", (raw) => { expect(parseCharacterNumber(raw)).toBeNull(); },
  );

  it("retains visible Alt precision and scientific step sizes", () => {
    expect(formatCharacterNumber(0.001, 0.01)).toBe("0.001");
    expect(formatCharacterNumber(0.3, 0.01)).toBe("0.30");
    expect(formatCharacterNumber(2e-7, 1e-7)).toBe("0.0000002");
    expect(formatCharacterValue(0.001, 0.01, "%")).toBe("0.1%");
    expect(formatCharacterValue(1.001, 0.01, "×")).toBe("1.001×");
    expect(formatCharacterNumber(1e22, 1)).toBe("1e+22");
  });

  it("normalizes non-finite ranges, preserves endpoints and avoids drift", () => {
    expect(characterRangeSpec(NaN, Infinity, 0)).toEqual({ min: 0, max: 0, step: 1 });
    expect(characterRangeSpec(2, 1, NaN)).toEqual({ min: 2, max: 2, step: 1 });
    const spec = characterRangeSpec(0, 1, 0.3);
    expect(snapCharacterValue(1, spec)).toBe(1);
    expect(snapCharacterValue(0.62, spec)).toBe(0.6);
    expect(clampCharacterValue(NaN, spec, 0.5)).toBe(0.5);
    expect(finalizeCharacterValue(0.1 + 0.2, spec)).toBe(0.3);
    expect(nudgeCharacterValue(0, 1, { min: -1, max: 1, step: 0.01 }, { altKey: true })).toBe(0.001);
  });

  it("keeps every finite sample within its declared limits", () => {
    const spec = characterRangeSpec(-1.7, 2.3, 0.007);
    for (let index = -2000; index <= 2000; index += 1) {
      const sample = index * 0.017;
      for (const value of [clampCharacterValue(sample, spec), snapCharacterValue(sample, spec), nudgeCharacterValue(sample, 1, spec)]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(spec.min);
        expect(value).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it("keeps the initial snapshot when controlled previews update the live value", () => {
    const first = previewCharacterEdit(null, 0.2, 0.5);
    expect(previewCharacterEdit(first, 0.5, 0.8)).toEqual({ before: 0.2, value: 0.8 });
    const originalColor = previewCharacterEdit<string | null>(null, null, "#123456");
    expect(previewCharacterEdit(originalColor, "#123456", "#abcdef").before).toBeNull();
  });

  it.each([["abc", "#aabbcc"], [" #ABC ", "#aabbcc"], ["Ａ１６２０７", "#a16207"], ["#abcdef", "#abcdef"]])(
    "normalizes colour %s", (raw, expected) => { expect(normalizeCharacterHex(raw)).toBe(expected); },
  );
  it.each(["", "#ab", "red", "#aabbccdd", "url(x)", "#gggggg"])("rejects invalid colour %s", (raw) => {
    expect(normalizeCharacterHex(raw)).toBeNull();
  });
});
