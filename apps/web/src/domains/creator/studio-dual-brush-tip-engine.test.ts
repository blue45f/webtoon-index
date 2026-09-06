import { describe, expect, it } from "vitest";

import {
  combineStudioDualTipAlpha,
  combineStudioDualTipExactCoverageV2,
  compositeStudioDualTipExactDepositionV2,
  compositeStudioDualTipExactSequenceV2,
  renderStudioDualBrushTip,
  STUDIO_DUAL_TIP_CONTRACT_VERSION,
  STUDIO_DUAL_TIP_PACKED_LAYOUT,
  STUDIO_DUAL_TIP_PACKED_STRIDE,
  STUDIO_DUAL_TIP_RECEIPT,
  type StudioDualTipAlphaField,
  type StudioDualTipArtifact,
  type StudioDualTipCombineMode,
  type StudioDualTipExactDepositionPixel,
  type StudioDualTipRequest,
} from "./studio-dual-brush-tip-engine";

function constantField(alpha: number): StudioDualTipAlphaField {
  return { width: 1, height: 1, alpha: [alpha] };
}

function radialField(size = 5): StudioDualTipAlphaField {
  const center = (size - 1) / 2;
  const radius = Math.max(1, center);
  return {
    width: size,
    height: size,
    alpha: Array.from({ length: size * size }, (_, index) => {
      const x = index % size;
      const y = Math.floor(index / size);
      return Math.max(0, 1 - Math.hypot(x - center, y - center) / radius);
    }),
  };
}

function request(overrides: Partial<StudioDualTipRequest> = {}): StudioDualTipRequest {
  return {
    contractVersion: STUDIO_DUAL_TIP_CONTRACT_VERSION,
    primary: radialField(),
    secondary: radialField(),
    samples: [{ x: 16.5, y: 16.5, pressure: 0.5 }],
    combineMode: "max",
    diameter: 16,
    spacingRatio: 0.25,
    seed: 0x1234_abcd,
    opacity: 1,
    linearColor: [0.75, 0.4, 0.2],
    output: { width: 33, height: 33 },
    ...overrides,
  };
}

function artifact(result: ReturnType<typeof renderStudioDualBrushTip>): StudioDualTipArtifact {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.artifact;
}

function commandValue(
  value: StudioDualTipArtifact,
  name: (typeof STUDIO_DUAL_TIP_PACKED_LAYOUT)[number],
  stamp = 0
): number {
  const field = STUDIO_DUAL_TIP_PACKED_LAYOUT.indexOf(name);
  return value.commands.values[stamp * STUDIO_DUAL_TIP_PACKED_STRIDE + field]!;
}

function alphaAt(value: StudioDualTipArtifact, x: number, y: number): number {
  return value.premultipliedLinearRgba[(y * value.width + x) * 4 + 3]!;
}

describe("studio dual-tip engine — independent alpha-combine oracle", () => {
  const cases: readonly [StudioDualTipCombineMode, number][] = [
    ["multiply", 0.32],
    ["min", 0.4],
    ["max", 0.8],
    ["add", 1],
    ["subtract", 0.4],
    ["intersect", 0.2],
  ];

  it.each(cases)("defines %s with an exact public linear-alpha behavior", (mode, expected) => {
    expect(combineStudioDualTipAlpha(0.8, 0.4, mode)).toBeCloseTo(expected, 12);

    const value = artifact(renderStudioDualBrushTip(request({
      primary: constantField(0.8),
      secondary: constantField(0.4),
      samples: [{ x: 0.5, y: 0.5 }],
      combineMode: mode,
      diameter: 1,
      linearColor: [1, 1, 1],
      output: { width: 1, height: 1 },
    })));

    expect(alphaAt(value, 0, 0)).toBeCloseTo(expected, 6);
  });

  it("keeps a symmetric tip symmetric when jitter and offsets are disabled", () => {
    const value = artifact(renderStudioDualBrushTip(request()));

    for (let y = 0; y < value.height; y += 1) {
      for (let x = 0; x < value.width; x += 1) {
        expect(alphaAt(value, x, y)).toBeCloseTo(
          alphaAt(value, value.width - 1 - x, y),
          6
        );
        expect(alphaAt(value, x, y)).toBeCloseTo(
          alphaAt(value, x, value.height - 1 - y),
          6
        );
      }
    }
  });

  it("replays a seeded jitter stream exactly and changes it for a different seed", () => {
    const input = request({
      samples: [
        { x: 6, y: 16, pressure: 0.2 },
        { x: 27, y: 16, pressure: 0.9 },
      ],
      diameter: 9,
      spacingRatio: 0.3,
      jitter: {
        position: 0.25,
        rotationDegrees: 35,
        scale: 0.3,
        opacity: 0.4,
      },
    });
    const first = artifact(renderStudioDualBrushTip(input));
    const replay = artifact(renderStudioDualBrushTip(input));
    const otherSeed = artifact(renderStudioDualBrushTip({ ...input, seed: input.seed + 1 }));

    expect(replay).toEqual(first);
    expect(otherSeed.commands.values).not.toEqual(first.commands.values);
    expect(otherSeed.premultipliedLinearRgba).not.toEqual(first.premultipliedLinearRgba);
  });

  it("increases resolved size and opacity monotonically with pressure", () => {
    const dynamics = {
      pressureSizeGain: 0.8,
      pressureOpacityGain: 1,
    };
    const light = artifact(renderStudioDualBrushTip(request({
      samples: [{ x: 16.5, y: 16.5, pressure: 0.2 }],
      dynamics,
    })));
    const heavy = artifact(renderStudioDualBrushTip(request({
      samples: [{ x: 16.5, y: 16.5, pressure: 0.9 }],
      dynamics,
    })));

    expect(commandValue(heavy, "primaryScaleX")).toBeGreaterThan(
      commandValue(light, "primaryScaleX")
    );
    expect(commandValue(heavy, "primaryScaleY")).toBeGreaterThan(
      commandValue(light, "primaryScaleY")
    );
    expect(commandValue(heavy, "opacity")).toBeGreaterThan(commandValue(light, "opacity"));
    expect(alphaAt(heavy, 16, 16)).toBeGreaterThan(alphaAt(light, 16, 16));
  });

  it("resolves tilt orientation and velocity attenuation before packing", () => {
    const dynamics = {
      tiltStretchGain: 1.5,
      tiltRotationGain: 0.5,
      velocitySizeGain: 0.75,
      velocityOpacityGain: 0.75,
      referenceVelocity: 1_000,
    };
    const resting = artifact(renderStudioDualBrushTip(request({
      samples: [{ x: 16.5, y: 16.5, pressure: 0.5 }],
      dynamics,
    })));
    const movingTilted = artifact(renderStudioDualBrushTip(request({
      samples: [{
        x: 16.5,
        y: 16.5,
        pressure: 0.5,
        tiltX: 0.6,
        tiltY: 0.8,
        velocity: 2_000,
      }],
      dynamics,
    })));

    expect(commandValue(movingTilted, "primaryRotationRadians")).toBeCloseTo(
      Math.atan2(0.8, 0.6) * 0.5,
      6
    );
    expect(commandValue(movingTilted, "primaryScaleX")).toBeGreaterThan(
      commandValue(movingTilted, "primaryScaleY")
    );
    expect(commandValue(movingTilted, "primaryScaleX")).toBeLessThan(
      commandValue(resting, "primaryScaleX") * 2.5
    );
    expect(commandValue(movingTilted, "opacity")).toBeLessThan(
      commandValue(resting, "opacity")
    );
    expect(commandValue(movingTilted, "pressure")).toBeCloseTo(0.5, 6);
    expect(commandValue(movingTilted, "tiltX")).toBeCloseTo(0.6, 6);
    expect(commandValue(movingTilted, "tiltY")).toBeCloseTo(0.8, 6);
    expect(commandValue(movingTilted, "velocity")).toBe(2_000);
  });

  it("composites premultiplied linear color without transparent RGB halos", () => {
    const value = artifact(renderStudioDualBrushTip(request({
      linearColor: [0.9, 0.55, 0.25],
      opacity: 0.65,
    })));

    for (let offset = 0; offset < value.premultipliedLinearRgba.length; offset += 4) {
      const red = value.premultipliedLinearRgba[offset]!;
      const green = value.premultipliedLinearRgba[offset + 1]!;
      const blue = value.premultipliedLinearRgba[offset + 2]!;
      const alpha = value.premultipliedLinearRgba[offset + 3]!;
      expect(red).toBeGreaterThanOrEqual(0);
      expect(green).toBeGreaterThanOrEqual(0);
      expect(blue).toBeGreaterThanOrEqual(0);
      expect(red).toBeLessThanOrEqual(alpha);
      expect(green).toBeLessThanOrEqual(alpha);
      expect(blue).toBeLessThanOrEqual(alpha);
      if (alpha === 0) expect([red, green, blue]).toEqual([0, 0, 0]);
    }
  });
});

describe("studio dual-tip engine — exact v2 logical-deposition oracle", () => {
  it("locks the two-overlap regression at 0.0975 instead of the aggregate-mask 0.1425", () => {
    const deposition: StudioDualTipExactDepositionPixel = {
      primaryCoverage: 0.5,
      secondaryCoverage: 0.5,
      paintAlpha: 0.2,
      linearColor: [1, 1, 1],
      blendFamily: "multiply",
      porterDuff: "source-over",
    };

    const exact = compositeStudioDualTipExactSequenceV2([deposition, deposition]);
    expect(exact[3]).toBeCloseTo(0.0975, 7);

    // The removed v1 approximation accumulated each mask first and then inferred paint alpha:
    // primaryRaw=.75, effectivePrimary=.19, secondary=.75 => .75*.75*(.19/.75).
    const forbiddenAggregateApproximation = 0.75 * 0.75 * (0.19 / 0.75);
    expect(forbiddenAggregateApproximation).toBeCloseTo(0.1425, 12);
    expect(exact[3]).not.toBeCloseTo(forbiddenAggregateApproximation, 5);
  });

  it("defines all eight dynamic families plus exact legacy soft-intersection replay", () => {
    const cases = [
      ["intersect", 0.32],
      ["darken", 0.4],
      ["lighten", 0.8],
      ["multiply", 0.32],
      ["screen", 0.88],
      ["add", 1],
      ["subtract", 0.4],
      ["difference", 0.4],
      ["soft-intersect", 0.2],
    ] as const;

    for (const [family, expected] of cases) {
      expect(combineStudioDualTipExactCoverageV2(0.8, 0.4, family)).toBeCloseTo(
        expected,
        12,
      );
    }
  });

  it("applies source-over and destination-out in sequence with premultiplied linear RGBA", () => {
    const painted = compositeStudioDualTipExactDepositionV2(
      [0.1, 0.05, 0.025, 0.25],
      {
        primaryCoverage: 0.8,
        secondaryCoverage: 0.5,
        paintAlpha: 0.5,
        linearColor: [0.9, 0.4, 0.2],
        blendFamily: "darken",
        porterDuff: "source-over",
      },
    );
    expect(painted).toEqual([
      Math.fround(0.9 * 0.25 + 0.1 * 0.75),
      Math.fround(0.4 * 0.25 + 0.05 * 0.75),
      Math.fround(0.2 * 0.25 + 0.025 * 0.75),
      Math.fround(0.25 + 0.25 * 0.75),
    ]);

    const erased = compositeStudioDualTipExactDepositionV2(painted, {
      primaryCoverage: 0.5,
      secondaryCoverage: 0.5,
      paintAlpha: 0.4,
      linearColor: [1, 0, 1],
      blendFamily: "lighten",
      porterDuff: "destination-out",
    });
    const inverse = Math.fround(1 - Math.fround(0.5 * 0.4));
    expect(erased).toEqual(painted.map((value) => Math.fround(value * inverse)));
  });

  it("matches an independent randomized scalar corpus for overlap, color and eraser order", () => {
    let state = 0x6d2b_79f5;
    const random = () => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 0x1_0000_0000;
    };
    const families = [
      "intersect",
      "darken",
      "lighten",
      "multiply",
      "screen",
      "add",
      "subtract",
      "difference",
    ] as const;
    const corpus: StudioDualTipExactDepositionPixel[] = Array.from(
      { length: 512 },
      (_, index) => ({
        primaryCoverage: random(),
        secondaryCoverage: random(),
        paintAlpha: random(),
        linearColor: [random(), random(), random()] as const,
        blendFamily: families[index % families.length]!,
        porterDuff: index % 11 === 0 ? "destination-out" : "source-over",
      }),
    );

    let independent = [0, 0, 0, 0] as [number, number, number, number];
    for (const deposition of corpus) {
      const a = Math.min(1, Math.max(0, deposition.primaryCoverage));
      const b = Math.min(1, Math.max(0, deposition.secondaryCoverage));
      const family = deposition.blendFamily;
      const combined = family === "intersect" || family === "multiply"
        ? a * b
        : family === "darken"
          ? Math.min(a, b)
          : family === "lighten"
            ? Math.max(a, b)
            : family === "screen"
              ? 1 - (1 - a) * (1 - b)
              : family === "add"
                ? Math.min(1, a + b)
                : family === "subtract"
                  ? Math.max(0, a - b)
                  : Math.abs(a - b);
      const sourceAlpha = Math.fround(combined * deposition.paintAlpha);
      const inverse = Math.fround(1 - sourceAlpha);
      if (deposition.porterDuff === "destination-out") {
        independent = independent.map(
          (value) => Math.fround(value * inverse),
        ) as [number, number, number, number];
      } else {
        independent = [
          Math.fround(
            deposition.linearColor[0] * sourceAlpha + independent[0] * inverse,
          ),
          Math.fround(
            deposition.linearColor[1] * sourceAlpha + independent[1] * inverse,
          ),
          Math.fround(
            deposition.linearColor[2] * sourceAlpha + independent[2] * inverse,
          ),
          Math.fround(sourceAlpha + independent[3] * inverse),
        ];
      }
    }

    expect(compositeStudioDualTipExactSequenceV2(corpus)).toEqual(independent);
  });
});

describe("studio dual-tip engine — packed GPU/WASM-ready execution contract", () => {
  it("packs explicit rotations, scales and normalized secondary offsets after resolution", () => {
    const value = artifact(renderStudioDualBrushTip(request({
      primaryTransform: {
        rotationDegrees: 90,
        scaleX: 2,
        scaleY: 0.5,
      },
      secondaryTransform: {
        rotationDegrees: -45,
        scaleX: 1.5,
        scaleY: 0.75,
        offsetX: 0.25,
        offsetY: -0.125,
      },
      diameter: 20,
    })));

    expect(commandValue(value, "primaryRotationRadians")).toBeCloseTo(Math.PI / 2, 6);
    expect(commandValue(value, "primaryScaleX")).toBeCloseTo(2, 6);
    expect(commandValue(value, "primaryScaleY")).toBeCloseTo(0.5, 6);
    expect(commandValue(value, "secondaryRotationRadians")).toBeCloseTo(-Math.PI / 4, 6);
    expect(commandValue(value, "secondaryScaleX")).toBeCloseTo(1.5, 6);
    expect(commandValue(value, "secondaryScaleY")).toBeCloseTo(0.75, 6);
    expect(commandValue(value, "secondaryOffsetX")).toBeCloseTo(5, 6);
    expect(commandValue(value, "secondaryOffsetY")).toBeCloseTo(-2.5, 6);
  });

  it("resamples spacing deterministically into fixed-width float records", () => {
    const value = artifact(renderStudioDualBrushTip(request({
      primary: constantField(1),
      secondary: constantField(1),
      samples: [
        { x: 4, y: 16, pressure: 0.25 },
        { x: 28, y: 16, pressure: 0.75 },
      ],
      diameter: 8,
      spacingRatio: 0.5,
    })));

    expect(value.stampCount).toBe(7);
    expect(value.commands.count).toBe(7);
    expect(value.commands.stride).toBe(24);
    expect(value.commands.values).toHaveLength(7 * STUDIO_DUAL_TIP_PACKED_STRIDE);
    expect(Array.from({ length: 7 }, (_, index) => (
      commandValue(value, "centerX", index)
    ))).toEqual([4, 8, 12, 16, 20, 24, 28]);
    expect(commandValue(value, "pressure", 0)).toBeCloseTo(0.25, 6);
    expect(commandValue(value, "pressure", 6)).toBeCloseTo(0.75, 6);
  });

  it("preserves a tap as one visible command and serializable artifact", () => {
    const value = artifact(renderStudioDualBrushTip(request({
      samples: [{ x: 16.5, y: 16.5, pressure: 0.7 }],
    })));

    expect(value.stampCount).toBe(1);
    expect(alphaAt(value, 16, 16)).toBeGreaterThan(0);
    expect(structuredClone(value)).toEqual(value);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it("publishes an explicit clean-room provenance and CPU authority receipt", () => {
    const value = artifact(renderStudioDualBrushTip(request()));

    expect(value.receipt).toBe(STUDIO_DUAL_TIP_RECEIPT);
    expect(value.receipt).toMatchObject({
      provenance: "clean-room-public-behavior",
      executionSource: "toonspectrum-independent-core",
      restrictedSourcePolicy: "prohibited-direct-port",
      goldenCorpusOwnership: "toonspectrum-independent-behavior-corpus",
      alphaContract: "premultiplied-linear-rgba-f32",
      authority: "cpu-f32-oracle",
      packedCommandContract: "gpu-wasm-ready-f32-v1",
    });
    expect(value.receipt.combineModes).toEqual([
      "multiply",
      "min",
      "max",
      "add",
      "subtract",
      "intersect",
    ]);
  });
});

describe("studio dual-tip engine — bounded fail-closed behavior", () => {
  it("rejects a stamp before rasterization when its work estimate exceeds budget", () => {
    const result = renderStudioDualBrushTip(request({
      primary: constantField(1),
      secondary: constantField(1),
      samples: [{ x: 64, y: 64 }],
      diameter: 64,
      output: { width: 128, height: 128 },
      workBudget: 10,
    }));

    expect(result).toEqual({
      ok: false,
      error: { code: "budget-exceeded", stage: "planning" },
    });
  });

  it("bounds pathological sub-pixel spacing by the stamp cap", () => {
    const result = renderStudioDualBrushTip(request({
      samples: [
        { x: 0.5, y: 0.5 },
        { x: 10.5, y: 0.5 },
      ],
      diameter: 0.1,
      spacingRatio: 0.01,
      output: { width: 1, height: 1 },
    }));

    expect(result).toEqual({
      ok: false,
      error: { code: "budget-exceeded", stage: "planning" },
    });
  });

  it.each([
    ["out-of-range alpha", { primary: constantField(1.01) }],
    ["non-finite alpha", { primary: constantField(Number.NaN) }],
    ["zero seed", { seed: 0 }],
    ["prototype combine key", { combineMode: "__proto__" }],
    ["non-finite diameter", { diameter: Number.NaN }],
    ["primary-only offset", { primaryTransform: { offsetX: 0.1 } }],
    ["zero output edge", { output: { width: 0, height: 10 } }],
    ["non-finite sample", { samples: [{ x: Number.NaN, y: 1 }] }],
    ["zero work budget", { workBudget: 0 }],
    ["unsupported contract", { contractVersion: 2 }],
  ] as const)("rejects malformed input: %s", (_label, overrides) => {
    const result = renderStudioDualBrushTip(request(
      overrides as unknown as Partial<StudioDualTipRequest>
    ));

    expect(result).toEqual({
      ok: false,
      error: { code: "invalid-request", stage: "validation" },
    });
  });

  it("returns no partial raster for mathematically empty coverage", () => {
    const result = renderStudioDualBrushTip(request({
      primary: constantField(0.2),
      secondary: constantField(0.8),
      combineMode: "subtract",
    }));

    expect(result).toEqual({
      ok: false,
      error: { code: "empty-output", stage: "raster" },
    });
  });
});
