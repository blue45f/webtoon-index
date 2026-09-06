import { describe, expect, it } from "vitest";

import {
  parseStudioGuidePercent,
  STUDIO_GUIDE_PERCENT_PRESETS,
  studioGuidePercentToPx,
} from "./studio-guide-percent";

describe("studio guide percent", () => {
  it("exposes the commercial-editor percentage presets", () => {
    expect(STUDIO_GUIDE_PERCENT_PRESETS).toEqual([25, 33.3, 50, 66.7, 75]);
  });

  it.each([
    ["25", 25],
    [" 33,3 % ", 33.3],
    ["\u00a050\u202f%", 50],
    [".5", 0.5],
    ["+75", 75],
  ] as const)("parses locale-friendly percentage %p", (input, expected) => {
    expect(parseStudioGuidePercent(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "NaN",
    "Infinity",
    "-Infinity",
    "0",
    "0%",
    "-1",
    "100",
    "100%",
    "101",
    "33,3.4",
    "1,234.5",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    100,
  ])("rejects invalid or boundary percentage %p", (input) => {
    expect(parseStudioGuidePercent(input)).toBeNull();
  });

  it("converts vertical guides with width and horizontal guides with height", () => {
    expect(studioGuidePercentToPx(25, 720)).toBe(180);
    expect(studioGuidePercentToPx("33,3", 12_000)).toBeCloseTo(3_996);
    expect(studioGuidePercentToPx(66.7, 12_000)).toBeCloseTo(8_004);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid canvas dimension %p",
    (dimension) => {
      expect(studioGuidePercentToPx(50, dimension)).toBeNull();
    },
  );
});
