import { describe, expect, it } from "vitest";

import {
  validateStudioEngineWebGpuBrushPlan,
} from "./render/studio-engine-webgpu-brush-runtime";
import {
  parseStudioCanonicalBrushPlan,
  type StudioCanonicalBrushPlan,
} from "./studio-canonical-brush-plan";
import {
  parseStudioProfessionalBrushDynamicsPlan,
  type StudioProfessionalBrushChannelName,
  type StudioProfessionalBrushDynamicsPlan,
  type StudioProfessionalBrushMapping,
} from "./studio-professional-brush-dynamics";
import {
  lowerStudioProfessionalBrushToWebGpu,
} from "./studio-professional-brush-webgpu-lowering";

const identityCurve = {
  interpolation: "monotone-cubic",
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
} as const;

function mapping(
  source: StudioProfessionalBrushMapping["source"],
  outputMin: number,
  outputMax: number,
): StudioProfessionalBrushMapping {
  return {
    source,
    combine: "replace",
    outputMin,
    outputMax,
    curve: identityCurve,
  };
}

function sourceSample(
  sequence: number,
  timeMilliseconds: number,
  x: number,
  overrides: Partial<{
    y: number;
    pressure: number;
    tangentialPressure: number;
    tiltX: number;
    tiltY: number;
    twist: number;
  }> = {},
) {
  return {
    role: "authoritative",
    sequence,
    x,
    y: overrides.y ?? 0,
    pressure: overrides.pressure ?? 0.5,
    tangentialPressure: overrides.tangentialPressure ?? 0,
    tiltX: overrides.tiltX ?? 0,
    tiltY: overrides.tiltY ?? 0,
    twist: overrides.twist ?? 0,
    timeMilliseconds,
    pointerId: 1,
    flags: 0,
  };
}

const validWetMedia = {
  model: "pigment-water-v1",
  fieldScale: 1,
  fixedRateHz: 60,
  simulationSteps: 2,
  absorption: 0.5,
  bleed: 0.5,
  dryingRate: 0.5,
  edgeDarkening: 0.5,
  fixationRate: 0.5,
  granulation: 0.5,
  paperRoughness: 0.5,
  pigmentLoad: 0.5,
  waterLoad: 0.5,
  wetnessLoad: 0.5,
} as const;

function canonicalPlan(
  overrides: {
    readonly samples?: readonly ReturnType<typeof sourceSample>[];
    readonly seed?: number;
    readonly transform?: Readonly<{
      encoding: "affine-f64-v1";
      m11: number;
      m12: number;
      m21: number;
      m22: number;
      translateX: number;
      translateY: number;
    }>;
    readonly colorSpace?: "linear-srgb" | "linear-display-p3";
    readonly blendMode?: "normal" | "multiply";
    readonly opacity?: number;
    readonly hardness?: number;
    readonly tip?: unknown;
    readonly grain?: unknown;
    readonly engine?: "dab-v1" | "wet-media-v1";
    readonly material?: "ink" | "pigment";
    readonly wetMedia?: unknown;
  } = {},
): StudioCanonicalBrushPlan {
  const samples = overrides.samples ?? [
    sourceSample(1, 0, 0),
    sourceSample(2, 10, 10),
  ];
  const candidate = {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
    strokeId: "professional-stroke",
    seed: overrides.seed ?? 0x1357_2468,
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
      space: overrides.colorSpace ?? "linear-srgb",
      alphaMode: "straight",
      components: [0.1, 0.2, 0.3, 0.8],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: overrides.blendMode ?? "normal",
      opacity: overrides.opacity ?? 0.75,
    },
    recipe: {
      version: 1,
      brushId: "professional-clean-room",
      engine: overrides.engine ?? "dab-v1",
      material: overrides.material ?? "ink",
      tip: overrides.tip ?? {
        kind: "analytic",
        shape: "ellipse",
        edgeSoftness: 0.2,
      },
      size: 10,
      flow: 1,
      hardness: overrides.hardness ?? 0.7,
      spacingRatio: 0.25,
      scatter: {
        radiusRatio: 0,
        distribution: "uniform-disk",
      },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: { minimum: 1, maximum: 1, exponent: 1 },
        opacity: { minimum: 1, maximum: 1, exponent: 1 },
        flow: { minimum: 1, maximum: 1, exponent: 1 },
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

function dynamicsPlan(
  overrides: {
    readonly seed?: number;
    readonly tickMilliseconds?: number;
    readonly spacing?: number;
    readonly channelBase?: Partial<Readonly<Record<StudioProfessionalBrushChannelName, number>>>;
    readonly channelMappings?: Partial<
      Readonly<Record<StudioProfessionalBrushChannelName, readonly StudioProfessionalBrushMapping[]>>
    >;
    readonly taper?: Partial<StudioProfessionalBrushDynamicsPlan["taper"]>;
    readonly stationary?: Partial<StudioProfessionalBrushDynamicsPlan["stationary"]>;
  } = {},
): StudioProfessionalBrushDynamicsPlan {
  const channel = (
    base: number,
    min: number,
    max: number,
    name: StudioProfessionalBrushChannelName,
  ) => ({
    base: overrides.channelBase?.[name] ?? base,
    min,
    max,
    mappings: overrides.channelMappings?.[name] ?? [],
  });
  const candidate = {
    kind: "studio-professional-brush-dynamics",
    version: 1,
    planId: "professional-webgpu",
    revision: 1,
    seed: overrides.seed ?? 0x2468_1357,
    units: {
      size: "document-css-px",
      opacity: "unit-interval",
      flow: "unit-interval",
      spacing: "document-css-px",
      angle: "radians",
      roundness: "unit-interval",
      scatter: "document-css-px",
      textureDepth: "unit-interval",
    },
    clock: {
      timeUnit: "milliseconds",
      tickMilliseconds: overrides.tickMilliseconds ?? 1,
    },
    budgets: {
      maxSamples: 1_024,
      maxEvents: 16_384,
      maxMappings: 64,
      maxCurvePoints: 64,
      maxStationaryEventsPerGap: 1_024,
    },
    velocity: {
      normalizationPixelsPerMillisecond: 1,
      smoothingTimeMilliseconds: 1,
      initialPixelsPerMillisecond: 0,
      maximumPixelsPerMillisecond: 100,
    },
    taper: {
      start: overrides.taper?.start ?? { mode: "stroke-percentage", value: 0 },
      end: overrides.taper?.end ?? { mode: "stroke-percentage", value: 0 },
      minimumSizeRatio: overrides.taper?.minimumSizeRatio ?? 0,
      minimumOpacityRatio: overrides.taper?.minimumOpacityRatio ?? 0,
      speedInfluence: overrides.taper?.speedInfluence ?? 0,
    },
    stationary: {
      mode: overrides.stationary?.mode ?? "disabled",
      intervalTicks: overrides.stationary?.intervalTicks ?? 2,
      movementEpsilonPixels: overrides.stationary?.movementEpsilonPixels ?? 0.01,
    },
    channels: {
      size: channel(10, 0.01, 512, "size"),
      opacity: channel(1, 0, 1, "opacity"),
      flow: channel(1, 0, 1, "flow"),
      spacing: channel(overrides.spacing ?? 5, 0.05, 512, "spacing"),
      angle: channel(0, -Math.PI * 2, Math.PI * 2, "angle"),
      roundness: channel(1, 0.01, 1, "roundness"),
      scatter: channel(0, 0, 512, "scatter"),
      textureDepth: channel(0, 0, 1, "textureDepth"),
    },
  };
  const parsed = parseStudioProfessionalBrushDynamicsPlan(candidate);
  if (!parsed.ok) throw new Error(`${parsed.reason}: ${parsed.path}`);
  return parsed.plan;
}

function ready(
  canonical: StudioCanonicalBrushPlan,
  dynamics: StudioProfessionalBrushDynamicsPlan,
  mode: "append" | "rebuild" = "rebuild",
) {
  const result = lowerStudioProfessionalBrushToWebGpu(canonical, dynamics, { mode });
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  return result.plan;
}

describe("professional brush dynamics to rich WebGPU lowering", () => {
  it("lowers pressure, tilt, speed, angle and roundness into actual GPU dab fields", () => {
    const canonical = canonicalPlan({
      opacity: 0.8,
      samples: [
        sourceSample(1, 0, 0, {
          pressure: 0,
          tiltX: 0,
          twist: 0,
        }),
        sourceSample(2, 10, 10, {
          pressure: 1,
          tiltX: 45,
          twist: 180,
        }),
      ],
    });
    const dynamics = dynamicsPlan({
      spacing: 5,
      channelMappings: {
        size: [mapping("pressure", 10, 20)],
        opacity: [mapping("tilt", 0, 1)],
        flow: [mapping("velocity", 0, 1)],
        angle: [mapping("twist", 0, Math.PI * 2)],
        roundness: [mapping("progress", 0.5, 1)],
      },
    });
    const plan = ready(canonical, dynamics);
    const last = plan.dabs.at(-1)!;

    expect(plan.dabs).toHaveLength(3);
    expect(last.stationX).toBe(10);
    expect(last.pressure).toBe(1);
    expect(last.diameter).toBe(20);
    expect(last.opacity).toBeCloseTo(0.4, 6);
    expect(last.flow).toBeGreaterThan(0.99);
    expect(last.tip.angleRadians).toBeCloseTo(Math.PI, 6);
    expect(last.tip.roundness).toBe(1);
    expect(last.tip.hardness).toBeCloseTo(0.7, 6);
    expect(last.tip.edgeSoftness).toBeCloseTo(0.2, 6);
    expect(last.color.components[3]).toBeCloseTo(0.8 * last.opacity * last.flow, 6);
    expect(validateStudioEngineWebGpuBrushPlan(plan, 65_536)).not.toBeNull();
  });

  it("preserves start/end taper in GPU diameter and opacity", () => {
    const canonical = canonicalPlan({
      samples: [
        sourceSample(1, 0, 0),
        sourceSample(2, 50, 50),
        sourceSample(3, 100, 100),
      ],
    });
    const dynamics = dynamicsPlan({
      spacing: 50,
      channelBase: { size: 100 },
      taper: {
        start: { mode: "stroke-percentage", value: 0.25 },
        end: { mode: "stroke-percentage", value: 0.25 },
        minimumSizeRatio: 0.1,
        minimumOpacityRatio: 0.2,
        speedInfluence: 0,
      },
    });
    const plan = ready(canonical, dynamics);

    expect(plan.dabs.map((dab) => dab.diameter)).toEqual([10, 100, 10]);
    expect(plan.dabs[0]!.opacity).toBeCloseTo(0.15, 6);
    expect(plan.dabs[1]!.opacity).toBeCloseTo(0.75, 6);
    expect(plan.dabs[2]!.opacity).toBeCloseTo(0.15, 6);
  });

  it("turns fixed-tick stationary airbrush deposition into distinct GPU dabs", () => {
    const canonical = canonicalPlan({
      samples: [
        sourceSample(1, 0, 12),
        sourceSample(2, 10, 12),
      ],
    });
    const dynamics = dynamicsPlan({
      stationary: {
        mode: "continuous",
        intervalTicks: 2,
        movementEpsilonPixels: 0.01,
      },
    });
    const plan = ready(canonical, dynamics);

    expect(plan.dabs).toHaveLength(6);
    expect(plan.dabs.every((dab) => dab.stationX === 12)).toBe(true);
    expect(plan.dabs.map((dab) => dab.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("preserves the full affine analytic footprint, translation, angle and roundness", () => {
    const canonical = canonicalPlan({
      samples: [sourceSample(1, 0, 2, { y: 3 })],
      transform: {
        encoding: "affine-f64-v1",
        m11: 2,
        m12: 0.5,
        m21: 0.25,
        m22: 3,
        translateX: 10,
        translateY: 20,
      },
    });
    const dynamics = dynamicsPlan({
      channelBase: {
        size: 8,
        angle: Math.PI / 2,
        roundness: 0.5,
      },
    });
    const dab = ready(canonical, dynamics).dabs[0]!;

    expect(dab.stationX).toBe(14.75);
    expect(dab.stationY).toBe(30);
    expect(dab.tip.localToDocument).toEqual([1, 12, -4, -1]);
    expect(dab.tip.angleRadians).toBeCloseTo(Math.PI / 2, 6);
    expect(dab.tip.roundness).toBe(0.5);
  });

  it("is replay-exact across append/rebuild and domain-separates both explicit seeds", () => {
    const canonical = canonicalPlan({
      samples: [
        sourceSample(1, 0, 0),
        sourceSample(2, 10, 10),
      ],
    });
    const dynamics = dynamicsPlan({ channelBase: { scatter: 10 } });
    const rebuildA = ready(canonical, dynamics, "rebuild");
    const rebuildB = ready(canonical, dynamics, "rebuild");
    const append = ready(canonical, dynamics, "append");

    expect(rebuildA).toEqual(rebuildB);
    expect(rebuildA.dabs).toEqual(append.dabs);
    expect(rebuildA.batches).toEqual(append.batches);
    expect(rebuildA.mode).toBe("rebuild");
    expect(append.mode).toBe("append");

    const canonicalSeedChange = ready(canonicalPlan({ seed: 99 }), dynamics);
    const dynamicsSeedChange = ready(canonical, dynamicsPlan({
      seed: 101,
      channelBase: { scatter: 10 },
    }));
    expect(rebuildA.dabs.map((dab) => [dab.x, dab.y])).not.toEqual(
      canonicalSeedChange.dabs.map((dab) => [dab.x, dab.y]),
    );
    expect(rebuildA.dabs.map((dab) => [dab.x, dab.y])).not.toEqual(
      dynamicsSeedChange.dabs.map((dab) => [dab.x, dab.y]),
    );
  });

  it.each([
    {
      name: "texture tip",
      canonical: () => canonicalPlan({
        tip: {
          kind: "texture",
          assetId: "tip-asset",
          contentHash: "sha256:1234567890abcdef",
          channel: "alpha",
          width: 32,
          height: 32,
        },
      }),
      dynamics: () => dynamicsPlan(),
      reason: "texture-tip",
    },
    {
      name: "grain",
      canonical: () => canonicalPlan({
        grain: {
          kind: "procedural-noise",
          assetId: null,
          contentHash: null,
          space: "document",
          scale: 1,
          depth: 0.5,
          contrast: 0.5,
          seed: 1,
        },
      }),
      dynamics: () => dynamicsPlan(),
      reason: "grain",
    },
    {
      name: "wet media",
      canonical: () => canonicalPlan({
        engine: "wet-media-v1",
        material: "pigment",
        wetMedia: validWetMedia,
      }),
      dynamics: () => dynamicsPlan(),
      reason: "wet-media",
    },
    {
      name: "non-normal blend",
      canonical: () => canonicalPlan({ blendMode: "multiply" }),
      dynamics: () => dynamicsPlan(),
      reason: "unsupported-blend-mode",
    },
    {
      name: "texture-depth dynamics",
      canonical: () => canonicalPlan(),
      dynamics: () => dynamicsPlan({ channelBase: { textureDepth: 0.5 } }),
      reason: "texture-depth",
    },
  ])("fails closed for unsupported $name", ({ canonical, dynamics, reason }) => {
    expect(lowerStudioProfessionalBrushToWebGpu(canonical(), dynamics())).toMatchObject({
      status: "unsupported",
      reason,
    });
  });

  it("rejects fake frozen plans with unknown or invalid recipe fields", () => {
    const valid = canonicalPlan();
    const unknownRecipe = Object.freeze({
      ...valid,
      recipe: Object.freeze({
        ...valid.recipe,
        vendorTuning: true,
      }),
    }) as unknown as StudioCanonicalBrushPlan;
    expect(lowerStudioProfessionalBrushToWebGpu(
      unknownRecipe,
      dynamicsPlan(),
    )).toMatchObject({
      status: "rejected",
      reason: "invalid-canonical-plan",
    });

    const invalidIgnoredField = Object.freeze({
      ...valid,
      recipe: Object.freeze({
        ...valid.recipe,
        flow: 2,
      }),
    }) as StudioCanonicalBrushPlan;
    expect(lowerStudioProfessionalBrushToWebGpu(
      invalidIgnoredField,
      dynamicsPlan(),
    )).toMatchObject({
      status: "rejected",
      reason: "invalid-canonical-plan",
    });
  });

  it("rejects hostile canonical accessors without invoking their getter", () => {
    const valid = canonicalPlan();
    let getterReads = 0;
    const hostile: Record<string, unknown> = {};
    for (const key of Object.keys(valid)) {
      if (key === "recipe") continue;
      Object.defineProperty(hostile, key, {
        enumerable: true,
        value: valid[key as keyof StudioCanonicalBrushPlan],
      });
    }
    Object.defineProperty(hostile, "recipe", {
      enumerable: true,
      get() {
        getterReads += 1;
        return valid.recipe;
      },
    });
    Object.freeze(hostile);

    expect(lowerStudioProfessionalBrushToWebGpu(
      hostile as unknown as StudioCanonicalBrushPlan,
      dynamicsPlan(),
    )).toMatchObject({
      status: "rejected",
      reason: "invalid-canonical-plan",
    });
    expect(getterReads).toBe(0);
  });

  it("enforces sample clock, dab and transformed-coordinate budgets", () => {
    const canonical = canonicalPlan({
      samples: [
        sourceSample(1, 0, 0),
        sourceSample(2, 10, 10),
      ],
    });
    expect(lowerStudioProfessionalBrushToWebGpu(
      canonical,
      dynamicsPlan({ tickMilliseconds: 3 }),
    )).toMatchObject({
      status: "rejected",
      reason: "sample-clock-mismatch",
    });
    expect(lowerStudioProfessionalBrushToWebGpu(
      canonical,
      dynamicsPlan({ spacing: 1 }),
      { maximumDabs: 2 },
    )).toMatchObject({
      status: "rejected",
      reason: "dab-limit-exceeded",
    });
    expect(lowerStudioProfessionalBrushToWebGpu(
      canonical,
      dynamicsPlan(),
      { maximumCoordinateAbsolute: 5 },
    )).toMatchObject({
      status: "rejected",
      reason: "coordinate-budget-exceeded",
    });
  });
});
