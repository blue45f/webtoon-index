import { describe, expect, it, vi } from "vitest";

import {
  parseStudioCanonicalBrushPlan,
  type StudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";
import {
  parseStudioProfessionalBrushDynamicsPlan,
  type StudioProfessionalBrushDynamicsPlan,
} from "../studio-professional-brush-dynamics";
import { sha256HexPortable } from "../studio-sha256";

import {
  buildStudioEngineWebGpuTexturedBrushPlan,
  compositeStudioEngineTexturedBrushPixelCpu,
  sampleStudioEngineTexturedBrushGrainCpu,
  sampleStudioEngineTexturedBrushTipCpu,
  type StudioEngineWebGpuTexturedBrushAssetPayload,
  type StudioEngineWebGpuTexturedBrushAssetRequest,
  type StudioEngineWebGpuTexturedBrushAssetResolver,
} from "./studio-engine-webgpu-textured-brush-plan";

const TIP_BYTES = new Uint8Array([0, 64, 128, 255]);
const GRAIN_BYTES = new Uint8Array([255, 0, 0, 255]);

function hash(bytes: Uint8Array): string {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function sourceSample(
  sequence: number,
  timeMilliseconds: number,
  x: number,
  overrides: Partial<{
    y: number;
    pressure: number;
    tiltX: number;
    twist: number;
  }> = {},
) {
  return {
    role: "authoritative",
    sequence,
    x,
    y: overrides.y ?? 0,
    pressure: overrides.pressure ?? 0.5,
    tangentialPressure: 0,
    tiltX: overrides.tiltX ?? 0,
    tiltY: 0,
    twist: overrides.twist ?? 0,
    timeMilliseconds,
    pointerId: 1,
    flags: 0,
  };
}

function canonicalPlan(
  overrides: {
    readonly samples?: readonly ReturnType<typeof sourceSample>[];
    readonly transform?: Readonly<{
      encoding: "affine-f64-v1";
      m11: number;
      m12: number;
      m21: number;
      m22: number;
      translateX: number;
      translateY: number;
    }>;
    readonly tip?: unknown;
    readonly grain?: unknown;
    readonly colorSpace?: "linear-srgb" | "linear-display-p3";
    readonly blendMode?: "normal" | "multiply";
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
    strokeId: "textured-stroke",
    seed: 0x1234_5678,
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
      components: [0.25, 0.5, 0.75, 0.8],
    },
    composite: {
      porterDuff: "source-over",
      blendMode: overrides.blendMode ?? "normal",
      opacity: 0.75,
    },
    recipe: {
      version: 1,
      brushId: "textured-clean-room",
      engine: overrides.engine ?? "dab-v1",
      material: overrides.material ?? "ink",
      tip: overrides.tip ?? {
        kind: "texture",
        assetId: "tip-r8",
        contentHash: hash(TIP_BYTES),
        channel: "alpha",
        width: 2,
        height: 2,
      },
      size: 10,
      flow: 1,
      hardness: 0.6,
      spacingRatio: 0.5,
      scatter: { radiusRatio: 0, distribution: "uniform-disk" },
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
    readonly size?: number;
    readonly spacing?: number;
    readonly scatter?: number;
    readonly textureDepth?: number;
    readonly angle?: number;
    readonly roundness?: number;
    readonly stationary?: boolean;
  } = {},
): StudioProfessionalBrushDynamicsPlan {
  const channel = (base: number, min: number, max: number) => ({
    base,
    min,
    max,
    mappings: [],
  });
  const candidate = {
    kind: "studio-professional-brush-dynamics",
    version: 1,
    planId: "textured-dynamics",
    revision: 1,
    seed: 0x8765_4321,
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
    clock: { timeUnit: "milliseconds", tickMilliseconds: 1 },
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
      start: { mode: "stroke-percentage", value: 0 },
      end: { mode: "stroke-percentage", value: 0 },
      minimumSizeRatio: 0,
      minimumOpacityRatio: 0,
      speedInfluence: 0,
    },
    stationary: {
      mode: overrides.stationary ? "continuous" : "disabled",
      intervalTicks: 2,
      movementEpsilonPixels: 0.01,
    },
    channels: {
      size: channel(overrides.size ?? 8, 0.01, 512),
      opacity: channel(1, 0, 1),
      flow: channel(1, 0, 1),
      spacing: channel(overrides.spacing ?? 5, 0.05, 512),
      angle: channel(overrides.angle ?? 0, -Math.PI * 2, Math.PI * 2),
      roundness: channel(overrides.roundness ?? 1, 0.01, 1),
      scatter: channel(overrides.scatter ?? 0, 0, 512),
      textureDepth: channel(overrides.textureDepth ?? 0, 0, 1),
    },
  };
  const parsed = parseStudioProfessionalBrushDynamicsPlan(candidate);
  if (!parsed.ok) throw new Error(`${parsed.reason}: ${parsed.path}`);
  return parsed.plan;
}

function payload(
  request: StudioEngineWebGpuTexturedBrushAssetRequest,
  bytes: Uint8Array,
  overrides: Partial<StudioEngineWebGpuTexturedBrushAssetPayload> = {},
): StudioEngineWebGpuTexturedBrushAssetPayload {
  const width = request.expectedWidth ?? 2;
  const height = request.expectedHeight ?? 2;
  return {
    kind: "studio-textured-brush-r8-asset",
    version: 1,
    assetId: request.assetId,
    contentHash: request.contentHash,
    width,
    height,
    channel: request.expectedChannel ?? "luminance",
    format: "r8-unorm",
    byteLength: bytes.byteLength,
    bytes,
    ...overrides,
  };
}

function resolver(
  resolve: StudioEngineWebGpuTexturedBrushAssetResolver["resolve"] = async (request) =>
    payload(request, request.role === "tip" ? TIP_BYTES : GRAIN_BYTES),
): StudioEngineWebGpuTexturedBrushAssetResolver {
  return { resolve: vi.fn(resolve) };
}

describe("content-addressed textured brush specialist planning", () => {
  it("rejects unknown and semantically mutated nested canonical fields", async () => {
    const canonical = canonicalPlan();
    const withUnknownRecipeField = Object.freeze({
      ...canonical,
      recipe: Object.freeze({
        ...canonical.recipe,
        unreviewedVendorExtension: true,
      }),
    }) as unknown as StudioCanonicalBrushPlan;
    const withInvalidFlow = Object.freeze({
      ...canonical,
      recipe: Object.freeze({
        ...canonical.recipe,
        flow: 2,
      }),
    }) as StudioCanonicalBrushPlan;
    const withInvalidPressure = Object.freeze({
      ...canonical,
      source: Object.freeze({
        ...canonical.source,
        samples: Object.freeze([
          Object.freeze({
            ...canonical.source.samples[0]!,
            pressure: 2,
          }),
          canonical.source.samples[1]!,
        ]),
      }),
    }) as StudioCanonicalBrushPlan;

    for (const candidate of [
      withUnknownRecipeField,
      withInvalidFlow,
      withInvalidPressure,
    ]) {
      await expect(buildStudioEngineWebGpuTexturedBrushPlan(
        candidate,
        dynamicsPlan(),
        resolver(),
      )).resolves.toMatchObject({
        status: "rejected",
        reason: "invalid-canonical-plan",
      });
    }
  });

  it("rejects canonical accessors without invoking hostile getters", async () => {
    const canonical = canonicalPlan();
    let reads = 0;
    const hostileRecipe = { ...canonical.recipe } as Record<string, unknown>;
    Object.defineProperty(hostileRecipe, "flow", {
      enumerable: true,
      get() {
        reads += 1;
        return 1;
      },
    });
    Object.freeze(hostileRecipe);
    const hostile = Object.freeze({
      ...canonical,
      recipe: hostileRecipe,
    }) as unknown as StudioCanonicalBrushPlan;

    await expect(buildStudioEngineWebGpuTexturedBrushPlan(
      hostile,
      dynamicsPlan(),
      resolver(),
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-canonical-plan",
    });
    expect(reads).toBe(0);
  });

  it("resolves an alpha tip and procedural document grain into one stable batch", async () => {
    const assetResolver = resolver();
    const result = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonicalPlan({
        grain: {
          kind: "procedural-noise",
          assetId: null,
          contentHash: null,
          space: "document",
          scale: 8,
          depth: 0.75,
          contrast: 0.4,
          seed: 17,
        },
      }),
      dynamicsPlan({ textureDepth: 1 }),
      assetResolver,
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan.assets).toHaveLength(1);
    expect(result.plan.tip).toMatchObject({
      channel: "alpha",
      filtering: "bilinear",
      edgeMode: "transparent-zero-border",
    });
    expect(result.plan.grain).toMatchObject({
      kind: "procedural-integer-noise",
      space: "document",
      depth: 0.75,
      contrast: 0.4,
      invert: false,
      filtering: "integer-cell",
    });
    expect(result.plan.dualTip).toBe("extension-required");
    expect(result.plan.batches).toHaveLength(1);
    expect(assetResolver.resolve).toHaveBeenCalledTimes(1);
  });

  it("resolves luminance tip and content-addressed repeating stroke grain in role order", async () => {
    const requests: StudioEngineWebGpuTexturedBrushAssetRequest[] = [];
    const assetResolver = resolver(async (request) => {
      requests.push(request);
      return payload(request, request.role === "tip" ? TIP_BYTES : GRAIN_BYTES);
    });
    const result = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonicalPlan({
        tip: {
          kind: "texture",
          assetId: "tip-luma",
          contentHash: hash(TIP_BYTES),
          channel: "luminance",
          width: 2,
          height: 2,
        },
        grain: {
          kind: "texture",
          assetId: "paper-grain",
          contentHash: hash(GRAIN_BYTES),
          space: "stroke",
          scale: 32,
          depth: 0.5,
          contrast: 0.25,
          seed: 9,
        },
      }),
      dynamicsPlan({ textureDepth: 0.5 }),
      assetResolver,
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(requests.map((request) => request.role)).toEqual(["tip", "grain"]);
    expect(result.plan.assets.map((asset) => asset.contentHash)).toEqual([
      hash(TIP_BYTES),
      hash(GRAIN_BYTES),
    ]);
    expect(result.plan.grain).toMatchObject({
      kind: "asset-r8-repeat",
      assetIndex: 1,
      space: "stroke",
      filtering: "bilinear",
      edgeMode: "repeat",
    });
    expect(result.plan.dabs.every((dab) => dab.grainDepth === 0.25)).toBe(true);
  });

  it("binds durable R8 identity and CPU-parity semantics into a distinct renderer fingerprint", async () => {
    const canonical = canonicalPlan({
      grain: {
        kind: "texture",
        assetId: "paper-grain",
        contentHash: hash(GRAIN_BYTES),
        space: "stroke",
        scale: 32,
        depth: 0.5,
        contrast: 0.25,
        seed: 9,
      },
    });
    const source = {
      kind: "r8-texture-v1" as const,
      asset: {
        assetId: "paper-grain",
        encodedSha256:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111" as const,
        decodedSha256: hash(GRAIN_BYTES) as `sha256:${string}`,
        byteLength: 128,
        mediaType: "image/png" as const,
        width: 2,
        height: 2,
        channel: "luminance" as const,
        encoding: "r8-unorm" as const,
      },
    };
    const omitted = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonical,
      dynamicsPlan({ textureDepth: 1 }),
      resolver(),
    );
    const bound = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonical,
      dynamicsPlan({ textureDepth: 1 }),
      resolver(),
      { durableR8GrainSource: source },
    );
    const replay = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonical,
      dynamicsPlan({ textureDepth: 1 }),
      resolver(),
      { durableR8GrainSource: source },
    );
    expect(omitted.status).toBe("ready");
    expect(bound.status).toBe("ready");
    expect(replay).toEqual(bound);
    if (omitted.status !== "ready" || bound.status !== "ready") return;
    expect(bound.plan).toMatchObject({
      durableR8GrainSource: source,
      grainPhaseStrokeSeed: canonical.seed,
      grainSamplingSemantics: "durable-r8-cpu-parity-v1",
    });
    expect(bound.plan.semanticFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(omitted.plan.semanticFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(bound.plan.semanticFingerprint).not.toBe(omitted.plan.semanticFingerprint);

    for (const mismatched of [
      { ...source, asset: { ...source.asset, assetId: "other-paper" } },
      {
        ...source,
        asset: {
          ...source.asset,
          decodedSha256:
            "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        },
      },
      { ...source, asset: { ...source.asset, width: 1, height: 4 } },
      { ...source, asset: { ...source.asset, channel: "alpha" } },
    ]) {
      await expect(buildStudioEngineWebGpuTexturedBrushPlan(
        canonical,
        dynamicsPlan({ textureDepth: 1 }),
        resolver(),
        { durableR8GrainSource: mismatched },
      )).resolves.toMatchObject({
        status: "rejected",
        reason: "durable-r8-source-mismatch",
      });
    }
  });

  it("preserves full affine footprint, deterministic scatter and fixed-tick deposits", async () => {
    const canonical = canonicalPlan({
      samples: [
        sourceSample(1, 0, 2, { y: 3 }),
        sourceSample(2, 10, 2, { y: 3 }),
      ],
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
      size: 8,
      angle: Math.PI / 2,
      roundness: 0.5,
      scatter: 3,
      stationary: true,
    });
    const first = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonical,
      dynamics,
      resolver(),
    );
    const replay = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonical,
      dynamics,
      resolver(),
    );

    expect(first).toEqual(replay);
    expect(first.status).toBe("ready");
    if (first.status !== "ready") return;
    expect(first.plan.dabs).toHaveLength(6);
    expect(first.plan.dabs[0]!.stationX).toBe(14.75);
    expect(first.plan.dabs[0]!.stationY).toBe(30);
    expect(first.plan.dabs[0]!.tip.localToDocument).toEqual([1, 12, -4, -1]);
    expect(first.plan.dabs.some((dab) => dab.x !== dab.stationX)).toBe(true);
  });

  it.each([
    {
      name: "identity",
      mutate: (request: StudioEngineWebGpuTexturedBrushAssetRequest) =>
        payload(request, TIP_BYTES, { assetId: "wrong" }),
      reason: "asset-identity-mismatch",
    },
    {
      name: "dimensions",
      mutate: (request: StudioEngineWebGpuTexturedBrushAssetRequest) =>
        payload(request, new Uint8Array(6), { width: 3, height: 2, byteLength: 6 }),
      reason: "asset-dimension-mismatch",
    },
    {
      name: "channel",
      mutate: (request: StudioEngineWebGpuTexturedBrushAssetRequest) =>
        payload(request, TIP_BYTES, { channel: "luminance" }),
      reason: "asset-channel-mismatch",
    },
    {
      name: "byte length",
      mutate: (request: StudioEngineWebGpuTexturedBrushAssetRequest) =>
        payload(request, TIP_BYTES, { byteLength: 3 }),
      reason: "asset-byte-length-mismatch",
    },
    {
      name: "content hash",
      mutate: (request: StudioEngineWebGpuTexturedBrushAssetRequest) =>
        payload(request, new Uint8Array([1, 2, 3, 4])),
      reason: "asset-content-hash-mismatch",
    },
  ])("fails closed on asset $name mismatch", async ({ mutate, reason }) => {
    const result = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonicalPlan(),
      dynamicsPlan(),
      resolver(async (request) => mutate(request)),
    );
    expect(result).toMatchObject({ status: "rejected", reason });
  });

  it("rejects a hostile asset payload without invoking accessors", async () => {
    let reads = 0;
    const result = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonicalPlan(),
      dynamicsPlan(),
      resolver(async (request) => {
        const hostile: Record<string, unknown> = {
          kind: "studio-textured-brush-r8-asset",
          version: 1,
          assetId: request.assetId,
          contentHash: request.contentHash,
          width: 2,
          height: 2,
          channel: "alpha",
          format: "r8-unorm",
          byteLength: 4,
        };
        Object.defineProperty(hostile, "bytes", {
          enumerable: true,
          get() {
            reads += 1;
            return TIP_BYTES;
          },
        });
        return hostile;
      }),
    );

    expect(result).toMatchObject({ status: "rejected", reason: "asset-payload-invalid" });
    expect(reads).toBe(0);
  });

  it("cancels asset resolution without emitting a partial plan", async () => {
    const controller = new AbortController();
    const result = await buildStudioEngineWebGpuTexturedBrushPlan(
      canonicalPlan(),
      dynamicsPlan(),
      resolver(async (request) => {
        controller.abort("superseded");
        return payload(request, TIP_BYTES);
      }),
      { signal: controller.signal },
    );
    expect(result).toEqual({
      status: "cancelled",
      processedSamples: 0,
      emittedEvents: 0,
    });
  });

  it.each([
    {
      name: "analytic tip",
      plan: () => canonicalPlan({
        tip: { kind: "analytic", shape: "round", edgeSoftness: 0.2 },
      }),
      reason: "analytic-tip-provider-required",
    },
    {
      name: "non-normal blend",
      plan: () => canonicalPlan({ blendMode: "multiply" }),
      reason: "unsupported-blend-mode",
    },
    {
      name: "P3",
      plan: () => canonicalPlan({ colorSpace: "linear-display-p3" }),
      reason: "unsupported-color-space",
    },
    {
      name: "wet media",
      plan: () => canonicalPlan({
        engine: "wet-media-v1",
        material: "pigment",
        wetMedia: {
          model: "pigment-water-v1",
          fieldScale: 2,
          fixedRateHz: 120,
          simulationSteps: 16,
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
        },
      }),
      reason: "wet-media",
    },
  ])("does not approximate unsupported $name", async ({ plan, reason }) => {
    expect(await buildStudioEngineWebGpuTexturedBrushPlan(
      plan(),
      dynamicsPlan(),
      resolver(),
    )).toMatchObject({ status: "unsupported", reason });
  });

  it("matches the explicit zero-border, grain and premultiplied CPU oracles", () => {
    const solid = { width: 1, height: 1, bytes: new Uint8Array([255]) };
    expect(sampleStudioEngineTexturedBrushTipCpu(solid, 0.5, 0.5, 0)).toBe(1);
    expect(sampleStudioEngineTexturedBrushTipCpu(solid, 0, 0.5, 0)).toBe(0.5);

    const grain = {
      kind: "procedural-integer-noise" as const,
      space: "document" as const,
      scale: 4,
      depth: 0.75,
      contrast: 0.5,
      invert: false,
      seed: 7,
      originX: 0,
      originY: 0,
    };
    const first = sampleStudioEngineTexturedBrushGrainCpu(grain, 9, -3, null);
    expect(first).toBe(sampleStudioEngineTexturedBrushGrainCpu(grain, 9, -3, null));
    expect(first).toBeGreaterThanOrEqual(0.25);
    expect(first).toBeLessThanOrEqual(1);

    expect(compositeStudioEngineTexturedBrushPixelCpu(
      [0.1, 0.2, 0.3, 0.5],
      [0.8, 0.4, 0.2, 0.5],
      0.5,
      "source-over",
    )).toEqual([
      Math.fround(0.8 * 0.25 + 0.1 * 0.75),
      Math.fround(0.4 * 0.25 + 0.2 * 0.75),
      Math.fround(0.2 * 0.25 + 0.3 * 0.75),
      Math.fround(0.25 + 0.5 * 0.75),
    ]);
    expect(compositeStudioEngineTexturedBrushPixelCpu(
      [0.1, 0.2, 0.3, 0.5],
      [0.8, 0.4, 0.2, 0.5],
      0.5,
      "destination-out",
    )).toEqual([
      Math.fround(0.075),
      Math.fround(0.15),
      Math.fround(0.225),
      Math.fround(0.375),
    ]);
  });
});
