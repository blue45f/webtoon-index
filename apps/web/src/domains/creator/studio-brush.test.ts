import { describe, expect, it } from "vitest";

import {
  BRUSH_PRESETS,
  BRUSH_PRESSURE_CURVE_PRESETS,
  STABILIZER_MAX,
  STUDIO_BRUSH_OPACITY_CHIPS,
  STUDIO_BRUSH_SIZE_CHIPS,
  buildCalligraphySegments,
  createStudioIncrementalCalligraphySegmentBuilder,
  gpenSegmentWidths,
  nearestStudioBrushOpacityChip,
  nearestStudioBrushSizeChip,
  normalizeCalligraphyStylusInput,
  polylineLength,
  processFreehandPoints,
  processPencilPoints,
  pressureCurvePresetId,
  pressureCurveValueForPreset,
  studioBrushPressureWithMinSize,
  resampleStrokePressures,
  resolveBrushPressureSample,
  resolveBrushReleasePressureSample,
  resolveStudioFreehandRenderPath,
  resolveStudioBrushRenderFamily,
  resolveStudioBrushPresetDrawMode,
  resolveStudioBrushPresetOperation,
  sanitizeCalligraphyTipSettings,
  screentoneDotRadius,
  screentoneDotsForStroke,
  shouldAppendStrokePoint,
  smoothStrokePoints,
  stabilizePoint,
  strokeRenderDistance,
  strokeSampleDistanceForBrushFamily,
  strokeSampleDistanceForScale,
} from "./studio-brush";
import { STUDIO_PIXEL_PENCIL_RENDER_MODE } from "./studio-pixel-pencil";

describe("BRUSH_PRESETS", () => {
  it("includes G-pen, tilt calligraphy, watercolor and commercial Canva/Express/Picsart aliases", () => {
    const ids = BRUSH_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of [
      "pen",
      "fineliner",
      "ballpoint",
      "gpen",
      "liner",
      "calligraphy",
      "marker",
      "felt-tip",
      "standard-eraser",
      "kneaded-eraser",
      "marker-bold",
      "highlighter",
      "neon",
      "glow",
      "soft-glow",
      "glitter",
      "star-dust",
      "brush",
      "watercolor",
      "ink-wash",
      "oil",
      "pastel",
      "ink-particle",
      "airbrush",
      "soft-brush",
      "spray",
      "dry-media",
      "crayon",
      "chalk",
      "charcoal",
      "pencil",
      "soft-pencil",
      "screentone",
    ]) {
      expect(ids).toContain(required);
    }
    expect(BRUSH_PRESETS.find((preset) => preset.id === "calligraphy")).toMatchObject({
      name: "캘리그래피(펜 기울기)",
      defaultWidth: 12,
      defaultOpacity: 1,
    });
    expect(BRUSH_PRESETS.find((preset) => preset.id === "watercolor")).toMatchObject({
      name: "수채 번짐",
      defaultWidth: 28,
      defaultOpacity: 0.55,
    });
    expect(BRUSH_PRESETS.find((preset) => preset.id === "airbrush")).toMatchObject({
      name: "소프트 에어브러시",
      defaultWidth: 32,
      defaultOpacity: 0.7,
    });
    expect(BRUSH_PRESETS.find((preset) => preset.id === "neon")).toMatchObject({
      defaultColor: "#39ff14",
    });
    expect(BRUSH_PRESETS.find((preset) => preset.id === "glow")).toMatchObject({
      defaultColor: "#ff4fd8",
    });
  });

  it("defines sane defaults for every preset", () => {
    for (const preset of BRUSH_PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.defaultWidth).toBeGreaterThan(0);
      expect(preset.defaultOpacity).toBeGreaterThan(0);
      expect(preset.defaultOpacity).toBeLessThanOrEqual(1);
      expect(["paint", "erase"]).toContain(preset.operation);
    }
  });

  it("models standard and kneaded erasers as explicit erase presets", () => {
    expect(BRUSH_PRESETS.find((preset) => preset.id === "standard-eraser")).toMatchObject({
      name: "일반 지우개",
      defaultWidth: 20,
      defaultOpacity: 1,
      operation: "erase",
    });
    expect(BRUSH_PRESETS.find((preset) => preset.id === "kneaded-eraser")).toMatchObject({
      defaultOpacity: 0.38,
      operation: "erase",
    });
    expect(resolveStudioBrushPresetOperation("standard-eraser")).toBe("erase");
    expect(resolveStudioBrushPresetOperation("kneaded-eraser")).toBe("erase");
    expect(resolveStudioBrushPresetOperation("pen")).toBe("paint");
    expect(resolveStudioBrushPresetOperation("legacy-unknown")).toBe("paint");
    expect(resolveStudioBrushPresetDrawMode("standard-eraser")).toBe("eraser");
    expect(resolveStudioBrushPresetDrawMode("pen")).toBe("pen");
  });

  it("maps commercial aliases onto stable render families", () => {
    expect(resolveStudioBrushRenderFamily("fineliner")).toBe("pen");
    expect(resolveStudioBrushRenderFamily("spray")).toBe("airbrush");
    expect(resolveStudioBrushRenderFamily("soft-brush")).toBe("airbrush");
    expect(resolveStudioBrushRenderFamily("crayon")).toBe("dry-media");
    expect(resolveStudioBrushRenderFamily("charcoal")).toBe("dry-media");
    expect(resolveStudioBrushRenderFamily("neon")).toBe("neon");
    expect(resolveStudioBrushRenderFamily("glow")).toBe("glow");
    expect(resolveStudioBrushRenderFamily("soft-glow")).toBe("glow");
    expect(resolveStudioBrushRenderFamily("glitter")).toBe("glitter");
    expect(resolveStudioBrushRenderFamily("star-dust")).toBe("glitter");
    expect(resolveStudioBrushRenderFamily("oil")).toBe("oil");
    expect(resolveStudioBrushRenderFamily("pastel")).toBe("pastel");
    expect(resolveStudioBrushRenderFamily("ink-wash")).toBe("watercolor");
    expect(resolveStudioBrushRenderFamily(STUDIO_PIXEL_PENCIL_RENDER_MODE)).toBe("pixel");
    expect(resolveStudioBrushRenderFamily("unknown-tool")).toBe("pen");
  });

  it("exposes Canva-style size chips and nearest selection", () => {
    expect(STUDIO_BRUSH_SIZE_CHIPS.map((c) => c.id)).toEqual(["xs", "s", "m", "l", "xl", "xxl"]);
    expect(nearestStudioBrushSizeChip(7)).toBe("s");
    expect(nearestStudioBrushSizeChip(40)).toBe("xl");
    expect(nearestStudioBrushSizeChip(64)).toBe("xxl");
  });

  it("exposes PicsArt-style opacity chips", () => {
    expect(STUDIO_BRUSH_OPACITY_CHIPS.map((c) => c.opacity)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
    expect(nearestStudioBrushOpacityChip(0.58)).toBe("o60");
    expect(nearestStudioBrushOpacityChip(1)).toBe("o100");
  });
});

describe("캘리그래피 스타일러스 정규화", () => {
  it("clamps pen tilt/twist to finite PointerEvent ranges", () => {
    expect(
      normalizeCalligraphyStylusInput({ pointerType: "PEN", tiltX: 120, tiltY: -140, twist: 720 })
    ).toEqual({
      pointerType: "pen",
      tiltX: 90,
      tiltY: -90,
      twist: 359,
      hasTilt: true,
    });
    expect(normalizeCalligraphyStylusInput({ pointerType: "pen", tiltX: Number.NaN, twist: Infinity })).toEqual({
      pointerType: "pen",
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      hasTilt: false,
    });
  });

  it("preserves valid hardware tilt and twist", () => {
    expect(normalizeCalligraphyStylusInput({ pointerType: "pen", tiltX: 30, tiltY: 40, twist: 123 })).toEqual({
      pointerType: "pen",
      tiltX: 30,
      tiltY: 40,
      twist: 123,
      hasTilt: true,
    });
  });

  it("uses a safe no-tilt fallback for mouse, touch and unsupported input", () => {
    const fallback = { tiltX: 0, tiltY: 0, twist: 0, hasTilt: false };
    expect(normalizeCalligraphyStylusInput({ pointerType: "mouse", tiltX: 50, tiltY: 20, twist: 90 })).toEqual({
      pointerType: "mouse",
      ...fallback,
    });
    expect(normalizeCalligraphyStylusInput({ pointerType: "touch", tiltX: -20 })).toEqual({
      pointerType: "touch",
      ...fallback,
    });
    expect(normalizeCalligraphyStylusInput(undefined)).toEqual({ pointerType: "unknown", ...fallback });
  });

  it("sanitizes manual tip fallback settings", () => {
    expect(sanitizeCalligraphyTipSettings({ tiltEnabled: false, angleDeg: -45, roundness: 5 })).toEqual({
      tiltEnabled: false,
      angleDeg: 315,
      roundness: 1,
    });
    const malformed = sanitizeCalligraphyTipSettings({ angleDeg: Number.NaN, roundness: Number.NaN });
    expect(malformed).toEqual({ tiltEnabled: true, angleDeg: 45, roundness: 0.32 });
  });
});

describe("resolveBrushPressureSample", () => {
  it("maps user-facing pressure presets to mathematically correct exponents", () => {
    expect(BRUSH_PRESSURE_CURVE_PRESETS.map((preset) => preset.id)).toEqual(["soft", "linear", "firm"]);
    expect(pressureCurveValueForPreset("soft")).toBe(0.65);
    expect(pressureCurveValueForPreset("linear")).toBe(1);
    expect(pressureCurveValueForPreset("firm")).toBe(1.8);
    expect(pressureCurveValueForPreset("unknown")).toBe(1);
    expect(pressureCurvePresetId(0.64)).toBe("soft");
    expect(pressureCurvePresetId(1.02)).toBe("linear");
    expect(pressureCurvePresetId(1.81)).toBe("firm");
    expect(pressureCurvePresetId(Number.NaN)).toBe("linear");
  });

  it.each([0.2, 0.5, 0.9])("prioritizes valid pen hardware pressure %s over velocity fallback", (pressure) => {
    expect(
      resolveBrushPressureSample({
        pointerType: "pen",
        rawPressure: pressure,
        distance: 28,
        velocityFallbackEnabled: true,
        velocitySensitivity: 1,
        pressureCurve: 1,
      })
    ).toBeCloseTo(pressure, 10);
  });

  it("uses touch hardware pressure instead of mouse-style fallback pressure", () => {
    expect(resolveBrushPressureSample({
      pointerType: "touch",
      rawPressure: 0.4,
      velocityFallbackEnabled: true,
      velocitySensitivity: 1,
      pressureCurve: 2,
      fallbackPressure: 1,
    })).toBeCloseTo(0.16, 10);
  });

  it("does not mistake the conventional mouse 0.5 for hardware pressure", () => {
    expect(
      resolveBrushPressureSample({
        pointerType: "mouse",
        rawPressure: 0.5,
        distance: 28,
        velocityFallbackEnabled: true,
        velocitySensitivity: 1,
        pressureCurve: 1,
      })
    ).toBeCloseTo(0.25, 10);
  });

  it("does not mistake the conventional touch 0.5 (no force sensor) for hardware pressure", () => {
    // A non-force-sensing touchscreen reports pressure=0.5 while in contact, same as a mouse.
    // The pressure curve must not apply to it (fallback path returns the flat fallback untouched).
    expect(
      resolveBrushPressureSample({
        pointerType: "touch",
        rawPressure: 0.5,
        fallbackPressure: 1,
        pressureCurve: 1.8,
      })
    ).toBe(1);
  });

  it("uses the configured initial fallback instead of treating zero travel as maximum pressure", () => {
    expect(resolveBrushPressureSample({
      pointerType: "mouse",
      rawPressure: 0.5,
      distance: 0,
      velocityFallbackEnabled: false,
      fallbackPressure: 0.8,
      pressureCurve: 1,
    })).toBe(0.8);
  });

  it("falls back safely for NaN/out-of-range pressure and clamps the result", () => {
    const invalidSamples = [Number.NaN, Infinity, -0.1, 1.1];
    for (const rawPressure of invalidSamples) {
      const result = resolveBrushPressureSample({
        pointerType: "pen",
        rawPressure,
        distance: 14,
        velocityFallbackEnabled: true,
        velocitySensitivity: 0.8,
      });
      expect(result).toBeCloseTo(0.7, 10);
      expect(Number.isFinite(result)).toBe(true);
    }
    expect(resolveBrushPressureSample({ pointerType: "touch", fallbackPressure: 9 })).toBe(1);
  });

  it("applies the pressure curve to real pen pressure but not a fixed mouse/touch fallback", () => {
    expect(resolveBrushPressureSample({ pointerType: "pen", rawPressure: 0.5, pressureCurve: 2 })).toBeCloseTo(0.25, 10);
    expect(resolveBrushPressureSample({ pointerType: "mouse", fallbackPressure: 0.5, pressureCurve: 0.5 })).toBe(0.5);
    expect(resolveBrushPressureSample({
      pointerType: "touch",
      rawPressure: Number.NaN,
      fallbackPressure: 0.25,
      pressureCurve: 8,
    })).toBe(0.25);
    expect(resolveBrushPressureSample({
      pointerType: "pen",
      rawPressure: Number.NaN,
      fallbackPressure: 0.4,
      pressureCurve: 2,
    })).toBe(0.4);
  });

  it("applies the pressure curve to explicitly enabled velocity pressure", () => {
    expect(resolveBrushPressureSample({
      pointerType: "mouse",
      distance: 28,
      velocityFallbackEnabled: true,
      velocitySensitivity: 1,
      pressureCurve: 2,
    })).toBeCloseTo(0.25 ** 2, 10);
  });

  it("uses real px/ms speed when elapsed time is available", () => {
    const eightMs = resolveBrushPressureSample({
      pointerType: "mouse",
      distance: 12,
      elapsedMs: 8,
      velocityFallbackEnabled: true,
      velocitySensitivity: 1,
      pressureCurve: 1,
    });
    const sixteenMs = resolveBrushPressureSample({
      pointerType: "mouse",
      distance: 24,
      elapsedMs: 16,
      velocityFallbackEnabled: true,
      velocitySensitivity: 1,
      pressureCurve: 1,
    });
    expect(eightMs).toBeCloseTo(sixteenMs, 10);
    expect(eightMs).toBeLessThan(1);
  });

  it("keeps the distance fallback for old callers without timestamps", () => {
    expect(resolveBrushPressureSample({
      pointerType: "mouse",
      distance: 14,
      maxDistance: 28,
      velocityFallbackEnabled: true,
      velocitySensitivity: 1,
      pressureCurve: 1,
    })).toBeCloseTo(0.625, 10);
  });
});

describe("studioBrushPressureWithMinSize (CSP Size Min)", () => {
  it("maps pressure through min + (1-min)*p and clamps invalid ratios to Magma zero floor", () => {
    expect(studioBrushPressureWithMinSize(0, 0.2)).toBeCloseTo(0.2, 10);
    expect(studioBrushPressureWithMinSize(1, 0.2)).toBeCloseTo(1, 10);
    expect(studioBrushPressureWithMinSize(0.5, 0.2)).toBeCloseTo(0.6, 10);
    expect(studioBrushPressureWithMinSize(0, 0)).toBe(0);
    expect(studioBrushPressureWithMinSize(0.4, Number.NaN)).toBeCloseTo(0.4, 10);
    expect(studioBrushPressureWithMinSize(0.4, -1)).toBeCloseTo(0.4, 10);
    expect(studioBrushPressureWithMinSize(0.4, 2)).toBeCloseTo(1, 10);
  });

  it("applies min size after the pressure curve on pen hardware samples only", () => {
    // curve=2, p=0.5 → 0.25; min=0.2 → 0.2 + 0.8*0.25 = 0.4
    expect(
      resolveBrushPressureSample({
        pointerType: "pen",
        rawPressure: 0.5,
        pressureCurve: 2,
        minSizeRatio: 0.2,
      })
    ).toBeCloseTo(0.4, 10);
    // Mouse fixed fallback must stay nominal (no min applied).
    expect(
      resolveBrushPressureSample({
        pointerType: "mouse",
        fallbackPressure: 0.5,
        pressureCurve: 2,
        minSizeRatio: 0.2,
      })
    ).toBe(0.5);
  });
});

describe("resolveBrushReleasePressureSample", () => {
  it("reuses the last curved contact pressure for a pen pointerup that reports non-contact zero", () => {
    expect(resolveBrushReleasePressureSample({
      pointerType: "pen",
      rawPressure: 0,
      lastContactPressure: 0.6,
      pressureCurve: 2,
      fallbackPressure: 0.5,
    })).toBe(0.6);
  });

  it("does not change the ordinary in-contact zero-pressure contract", () => {
    expect(resolveBrushPressureSample({
      pointerType: "pen",
      rawPressure: 0,
      pressureCurve: 2,
    })).toBe(0);
  });

  it("still resolves a usable non-zero pen release sample through the configured curve", () => {
    expect(resolveBrushReleasePressureSample({
      pointerType: "pen",
      rawPressure: 0.7,
      lastContactPressure: 0.2,
      pressureCurve: 2,
    })).toBeCloseTo(0.49, 10);
  });

  it("sanitizes a malformed last contact value and leaves non-pen fallback behavior unchanged", () => {
    expect(resolveBrushReleasePressureSample({
      pointerType: "pen",
      rawPressure: 0,
      lastContactPressure: Number.NaN,
      fallbackPressure: 0.4,
    })).toBe(0.4);
    expect(resolveBrushReleasePressureSample({
      pointerType: "mouse",
      rawPressure: 0,
      lastContactPressure: 0.9,
      fallbackPressure: 0.5,
    })).toBe(0.5);
  });
});

describe("resampleStrokePressures", () => {
  it("linearly resamples monotonically while preserving endpoints", () => {
    const result = resampleStrokePressures([0.1, 0.5, 0.9], 5);
    expect(result).toHaveLength(5);
    for (const [index, expected] of [0.1, 0.3, 0.5, 0.7, 0.9].entries()) {
      expect(result[index]).toBeCloseTo(expected, 10);
    }
    expect(result[0]).toBe(0.1);
    expect(result.at(-1)).toBe(0.9);
    for (let i = 1; i < result.length; i++) expect(result[i]!).toBeGreaterThanOrEqual(result[i - 1]!);
  });

  it("returns exactly the requested length and sanitizes malformed values", () => {
    expect(resampleStrokePressures([Number.NaN, 2, -1, Infinity], 4, 0.4)).toEqual([0.4, 1, 0, 0.4]);
    expect(resampleStrokePressures([], 3, Number.NaN)).toEqual([0.5, 0.5, 0.5]);
    expect(resampleStrokePressures([0.25], 3)).toEqual([0.25, 0.25, 0.25]);
    expect(resampleStrokePressures([0.2, 0.8], 0)).toEqual([]);
    expect(resampleStrokePressures([0.2, 0.8], Number.NaN)).toEqual([]);
  });
});

describe("buildCalligraphySegments", () => {
  const manualTip = { tiltEnabled: false, angleDeg: 0, roundness: 0.2 };

  it("projects an elliptical nib against travel direction", () => {
    const horizontal = buildCalligraphySegments([0, 0, 100, 0], [0.5, 0.5], [], 10, manualTip)[0]!;
    const vertical = buildCalligraphySegments([0, 0, 0, 100], [0.5, 0.5], [], 10, manualTip)[0]!;
    expect(vertical.width).toBeGreaterThan(horizontal.width * 4);
    expect(horizontal.tipAngleRad).toBe(0);
    expect(horizontal.roundness).toBe(0.2);
  });

  it("makes higher pressure thicker on the same route", () => {
    const low = buildCalligraphySegments([0, 0, 0, 100], [0.1], [], 10, manualTip)[0]!;
    const high = buildCalligraphySegments([0, 0, 0, 100], [0.9], [], 10, manualTip)[0]!;
    expect(high.width).toBeGreaterThan(low.width);
  });

  it("uses hardware tilt direction, magnitude and twist when enabled", () => {
    const fallback = buildCalligraphySegments(
      [0, 0, 100, 0],
      [0.5],
      [],
      10,
      { tiltEnabled: true, angleDeg: 45, roundness: 0.8 }
    )[0]!;
    const hardware = buildCalligraphySegments(
      [0, 0, 100, 0],
      [0.5],
      [{ pointerType: "pen", tiltX: 45, tiltY: 0, twist: 90 }],
      10,
      { tiltEnabled: true, angleDeg: 45, roundness: 0.8 }
    )[0]!;
    expect(hardware.tipAngleRad).toBeCloseTo(Math.PI / 2, 10);
    expect(hardware.roundness).toBeLessThan(fallback.roundness);
    expect(hardware.width).not.toBeCloseTo(fallback.width, 5);
  });

  it("uses barrel twist even when a vertical pen reports zero tilt", () => {
    const segment = buildCalligraphySegments(
      [0, 0, 100, 0],
      [0.5],
      [{ pointerType: "pen", tiltX: 0, tiltY: 0, twist: 90 }],
      10,
      { tiltEnabled: true, angleDeg: 0, roundness: 0.2 }
    )[0]!;
    expect(segment.tipAngleRad).toBeCloseTo(Math.PI / 2, 10);
  });

  it("proportionally samples mismatched arrays and is finite/deterministic for malformed data", () => {
    const args = [
      [0, 0, 20, Number.NaN, Infinity, 30, 60, 40],
      [0.1, Number.NaN, 0.9],
      [{ pointerType: "pen", tiltX: Number.NaN, tiltY: 25, twist: 999 }],
      Number.NaN,
      { tiltEnabled: true, angleDeg: Number.NaN, roundness: Number.NaN },
    ] as const;
    const first = buildCalligraphySegments(...args);
    const second = buildCalligraphySegments(...args);
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    for (const segment of first) {
      expect(Object.values(segment).every(Number.isFinite)).toBe(true);
      expect(segment.width).toBeGreaterThan(0);
      expect(segment.roundness).toBeGreaterThan(0);
      expect(segment.roundness).toBeLessThanOrEqual(1);
    }
    expect(buildCalligraphySegments([], [], [], 10, manualTip)).toEqual([]);
    expect(buildCalligraphySegments([1, 2], [], [], 10, manualTip)).toEqual([]);
  });
});

describe("createStudioIncrementalCalligraphySegmentBuilder", () => {
  const tip = { tiltEnabled: true, angleDeg: 45, roundness: 0.32 };
  // pointCount - 1 = 16 (2의 거듭제곱)이면 배치 빌더의 (i-0.5)/(n-1)·(n-1) 진행률 왕복이
  // 부동소수에서도 정확히 i-0.5로 떨어져, 나란한 배열에서 두 빌더가 바이트 동일해진다.
  const pointCount = 17;
  const flatPoints = Array.from({ length: pointCount }, (_, index) => [
    index * 7 + Math.sin(index * 0.8) * 3,
    40 + Math.cos(index * 0.6) * 11,
  ]).flat();
  const pressures = Array.from({ length: pointCount }, (_, index) => 0.2 + (index % 5) / 8);
  const stylus = Array.from({ length: pointCount }, (_, index) => ({
    pointerType: "pen" as const,
    tiltX: 10 + (index % 7) * 4,
    tiltY: -20 + (index % 5) * 6,
    twist: (index * 37) % 360,
  }));

  function makeBuilder() {
    return createStudioIncrementalCalligraphySegmentBuilder(14, tip);
  }

  function appendPrefix(
    builder: ReturnType<typeof makeBuilder>,
    count: number,
  ): readonly ReturnType<typeof buildCalligraphySegments>[number][] {
    return builder.append(
      flatPoints.slice(0, count * 2),
      (index) => pressures[index],
      (index) => stylus[index],
    );
  }

  it("matches the batch builder exactly for parallel per-point inputs", () => {
    const batch = buildCalligraphySegments(flatPoints, pressures, stylus, 14, tip);
    const whole = appendPrefix(makeBuilder(), pointCount);
    expect(whole).toEqual(batch);

    // 임의 크기 chunk로 나눠 넣어도 같은 목록이 자라난다 — 이동당 새 점만 소비하는 계약.
    const chunked = makeBuilder();
    let consumed = 2;
    for (const chunk of [1, 3, 5, 2, 4]) {
      appendPrefix(chunked, consumed);
      consumed = Math.min(pointCount, consumed + chunk);
    }
    expect(appendPrefix(chunked, pointCount)).toEqual(batch);
  });

  it("rebuilds from scratch when the arrays shrink (seek/undo)", () => {
    // 줄어든 길이도 (n-1)이 2의 거듭제곱인 9점이어야 배치 비교가 바이트 동일하다(위 주석).
    const builder = makeBuilder();
    appendPrefix(builder, pointCount);
    const shrunk = appendPrefix(builder, 9);
    expect(shrunk).toEqual(
      buildCalligraphySegments(
        flatPoints.slice(0, 18),
        pressures.slice(0, 9),
        stylus.slice(0, 9),
        14,
        tip,
      ),
    );
    expect(appendPrefix(builder, pointCount)).toEqual(
      buildCalligraphySegments(flatPoints, pressures, stylus, 14, tip),
    );
  });

  it("truncates at the first non-finite coordinate like pairsFromElement", () => {
    // 유효 점 5개(n-1=4, 2의 거듭제곱) 뒤에 비유한 좌표: 거기서 절단한다.
    const builder = makeBuilder();
    const corrupt = [...flatPoints.slice(0, 10), Number.NaN, 12, ...flatPoints.slice(12)];
    const segments = builder.append(
      corrupt,
      (index) => pressures[index],
      (index) => stylus[index],
    );
    expect(segments).toEqual(
      buildCalligraphySegments(
        flatPoints.slice(0, 10),
        pressures.slice(0, 5),
        stylus.slice(0, 5),
        14,
        tip,
      ),
    );
    // 절단 뒤에도 같은 자리에서 다시 멈춘다(이동마다 O(1) 재검증).
    expect(builder.append(
      corrupt,
      (index) => pressures[index],
      (index) => stylus[index],
    )).toHaveLength(4);
  });
});

describe("polylineLength", () => {
  it("sums segment lengths for flat and diagonal strokes", () => {
    expect(polylineLength([0, 0, 10, 0])).toBe(10);
    expect(polylineLength([0, 0, 3, 4])).toBe(5);
    expect(polylineLength([0, 0])).toBe(0);
  });
});

describe("shouldAppendStrokePoint (라이브 thinning)", () => {
  it("skips points that are too close to the previous sample", () => {
    expect(shouldAppendStrokePoint(0, 0, 0.5, 0.5, 1.5)).toBe(false);
    expect(shouldAppendStrokePoint(0, 0, 4, 0, 1.5)).toBe(true);
  });
});

describe("stabilizePoint (입력 시점 손떨림 보정)", () => {
  it("returns the raw point when strength is 0", () => {
    expect(stabilizePoint(0, 0, 10, 20, 0)).toEqual([10, 20]);
  });

  it("pulls the point toward the previous point as strength grows", () => {
    const weak = stabilizePoint(0, 0, 100, 0, 2);
    const strong = stabilizePoint(0, 0, 100, 0, 10);
    expect(weak[0]).toBeGreaterThan(strong[0]);
    expect(strong[0]).toBeGreaterThan(0);
    expect(strong[0]).toBeLessThan(weak[0]);
    expect(weak[0]).toBeLessThan(100);
  });

  it("clamps strength outside the 0~10 range", () => {
    expect(stabilizePoint(0, 0, 100, 0, -5)).toEqual([100, 0]);
    expect(stabilizePoint(0, 0, 100, 0, 999)).toEqual(stabilizePoint(0, 0, 100, 0, STABILIZER_MAX));
    expect(stabilizePoint(0, 0, 100, 0, Number.NaN)).toEqual([100, 0]);
  });
});

describe("smoothStrokePoints (커밋 시점 이동평균 스무딩)", () => {
  const jittery = (): number[] => {
    // x는 등간격 증가, y는 불규칙 고주파 떨림(결정적 의사 노이즈)
    const pts: number[] = [];
    for (let i = 0; i < 30; i++) pts.push(i * 8, Math.sin(i * 2.39996) * 12);
    return pts;
  };

  // 떨림 정도: y의 2차 차분 절대합(작을수록 매끈)
  const roughness = (arr: number[]) => {
    let sum = 0;
    for (let i = 3; i < arr.length - 2; i += 2) {
      sum += Math.abs(arr[i - 2]! - 2 * arr[i]! + arr[i + 2]!);
    }
    return sum;
  };

  it("returns the original array reference for strength 0", () => {
    const pts = jittery();
    expect(smoothStrokePoints(pts, 0)).toBe(pts);
  });

  it("preserves point count and both endpoints", () => {
    const pts = jittery();
    const out = smoothStrokePoints(pts, 7);
    expect(out.length).toBe(pts.length);
    expect(out[0]).toBe(pts[0]);
    expect(out[1]).toBe(pts[1]);
    expect(out[out.length - 2]).toBe(pts[pts.length - 2]);
    expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
  });

  it("reduces high-frequency jitter, more with higher strength", () => {
    const pts = jittery();
    const raw = roughness(pts);
    const soft = roughness(smoothStrokePoints(pts, 3));
    const hard = roughness(smoothStrokePoints(pts, 10));
    expect(soft).toBeLessThan(raw);
    expect(hard).toBeLessThan(soft);
  });

  it("keeps a straight line straight (no distortion)", () => {
    const line: number[] = [];
    for (let i = 0; i < 12; i++) line.push(i * 5, 100);
    const out = smoothStrokePoints(line, 8);
    for (let i = 1; i < out.length; i += 2) expect(out[i]).toBeCloseTo(100, 8);
  });

  it("passes through tiny strokes untouched", () => {
    const tiny = [0, 0, 4, 4];
    expect(smoothStrokePoints(tiny, 9)).toBe(tiny);
  });

  it("preserves an intentional sharp corner when requested", () => {
    const elbow = [
      0, 0,
      10, 0,
      20, 0,
      30, 0,
      40, 0,
      40, 10,
      40, 20,
      40, 30,
      40, 40,
    ];
    const rounded = smoothStrokePoints(elbow, 9);
    const preserved = smoothStrokePoints(elbow, 9, { preserveCorners: true });
    expect(rounded[8]).not.toBe(40);
    expect(rounded[9]).not.toBe(0);
    expect(preserved[8]).toBe(40);
    expect(preserved[9]).toBe(0);
    expect(preserved).toHaveLength(elbow.length);
  });

  it("does not mistake a smooth arc for a sequence of sharp corners", () => {
    const arc = Array.from({ length: 25 }, (_, index) => {
      const angle = (Math.PI * index) / 24;
      return [120 + Math.cos(angle) * 80, 120 + Math.sin(angle) * 80];
    }).flat();
    const ordinary = smoothStrokePoints(arc, 10, { preserveCorners: false });
    const cornerAware = smoothStrokePoints(arc, 10, { preserveCorners: true });
    expect(cornerAware).toHaveLength(ordinary.length);
    cornerAware.forEach((value, index) => {
      expect(value).toBeCloseTo(ordinary[index] ?? 0, 10);
    });
  });

  it("sanitizes a malformed corner threshold without changing endpoints", () => {
    const points = [0, 0, 10, 0, 20, 10, 20, 20, 20, 30];
    const result = smoothStrokePoints(points, 8, {
      preserveCorners: true,
      cornerThresholdDeg: Number.NaN,
    });
    expect(result.slice(0, 2)).toEqual(points.slice(0, 2));
    expect(result.slice(-2)).toEqual(points.slice(-2));
    expect(result.every(Number.isFinite)).toBe(true);
  });
});

describe("gpenSegmentWidths (G펜 필압 굵기)", () => {
  it("maps each pressure to one width", () => {
    const widths = gpenSegmentWidths([0.2, 0.5, 0.9], 8);
    expect(widths).toHaveLength(3);
    for (const w of widths) expect(w).toBeGreaterThan(0);
  });

  it("makes higher pressure strokes thicker", () => {
    const widths = gpenSegmentWidths([0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.1, 0.1, 0.1], 10);
    const middleLow = widths[4]!; // 중앙(테이퍼 영향 없음) 비교를 위해 양쪽에 동일 인덱스 사용
    const before = gpenSegmentWidths([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2], 10)[4]!;
    expect(middleLow).toBeGreaterThan(before);
  });

  it("tapers both stroke ends thinner than the middle", () => {
    const widths = gpenSegmentWidths(Array(12).fill(0.7), 10);
    expect(widths[0]!).toBeLessThan(widths[6]!);
    expect(widths[widths.length - 1]!).toBeLessThan(widths[6]!);
  });

  it("clamps pressures outside 0..1 and stays positive", () => {
    const widths = gpenSegmentWidths([-1, 2, 0.5], 6);
    for (const w of widths) {
      expect(w).toBeGreaterThanOrEqual(0.4);
      expect(Number.isFinite(w)).toBe(true);
    }
    expect(gpenSegmentWidths([], 6)).toEqual([]);
  });
});

describe("screentoneDotsForStroke (스크린톤 도트 브러시)", () => {
  const PITCH = 8;
  const RADIUS = 12;

  it("stamps dots aligned to the global lattice", () => {
    const dots = screentoneDotsForStroke([0, 0, 100, 0], RADIUS, PITCH);
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.length % 2).toBe(0);
    for (let i = 0; i < dots.length; i += 2) {
      const y = dots[i + 1]!;
      const iy = Math.round(y / PITCH);
      expect(Math.abs(iy * PITCH - y)).toBeLessThan(1e-9);
      const rowOffset = iy % 2 === 0 ? 0 : PITCH / 2;
      const xResidue = Math.abs((dots[i]! - rowOffset) / PITCH - Math.round((dots[i]! - rowOffset) / PITCH));
      expect(xResidue).toBeLessThan(1e-9);
    }
  });

  it("deduplicates overlapping stamps (no duplicate lattice dots)", () => {
    const dots = screentoneDotsForStroke([0, 0, 4, 0, 8, 0, 8, 0, 12, 0], RADIUS, PITCH);
    const keys = new Set<string>();
    for (let i = 0; i < dots.length; i += 2) {
      const key = `${dots[i]}:${dots[i + 1]}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  });

  it("keeps every dot within brush radius of the polyline", () => {
    const pts = [0, 0, 60, 40, 120, 0];
    const dots = screentoneDotsForStroke(pts, RADIUS, PITCH);
    const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
      const vx = x2 - x1;
      const vy = y2 - y1;
      const lenSq = vx * vx + vy * vy;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / lenSq));
      return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
    };
    for (let i = 0; i < dots.length; i += 2) {
      const x = dots[i]!;
      const y = dots[i + 1]!;
      const dist = Math.min(distToSegment(x, y, 0, 0, 60, 40), distToSegment(x, y, 60, 40, 120, 0));
      expect(dist).toBeLessThanOrEqual(RADIUS + 1e-6);
    }
  });

  it("is deterministic and handles degenerate input", () => {
    const a = screentoneDotsForStroke([10, 10, 90, 60], RADIUS, PITCH);
    const b = screentoneDotsForStroke([10, 10, 90, 60], RADIUS, PITCH);
    expect(a).toEqual(b);
    expect(screentoneDotsForStroke([], RADIUS, PITCH)).toEqual([]);
    expect(screentoneDotsForStroke([5], RADIUS, PITCH)).toEqual([]);
  });

  it("derives a positive dot radius from pitch", () => {
    expect(screentoneDotRadius(PITCH)).toBeGreaterThan(0);
    expect(screentoneDotRadius(0)).toBeGreaterThan(0);
  });
});

describe("legacy point processors stay intact", () => {
  it("keeps live sampling at the same CSS-pixel distance across zoom levels", () => {
    for (const scale of [0.5, 1, 2, 4]) {
      expect(strokeSampleDistanceForScale(scale) * scale).toBeCloseTo(1.5, 10);
    }
    expect(strokeSampleDistanceForScale(Number.NaN)).toBe(1.5);
  });

  it("derives render thinning from a new stroke's captured sampling distance", () => {
    expect(strokeRenderDistance(1.5)).toBe(3);
    expect(strokeRenderDistance(0.75)).toBe(1.5);
    expect(strokeRenderDistance(undefined)).toBe(3);
    expect(strokeRenderDistance(Number.NaN)).toBe(3);
  });

  it("keeps outline brush source routes sub-pixel across zoom while material brushes stay bounded", () => {
    for (const scale of [0.25, 0.5, 1, 2, 4]) {
      expect(strokeSampleDistanceForBrushFamily(scale, "gpen") * scale).toBe(0.5);
      expect(strokeSampleDistanceForBrushFamily(scale, "perfect") * scale).toBe(0.5);
      expect(strokeSampleDistanceForBrushFamily(scale, "calligraphy") * scale).toBe(0.5);
      expect(strokeSampleDistanceForBrushFamily(scale, "marker") * scale).toBe(0.75);
      expect(strokeSampleDistanceForBrushFamily(scale, "dry-media") * scale).toBe(0.8);
      expect(strokeSampleDistanceForBrushFamily(scale, "airbrush") * scale).toBe(1);
    }
  });

  it("retains more than twice the small-curve detail for G-pen without changing the pixel grid", () => {
    const route = Array.from({ length: 41 }, (_, index) => {
      const angle = Math.PI * 0.5 * (index / 40);
      return { x: 8 * Math.cos(angle), y: 8 * Math.sin(angle) };
    });
    const admittedCount = (minimumDistance: number) => {
      let last = route[0]!;
      let count = 1;
      for (const candidate of route.slice(1)) {
        if (Math.hypot(candidate.x - last.x, candidate.y - last.y) < minimumDistance) continue;
        last = candidate;
        count += 1;
      }
      return count;
    };

    const oldGenericCount = admittedCount(strokeSampleDistanceForScale(1));
    const gpenCount = admittedCount(strokeSampleDistanceForBrushFamily(1, "gpen"));
    expect(gpenCount).toBeGreaterThan(oldGenericCount * 2);
    expect(strokeSampleDistanceForBrushFamily(1, "pixel")).toBe(1);
  });

  it("processFreehandPoints thins dense points and keeps endpoints", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 50; i++) pts.push(i, 0); // 1px 간격 → 3px 미만은 솎아짐
    const out = processFreehandPoints(pts);
    expect(out.length).toBeLessThan(pts.length);
    expect(out[0]).toBe(0);
    expect(out[out.length - 2]).toBe(50);
  });

  it("accepts a per-stroke thinning distance without changing the legacy default", () => {
    const points = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0];
    const legacy = processFreehandPoints(points);
    const detailed = processFreehandPoints(points, 1);
    expect(legacy).toHaveLength(6);
    expect(detailed).toHaveLength(points.length);
    expect(legacy.slice(0, 2)).toEqual([0, 0]);
    expect(legacy.slice(-2)).toEqual([4, 0]);
    expect(detailed.slice(-2)).toEqual([4, 0]);
  });

  it.each([0, 0.75, -1])(
    "keeps accepted points causal for a finite sampleSpacing of %s",
    (sampleSpacing) => {
      const prefix = [0, 0, 1, 1, 2, 1, 3, 2];
      const extended = [...prefix, 4, 3, 5, 3];
      const prefixPath = resolveStudioFreehandRenderPath(prefix, {
        sampleSpacing,
        legacyMinDistance: 3,
        legacyTension: 0.4,
      });
      const extendedPath = resolveStudioFreehandRenderPath(extended, {
        sampleSpacing,
        legacyMinDistance: 3,
        legacyTension: 0.4,
      });

      expect(prefixPath.points).toBe(prefix);
      expect(extendedPath.points).toBe(extended);
      expect(extendedPath.points.slice(0, prefix.length)).toEqual(prefixPath.points);
      expect(prefixPath.tension).toBe(0);
      expect(extendedPath.tension).toBe(0);
    }
  );

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, "1.5"])(
    "preserves legacy point processing and tension for sampleSpacing %s",
    (sampleSpacing) => {
      const points = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0];
      const legacyMinDistance = 2;
      const legacyTension = 0.35;
      const path = resolveStudioFreehandRenderPath(points, {
        sampleSpacing,
        legacyMinDistance,
        legacyTension,
      });

      expect(path.points).toEqual(processFreehandPoints(points, legacyMinDistance));
      expect(path.points).not.toBe(points);
      expect(path.tension).toBe(legacyTension);
    }
  );

  it("lets connected-path brushes smooth accepted points without reprocessing their geometry", () => {
    const points = [0, 0, 8, 5, 16, 1, 24, 8];
    const path = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: 0.75,
      acceptedTension: 0.35,
      legacyTension: 0.9,
    });

    expect(path.points).toBe(points);
    expect(path.tension).toBe(0.35);
  });

  it("clamps invalid or excessive accepted-point tension at the render boundary", () => {
    const points = [0, 0, 8, 5, 16, 1];
    expect(resolveStudioFreehandRenderPath(points, {
      sampleSpacing: 0.75,
      acceptedTension: Number.NaN,
      legacyTension: 0.4,
    }).tension).toBe(0);
    expect(resolveStudioFreehandRenderPath(points, {
      sampleSpacing: 0.75,
      acceptedTension: 4,
      legacyTension: 0.4,
    }).tension).toBe(1);
  });

  it("uses the historical render distance when a legacy caller omits one", () => {
    const points = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0];
    const path = resolveStudioFreehandRenderPath(points, {
      sampleSpacing: undefined,
      legacyTension: 0.2,
    });

    expect(path.points).toEqual(processFreehandPoints(points));
    expect(path.tension).toBe(0.2);
  });

  it("processPencilPoints applies bounded deterministic jitter", () => {
    const pts = [0, 0, 10, 10, 20, 20];
    const a = processPencilPoints(pts);
    const b = processPencilPoints(pts);
    expect(a).toEqual(b);
    for (let i = 0; i < pts.length; i++) {
      expect(Math.abs(a[i]! - pts[i]!)).toBeLessThanOrEqual(0.75 + 1e-9);
    }
  });
});
