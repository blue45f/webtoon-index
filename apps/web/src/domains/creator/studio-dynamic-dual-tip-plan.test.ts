import { describe, expect, it, vi } from "vitest";

import {
  parseStudioCanonicalBrushPlan,
} from "./studio-canonical-brush-plan";
import {
  buildStudioDynamicDualTipPlan,
} from "./studio-dynamic-dual-tip-plan";
import {
  parseStudioProfessionalBrushDynamicsPlan,
} from "./studio-professional-brush-dynamics";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioEngineWebGpuTexturedBrushAssetPayload,
  StudioEngineWebGpuTexturedBrushAssetRequest,
  StudioEngineWebGpuTexturedBrushAssetResolver,
} from "./render/studio-engine-webgpu-textured-brush-plan";
import type {
  StudioCanonicalBrushPlan,
} from "./studio-canonical-brush-plan";
import type {
  StudioDynamicDualTipBlendFamily,
  StudioDynamicDualTipExtension,
  StudioDynamicDualTipPlanResult,
} from "./studio-dynamic-dual-tip-plan";
import type {
  StudioProfessionalBrushAcceptedSample,
  StudioProfessionalBrushDynamicsPlan,
} from "./studio-professional-brush-dynamics";

const PRIMARY_BYTES = new Uint8Array([0, 96, 192, 255]);
const SECONDARY_BYTES = new Uint8Array([255, 128, 32, 16, 128, 255]);
const BLENDS: readonly StudioDynamicDualTipBlendFamily[] = [
  "intersect",
  "darken",
  "lighten",
  "multiply",
  "screen",
  "add",
  "subtract",
  "difference",
];

function hash(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function deepFreeze<T>(value: T): T {
  if (
    typeof value !== "object"
    || value === null
    || Object.isFrozen(value)
    || ArrayBuffer.isView(value)
  ) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sourceSample(
  sequence: number,
  timeMilliseconds: number,
  x: number,
  y: number,
  pressure = 0.6,
) {
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
    timeMilliseconds,
    pointerId: 1,
    flags: 0,
  };
}

interface CanonicalOverrides {
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
  readonly colorSpace?: "linear-srgb" | "linear-display-p3";
  readonly blendMode?: "normal" | "multiply";
  readonly engine?: "dab-v1" | "wet-media-v1";
  readonly material?: "ink" | "pigment";
  readonly wetMedia?: unknown;
}

function canonicalPlan(
  overrides: CanonicalOverrides = {},
): StudioCanonicalBrushPlan {
  const samples = overrides.samples ?? [
    sourceSample(1, 0, 0, 0, 0.25),
    sourceSample(2, 10, 12, 0, 0.5),
    sourceSample(3, 20, 12, 16, 0.8),
    sourceSample(4, 30, 0, 24, 1),
  ];
  const candidate = {
    kind: "studio-canonical-brush-plan",
    version: 1,
    sessionEpoch: 1,
    strokeEpoch: 1,
    commandSequence: 1,
    strokeId: "dynamic-dual-tip-stroke",
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
      brushId: "dynamic-dual-tip-primary",
      engine: overrides.engine ?? "dab-v1",
      material: overrides.material ?? "ink",
      tip: overrides.tip ?? {
        kind: "texture",
        assetId: "primary-r8",
        contentHash: hash(PRIMARY_BYTES),
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
      grain: null,
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
  overrides: Readonly<{
    spacing?: number;
    size?: number;
  }> = {},
): StudioProfessionalBrushDynamicsPlan {
  const channel = (base: number, min: number, max: number) => ({
    base,
    min,
    max,
    mappings: [],
  });
  const parsed = parseStudioProfessionalBrushDynamicsPlan({
    kind: "studio-professional-brush-dynamics",
    version: 1,
    planId: "dynamic-dual-tip-dynamics",
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
      mode: "disabled",
      intervalTicks: 2,
      movementEpsilonPixels: 0.01,
    },
    channels: {
      size: channel(overrides.size ?? 8, 0.01, 512),
      opacity: channel(1, 0, 1),
      flow: channel(1, 0, 1),
      spacing: channel(overrides.spacing ?? 9, 0.05, 512),
      angle: channel(0, -Math.PI * 2, Math.PI * 2),
      roundness: channel(1, 0.01, 1),
      scatter: channel(0, 0, 512),
      textureDepth: channel(0, 0, 1),
    },
  });
  if (!parsed.ok) throw new Error(`${parsed.reason}: ${parsed.path}`);
  return parsed.plan;
}

function acceptedPrefix(
  canonical: StudioCanonicalBrushPlan,
  dynamics: StudioProfessionalBrushDynamicsPlan,
): readonly StudioProfessionalBrushAcceptedSample[] {
  return deepFreeze(canonical.source.samples.map((sample) => ({
    sequence: sample.sequence,
    timeTick: sample.timeMilliseconds / dynamics.clock.tickMilliseconds,
    x: sample.x,
    y: sample.y,
    pressure: sample.pressure,
    tiltXDegrees: sample.tiltX,
    tiltYDegrees: sample.tiltY,
    tangentialPressure: sample.tangentialPressure,
    twistDegrees: sample.twist,
  })));
}

function extension(
  overrides: Partial<StudioDynamicDualTipExtension> = {},
): StudioDynamicDualTipExtension {
  return deepFreeze({
    kind: "studio-dynamic-dual-tip-extension",
    version: 1,
    secondaryTip: {
      kind: "studio-dynamic-dual-tip-r8-reference",
      version: 1,
      assetId: "secondary-r8",
      contentHash: hash(SECONDARY_BYTES),
      width: 3,
      height: 2,
      channel: "luminance",
    },
    units: {
      diameter: "canonical-local-css-px",
      spacing: "document-css-px",
      scatter: "document-css-px",
      angle: "radians-relative-to-stroke",
    },
    secondaryDiameter: 6,
    secondarySpacing: 4,
    scatterAxes: "perpendicular-axis",
    scatterDistance: 2,
    count: 3,
    countJitter: 1,
    angleRadians: 0.2,
    roundness: 0.6,
    seed: 0x4a17,
    blendFamily: "multiply",
    secondaryOpacity: 0.7,
    ...overrides,
  });
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
    channel: request.expectedChannel ?? "alpha",
    format: "r8-unorm",
    byteLength: bytes.byteLength,
    bytes,
    ...overrides,
  };
}

function resolver(
  implementation: StudioEngineWebGpuTexturedBrushAssetResolver["resolve"] =
    async (request) => payload(
      request,
      request.assetId === "secondary-r8" ? SECONDARY_BYTES : PRIMARY_BYTES,
    ),
): StudioEngineWebGpuTexturedBrushAssetResolver & {
  readonly resolve: ReturnType<typeof vi.fn>;
} {
  return { resolve: vi.fn(implementation) };
}

function ready(
  result: StudioDynamicDualTipPlanResult,
): Extract<StudioDynamicDualTipPlanResult, { status: "ready" }> {
  if (result.status !== "ready") {
    throw new Error(`expected ready dual-tip plan, received ${JSON.stringify(result)}`);
  }
  return result;
}

async function build(
  canonical = canonicalPlan(),
  dynamics = dynamicsPlan(),
  dualExtension = extension(),
  assetResolver = resolver(),
  options: Parameters<typeof buildStudioDynamicDualTipPlan>[5] = {},
) {
  return buildStudioDynamicDualTipPlan(
    canonical,
    dynamics,
    acceptedPrefix(canonical, dynamics),
    dualExtension,
    assetResolver,
    options,
  );
}

describe("dynamic dual-tip provider-neutral planning", () => {
  it("returns independent immutable primary and secondary streams with an explicit capability", async () => {
    const canonical = canonicalPlan({
      transform: {
        encoding: "affine-f64-v1",
        m11: 2,
        m12: 0.25,
        m21: 0.5,
        m22: 1.5,
        translateX: 40,
        translateY: -20,
      },
    });
    const dynamics = dynamicsPlan({ spacing: 11 });
    const assetResolver = resolver();
    const result = ready(await build(
      canonical,
      dynamics,
      extension({ secondarySpacing: 3 }),
      assetResolver,
    ));

    expect(result.plan).toMatchObject({
      kind: "studio-dynamic-dual-tip-plan",
      version: 1,
      providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1",
      executionRoute: "experimental-webgpu-aggregate-preview-v1",
      exactExecutionRoute: "webgpu-exact-packed-deposition-v2",
      fidelity: "aggregate-mask-preview-only",
      singleTipFallback: "forbidden",
      textureFormat: "rgba16float",
      maskFormat: "r8-unorm",
    });
    expect(result.plan.primary.dualTip).toBe("extension-required");
    expect(result.plan.secondaryStations.length)
      .toBeGreaterThan(result.plan.primary.dabs.length);
    expect(result.plan.secondaryInstances.length)
      .toBeGreaterThan(result.plan.secondaryStations.length);
    expect(result.plan.secondaryAsset).toMatchObject({
      assetIndex: result.plan.primary.assets.length,
      assetId: "secondary-r8",
      contentHash: hash(SECONDARY_BYTES),
      width: 3,
      height: 2,
      channel: "luminance",
      format: "r8-unorm",
    });
    expect(assetResolver.resolve.mock.calls.map(([request]) => request.assetId))
      .toEqual(["primary-r8", "secondary-r8"]);
    expect(result.receipt).toMatchObject({
      providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1",
      executionRoute: "experimental-webgpu-aggregate-preview-v1",
      exactExecutionRoute: "webgpu-exact-packed-deposition-v2",
      fidelity: "aggregate-mask-preview-only",
      singleTipFallback: "forbidden",
      primaryEventCount: result.plan.primary.dabs.length,
      secondaryStationCount: result.plan.secondaryStations.length,
      secondaryInstanceCount: result.plan.secondaryInstances.length,
      assetCount: 2,
      complete: false,
    });
    expect(result.receipt.fingerprint).toBe(result.plan.fingerprint);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.plan)).toBe(true);
    expect(Object.isFrozen(result.plan.secondaryStations)).toBe(true);
    expect(Object.isFrozen(result.plan.secondaryInstances[0]!.localToDocument)).toBe(true);
  });

  it("uses independent document-arc spacing and preserves the terminal station", async () => {
    const canonical = canonicalPlan({
      samples: [
        sourceSample(1, 0, 0, 0),
        sourceSample(2, 10, 20, 0),
      ],
    });
    const result = ready(await build(
      canonical,
      dynamicsPlan({ spacing: 13 }),
      extension({
        secondarySpacing: 6,
        scatterDistance: 0,
        count: 1,
        countJitter: 0,
      }),
    ));
    expect(result.plan.secondaryStations.map(({ arcLength }) => arcLength))
      .toEqual([0, 6, 12, 18, 20]);
    expect(result.plan.primary.dabs.length).not.toBe(result.plan.secondaryStations.length);
    expect(result.plan.secondaryInstances).toHaveLength(5);
  });

  it("derives a stationary stroke frame from the canonical affine transform", async () => {
    const canonical = canonicalPlan({
      samples: [sourceSample(1, 0, 0, 0)],
      transform: {
        encoding: "affine-f64-v1",
        m11: 0,
        m12: 2,
        m21: -3,
        m22: 0,
        translateX: 20,
        translateY: -10,
      },
    });
    const result = ready(await build(
      canonical,
      dynamicsPlan(),
      extension({
        scatterDistance: 0,
        count: 1,
        countJitter: 0,
      }),
    ));
    expect(result.plan.secondaryStations).toHaveLength(1);
    expect(result.plan.secondaryStations[0]).toMatchObject({
      x: 20,
      y: -10,
      localTangentX: 1,
      localTangentY: 0,
      documentTangentX: 0,
      documentTangentY: 1,
      documentNormalX: -1,
      documentNormalY: 0,
    });
  });

  it("supports perpendicular-only and both-axis scatter in the local path frame", async () => {
    const canonical = canonicalPlan({
      samples: [
        sourceSample(1, 0, 0, 0),
        sourceSample(2, 10, 30, 0),
      ],
    });
    const common = {
      secondarySpacing: 10,
      scatterDistance: 5,
      count: 4,
      countJitter: 0,
    } as const;
    const perpendicular = ready(await build(
      canonical,
      dynamicsPlan(),
      extension({ ...common, scatterAxes: "perpendicular-axis" }),
    ));
    const both = ready(await build(
      canonical,
      dynamicsPlan(),
      extension({ ...common, scatterAxes: "both-axes" }),
    ));
    const tangentDisplacement = (result: typeof perpendicular) => {
      const station = result.plan.secondaryStations[0]!;
      return result.plan.secondaryInstances
        .filter(({ stationIndex }) => stationIndex === 0)
        .map((instance) => (
          (instance.x - station.x) * station.documentTangentX
          + (instance.y - station.y) * station.documentTangentY
        ));
    };
    expect(tangentDisplacement(perpendicular).every(
      (distance) => Math.abs(distance) < 1e-5,
    )).toBe(true);
    expect(tangentDisplacement(both).some(
      (distance) => Math.abs(distance) > 0.1,
    )).toBe(true);
  });

  it("emits deterministic count jitter, affine f32 footprints, and fingerprints", async () => {
    const canonical = canonicalPlan({
      transform: {
        encoding: "affine-f64-v1",
        m11: 1.75,
        m12: 0.4,
        m21: -0.25,
        m22: 2.25,
        translateX: 0,
        translateY: 0,
      },
    });
    const first = ready(await build(canonical));
    const replay = ready(await build(canonical));
    expect(replay.plan).toEqual(first.plan);
    expect(replay.receipt).toEqual(first.receipt);
    expect(new Set(
      first.plan.secondaryStations.map(({ instanceCount }) => instanceCount),
    ).size).toBeGreaterThan(1);
    for (const instance of first.plan.secondaryInstances) {
      expect(instance.localToDocument.every(
        (value) => value === Math.fround(value),
      )).toBe(true);
      const [xx, xy, yx, yy] = instance.localToDocument;
      expect(Math.fround(xx * yy - xy * yx)).not.toBe(0);
      expect(instance.x).toBe(Math.fround(instance.x));
      expect(instance.y).toBe(Math.fround(instance.y));
    }
    expect(first.plan.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it.each(BLENDS)("models the %s blend family without single-tip execution", async (blend) => {
    const result = ready(await build(
      canonicalPlan(),
      dynamicsPlan(),
      extension({ blendFamily: blend, secondaryOpacity: 0.35 }),
    ));
    expect(result.plan.extension).toMatchObject({
      blendFamily: blend,
      secondaryOpacity: 0.35,
    });
    expect(result.receipt.blendFamily).toBe(blend);
    expect(result.plan.singleTipFallback).toBe("forbidden");
  });

  it("keeps append/rebuild geometry exact while mode participates in the fingerprint", async () => {
    const canonical = canonicalPlan();
    const dynamics = dynamicsPlan();
    const append = ready(await build(
      canonical,
      dynamics,
      extension(),
      resolver(),
      { mode: "append" },
    ));
    const rebuild = ready(await build(
      canonical,
      dynamics,
      extension(),
      resolver(),
      { mode: "rebuild" },
    ));
    expect(append.plan.secondaryStations).toEqual(rebuild.plan.secondaryStations);
    expect(append.plan.secondaryInstances).toEqual(rebuild.plan.secondaryInstances);
    expect(append.plan.primary.dabs).toEqual(rebuild.plan.primary.dabs);
    expect(append.plan.fingerprint).not.toBe(rebuild.plan.fingerprint);
    expect(append.plan.mode).toBe("append");
    expect(rebuild.plan.mode).toBe("rebuild");
  });

  it.each([
    ["identity", { assetId: "wrong-secondary" }, "secondary-asset-identity-mismatch"],
    ["dimension", { width: 2 }, "secondary-asset-dimension-mismatch"],
    ["channel", { channel: "alpha" }, "secondary-asset-channel-mismatch"],
    [
      "byte length",
      { byteLength: 5 },
      "secondary-asset-byte-length-mismatch",
    ],
  ])("rejects a secondary asset %s mismatch", async (_label, overrides, reason) => {
    const assetResolver = resolver(async (request) => (
      request.assetId === "secondary-r8"
        ? payload(
            request,
            SECONDARY_BYTES,
            overrides as Partial<StudioEngineWebGpuTexturedBrushAssetPayload>,
          )
        : payload(request, PRIMARY_BYTES)
    ));
    await expect(build(
      canonicalPlan(),
      dynamicsPlan(),
      extension(),
      assetResolver,
    )).resolves.toMatchObject({ status: "rejected", reason });
  });

  it("verifies secondary SHA-256 and detached bytes against per-asset and total budgets", async () => {
    const wrongBytes = new Uint8Array(SECONDARY_BYTES);
    wrongBytes[0] ^= 0xff;
    await expect(build(
      canonicalPlan(),
      dynamicsPlan(),
      extension(),
      resolver(async (request) => (
        request.assetId === "secondary-r8"
          ? payload(request, wrongBytes)
          : payload(request, PRIMARY_BYTES)
      )),
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "secondary-asset-content-hash-mismatch",
    });
    await expect(build(
      canonicalPlan(),
      dynamicsPlan(),
      extension(),
      resolver(),
      { maximumAssetBytes: 5 },
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "asset-budget-exceeded",
    });
    await expect(build(
      canonicalPlan(),
      dynamicsPlan(),
      extension(),
      resolver(),
      { maximumTotalAssetBytes: 9 },
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "asset-budget-exceeded",
    });

    const mutableSecondary = new Uint8Array(SECONDARY_BYTES);
    const detached = ready(await build(
      canonicalPlan(),
      dynamicsPlan(),
      extension(),
      resolver(async (request) => payload(
        request,
        request.assetId === "secondary-r8" ? mutableSecondary : PRIMARY_BYTES,
      )),
    ));
    mutableSecondary.fill(0);
    expect(detached.plan.secondaryAsset.bytes).toEqual(SECONDARY_BYTES);
  });

  it("rejects hostile getters, unknown fields, and mutable accepted-prefix data before resolving", async () => {
    const canonical = canonicalPlan();
    const dynamics = dynamicsPlan();
    const canonicalGetter = vi.fn(() => 1);
    const hostileRecipe = { ...canonical.recipe } as Record<string, unknown>;
    Object.defineProperty(hostileRecipe, "flow", {
      enumerable: true,
      get: canonicalGetter,
    });
    Object.freeze(hostileRecipe);
    const hostileCanonical = Object.freeze({
      ...canonical,
      recipe: hostileRecipe,
    });
    const assetResolver = resolver();
    await expect(buildStudioDynamicDualTipPlan(
      hostileCanonical,
      dynamics,
      acceptedPrefix(canonical, dynamics),
      extension(),
      assetResolver,
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-canonical-plan",
    });
    expect(canonicalGetter).not.toHaveBeenCalled();
    expect(assetResolver.resolve).not.toHaveBeenCalled();

    const acceptedGetter = vi.fn(() => 0);
    const hostileAccepted = {
      ...acceptedPrefix(canonical, dynamics)[0]!,
    } as Record<string, unknown>;
    Object.defineProperty(hostileAccepted, "pressure", {
      enumerable: true,
      get: acceptedGetter,
    });
    const hostilePrefix = Object.freeze([Object.freeze(hostileAccepted)]);
    await expect(buildStudioDynamicDualTipPlan(
      canonical,
      dynamics,
      hostilePrefix,
      extension(),
      resolver(),
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-accepted-prefix",
    });
    expect(acceptedGetter).not.toHaveBeenCalled();

    const extensionGetter = vi.fn(() => 4);
    const hostileExtension = {
      ...extension(),
    } as unknown as Record<string, unknown>;
    Object.defineProperty(hostileExtension, "secondarySpacing", {
      enumerable: true,
      get: extensionGetter,
    });
    Object.freeze(hostileExtension);
    await expect(buildStudioDynamicDualTipPlan(
      canonical,
      dynamics,
      acceptedPrefix(canonical, dynamics),
      hostileExtension,
      resolver(),
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-extension",
    });
    expect(extensionGetter).not.toHaveBeenCalled();

    const resolverGetter = vi.fn();
    const hostileResolver = {};
    Object.defineProperty(hostileResolver, "resolve", {
      enumerable: true,
      get: resolverGetter,
    });
    await expect(buildStudioDynamicDualTipPlan(
      canonical,
      dynamics,
      acceptedPrefix(canonical, dynamics),
      extension(),
      hostileResolver,
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-resolver",
    });
    expect(resolverGetter).not.toHaveBeenCalled();

    await expect(buildStudioDynamicDualTipPlan(
      canonical,
      dynamics,
      acceptedPrefix(canonical, dynamics),
      deepFreeze({
        ...extension(),
        unreviewedVendorPresetField: true,
      }),
      resolver(),
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-extension",
    });
    await expect(buildStudioDynamicDualTipPlan(
      canonical,
      dynamics,
      acceptedPrefix(canonical, dynamics).map((item) => ({ ...item })),
      extension(),
      resolver(),
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-accepted-prefix",
    });
  });

  it("rejects accepted-prefix divergence before any external asset call", async () => {
    const canonical = canonicalPlan();
    const dynamics = dynamicsPlan();
    const divergent = deepFreeze(acceptedPrefix(canonical, dynamics).map(
      (item, index) => index === 1 ? { ...item, x: item.x + 0.25 } : item,
    ));
    const assetResolver = resolver();
    await expect(buildStudioDynamicDualTipPlan(
      canonical,
      dynamics,
      divergent,
      extension(),
      assetResolver,
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "accepted-prefix-mismatch",
    });
    expect(assetResolver.resolve).not.toHaveBeenCalled();
  });

  it.each([
    [
      "analytic primary",
      canonicalPlan({
        tip: { kind: "analytic", shape: "round", edgeSoftness: 0.2 },
      }),
      "texture-primary-required",
    ],
    [
      "Display P3",
      canonicalPlan({ colorSpace: "linear-display-p3" }),
      "unsupported-color-space",
    ],
    [
      "non-normal primary blend",
      canonicalPlan({ blendMode: "multiply" }),
      "unsupported-blend-mode",
    ],
    [
      "wet media",
      canonicalPlan({
        engine: "wet-media-v1",
        material: "pigment",
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
      "wet-media",
    ],
  ])("fails closed for %s", async (_label, canonical, reason) => {
    const dynamics = dynamicsPlan();
    await expect(buildStudioDynamicDualTipPlan(
      canonical,
      dynamics,
      acceptedPrefix(canonical, dynamics),
      extension(),
      resolver(),
    )).resolves.toMatchObject({ status: "unsupported", reason });
  });

  it("enforces station, instance, primary-dab, coordinate, and extension limits", async () => {
    const long = canonicalPlan({
      samples: [
        sourceSample(1, 0, 0, 0),
        sourceSample(2, 10, 100, 0),
      ],
    });
    await expect(build(
      long,
      dynamicsPlan(),
      extension({ secondarySpacing: 1 }),
      resolver(),
      { maximumSecondaryStations: 2 },
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "station-limit-exceeded",
    });
    await expect(build(
      canonicalPlan({
        samples: [sourceSample(1, 0, 0, 0)],
      }),
      dynamicsPlan(),
      extension({ count: 4, countJitter: 0 }),
      resolver(),
      { maximumSecondaryInstances: 3 },
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "instance-limit-exceeded",
    });
    await expect(build(
      long,
      dynamicsPlan({ spacing: 1 }),
      extension(),
      resolver(),
      { maximumPrimaryDabs: 1 },
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "primary-plan-rejected",
      detail: "dab-limit-exceeded",
    });
    await expect(build(
      canonicalPlan({
        samples: [sourceSample(1, 0, 0, 0)],
      }),
      dynamicsPlan({ size: 4 }),
      extension({
        secondaryDiameter: 20,
        scatterDistance: 0,
        count: 1,
        countJitter: 0,
      }),
      resolver(),
      { maximumCoordinateAbsolute: 5 },
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "coordinate-budget-exceeded",
    });
    await expect(build(
      canonicalPlan(),
      dynamicsPlan(),
      extension({ count: 2, countJitter: 2 } as Partial<StudioDynamicDualTipExtension>),
    )).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-extension",
    });
  });

  it("supports abort and deterministic cancellation gates across every planning phase", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(build(
      canonicalPlan(),
      dynamicsPlan(),
      extension(),
      resolver(),
      { signal: controller.signal },
    )).resolves.toEqual({
      status: "cancelled",
      phase: "primary",
      completed: 0,
      total: 1,
    });

    await expect(build(
      canonicalPlan(),
      dynamicsPlan(),
      extension(),
      resolver(),
      {
        shouldCancel: (progress) => (
          progress.phase === "secondary-stations" && progress.completed >= 1
        ),
      },
    )).resolves.toMatchObject({
      status: "cancelled",
      phase: "secondary-stations",
      completed: 1,
    });

    await expect(build(
      canonicalPlan(),
      dynamicsPlan(),
      extension(),
      resolver(),
      {
        shouldCancel: (progress) => (
          progress.phase === "secondary-instances" && progress.completed >= 2
        ),
      },
    )).resolves.toMatchObject({
      status: "cancelled",
      phase: "secondary-instances",
      completed: 2,
    });

    await expect(build(
      canonicalPlan(),
      dynamicsPlan(),
      extension(),
      resolver(),
      {
        shouldCancel: () => {
          throw new Error("scheduler failed");
        },
      },
    )).resolves.toEqual({
      status: "cancelled",
      phase: "primary",
      completed: 0,
      total: 1,
    });
  });
});
