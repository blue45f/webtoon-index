import { describe, expect, it } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import {
  parseStudioCanonicalBrushPlan,
  type StudioCanonicalBrushPlan,
} from "./studio-canonical-brush-plan";
import {
  lowerStudioCanonicalBrushPlanToWebGpuDabs,
} from "./studio-canonical-brush-webgpu-lowering";

function curve(minimum = 1, maximum = 1, exponent = 1) {
  return { minimum, maximum, exponent };
}

function sample(sequence: number, x: number, y: number, pressure = 0.5) {
  return {
    role: "authoritative",
    sequence,
    x,
    y,
    pressure,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    timeMilliseconds: sequence,
    pointerId: 1,
    flags: 0,
  };
}

function plan(
  overrides: {
    samples?: ReturnType<typeof sample>[];
    seed?: number;
    brushId?: string;
    material?: "ink" | "graphite" | "marker" | "air" | "pigment" | "eraser";
    porterDuff?: "source-over" | "destination-out";
    size?: number;
    spacingRatio?: number;
    scatterRatio?: number;
    pressure?: {
      size: ReturnType<typeof curve>;
      opacity: ReturnType<typeof curve>;
      flow: ReturnType<typeof curve>;
    };
    transform?: {
      encoding: "affine-f64-v1";
      m11: number;
      m12: number;
      m21: number;
      m22: number;
      translateX: number;
      translateY: number;
    };
    tip?: unknown;
    grain?: unknown;
    engine?: "dab-v1" | "wet-media-v1";
    wetMedia?: unknown;
  } = {},
): StudioCanonicalBrushPlan {
  const samples = overrides.samples ?? [
    sample(1, 0, 0, 0),
    sample(2, 20, 0, 1),
  ];
  const candidate = {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
    strokeId: `stroke-${overrides.brushId ?? "g-pen"}`,
    seed: overrides.seed ?? 0x1234_5678,
    coordinateSpace: "document-css-px",
    transform: overrides.transform ?? {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.1, 0.2, 0.3, 0.8],
    },
    composite: {
      porterDuff: overrides.porterDuff ?? "source-over",
      blendMode: "normal",
      opacity: 0.75,
    },
    recipe: {
      version: 1,
      brushId: overrides.brushId ?? "g-pen",
      engine: overrides.engine ?? "dab-v1",
      material: overrides.material ?? "ink",
      tip: overrides.tip ?? {
        kind: "analytic",
        shape: "round",
        edgeSoftness: 0.1,
      },
      size: overrides.size ?? 10,
      flow: 0.5,
      hardness: 0.8,
      spacingRatio: overrides.spacingRatio ?? 0.5,
      scatter: {
        radiusRatio: overrides.scatterRatio ?? 0,
        distribution: "uniform-disk",
      },
      angleRadians: 0,
      roundness: 1,
      pressure: overrides.pressure ?? {
        size: curve(0.5, 1),
        opacity: curve(0.5, 1),
        flow: curve(0.5, 1),
      },
      grain: overrides.grain ?? null,
      wetMedia: overrides.wetMedia ?? null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: samples[0]!.sequence,
      lastSequence: samples.at(-1)!.sequence,
      samples,
    },
  };
  const parsed = parseStudioCanonicalBrushPlan(candidate, {
    sessionEpoch: 1,
    strokeEpoch: 1,
    lastAcceptedCommandSequence: 0,
  });
  if (!parsed.ok) throw new Error(`${parsed.reason}: ${parsed.path}`);
  return parsed.value.plan;
}

function lowered(value: StudioCanonicalBrushPlan) {
  const result = lowerStudioCanonicalBrushPlanToWebGpuDabs(value);
  if (result.status !== "lowered") throw new Error(result.status);
  return result;
}

function paintPlan(
  model: "layered-flow-v1" | "bounded-flow-v2",
): StudioCanonicalBrushPlan {
  const candidate = structuredClone(plan({
    brushId: model === "bounded-flow-v2" ? "airbrush" : "pen",
    material: model === "bounded-flow-v2" ? "air" : "ink",
  })) as unknown as Record<string, unknown>;
  const recipe = candidate.recipe as Record<string, unknown>;
  recipe.version = 2;
  recipe.paint = {
    model,
    depositionAlpha: "flow-times-dab-opacity",
    accumulation: "source-over-stroke-local-rgba",
    finalCompositeOpacity: "plan-composite-opacity-once",
    surface: model === "bounded-flow-v2"
      ? "bounded-sparse-rgba-tiles"
      : "stroke-local-rgba",
  };
  recipe.retainedDynamics = model === "bounded-flow-v2"
    ? normalizeStudioBrushDynamicsSettings({
        seed: 202,
        tip: { shape: "soft", softness: 0.42 },
        spacingRatio: 0.145,
        scatterRatio: 0.04,
        width: {
          base: 10,
          mappings: [{ source: "pressure", from: 0.7, to: 1.25 }],
          jitter: { mode: "multiply", amount: 0.1 },
        },
      })
    : null;
  const source = candidate.source as Record<string, unknown>;
  source.samples = (source.samples as Array<Record<string, unknown>>).map((sampleValue) => ({
    role: "authoritative",
    ...sampleValue,
  }));
  const parsed = parseStudioCanonicalBrushPlan(candidate, {
    sessionEpoch: 1,
    strokeEpoch: 1,
    lastAcceptedCommandSequence: 0,
  });
  if (!parsed.ok) throw new Error(`${parsed.reason}: ${parsed.path}`);
  return parsed.value.plan;
}

describe("canonical brush WebGPU lowering", () => {
  it("keeps a tap and emits one contiguous batch", () => {
    const result = lowered(plan({
      samples: [sample(8, 3, 4, 0.75)],
    }));

    expect(result.dabs).toHaveLength(1);
    expect(result.dabs[0]).toMatchObject({
      index: 0,
      stationX: 3,
      stationY: 4,
      pressure: 0.75,
    });
    expect(result.batches).toEqual([{
      composite: { porterDuff: "source-over", blendMode: "normal" },
      colorSpace: "linear-srgb",
      firstInstance: 0,
      instanceCount: 1,
    }]);
  });

  it("fills a coalesced G-pen gap by arc length and retains both endpoints", () => {
    const result = lowered(plan({
      samples: [sample(1, 0, 0, 1), sample(99, 20, 0, 1)],
      size: 10,
      spacingRatio: 0.5,
    }));

    expect(result.dabs.map((dab) => dab.stationX)).toEqual([0, 5, 10, 15, 20]);
    expect(result.dabs.every((dab) => dab.stationY === 0)).toBe(true);
  });

  it("interpolates pressure before resolving size, opacity and flow", () => {
    const result = lowered(plan({
      samples: [sample(1, 0, 0, 0), sample(2, 20, 0, 1)],
      pressure: {
        size: curve(0.5, 1),
        opacity: curve(0.25, 1),
        flow: curve(0.5, 1),
      },
    }));

    expect(result.dabs[0]!.diameter).toBe(5);
    expect(result.dabs.at(-1)!.diameter).toBe(10);
    expect(result.dabs.at(-1)!.opacity).toBe(0.75);
    expect(result.dabs.at(-1)!.flow).toBe(0.5);
    expect(result.dabs.at(-1)!.color.components[3]).toBeCloseTo(0.3);
  });

  it("applies the complete affine transform to centres and tip basis", () => {
    const result = lowered(plan({
      samples: [sample(1, 1, 2, 1)],
      transform: {
        encoding: "affine-f64-v1",
        m11: 2,
        m12: 0,
        m21: 1,
        m22: 3,
        translateX: 4,
        translateY: -2,
      },
    }));

    expect(result.dabs[0]).toMatchObject({
      stationX: 8,
      stationY: 4,
      tip: { localToDocument: [10, 0, 5, 15] },
    });
  });

  it("makes seeded airbrush scatter deterministic and uniformly bounded", () => {
    const input = plan({
      brushId: "airbrush",
      material: "air",
      scatterRatio: 1.5,
      samples: [sample(1, 0, 0, 1), sample(2, 30, 0, 1)],
    });
    const first = lowered(input);
    const replay = lowered(structuredClone(input));

    expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
    for (const dab of first.dabs) {
      expect(Math.hypot(dab.x - dab.stationX, dab.y - dab.stationY))
        .toBeLessThanOrEqual(dab.diameter * 1.5 + 1e-5);
    }
  });

  it("preserves straight linear colour and destination-out eraser semantics", () => {
    const result = lowered(plan({
      brushId: "eraser",
      material: "eraser",
      porterDuff: "destination-out",
      samples: [sample(1, 0, 0, 1)],
    }));

    expect(result.dabs[0]!.color).toEqual({
      space: "linear-srgb",
      alphaMode: "straight",
      components: [Math.fround(0.1), Math.fround(0.2), Math.fround(0.3), Math.fround(0.3)],
    });
    expect(result.dabs[0]!.composite).toEqual({
      porterDuff: "destination-out",
      blendMode: "normal",
    });
  });

  it.each([
    ["texture tip", { tip: {
      kind: "texture",
      assetId: "tip",
      contentHash: "sha256:abcdef0123456789",
      channel: "alpha",
      width: 16,
      height: 16,
    } }, ["texture-tip"]],
    ["grain", { grain: {
      kind: "procedural-noise",
      assetId: null,
      contentHash: null,
      space: "document",
      scale: 4,
      depth: 0.3,
      contrast: 0.5,
      seed: 9,
    } }, ["grain"]],
    ["wet media", {
      brushId: "watercolor",
      material: "pigment",
      engine: "wet-media-v1",
      wetMedia: {
        model: "pigment-water-v1",
        fieldScale: 2,
        fixedRateHz: 120,
        simulationSteps: 8,
        absorption: 0.2,
        bleed: 0.3,
        dryingRate: 0.4,
        edgeDarkening: 0.5,
        fixationRate: 0.2,
        granulation: 0.3,
        paperRoughness: 0.4,
        pigmentLoad: 0.8,
        waterLoad: 0.7,
        wetnessLoad: 0.9,
      },
    }, ["wet-media"]],
  ])("requires a specialist for %s", (_label, overrides, requirements) => {
    expect(lowerStudioCanonicalBrushPlanToWebGpuDabs(
      plan(overrides as Parameters<typeof plan>[0]),
    )).toMatchObject({
      status: "lowering-required",
      requirements,
    });
  });

  it("requires explicit paint/dynamics specialists for recipe v2 instead of multiplying opacity per dab", () => {
    expect(lowerStudioCanonicalBrushPlanToWebGpuDabs(
      paintPlan("layered-flow-v1"),
    )).toMatchObject({
      status: "lowering-required",
      requirements: ["stroke-local-compositor"],
    });
    expect(lowerStudioCanonicalBrushPlanToWebGpuDabs(
      paintPlan("bounded-flow-v2"),
    )).toMatchObject({
      status: "lowering-required",
      requirements: ["retained-dynamics", "stroke-local-compositor"],
    });
  });

  it("fails closed on output limits and forged non-finite typed input", () => {
    const input = plan({
      samples: [sample(1, 0, 0, 1), sample(2, 100, 0, 1)],
      spacingRatio: 0.1,
    });
    expect(lowerStudioCanonicalBrushPlanToWebGpuDabs(input, { maximumDabs: 2 }))
      .toEqual({ status: "rejected", reason: "dab-limit-exceeded" });
    const forged = {
      ...input,
      recipe: { ...input.recipe, size: Number.NaN },
    } as StudioCanonicalBrushPlan;
    expect(lowerStudioCanonicalBrushPlanToWebGpuDabs(forged))
      .toEqual({ status: "rejected", reason: "invalid-plan" });
  });
});
