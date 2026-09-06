import { describe, expect, it } from "vitest";

import {
  STUDIO_HYBRID_PRESSURE_PROFILES,
  STUDIO_HYBRID_PRESSURE_PROFILE_VERSION,
  resolveStudioHybridPressureProfile,
  resolveStudioHybridPressureSample,
  resolveStudioHybridPressureSeries,
} from "./studio-hybrid-pressure-profile";

describe("studio hybrid pressure profiles", () => {
  it("maps non-G-pen brush families while preserving the existing G-pen contract", () => {
    expect(resolveStudioHybridPressureProfile("pen")?.id).toBe("ink");
    expect(resolveStudioHybridPressureProfile("ballpoint")?.id).toBe("ink");
    expect(resolveStudioHybridPressureProfile("fineliner")?.id).toBe("technical");
    expect(resolveStudioHybridPressureProfile("technical-pen")?.id).toBe("technical");
    expect(resolveStudioHybridPressureProfile("pencil-6b")?.id).toBe("pencil");
    expect(resolveStudioHybridPressureProfile("marker-bold")?.id).toBe("marker");
    expect(resolveStudioHybridPressureProfile("brush-pen")?.id).toBe("brush-pen");
    expect(resolveStudioHybridPressureProfile("perfect-ink")?.id).toBe("brush-pen");
    expect(resolveStudioHybridPressureProfile("flat-brush")?.id).toBe("ribbon");
    expect(resolveStudioHybridPressureProfile("watercolor")?.id).toBe("wet-media");
    expect(resolveStudioHybridPressureProfile("charcoal")?.id).toBe("dry-media");
    expect(resolveStudioHybridPressureProfile("airbrush")?.id).toBe("airbrush");
    expect(resolveStudioHybridPressureProfile("ink-particle")?.id).toBe("particle");

    for (const gpenId of ["gpen", "mapping-pen", "kaburapen", "liner"]) {
      expect(resolveStudioHybridPressureProfile(gpenId)).toBeNull();
    }
    expect(resolveStudioHybridPressureProfile("screentone")).toBeNull();
    expect(resolveStudioHybridPressureProfile(null)).toBeNull();
  });

  it("has a versioned, genuinely distinct response signature for every family", () => {
    const signatures = Object.values(STUDIO_HYBRID_PRESSURE_PROFILES).map((profile) => {
      expect(profile.version).toBe(STUDIO_HYBRID_PRESSURE_PROFILE_VERSION);
      return JSON.stringify({
        nominalPressure: profile.nominalPressure,
        minimumWidthRatio: profile.minimumWidthRatio,
        pressureExponent: profile.pressureExponent,
        velocitySensitivity: profile.velocitySensitivity,
        maxVelocity: profile.maxVelocity,
        opacity: profile.opacity,
        flow: profile.flow,
      });
    });
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("prioritizes real stylus pressure over velocity for every supported family", () => {
    for (const brushId of [
      "pen",
      "technical-pen",
      "pencil",
      "marker",
      "brush-pen",
      "flat-brush",
      "charcoal",
      "watercolor",
      "airbrush",
      "ink-particle",
    ]) {
      const light = resolveStudioHybridPressureSample(brushId, {
        pointerType: "pen",
        rawPressure: 0.15,
        distance: 100,
        elapsedMs: 1,
      });
      const heavy = resolveStudioHybridPressureSample(brushId, {
        pointerType: "pen",
        rawPressure: 0.85,
        distance: 0.1,
        elapsedMs: 50,
      });
      expect(light?.source).toBe("hardware");
      expect(heavy?.source).toBe("hardware");
      expect(heavy!.pressure).toBeGreaterThan(light!.pressure);
      expect(heavy!.opacityRatio).toBeGreaterThanOrEqual(light!.opacityRatio);
      expect(heavy!.flowRatio).toBeGreaterThanOrEqual(light!.flowRatio);
    }
  });

  it("gives mouse/touch deterministic velocity pressure and treats conventional touch 0.5 as non-hardware", () => {
    const slow = resolveStudioHybridPressureSample("pen", {
      pointerType: "mouse",
      distance: 4,
      elapsedMs: 16,
    });
    const fastInput = {
      pointerType: "touch",
      rawPressure: 0.5,
      distance: 24,
      elapsedMs: 8,
    } as const;
    const fast = resolveStudioHybridPressureSample("pen", fastInput);
    expect(slow?.source).toBe("velocity");
    expect(fast?.source).toBe("velocity");
    expect(slow!.pressure).toBeGreaterThan(fast!.pressure);
    expect(resolveStudioHybridPressureSample("pen", fastInput)).toEqual(fast);
  });

  it("keeps an actual pressure-capable touch sample as hardware input", () => {
    const resolved = resolveStudioHybridPressureSample("pencil", {
      pointerType: "touch",
      rawPressure: 0.72,
      distance: 40,
      elapsedMs: 2,
    });
    expect(resolved?.source).toBe("hardware");
  });

  it("makes the same physical sample visibly different across brush families", () => {
    const brushes = ["pen", "technical-pen", "pencil", "marker", "brush-pen"] as const;
    const results = brushes.map((brushId) =>
      resolveStudioHybridPressureSample(brushId, {
        pointerType: "pen",
        rawPressure: 0.38,
      })!
    );
    expect(new Set(results.map(({ pressure }) => pressure.toFixed(6))).size).toBe(
      brushes.length
    );
    expect(results[1]!.pressure).toBeGreaterThan(results[2]!.pressure);
    expect(results[4]!.pressure).toBeLessThan(results[0]!.pressure);
    expect(results[2]!.opacityRatio).toBeLessThan(results[3]!.opacityRatio);
  });

  it("applies the artist curve and can disable velocity response without changing the family floor", () => {
    const soft = resolveStudioHybridPressureSample("pencil", {
      pointerType: "pen",
      rawPressure: 0.4,
      pressureCurve: 0.6,
    })!;
    const firm = resolveStudioHybridPressureSample("pencil", {
      pointerType: "pen",
      rawPressure: 0.4,
      pressureCurve: 1.8,
    })!;
    expect(soft.pressure).toBeGreaterThan(firm.pressure);

    const fixed = resolveStudioHybridPressureSample("pencil", {
      pointerType: "mouse",
      distance: 80,
      elapsedMs: 1,
      simulateVelocity: false,
    })!;
    expect(fixed.source).toBe("nominal");
    expect(fixed.pressure).toBe(STUDIO_HYBRID_PRESSURE_PROFILES.pencil.nominalPressure);
    expect(fixed.widthRatio).toBeGreaterThanOrEqual(
      STUDIO_HYBRID_PRESSURE_PROFILES.pencil.minimumWidthRatio
    );
  });

  it("keeps canonical pigment pressure independent from the geometry minimum-size floor", () => {
    const light = resolveStudioHybridPressureSample("charcoal", {
      pointerType: "pen",
      rawPressure: 0,
    })!;

    expect(light.pressure).toBe(0);
    expect(light.widthRatio).toBe(
      STUDIO_HYBRID_PRESSURE_PROFILES["dry-media"].minimumWidthRatio
    );
    expect(light.opacityRatio).toBe(
      STUDIO_HYBRID_PRESSURE_PROFILES["dry-media"].opacity.minimum
    );
    expect(light.flowRatio).toBe(
      STUDIO_HYBRID_PRESSURE_PROFILES["dry-media"].flow.minimum
    );
  });

  it("creates a causal, prefix-stable pointer journal with nominal first contact", () => {
    const prefix = [
      { x: 0, y: 0, timeMs: 0 },
      { x: 3, y: 0, timeMs: 16 },
      { x: 10, y: 1, timeMs: 32 },
    ];
    const first = resolveStudioHybridPressureSeries({
      brushId: "brush-pen",
      pointerType: "mouse",
      samples: prefix,
    });
    const extended = resolveStudioHybridPressureSeries({
      brushId: "brush-pen",
      pointerType: "mouse",
      samples: [...prefix, { x: 45, y: 4, timeMs: 40 }],
    });

    expect(first[0]?.source).toBe("nominal");
    expect(first.slice(1).every(({ source }) => source === "velocity")).toBe(true);
    expect(extended.slice(0, first.length)).toEqual(first);
    expect(extended.at(-1)!.pressure).toBeLessThan(extended[1]!.pressure);
  });

  it("sanitizes malformed journals into finite bounded output without mutating source samples", () => {
    const samples = [
      { x: Number.NaN, y: Number.POSITIVE_INFINITY, timeMs: Number.NaN },
      { x: 12, y: 4, timeMs: -1, pressure: Number.NaN },
    ];
    const snapshot = samples.map((sample) => ({ ...sample }));
    const output = resolveStudioHybridPressureSeries({
      brushId: "marker",
      pointerType: "mouse",
      pressureCurve: Number.POSITIVE_INFINITY,
      velocitySensitivityScale: -100,
      samples,
    });
    expect(output).toHaveLength(2);
    for (const result of output) {
      for (const value of [
        result.pressure,
        result.widthRatio,
        result.opacityRatio,
        result.flowRatio,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    expect(samples).toEqual(snapshot);
    expect(resolveStudioHybridPressureSeries({
      brushId: "gpen",
      samples,
    })).toEqual([]);
  });
});
