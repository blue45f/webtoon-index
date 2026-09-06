import { describe, expect, it, vi } from "vitest";

import {
  validateStudioEngineWebGpuBrushPlan,
} from "./render/studio-engine-webgpu-brush-runtime";
import {
  resolveStudioProfessionalBristleDynamics,
} from "./studio-professional-bristle-dynamics";
import {
  STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1,
  lowerStudioProfessionalBristleToWebGpu,
} from "./studio-professional-bristle-webgpu-lowering";

import type {
  StudioProfessionalBristleWebGpuLoweringResult,
} from "./studio-professional-bristle-webgpu-lowering";

interface CanonicalFixtureOptions {
  readonly samples?: readonly Record<string, unknown>[];
  readonly transform?: Readonly<Record<string, unknown>>;
  readonly color?: Readonly<Record<string, unknown>>;
  readonly composite?: Readonly<Record<string, unknown>>;
  readonly recipe?: Readonly<Record<string, unknown>>;
}

function sample(
  sequence: number,
  x: number,
  y: number,
  pressure = 0.5,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
    timeMilliseconds: sequence * 8,
    pointerId: 1,
    flags: 0,
    ...overrides,
  };
}

function canonical(options: CanonicalFixtureOptions = {}): Record<string, unknown> {
  const samples = options.samples ?? [
    sample(1, 10, 10, 0.25),
    sample(2, 42, 10, 0.55, { tiltX: 25 }),
    sample(3, 58, 32, 0.8, { tiltX: 55, twist: 35 }),
    sample(4, 42, 58, 1, { tiltX: 70, twist: 80 }),
  ];
  return {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 7,
    strokeEpoch: 3,
    commandSequence: 11,
    strokeId: "professional-bristle-stroke",
    seed: 0x4a17,
    coordinateSpace: "document-css-px",
    transform: options.transform ?? {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 0,
      translateY: 0,
    },
    color: options.color ?? {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.82, 0.16, 0.04, 0.8],
    },
    composite: options.composite ?? {
      porterDuff: "source-over",
      blendMode: "normal",
      opacity: 0.72,
    },
    recipe: options.recipe ?? recipe(),
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: samples[0]!.sequence,
      lastSequence: samples.at(-1)!.sequence,
      samples,
    },
  };
}

function recipe(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    brushId: "professional-rake-base",
    engine: "dab-v1",
    material: "pigment",
    tip: {
      kind: "analytic",
      shape: "round",
      edgeSoftness: 0.22,
    },
    size: 18,
    flow: 0.78,
    hardness: 0.68,
    spacingRatio: 0.2,
    scatter: {
      radiusRatio: 0,
      distribution: "uniform-disk",
    },
    angleRadians: 0,
    roundness: 1,
    pressure: {
      size: { minimum: 0.35, maximum: 1, exponent: 1.1 },
      opacity: { minimum: 0.3, maximum: 1, exponent: 1 },
      flow: { minimum: 0.5, maximum: 1, exponent: 1 },
    },
    grain: null,
    wetMedia: null,
    ...overrides,
  };
}

function dynamics(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "studio-professional-bristle-dynamics",
    version: 1,
    brushId: "clean-room-rake",
    seed: 0xffff_ffff,
    bristleCount: 7,
    bristleRadiusRatio: 0.045,
    featureReferenceDiameter: 18,
    spacingRatio: 0.3,
    spread: 0.82,
    fanning: 0.5,
    rigidity: 0.62,
    friction: 0.28,
    contactAngleRadians: Math.PI,
    turnAmount: 1.2,
    softenEdge: 0.45,
    pressureSpread: 0.55,
    tiltSpread: 0.75,
    lengthVariation: 0.4,
    colorVariation: 0.8,
    orientation: "hybrid",
    scaleFeatureWithBrushSize: true,
    ...overrides,
  };
}

function extension(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1,
    ...overrides,
  };
}

function ready(
  result: StudioProfessionalBristleWebGpuLoweringResult,
): Extract<StudioProfessionalBristleWebGpuLoweringResult, { status: "ready" }> {
  if (result.status !== "ready") {
    throw new Error(`expected ready lowering, received ${JSON.stringify(result)}`);
  }
  expect(result.status).toBe("ready");
  return result;
}

function withoutMode<Value extends {
  readonly mode: "append" | "rebuild";
}>(value: Value): Omit<Value, "mode"> {
  const { mode: _mode, ...rest } = value;
  return rest;
}

describe("professional bristle WebGPU lowering", () => {
  it("preserves resolved affine footprints and stable station-major rake order", () => {
    const affine = {
      encoding: "affine-f64-v1",
      m11: 2,
      m12: 0.35,
      m21: 0.55,
      m22: 2.8,
      translateX: 100,
      translateY: -40,
    };
    const canonicalInput = canonical({ transform: affine });
    const dynamicsInput = dynamics();
    const resolved = resolveStudioProfessionalBristleDynamics(
      canonicalInput,
      dynamicsInput,
    );
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;

    const lowered = ready(lowerStudioProfessionalBristleToWebGpu(
      canonicalInput,
      dynamicsInput,
      extension(),
    ));
    expect(lowered.plan.dabs).toHaveLength(resolved.depositions.length);
    expect(lowered.receipt).toMatchObject({
      kind: "studio-professional-bristle-webgpu-capability-receipt",
      loweringVersion: 1,
      dynamicsVersion: 1,
      extensionVersion: 1,
      providerCapability: "rgba16float-analytic-bristle-v1",
      textureFormat: "rgba16float",
      surfaceColorModel: "linear-premultiplied",
      inputColorEncoding: "scene-linear-straight",
      workingColorSpace: "linear-srgb",
      colorVariation: "oklch-gamut-safe-v1",
      tipMapping: "canonical-round-ellipse-v1",
      ordering: "station-major-bristle-index-v1",
      stationCount: resolved.stations.length,
      depositionCount: resolved.depositions.length,
      bristleCount: 7,
      complete: true,
    });
    for (let index = 0; index < resolved.depositions.length; index += 1) {
      const deposition = resolved.depositions[index]!;
      const dab = lowered.plan.dabs[index]!;
      expect(dab.index).toBe(index);
      expect(dab.stationX).toBe(Math.fround(deposition.x));
      expect(dab.stationY).toBe(Math.fround(deposition.y));
      expect(dab.tip.localToDocument).toEqual(
        deposition.localToDocument.map(Math.fround),
      );
    }
    expect(lowered.plan.dabs.some((dab) => dab.tip.shape === "ellipse")).toBe(true);
    expect(
      new Set(lowered.plan.dabs.map((dab) => Math.fround(dab.tip.angleRadians)))
        .size,
    ).toBeGreaterThan(2);
    expect(validateStudioEngineWebGpuBrushPlan(lowered.plan, 65_536)).not.toBeNull();
    expect(Object.isFrozen(lowered)).toBe(true);
    expect(Object.isFrozen(lowered.plan.dabs)).toBe(true);
    expect(Object.isFrozen(lowered.plan.dabs[0]!.tip.localToDocument)).toBe(true);
  });

  it("maps canonical scatter through each affine bristle basis instead of a document-space circle", () => {
    const samples = [sample(1, 24, 18, 0.8)];
    const scatterRecipe = recipe({
      scatter: {
        radiusRatio: 0.75,
        distribution: "uniform-disk",
      },
    });
    const dynamicsInput = dynamics({
      orientation: "stroke-direction",
      pressureSpread: 0,
      tiltSpread: 0,
      lengthVariation: 0,
    });
    const identity = ready(lowerStudioProfessionalBristleToWebGpu(
      canonical({ samples, recipe: scatterRecipe }),
      dynamicsInput,
      extension(),
    ));
    const transformed = ready(lowerStudioProfessionalBristleToWebGpu(
      canonical({
        samples,
        recipe: scatterRecipe,
        transform: {
          encoding: "affine-f64-v1",
          m11: -1.8,
          m12: 0.65,
          m21: 0.45,
          m22: 0.7,
          translateX: 0,
          translateY: 0,
        },
      }),
      dynamicsInput,
      extension(),
    ));

    const localScatter = (
      dab: (typeof identity.plan.dabs)[number],
    ): readonly [number, number] => {
      const [xx, xy, yx, yy] = dab.tip.localToDocument;
      const determinant = xx * yy - xy * yx;
      const dx = dab.x - dab.stationX;
      const dy = dab.y - dab.stationY;
      return [
        (yy * dx - yx * dy) / determinant,
        (-xy * dx + xx * dy) / determinant,
      ];
    };

    expect(transformed.plan.dabs).toHaveLength(identity.plan.dabs.length);
    for (let index = 0; index < identity.plan.dabs.length; index += 1) {
      const localIdentity = localScatter(identity.plan.dabs[index]!);
      const localTransformed = localScatter(transformed.plan.dabs[index]!);
      expect(localTransformed[0]).toBeCloseTo(localIdentity[0], 5);
      expect(localTransformed[1]).toBeCloseTo(localIdentity[1], 5);
      expect(Math.hypot(...localTransformed)).toBeLessThanOrEqual(1.5 + 1e-5);
    }
    expect(transformed.plan.dabs.some((dab) => (
      (dab.tip.localToDocument[0] * dab.tip.localToDocument[3]
        - dab.tip.localToDocument[1] * dab.tip.localToDocument[2]) < 0
    ))).toBe(true);
  });

  it("carries pressure and tilt fanning into responsive radius and lateral geometry", () => {
    const low = ready(lowerStudioProfessionalBristleToWebGpu(
      canonical({
        samples: [
          sample(1, 0, 0, 0.1),
          sample(2, 40, 0, 0.1),
        ],
      }),
      dynamics({ orientation: "stroke-direction" }),
      extension(),
    ));
    const high = ready(lowerStudioProfessionalBristleToWebGpu(
      canonical({
        samples: [
          sample(1, 0, 0, 1, { tiltX: 85 }),
          sample(2, 40, 0, 1, { tiltX: 85 }),
        ],
      }),
      dynamics({ orientation: "stroke-direction" }),
      extension(),
    ));
    const lowSpread = Math.max(...low.plan.dabs.map((dab) => Math.abs(dab.y)));
    const highSpread = Math.max(...high.plan.dabs.map((dab) => Math.abs(dab.y)));
    const lowDiameter = Math.max(...low.plan.dabs.map((dab) => dab.diameter));
    const highDiameter = Math.max(...high.plan.dabs.map((dab) => dab.diameter));
    expect(highSpread).toBeGreaterThan(lowSpread * 2);
    expect(highDiameter).toBeGreaterThan(lowDiameter * 2);
    expect(new Set(high.plan.dabs.map((dab) => dab.pressure))).toEqual(new Set([1]));
  });

  it("applies deterministic per-bristle OKLCH variation with gamut-safe linear-sRGB output", () => {
    const canonicalInput = canonical({
      color: {
        space: "linear-srgb",
        alphaMode: "straight",
        components: [1, 0.015, 0.002, 0.9],
      },
      samples: [
        sample(1, 0, 0, 0.8),
        sample(2, 30, 0, 0.8),
      ],
    });
    const first = ready(lowerStudioProfessionalBristleToWebGpu(
      canonicalInput,
      dynamics({ colorVariation: 1 }),
      extension(),
    ));
    const replay = ready(lowerStudioProfessionalBristleToWebGpu(
      structuredClone(canonicalInput),
      dynamics({ colorVariation: 1 }),
      extension(),
    ));
    expect(replay).toEqual(first);
    const firstStationColors = first.plan.dabs
      .slice(0, 7)
      .map((dab) => dab.color.components.slice(0, 3));
    expect(new Set(firstStationColors.map((color) => color.join(":"))).size)
      .toBeGreaterThan(3);
    for (const dab of first.plan.dabs) {
      expect(dab.color.space).toBe("linear-srgb");
      expect(dab.color.components.every(
        (component) => component >= 0 && component <= 1,
      )).toBe(true);
    }
    expect(first.plan.dabs.slice(7, 14).map((dab) => dab.color.components.slice(0, 3)))
      .toEqual(firstStationColors);
  });

  it("preserves resolved composite opacity/flow exactly once in straight source alpha", () => {
    const canonicalInput = canonical({
      color: {
        space: "linear-srgb",
        alphaMode: "straight",
        components: [0.2, 0.3, 0.4, 0.8],
      },
      composite: {
        porterDuff: "destination-out",
        blendMode: "normal",
        opacity: 0.5,
      },
      recipe: recipe({
        flow: 0.5,
        pressure: {
          size: { minimum: 1, maximum: 1, exponent: 1 },
          opacity: { minimum: 1, maximum: 1, exponent: 1 },
          flow: { minimum: 1, maximum: 1, exponent: 1 },
        },
      }),
      samples: [sample(1, 0, 0, 1)],
    });
    const dynamicsInput = dynamics({
      bristleCount: 1,
      softenEdge: 0,
      colorVariation: 0,
    });
    const resolved = resolveStudioProfessionalBristleDynamics(
      canonicalInput,
      dynamicsInput,
    );
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    const lowered = ready(lowerStudioProfessionalBristleToWebGpu(
      canonicalInput,
      dynamicsInput,
      extension(),
    ));
    expect(resolved.depositions[0]!.opacity).toBeCloseTo(0.25);
    expect(lowered.plan.dabs[0]).toMatchObject({
      opacity: Math.fround(resolved.depositions[0]!.opacity),
      flow: Math.fround(0.5),
      composite: {
        porterDuff: "destination-out",
        blendMode: "normal",
      },
    });
    expect(lowered.plan.dabs[0]!.color.components[3])
      .toBe(Math.fround(0.8 * resolved.depositions[0]!.opacity));
  });

  it("makes append/rebuild payloads exact while exposing mode and content fingerprints", () => {
    const canonicalInput = canonical();
    const dynamicsInput = dynamics();
    const append = ready(lowerStudioProfessionalBristleToWebGpu(
      canonicalInput,
      dynamicsInput,
      extension(),
      { mode: "append" },
    ));
    const rebuild = ready(lowerStudioProfessionalBristleToWebGpu(
      canonicalInput,
      dynamicsInput,
      extension(),
      { mode: "rebuild" },
    ));
    expect(withoutMode(append.plan)).toEqual(withoutMode(rebuild.plan));
    expect(append.plan.mode).toBe("append");
    expect(rebuild.plan.mode).toBe("rebuild");
    expect(append.receipt.contentFingerprint).toBe(rebuild.receipt.contentFingerprint);
    expect(append.receipt.planFingerprint).not.toBe(rebuild.receipt.planFingerprint);
    expect(append.plan.batches).toEqual([{
      composite: { porterDuff: "source-over", blendMode: "normal" },
      colorSpace: "linear-srgb",
      firstInstance: 0,
      instanceCount: append.plan.dabs.length,
    }]);
  });

  it("rejects hostile canonical, dynamics, extension, and options getters without invoking them", () => {
    const canonicalGetter = vi.fn(() => ({
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0, 0, 0, 1],
    }));
    const hostileCanonical = canonical();
    Object.defineProperty(hostileCanonical, "color", {
      enumerable: true,
      get: canonicalGetter,
    });
    expect(lowerStudioProfessionalBristleToWebGpu(
      hostileCanonical,
      dynamics(),
      extension(),
    )).toMatchObject({ status: "rejected", reason: "invalid-canonical-plan" });
    expect(canonicalGetter).not.toHaveBeenCalled();

    const dynamicsGetter = vi.fn(() => "hybrid");
    const hostileDynamics = dynamics();
    Object.defineProperty(hostileDynamics, "orientation", {
      enumerable: true,
      get: dynamicsGetter,
    });
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      hostileDynamics,
      extension(),
    )).toMatchObject({ status: "rejected", reason: "invalid-dynamics-plan" });
    expect(dynamicsGetter).not.toHaveBeenCalled();

    const extensionGetter = vi.fn(() => "oklch-gamut-safe-v1");
    const hostileExtension = extension();
    Object.defineProperty(hostileExtension, "colorVariation", {
      enumerable: true,
      get: extensionGetter,
    });
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      dynamics(),
      hostileExtension,
    )).toMatchObject({ status: "rejected", reason: "invalid-extension" });
    expect(extensionGetter).not.toHaveBeenCalled();

    const optionGetter = vi.fn(() => 2);
    const hostileOptions: Record<string, unknown> = {};
    Object.defineProperty(hostileOptions, "maximumDabs", {
      enumerable: true,
      get: optionGetter,
    });
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      dynamics(),
      extension(),
      hostileOptions,
    )).toMatchObject({ status: "rejected", reason: "invalid-options" });
    expect(optionGetter).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Display P3",
      canonical({
        color: {
          space: "linear-display-p3",
          alphaMode: "straight",
          components: [0.8, 0.2, 0.1, 1],
        },
      }),
      "display-p3",
    ],
    [
      "non-normal blend",
      canonical({
        composite: {
          porterDuff: "source-over",
          blendMode: "multiply",
          opacity: 1,
        },
      }),
      "non-normal-blend",
    ],
    [
      "texture tip",
      canonical({
        recipe: recipe({
          tip: {
            kind: "texture",
            assetId: "tip",
            contentHash: "sha256:abcdef0123456789",
            channel: "alpha",
            width: 16,
            height: 16,
          },
        }),
      }),
      "texture-tip",
    ],
    [
      "grain",
      canonical({
        recipe: recipe({
          grain: {
            kind: "procedural-noise",
            assetId: null,
            contentHash: null,
            space: "document",
            scale: 4,
            depth: 0.3,
            contrast: 0.5,
            seed: 9,
          },
        }),
      }),
      "grain",
    ],
    [
      "wet media",
      canonical({
        recipe: recipe({
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
        }),
      }),
      "wet-media",
    ],
    [
      "square tip",
      canonical({
        recipe: recipe({
          tip: {
            kind: "analytic",
            shape: "square",
            edgeSoftness: 0.2,
          },
        }),
      }),
      "unsupported-tip-shape",
    ],
  ])("fails closed instead of approximating the %s path", (_label, input, reason) => {
    expect(lowerStudioProfessionalBristleToWebGpu(
      input,
      dynamics(),
      extension(),
    )).toMatchObject({ status: "unsupported", reason });
  });

  it("enforces station, deposition, dab, coordinate, and option budgets", () => {
    const longStroke = canonical({
      samples: [
        sample(1, 0, 0, 1),
        sample(2, 200, 0, 1),
      ],
    });
    expect(lowerStudioProfessionalBristleToWebGpu(
      longStroke,
      dynamics({ spacingRatio: 0.01 }),
      extension(),
      { maximumStations: 2 },
    )).toMatchObject({ status: "rejected", reason: "station-limit-exceeded" });
    expect(lowerStudioProfessionalBristleToWebGpu(
      longStroke,
      dynamics({ bristleCount: 32 }),
      extension(),
      { maximumDepositions: 2 },
    )).toMatchObject({ status: "rejected", reason: "deposition-limit-exceeded" });
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical({ samples: [sample(1, 0, 0, 1)] }),
      dynamics(),
      extension(),
      { maximumDabs: 2 },
    )).toMatchObject({ status: "rejected", reason: "dab-limit-exceeded" });
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical({ samples: [sample(1, 20, 20, 1)] }),
      dynamics(),
      extension(),
      { maximumCoordinateAbsolute: 2 },
    )).toMatchObject({
      status: "rejected",
      reason: "coordinate-budget-exceeded",
    });
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      dynamics(),
      extension(),
      { maximumDabs: 0 },
    )).toEqual({ status: "rejected", reason: "invalid-options" });
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      { ...dynamics(), vendorPrivateState: true },
      extension(),
    )).toMatchObject({ status: "rejected", reason: "invalid-dynamics-plan" });
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      dynamics(),
      { ...extension(), vendorPrivateState: true },
    )).toMatchObject({ status: "rejected", reason: "invalid-extension" });
  });

  it("supports pre-abort, resolver cancellation, and fail-closed callback errors", () => {
    const controller = new AbortController();
    controller.abort();
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      dynamics(),
      extension(),
      { signal: controller.signal },
    )).toEqual({
      status: "cancelled",
      phase: "resolve",
      processedStations: 0,
      emittedDabs: 0,
    });

    const cancel = vi.fn((progress: {
      readonly phase: "resolve" | "lower";
      readonly processedStations: number;
    }) => progress.phase === "resolve" && progress.processedStations >= 2);
    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      dynamics(),
      extension(),
      { shouldCancel: cancel },
    )).toMatchObject({
      status: "cancelled",
      phase: "resolve",
      processedStations: 2,
    });
    expect(cancel).toHaveBeenCalled();

    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      dynamics(),
      extension(),
      {
        shouldCancel: (progress) => (
          progress.phase === "lower" && progress.emittedDabs >= 2
        ),
      },
    )).toMatchObject({
      status: "cancelled",
      phase: "lower",
      emittedDabs: 2,
    });

    expect(lowerStudioProfessionalBristleToWebGpu(
      canonical(),
      dynamics(),
      extension(),
      {
        shouldCancel: () => {
          throw new Error("host callback failed");
        },
      },
    )).toEqual({
      status: "cancelled",
      phase: "resolve",
      processedStations: 0,
      emittedDabs: 0,
    });
  });
});
