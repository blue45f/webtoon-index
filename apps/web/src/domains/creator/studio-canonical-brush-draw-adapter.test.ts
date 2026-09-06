import { describe, expect, it } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import { encodeStudioBrushTipAlphaMapBase64 } from "./brush/studio-brush-tip-stamp";
import { sampleStudioEngineTexturedBrushTipCpu } from "./render/studio-engine-webgpu-textured-brush-plan";
import { adaptStudioDrawElementToCanonicalBrushPlan } from "./studio-canonical-brush-draw-adapter";
import { hashStudioCanonicalBrushPlan } from "./studio-canonical-brush-plan";
import { sha256HexPortable } from "./studio-sha256";

import type { NormalizedStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import type {
  StudioCanonicalBrushDrawAdapterReady,
  StudioCanonicalBrushDrawAdapterRequest,
} from "./studio-canonical-brush-draw-adapter";
import type { DrawEl } from "./studio-element-model";

const TRANSFORM = {
  encoding: "affine-f64-v1",
  m11: 1.25,
  m12: 0.1,
  m21: -0.2,
  m22: 0.9,
  translateX: 12,
  translateY: -7,
} as const;

function request(
  element: DrawEl,
  overrides: Partial<StudioCanonicalBrushDrawAdapterRequest> = {},
): StudioCanonicalBrushDrawAdapterRequest {
  return {
    element,
    sessionEpoch: 9,
    strokeEpoch: 4,
    commandSequence: 1,
    firstSampleSequence: 100,
    firstTimeMilliseconds: 500,
    fallbackSampleIntervalMilliseconds: 4,
    pointerId: 7,
    flags: 3,
    colorSpace: "linear-srgb",
    transform: TRANSFORM,
    ...overrides,
  };
}

function ready(
  result: ReturnType<typeof adaptStudioDrawElementToCanonicalBrushPlan>,
): StudioCanonicalBrushDrawAdapterReady {
  if (result.status !== "ready") {
    throw new Error(`${result.reason} at ${result.path}: ${result.detail}`);
  }
  return result;
}

function effectiveTipAsset(result: StudioCanonicalBrushDrawAdapterReady) {
  const tip = result.plan.recipe.tip;
  if (tip.kind !== "texture") throw new Error("Expected a flattened canonical texture tip.");
  const asset = result.assets.find((candidate) => candidate.assetId === tip.assetId);
  if (!asset) throw new Error("Missing effective canonical tip asset.");
  return asset;
}

function constantAlphaTip(byte: number) {
  const bytes = new Uint8Array(8 * 8);
  bytes.fill(byte);
  return {
    shape: "round" as const,
    softness: 0,
    alphaMapSize: 8,
    alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(bytes),
  };
}

function boundedCompositionElement(
  id: string,
  dynamics: NormalizedStudioBrushDynamicsSettings,
): DrawEl {
  return dynamicElement({
    id,
    brush: "watercolor",
    paintModel: "bounded-flow-v2",
    sampleSpacing: 0,
    pressureModel: "linear-residual-path-v3",
    brushDynamics: dynamics,
  });
}

function dynamicElement(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "dynamic-bristle-1",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0, 4, 0, 4, 3],
    pressures: [0.2, 0.6, 0.9],
    speeds: [0, 2, 1],
    tiltXs: [-15, 10, 25],
    tiltYs: [4, -8, 30],
    twists: [15, 180, 359],
    tangentialPressures: [-0.25, 0.1, 0.75],
    stroke: "#336699cc",
    strokeWidth: 12,
    opacity: 0.65,
    brush: "ink-particle",
    // Product pointer-start stamps the bounded-flow-v2 paint seam with causal sampleSpacing on
    // every retained-dynamics pen stroke; the captured-preset resolver requires that seam.
    paintModel: "bounded-flow-v2",
    sampleSpacing: 1,
    brushDynamics: normalizeStudioBrushDynamicsSettings({
      seed: 123,
      fallbackPressure: 0.45,
      spacingRatio: 0.22,
      scatterRatio: 0.15,
      taper: { enabled: false },
      tip: { shape: "bristle", softness: 0.2, alphaMapSize: 16 },
      colorDynamics: {
        backgroundColor: "#ffffff",
        foregroundBackgroundMix: 0,
        foregroundBackgroundJitter: 0,
        hueJitter: 0,
        saturationJitter: 0,
        valueJitter: 0,
      },
      grain: {
        space: "stroke-fixed",
        amount: 0.35,
        scale: 7,
        contrast: 0.6,
        seed: 77,
      },
      tipLayers: [],
      width: {
        base: 12,
        min: 0.05,
        max: 4096,
        mappings: [{
          source: "pressure",
          mode: "multiply",
          from: 0.4,
          to: 1.2,
          amount: 1,
          curve: 1.4,
        }],
        jitter: null,
      },
      opacity: {
        base: 0.75,
        min: 0,
        max: 1,
        mappings: [],
        jitter: null,
      },
      flow: {
        base: 0.6,
        min: 0,
        max: 1,
        mappings: [{
          source: "pressure",
          mode: "multiply",
          from: 0.5,
          to: 1,
          amount: 1,
          curve: 1.25,
        }],
        jitter: null,
      },
      spacing: { base: 2.64, min: 0.25, max: 4096, mappings: [], jitter: null },
      scatter: { base: 1.8, min: 0, max: 4096, mappings: [], jitter: null },
      angle: { base: -18, min: -180, max: 180, mappings: [], jitter: null },
      roundness: { base: 0.72, min: 0.08, max: 1, mappings: [], jitter: null },
    }),
    ...overrides,
  };
}

describe("Studio DrawEl canonical brush adapter", () => {
  it("preserves all accepted stylus channels, reconstructs velocity time and emits specialist texture/grain", () => {
    const element = dynamicElement();
    const first = ready(adaptStudioDrawElementToCanonicalBrushPlan(request(element)));
    const second = ready(adaptStudioDrawElementToCanonicalBrushPlan(request(structuredClone(element))));

    expect(first.plan).toEqual(second.plan);
    expect(first.requirements).toEqual([
      "texture-tip",
      "grain",
      "retained-dynamics",
      "stroke-local-compositor",
    ]);
    expect(first.plan.transform).toEqual(TRANSFORM);
    expect(first.plan.source.samples).toEqual([
      {
        sequence: 100,
        x: 0,
        y: 0,
        pressure: 0.2,
        tangentialPressure: -0.25,
        tiltX: -15,
        tiltY: 4,
        twist: 15,
        timeMilliseconds: 500,
        pointerId: 7,
        flags: 3,
      },
      {
        sequence: 101,
        x: 4,
        y: 0,
        pressure: 0.6,
        tangentialPressure: 0.1,
        tiltX: 10,
        tiltY: -8,
        twist: 180,
        timeMilliseconds: 502,
        pointerId: 7,
        flags: 3,
      },
      {
        sequence: 102,
        x: 4,
        y: 3,
        pressure: 0.9,
        tangentialPressure: 0.75,
        tiltX: 25,
        tiltY: 30,
        twist: 359,
        timeMilliseconds: 505,
        pointerId: 7,
        flags: 3,
      },
    ]);
    expect(first.plan.recipe).toMatchObject({
      engine: "dab-v1",
      material: "ink",
      size: 12,
      flow: 1,
      hardness: 1,
      spacingRatio: 0.22,
      scatter: { radiusRatio: 0.15, distribution: "uniform-disk" },
      roundness: 0.72,
      grain: {
        kind: "procedural-noise",
        space: "stroke",
        scale: 7,
        depth: 0.35,
        contrast: 0.6,
        seed: 77,
      },
    });
    // v2 bounded recipes neutralize channel-serialized pressure curves to identity; the truth
    // travels in retainedDynamics and is replayed by the consumer with the retained planner.
    const identityCurve = { minimum: 1, maximum: 1, exponent: 1 };
    expect(first.plan.recipe.pressure.size).toEqual(identityCurve);
    expect(first.plan.recipe.pressure.opacity).toEqual(identityCurve);
    expect(first.plan.recipe.pressure.flow).toEqual(identityCurve);
    expect(first.plan.recipe.version).toBe(2);
    const recipeWithDynamics = first.plan.recipe as typeof first.plan.recipe & {
      retainedDynamics: NormalizedStudioBrushDynamicsSettings | null;
    };
    expect(recipeWithDynamics.retainedDynamics).not.toBeNull();
    expect(recipeWithDynamics.retainedDynamics!.spacingRatio).toBe(0.22);
    expect(recipeWithDynamics.retainedDynamics!.scatterRatio).toBe(0.15);
    expect(recipeWithDynamics.retainedDynamics!.width.base).toBe(12);
    expect(recipeWithDynamics.retainedDynamics!.angle.base).toBe(-18);
    expect(first.plan.recipe.angleRadians).toBeCloseTo(-Math.PI / 10, 12);
    expect(first.plan.color.components[3]).toBeCloseTo(0.8, 5);
    expect(Object.isFrozen(first.plan)).toBe(true);
    expect(Object.isFrozen(first.plan.source.samples[0])).toBe(true);

    const tip = first.plan.recipe.tip;
    expect(tip.kind).toBe("texture");
    const asset = first.assets[0]!;
    expect(asset.width).toBe(16);
    expect(asset.height).toBe(16);
    expect(asset.byteLength).toBe(256);
    expect(asset.contentHash).toBe(`sha256:${sha256HexPortable(asset.bytes)}`);
    if (tip.kind === "texture") {
      expect(asset.assetId).toBe(tip.assetId);
      expect(asset.contentHash).toBe(tip.contentHash);
    }

    element.points[0] = 999;
    element.pressures![0] = 1;
    expect(first.plan.source.samples[0]!.x).toBe(0);
    expect(first.plan.source.samples[0]!.pressure).toBe(0.2);
  });

  it("maps the exact causal wet physical recipe without double-applying source alpha", () => {
    const result = ready(adaptStudioDrawElementToCanonicalBrushPlan(request({
      id: "wet-ink-1",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [2, 3, 8, 9],
      pressures: [0.2, 0.8],
      stroke: "#0a141e80",
      strokeWidth: 20,
      opacity: 0.8,
      brush: "ink-wash",
      watercolorPipeline: "causal-walker-v2",
    })));

    expect(result.requirements).toEqual(["wet-media"]);
    expect(result.assets).toEqual([]);
    expect(result.plan.recipe).toMatchObject({
      brushId: "ink-wash",
      engine: "wet-media-v1",
      material: "pigment",
      hardness: 0.52,
      scatter: { radiusRatio: 0 },
      wetMedia: {
        model: "pigment-water-v1",
        fieldScale: 4,
        fixedRateHz: 240,
        simulationSteps: 16,
        absorption: 0.034,
        bleed: 0.46,
        dryingRate: 0.038,
        edgeDarkening: 0.82,
        fixationRate: 0.132,
        granulation: 0.74,
        paperRoughness: 0.8,
        pigmentLoad: 1.34,
        waterLoad: 0.86,
        wetnessLoad: 0.94,
      },
    });
    expect(result.plan.color.components[3]).toBe(1);
    expect(result.plan.composite.opacity).toBeCloseTo(0.8 * (128 / 255), 8);
    expect(result.plan.source.samples.map((sample) => sample.timeMilliseconds)).toEqual([500, 504]);
  });

  it("keeps new G-pen residual-path spacing explicit instead of rejecting sampleSpacing zero", () => {
    const result = ready(adaptStudioDrawElementToCanonicalBrushPlan(request({
      id: "gpen-v3",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [0, 0, 10, 0, 10, 10],
      pressures: [0.1, 0.7, 1],
      stroke: "#111827",
      strokeWidth: 7,
      opacity: 1,
      brush: "gpen",
      pressureModel: "linear-residual-path-v3",
      sampleSpacing: 0,
    })));

    expect(result.requirements).toEqual(["causal-residual-spacing"]);
    expect(result.plan.recipe.spacingRatio).toBe(0.2);
    expect(result.plan.recipe.pressure.size).toEqual({
      minimum: 0,
      maximum: 1,
      exponent: 1,
    });
  });

  it("uses deterministic destination-out eraser semantics independent of the CSS stroke colour", () => {
    const result = ready(adaptStudioDrawElementToCanonicalBrushPlan(request({
      id: "eraser-1",
      type: "draw",
      kind: "freehand",
      mode: "eraser",
      points: [1, 2, 5, 6],
      stroke: "this-colour-is-never-sampled",
      strokeWidth: 16,
      opacity: 0.4,
      brush: "pen",
      pressureModel: "linear-full-v1",
      sampleSpacing: 0.8,
    }, {
      colorSpace: "linear-display-p3",
    })));

    expect(result.requirements).toEqual([]);
    expect(result.plan.color).toEqual({
      space: "linear-display-p3",
      alphaMode: "straight",
      components: [0, 0, 0, 1],
    });
    expect(result.plan.composite).toEqual({
      porterDuff: "destination-out",
      blendMode: "normal",
      opacity: 0.4,
    });
    expect(result.plan.recipe.material).toBe("eraser");
    expect(result.plan.recipe.pressure.size).toEqual({
      minimum: 0,
      maximum: 1,
      exponent: 1,
    });
  });

  it("captures layered and bounded flow as recipe v2 without flattening dynamic mappings", () => {
    const bounded = ready(adaptStudioDrawElementToCanonicalBrushPlan(request({
      ...dynamicElement(),
      paintModel: "bounded-flow-v2",
      sampleSpacing: 0,
      pressureModel: "linear-residual-path-v3",
    })));
    expect(bounded.requirements).toEqual([
      "texture-tip",
      "grain",
      "retained-dynamics",
      "stroke-local-compositor",
    ]);
    expect(bounded.plan.recipe).toMatchObject({
      version: 2,
      paint: {
        model: "bounded-flow-v2",
        depositionAlpha: "flow-times-dab-opacity",
        accumulation: "source-over-stroke-local-rgba",
        finalCompositeOpacity: "plan-composite-opacity-once",
        surface: "bounded-sparse-rgba-tiles",
      },
      retainedDynamics: {
        width: {
          base: 12,
          mappings: [{
            source: "pressure",
            from: 0.4,
            to: 1.2,
            curve: 1.4,
          }],
        },
        grain: { amount: 0.35, seed: 77 },
      },
    });

    const layered = ready(adaptStudioDrawElementToCanonicalBrushPlan(request({
      id: "layered-pen",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [0, 0, 4, 3],
      pressures: [0.3, 0.9],
      stroke: "#334155",
      strokeWidth: 7,
      opacity: 0.45,
      brush: "pen",
      pressureModel: "linear-residual-path-v3",
      sampleSpacing: 0,
      paintModel: "layered-flow-v1",
    })));
    expect(layered.requirements).toEqual([
      "causal-residual-spacing",
      "stroke-local-compositor",
    ]);
    expect(layered.plan.recipe).toMatchObject({
      version: 2,
      paint: {
        model: "layered-flow-v1",
        surface: "stroke-local-rgba",
      },
      retainedDynamics: null,
    });

    const kneaded = ready(adaptStudioDrawElementToCanonicalBrushPlan(request({
      id: "layered-kneaded-eraser",
      type: "draw",
      kind: "freehand",
      mode: "eraser",
      points: [0, 0, 12, 3],
      pressures: [0.3, 0.9],
      stroke: "#000000",
      strokeWidth: 26,
      opacity: 0.38,
      brush: "kneaded-eraser",
      pressureModel: "linear-full-v1",
      sampleSpacing: 0,
      paintModel: "layered-flow-v1",
    })));
    expect(kneaded.requirements).toEqual(["stroke-local-compositor"]);
    expect(kneaded.plan).toMatchObject({
      composite: { porterDuff: "destination-out", opacity: 0.38 },
      recipe: {
        version: 2,
        brushId: "eraser:kneaded-eraser",
        material: "eraser",
        paint: { model: "layered-flow-v1", surface: "stroke-local-rgba" },
      },
    });
  });

  it("preserves watercolor dualBrush and ordered tipLayers in the canonical v2 visual contract", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      ...dynamicElement().brushDynamics,
      depositPipeline: "causal-deposit-v3-segmented",
      tip: { shape: "soft", softness: 0.86, alphaMapSize: 16 },
      tipLayers: [
        {
          tip: { shape: "bristle", softness: 0.3, alphaMapSize: 16 },
          scale: 1.25,
          opacity: 0.42,
          offsetX: -0.35,
          offsetY: 0.2,
          angle: 18,
          roundness: 0.7,
        },
        {
          tip: { shape: "grain", softness: 0.5, alphaMapSize: 16 },
          scale: 0.65,
          opacity: 0.78,
          offsetX: 0.4,
          offsetY: -0.15,
          angle: -27,
          roundness: 1.2,
        },
      ],
      dualBrush: {
        enabled: true,
        tip: { shape: "sponge", softness: 0.66, alphaMapSize: 16 },
        blendMode: "screen",
        sizeRatio: 1.42,
      },
    });
    const element = boundedCompositionElement("watercolor-canonical-composition", dynamics);
    const first = ready(adaptStudioDrawElementToCanonicalBrushPlan(request(element)));
    const replay = ready(adaptStudioDrawElementToCanonicalBrushPlan(
      request(structuredClone(element)),
    ));

    expect(first.plan.recipe).toMatchObject({
      version: 2,
      tip: { kind: "texture" },
      tipComposition: {
        model: "normalized-multi-tip-v1",
        primary: dynamics.tip,
        layers: [
          { scale: 1.25, opacity: 0.42, offsetX: -0.35, angle: 18 },
          { scale: 0.65, opacity: 0.78, offsetX: 0.4, angle: -27 },
        ],
        dualBrush: {
          enabled: true,
          blendMode: "screen",
          sizeRatio: 1.42,
        },
      },
      retainedDynamics: {
        tipLayers: dynamics.tipLayers,
        dualBrush: dynamics.dualBrush,
      },
    });
    expect(first.requirements).toEqual([
      "texture-tip",
      "grain",
      "retained-dynamics",
      "stroke-local-compositor",
    ]);
    expect(first.assets.length).toBeGreaterThanOrEqual(4);
    expect(first.assets.map((asset) => asset.assetId)).toEqual(
      [...first.assets.map((asset) => asset.assetId)].sort(),
    );
    expect(new Set(first.assets.map((asset) => asset.assetId)).size).toBe(first.assets.length);
    const effective = effectiveTipAsset(first);
    expect(effective.contentHash).toBe(
      "sha256:2ac6bcc8d78189852aa5fb3c309c2a89694727d6a311c109be3326cb77f09ca6",
    );
    expect(effective.width).toBeGreaterThan(16);
    expect(first.plan.recipe).toMatchObject({
      size: expect.any(Number),
      angleRadians: 0,
      roundness: 1,
    });
    expect(first.plan.recipe.size).toBeGreaterThan(dynamics.width.base);
    expect(replay.assets).toEqual(first.assets);
    expect(hashStudioCanonicalBrushPlan(replay.plan)).toBe(
      hashStudioCanonicalBrushPlan(first.plan),
    );
  });

  it("flattens ordered layers through R8 source-over and pins their single-tip bytes", () => {
    const primary = constantAlphaTip(1);
    const faint = constantAlphaTip(1);
    const wash = constantAlphaTip(64);
    const layer = (tip: ReturnType<typeof constantAlphaTip>) => ({
      tip,
      scale: 1,
      opacity: 1,
      offsetX: 0,
      offsetY: 0,
      angle: 0,
      roundness: 1,
    });
    const settings = (tipLayers: readonly ReturnType<typeof layer>[]) => (
      normalizeStudioBrushDynamicsSettings({
        ...dynamicElement().brushDynamics,
        depositPipeline: "causal-deposit-v3-segmented",
        tip: primary,
        tipLayers,
        grain: { amount: 0 },
        angle: { base: 0, mappings: [], jitter: null },
        roundness: { base: 1, mappings: [], jitter: null },
      })
    );
    const forward = ready(adaptStudioDrawElementToCanonicalBrushPlan(request(
      boundedCompositionElement("ordered-layer-r8", settings([layer(faint), layer(wash)])),
    )));
    const reversed = ready(adaptStudioDrawElementToCanonicalBrushPlan(request(
      boundedCompositionElement("ordered-layer-r8", settings([layer(wash), layer(faint)])),
    )));
    const primaryOnly = ready(adaptStudioDrawElementToCanonicalBrushPlan(request(
      boundedCompositionElement("ordered-layer-r8", settings([])),
    )));
    const forwardAsset = effectiveTipAsset(forward);
    const reversedAsset = effectiveTipAsset(reversed);
    const primaryAsset = effectiveTipAsset(primaryOnly);

    expect([...new Set(forwardAsset.bytes)]).toEqual([65]);
    expect([...new Set(reversedAsset.bytes)]).toEqual([66]);
    expect(forwardAsset.contentHash).toBe(
      "sha256:d53eda7a637c99cc7fb566d96e9fa109bf15c478410a3f5eb4d4c4e26cd081f6",
    );
    expect(reversedAsset.contentHash).toBe(
      "sha256:c422e7070cb1cb455b5de9afee0d975e303d0239c72030cd7414ab5c382d3ae8",
    );
    expect(forwardAsset.bytes).not.toEqual(reversedAsset.bytes);
    expect(sampleStudioEngineTexturedBrushTipCpu(
      forwardAsset,
      0.5,
      0.5,
      0,
    )).toBeGreaterThan(sampleStudioEngineTexturedBrushTipCpu(
      primaryAsset,
      0.5,
      0.5,
      0,
    ));
    expect(forward.plan.recipe.tip).toMatchObject({
      kind: "texture",
      assetId: forwardAsset.assetId,
      contentHash: forwardAsset.contentHash,
    });
  });

  it("binds every layer transform and opacity into effective carrier pixels", () => {
    const baseLayer = {
      tip: { shape: "bristle" as const, softness: 0.2, alphaMapSize: 24 },
      scale: 1.1,
      opacity: 0.55,
      offsetX: 0.2,
      offsetY: -0.15,
      angle: 13,
      roundness: 0.72,
    };
    const effectiveHash = (patch: Partial<typeof baseLayer>): string => {
      const dynamics = normalizeStudioBrushDynamicsSettings({
        ...dynamicElement().brushDynamics,
        depositPipeline: "causal-deposit-v3-segmented",
        tip: { shape: "soft", softness: 0.65, alphaMapSize: 24 },
        tipLayers: [{ ...baseLayer, ...patch }],
        grain: { amount: 0 },
        angle: { base: 0, mappings: [], jitter: null },
        roundness: { base: 1, mappings: [], jitter: null },
      });
      return effectiveTipAsset(ready(adaptStudioDrawElementToCanonicalBrushPlan(request(
        boundedCompositionElement("layer-transform-pixels", dynamics),
      )))).contentHash;
    };
    const baseline = effectiveHash({});
    const variants = [
      effectiveHash({ scale: 1.45 }),
      effectiveHash({ opacity: 0.31 }),
      effectiveHash({ offsetX: -0.45 }),
      effectiveHash({ offsetY: 0.5 }),
      effectiveHash({ angle: -41 }),
      effectiveHash({ roundness: 0.38 }),
    ];

    expect(new Set(variants).size).toBe(variants.length);
    expect(variants).not.toContain(baseline);
  });

  it("fails closed for unversioned non-pressure dynamics, dual tips and incomplete channels", () => {
    const cases: Array<{
      readonly element: DrawEl;
      readonly reason: string;
      readonly path: string;
    }> = [
      {
        element: dynamicElement({ tiltXs: [0, 1] }),
        reason: "invalid-samples",
        path: "element.tiltXs",
      },
      {
        element: dynamicElement({ speeds: [0, 0, 1] }),
        reason: "invalid-samples",
        path: "element.speeds[1]",
      },
    ];

    // Direction-source mappings are not serializable channel-by-channel, but the v2 paint recipe
    // binds the complete retained dynamics for consumer-side replay, so they now compile ready.
    const directionMapped = adaptStudioDrawElementToCanonicalBrushPlan(request(dynamicElement({
      brushDynamics: normalizeStudioBrushDynamicsSettings({
        ...dynamicElement().brushDynamics,
        angle: {
          base: 0,
          min: -180,
          max: 180,
          mappings: [{
            source: "direction",
            mode: "add",
            from: 0,
            to: 360,
            amount: 1,
          }],
        },
      }),
    })));
    expect(directionMapped.status).toBe("ready");
    if (directionMapped.status === "ready") {
      expect(directionMapped.requirements).toContain("retained-dynamics");
    }

    // Dual-tip dynamics likewise ride the v2 retained replay (the dual-tip WebGPU verifiers own
    // the consumer-side parity gates), so they no longer fail closed at the adapter boundary.
    const dualTip = adaptStudioDrawElementToCanonicalBrushPlan(request(dynamicElement({
      brushDynamics: normalizeStudioBrushDynamicsSettings({
        ...dynamicElement().brushDynamics,
        dualBrush: {
          enabled: true,
          tip: { shape: "star", softness: 0.1 },
          blendMode: "multiply",
          sizeRatio: 1,
        },
      }),
    })));
    expect(dualTip.status).toBe("ready");
    if (dualTip.status === "ready") {
      expect(dualTip.requirements).toContain("retained-dynamics");
    }

    for (const expected of cases) {
      const result = adaptStudioDrawElementToCanonicalBrushPlan(request(expected.element));
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBe(expected.reason);
        expect(result.path).toBe(expected.path);
      }
    }
  });
});
