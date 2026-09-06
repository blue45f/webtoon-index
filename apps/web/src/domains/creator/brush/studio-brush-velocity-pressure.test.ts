import { describe, expect, it } from "vitest";

import { resolveStudioHybridPressureSample } from "../hybrid-dcc/studio-hybrid-pressure-profile";

import {
  advanceStudioBrushVelocityPressure,
  resolveStudioBrushReleasePressure,
  type StudioBrushVelocityPressureSettings,
} from "./studio-brush-velocity-pressure";

const base: StudioBrushVelocityPressureSettings = {
  brushId: "pen",
  pressureCurve: 1,
  pressureMinSize: 0.1,
  useVelocityPressure: true,
  velocitySensitivity: 1,
  fallbackPressure: 1,
};

describe("studio-brush-velocity-pressure", () => {
  it("keeps the exact family nominal width on the first mouse point", () => {
    const result = advanceStudioBrushVelocityPressure(
      null,
      { x: 0, y: 0, timeMs: 0, pointerType: "mouse", pressure: 0.5 },
      { ...base, brushId: "marker", pressureCurve: 3 }
    );

    expect(result.pressure).toBe(0.8);
    expect(result.sample.source).toBe("nominal");
  });

  it("keeps the default pen's existing full-width nominal contract", () => {
    const result = advanceStudioBrushVelocityPressure(
      null,
      { x: 0, y: 0, timeMs: 0, pointerType: "mouse", pressure: 0.5 },
      base
    );

    expect(result.pressure).toBe(1);
    expect(result.sample.source).toBe("nominal");
  });

  it("keeps non-pressure input nominal when velocity simulation is disabled", () => {
    const settings = { ...base, brushId: "pencil", useVelocityPressure: false };
    const first = advanceStudioBrushVelocityPressure(
      null,
      { x: 0, y: 0, timeMs: 0, pointerType: "mouse", pressure: 0.5 },
      settings
    );
    const second = advanceStudioBrushVelocityPressure(
      first.state,
      { x: 80, y: 0, timeMs: 8, pointerType: "mouse", pressure: 0.5 },
      settings
    );

    expect(first.pressure).toBe(0.58);
    expect(second.pressure).toBe(0.58);
  });

  it.each([
    ["pencil", 0.58],
    ["brush", 0.65],
  ] as const)(
    "keeps the first %s move within a 15%% nominal-pressure continuity envelope",
    (brushId, nominalPressure) => {
      const settings = { ...base, brushId };
      const first = advanceStudioBrushVelocityPressure(
        null,
        { x: 0, y: 0, timeMs: 0, pointerType: "mouse", pressure: 0.5 },
        settings
      );
      const second = advanceStudioBrushVelocityPressure(
        first.state,
        { x: 1, y: 0, timeMs: 5, pointerType: "mouse", pressure: 0.5 },
        settings
      );

      expect(first.pressure).toBe(nominalPressure);
      expect(second.pressure).toBeGreaterThanOrEqual(nominalPressure * 0.85);
      expect(second.pressure).toBeLessThanOrEqual(nominalPressure * 1.15);
    }
  );

  it("low-passes a one-frame speed spike instead of applying the full instantaneous thinning", () => {
    const first = advanceStudioBrushVelocityPressure(
      null,
      { x: 0, y: 0, timeMs: 0, pointerType: "mouse", pressure: 0.5 },
      base
    );
    const spike = advanceStudioBrushVelocityPressure(
      first.state,
      { x: 64, y: 0, timeMs: 4, pointerType: "mouse", pressure: 0.5 },
      base
    );
    const recovery = advanceStudioBrushVelocityPressure(
      spike.state,
      { x: 66, y: 0, timeMs: 12, pointerType: "mouse", pressure: 0.5 },
      base
    );

    expect(spike.sample.rawVelocity).toBe(8);
    expect(spike.sample.filteredVelocity).toBeLessThan(spike.sample.rawVelocity);
    expect(spike.pressure).toBeGreaterThan(0.25);
    expect(recovery.sample.filteredVelocity).toBeLessThan(spike.sample.filteredVelocity);
    expect(recovery.pressure).toBeGreaterThan(spike.pressure);
  });

  it("keeps the pressure-curve control effective for velocity-simulated mouse input", () => {
    const run = (pressureCurve: number) => {
      const settings = {
        ...base,
        brushId: "pencil",
        pressureCurve,
      };
      const first = advanceStudioBrushVelocityPressure(
        null,
        { x: 0, y: 0, timeMs: 0, pointerType: "mouse", pressure: 0.5 },
        settings
      );
      const second = advanceStudioBrushVelocityPressure(
        first.state,
        { x: 1, y: 0, timeMs: 5, pointerType: "mouse", pressure: 0.5 },
        settings
      );
      const sustained = advanceStudioBrushVelocityPressure(
        second.state,
        { x: 9, y: 0, timeMs: 13, pointerType: "mouse", pressure: 0.5 },
        settings
      );
      expect(second.pressure).toBeGreaterThanOrEqual(first.pressure * 0.85);
      expect(second.pressure).toBeLessThanOrEqual(first.pressure * 1.15);
      return sustained.pressure;
    };

    expect(run(0.5)).toBeGreaterThan(run(3));
  });

  it("preserves real stylus pressure precedence and the configured curve/minimum size", () => {
    const legacy = resolveStudioHybridPressureSample("perfect-ink", {
      pointerType: "pen",
      rawPressure: 0.25,
      pressureCurve: 2,
      velocitySensitivityScale: 1,
    });
    const result = advanceStudioBrushVelocityPressure(
      null,
      { x: 10, y: 20, timeMs: 5, pointerType: "pen", pressure: 0.25 },
      {
        ...base,
        brushId: "perfect-ink",
        pressureCurve: 2,
        pressureMinSize: 0.2,
      }
    );

    expect(result.sample.source).toBe("hardware");
    expect(result.pressure).toBeCloseTo(legacy!.pressure, 10);
  });

  it("retains distinct family response under the same pointer journal", () => {
    const run = (brushId: string) => {
      const settings = { ...base, brushId };
      const first = advanceStudioBrushVelocityPressure(
        null,
        { x: 0, y: 0, timeMs: 0, pointerType: "mouse", pressure: 0.5 },
        settings
      );
      return advanceStudioBrushVelocityPressure(
        first.state,
        { x: 24, y: 0, timeMs: 8, pointerType: "mouse", pressure: 0.5 },
        settings
      ).pressure;
    };

    expect(run("technical-pen")).toBeGreaterThan(run("brush-pen"));
  });

  it("keeps real pressure dynamic across every production material family", () => {
    const representativeBrushes = [
      "pen",
      "technical-pen",
      "pencil-6b",
      "marker-bold",
      "brush-pen",
      "flat-brush",
      "charcoal",
      "watercolor",
      "airbrush",
      "ink-particle",
      "gpen",
    ] as const;

    for (const brushId of representativeBrushes) {
      const settings = { ...base, brushId };
      const light = advanceStudioBrushVelocityPressure(
        null,
        { x: 0, y: 0, timeMs: 0, pointerType: "pen", pressure: 0.12 },
        settings
      );
      const heavy = advanceStudioBrushVelocityPressure(
        light.state,
        { x: 12, y: 0, timeMs: 8, pointerType: "pen", pressure: 0.9 },
        settings
      );

      expect(light.sample.source, brushId).toBe("hardware");
      expect(heavy.sample.source, brushId).toBe("hardware");
      expect(heavy.pressure, brushId).toBeGreaterThan(light.pressure);
    }
  });

  it("persists pre-floor material pressure while retaining the default pen width contract", () => {
    const dry = advanceStudioBrushVelocityPressure(
      null,
      { x: 0, y: 0, timeMs: 0, pointerType: "pen", pressure: 0 },
      { ...base, brushId: "charcoal" }
    );
    const pen = advanceStudioBrushVelocityPressure(
      null,
      { x: 0, y: 0, timeMs: 0, pointerType: "pen", pressure: 0 },
      base
    );

    expect(dry.pressure).toBe(0);
    expect(dry.sample.widthRatio).toBeGreaterThan(0);
    expect(pen.pressure).toBe(base.pressureMinSize);
  });

  it("lets the artist geometry floor strengthen a profile without flooring pigment pressure", () => {
    const result = advanceStudioBrushVelocityPressure(
      null,
      { x: 0, y: 0, timeMs: 0, pointerType: "pen", pressure: 0 },
      {
        ...base,
        brushId: "charcoal",
        pressureMinSize: 0.8,
      }
    );

    expect(result.pressure).toBe(0);
    expect(result.sample.widthRatio).toBe(0.8);
  });

  it("uses the family curve for a nonzero release but keeps the last contact for pen-up zero", () => {
    const nonzero = resolveStudioBrushReleasePressure({
      ...base,
      brushId: "spray",
      pointerType: "pen",
      rawPressure: 0.25,
      lastContactPressure: 0.7,
      pressureCurve: 2,
    });
    const released = resolveStudioBrushReleasePressure({
      ...base,
      brushId: "spray",
      pointerType: "pen",
      rawPressure: 0,
      lastContactPressure: 0.7,
      pressureCurve: 2,
    });

    expect(nonzero).toBeCloseTo(Math.pow(0.25, 0.78 * 2), 10);
    expect(released).toBe(0.7);
  });

  it.each([undefined, Number.NaN, -1, 2])(
    "keeps the last contact when pen release pressure is invalid (%s)",
    (rawPressure) => {
      expect(resolveStudioBrushReleasePressure({
        ...base,
        brushId: "spray",
        pointerType: "pen",
        rawPressure,
        lastContactPressure: 0.2,
      })).toBe(0.2);
    }
  );

  it("is prefix-stable when future samples are appended", () => {
    const first = advanceStudioBrushVelocityPressure(
      null,
      { x: 0, y: 0, timeMs: 0, pointerType: "mouse", pressure: 0.5 },
      base
    );
    const second = advanceStudioBrushVelocityPressure(
      first.state,
      { x: 12, y: 4, timeMs: 8, pointerType: "mouse", pressure: 0.5 },
      base
    );
    const before = { state: second.state, pressure: second.pressure };
    advanceStudioBrushVelocityPressure(
      second.state,
      { x: 40, y: 10, timeMs: 16, pointerType: "mouse", pressure: 0.5 },
      base
    );

    expect(second.state).toEqual(before.state);
    expect(second.pressure).toBe(before.pressure);
  });
});
