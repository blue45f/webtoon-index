import { describe, expect, it } from "vitest";

import {
  buildStudioPerceptualColorRamp,
  convertStudioLinearColor,
  parseStudioColorToLinear,
  studioColorDeltaE2000,
  type StudioLinearColor,
} from "./studio-color-quality-engine";

function expectNear(
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 1e-6,
): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThanOrEqual(
      tolerance,
    );
  }
}

describe("Studio color quality engine", () => {
  it("parses sRGB into scene-linear RGBA and cross-checks Culori", () => {
    const result = parseStudioColorToLinear("#80808080", "linear-srgb");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectNear(result.value.color.components, [
      0.21586050011389923,
      0.21586050011389923,
      0.21586050011389923,
      128 / 255,
    ]);
    expect(result.value.oracleMaxEncodedChannelDelta).toBeLessThan(1e-10);
  });

  it("preserves out-of-sRGB P3 values when mapping is explicitly disabled", () => {
    const result = parseStudioColorToLinear(
      "color(display-p3 0 1 0 / 0.5)",
      "linear-srgb",
      "none",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceInTargetGamut).toBe(false);
    expect(result.value.color.components[0]).toBeLessThan(0);
    expect(result.value.color.components[1]).toBeGreaterThan(1);
    expect(result.value.color.components[3]).toBe(0.5);
  });

  it("applies CSS Color 4 gamut mapping only when requested", () => {
    const mapped = parseStudioColorToLinear(
      "color(display-p3 0 1 0)",
      "linear-srgb",
      "css",
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    for (const component of mapped.value.color.components.slice(0, 3)) {
      expect(component).toBeGreaterThanOrEqual(0);
      expect(component).toBeLessThanOrEqual(1);
    }
    expect(mapped.value.gamutMapping).toBe("css");
  });

  it("round-trips in-gamut colors between linear sRGB and linear P3", () => {
    const source: StudioLinearColor = {
      space: "linear-srgb",
      components: [0.12, 0.43, 0.87, 0.6],
    };
    const p3 = convertStudioLinearColor(source, "linear-display-p3");
    expect(p3.ok).toBe(true);
    if (!p3.ok) return;
    const roundTrip = convertStudioLinearColor(
      p3.value.color,
      "linear-srgb",
    );
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) return;
    expectNear(roundTrip.value.color.components, source.components, 2e-6);
  });

  it("creates deterministic OKLCH ramps with exact endpoint colors", () => {
    const request = {
      stops: ["#ff0000", "color(display-p3 0 1 0)"],
      steps: 9,
      targetSpace: "linear-display-p3" as const,
      gamutMapping: "css" as const,
    };
    const first = buildStudioPerceptualColorRamp(request);
    const second = buildStudioPerceptualColorRamp(request);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value).toHaveLength(9);
    const red = parseStudioColorToLinear(
      "#ff0000",
      "linear-display-p3",
      "css",
    );
    const green = parseStudioColorToLinear(
      "color(display-p3 0 1 0)",
      "linear-display-p3",
      "css",
    );
    expect(red.ok && green.ok).toBe(true);
    if (!red.ok || !green.ok) return;
    expectNear(first.value[0]!.components, red.value.color.components, 2e-6);
    expectNear(
      first.value.at(-1)!.components,
      green.value.color.components,
      2e-6,
    );
    expect(first.value[4]!.components).not.toEqual(first.value[0]!.components);
  });

  it("computes perceptual Delta-E and is symmetric", () => {
    const red = parseStudioColorToLinear("#f00", "linear-srgb");
    const nearRed = parseStudioColorToLinear("#f10", "linear-srgb");
    const blue = parseStudioColorToLinear("#00f", "linear-srgb");
    expect(red.ok && nearRed.ok && blue.ok).toBe(true);
    if (!red.ok || !nearRed.ok || !blue.ok) return;
    const small = studioColorDeltaE2000(red.value.color, nearRed.value.color);
    const large = studioColorDeltaE2000(red.value.color, blue.value.color);
    const reverse = studioColorDeltaE2000(blue.value.color, red.value.color);
    expect(small.ok && large.ok && reverse.ok).toBe(true);
    if (!small.ok || !large.ok || !reverse.ok) return;
    expect(small.value).toBeLessThan(large.value);
    expect(reverse.value).toBeCloseTo(large.value, 12);
  });

  it("fails closed for malformed colors, invalid alpha, and abusive ramp sizes", () => {
    expect(parseStudioColorToLinear("definitely-not-a-color", "linear-srgb").ok)
      .toBe(false);
    expect(
      convertStudioLinearColor(
        {
          space: "linear-srgb",
          components: [0, 0, 0, 2],
        },
        "linear-display-p3",
      ).ok,
    ).toBe(false);
    expect(
      buildStudioPerceptualColorRamp({
        stops: ["#000", "#fff"],
        steps: 10_000,
        targetSpace: "linear-srgb",
      }).ok,
    ).toBe(false);
  });
});
