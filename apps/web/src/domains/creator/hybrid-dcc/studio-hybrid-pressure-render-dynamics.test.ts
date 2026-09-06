import { describe, expect, it } from "vitest";

import {
  STUDIO_HYBRID_PRESSURE_RENDER_DYNAMICS_VERSION,
  resolveStudioHybridPressureRenderDynamics,
  resolveStudioHybridPressureRenderDynamicsSeries,
} from "./studio-hybrid-pressure-render-dynamics";

describe("studio hybrid pressure render dynamics", () => {
  it("gives every family a visibly distinct width, opacity and flow signature", () => {
    const brushIds = [
      "pen",
      "technical-pen",
      "pencil",
      "marker",
      "brush-pen",
    ] as const;
    const results = brushIds.map((brushId) =>
      resolveStudioHybridPressureRenderDynamics(brushId, {
        pointerType: "pen",
        rawPressure: 0.38,
        baseWidth: 20,
        baseOpacity: 0.9,
        baseFlow: 0.8,
      })!
    );

    expect(
      new Set(
        results.map((result) =>
          [
            result.resolvedWidth,
            result.resolvedOpacity,
            result.resolvedFlow,
          ].map((value) => value.toFixed(8)).join(":")
        )
      ).size
    ).toBe(brushIds.length);

    const [ink, technical, pencil, marker, brushPen] = results;
    expect(technical!.resolvedWidth).toBeGreaterThan(marker!.resolvedWidth);
    expect(marker!.resolvedWidth).toBeGreaterThan(pencil!.resolvedWidth);
    expect(pencil!.resolvedWidth).toBeGreaterThan(ink!.resolvedWidth);
    expect(ink!.resolvedWidth).toBeGreaterThan(brushPen!.resolvedWidth);
    expect(technical!.resolvedOpacity).toBeGreaterThan(marker!.resolvedOpacity);
    expect(marker!.resolvedOpacity).toBeGreaterThan(ink!.resolvedOpacity);
    expect(ink!.resolvedOpacity).toBeGreaterThan(pencil!.resolvedOpacity);
    expect(pencil!.resolvedOpacity).toBeGreaterThan(brushPen!.resolvedOpacity);
    expect(technical!.resolvedFlow).toBeGreaterThan(marker!.resolvedFlow);
    expect(marker!.resolvedFlow).toBeGreaterThan(ink!.resolvedFlow);
    expect(ink!.resolvedFlow).toBeGreaterThan(pencil!.resolvedFlow);
    expect(pencil!.resolvedFlow).toBeGreaterThan(brushPen!.resolvedFlow);
  });

  it("preserves real pen pressure priority independently of pointer velocity", () => {
    const fast = resolveStudioHybridPressureRenderDynamics("pencil", {
      pointerType: "pen",
      rawPressure: 0.42,
      distance: 400,
      elapsedMs: 1,
    });
    const slow = resolveStudioHybridPressureRenderDynamics("pencil", {
      pointerType: "pen",
      rawPressure: 0.42,
      distance: 0.01,
      elapsedMs: 100,
    });
    const heavy = resolveStudioHybridPressureRenderDynamics("pencil", {
      pointerType: "pen",
      rawPressure: 0.86,
      distance: 400,
      elapsedMs: 1,
    });

    expect(fast).toEqual(slow);
    expect(heavy!.resolvedWidth).toBeGreaterThan(fast!.resolvedWidth);
    expect(heavy!.resolvedOpacity).toBeGreaterThan(fast!.resolvedOpacity);
    expect(heavy!.resolvedFlow).toBeGreaterThan(fast!.resolvedFlow);
  });

  it("marks terminal values so pressure cannot be applied twice downstream", () => {
    const result = resolveStudioHybridPressureRenderDynamics("marker", {
      pointerType: "pen",
      rawPressure: 0.31,
      baseWidth: 24,
      baseOpacity: 0.75,
      baseFlow: 0.6,
    })!;

    expect(result.version).toBe(STUDIO_HYBRID_PRESSURE_RENDER_DYNAMICS_VERSION);
    expect(result.pressureApplication).toBe("terminal-resolved-once");
    expect(result.downstreamPressure).toBe(1);
    expect(result.resolvedWidth).toBeCloseTo(24 * result.widthRatio, 12);
    expect(result.resolvedOpacity).toBeCloseTo(0.75 * result.opacityRatio, 12);
    expect(result.resolvedFlow).toBeCloseTo(0.6 * result.flowRatio, 12);
  });

  it("passes unrelated brushes through neutrally and excludes G-pen authority", () => {
    const neutral = resolveStudioHybridPressureRenderDynamics("screentone", {
      pointerType: "pen",
      rawPressure: 0.05,
      baseWidth: 19,
      baseOpacity: 0.65,
      baseFlow: 0.44,
    });
    expect(neutral).toMatchObject({
      source: "neutral",
      profileId: null,
      inputPressure: 1,
      downstreamPressure: 1,
      widthRatio: 1,
      opacityRatio: 1,
      flowRatio: 1,
      resolvedWidth: 19,
      resolvedOpacity: 0.65,
      resolvedFlow: 0.44,
    });

    for (const brushId of ["gpen", "mapping-pen", "kaburapen", "liner"]) {
      expect(resolveStudioHybridPressureRenderDynamics(brushId, {
        baseWidth: 19,
      })).toBeNull();
      expect(resolveStudioHybridPressureRenderDynamicsSeries({
        brushId,
        samples: [{ x: 0, y: 0, timeMs: 0 }],
      })).toEqual([]);
    }
  });

  it("sanitizes malformed bases and keeps every render value finite and bounded", () => {
    const malformed = resolveStudioHybridPressureRenderDynamics("brush-pen", {
      pointerType: "pen",
      rawPressure: Number.NaN,
      baseWidth: Number.POSITIVE_INFINITY,
      baseOpacity: -100,
      baseFlow: Number.NaN,
    })!;
    expect(malformed.resolvedWidth).toBeGreaterThanOrEqual(0);
    expect(malformed.resolvedWidth).toBeLessThanOrEqual(65_536);
    expect(malformed.resolvedOpacity).toBe(0);
    expect(malformed.resolvedFlow).toBeGreaterThanOrEqual(0);
    expect(malformed.resolvedFlow).toBeLessThanOrEqual(1);

    for (const value of Object.values(malformed)) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("keeps terminal dynamics prefix-stable when future pointer samples arrive", () => {
    const prefix = [
      { x: 0, y: 0, timeMs: 0 },
      { x: 4, y: 1, timeMs: 16 },
      { x: 11, y: 2, timeMs: 32 },
    ];
    const initial = resolveStudioHybridPressureRenderDynamicsSeries({
      brushId: "brush-pen",
      pointerType: "mouse",
      baseWidth: 18,
      baseOpacity: 0.8,
      baseFlow: 0.7,
      samples: prefix,
    });
    const extended = resolveStudioHybridPressureRenderDynamicsSeries({
      brushId: "brush-pen",
      pointerType: "mouse",
      baseWidth: 18,
      baseOpacity: 0.8,
      baseFlow: 0.7,
      samples: [...prefix, { x: 60, y: 7, timeMs: 40 }],
    });

    expect(extended.slice(0, initial.length)).toEqual(initial);
    expect(initial[0]?.source).toBe("nominal");
    expect(initial.slice(1).every(({ source }) => source === "velocity")).toBe(true);
  });
});
