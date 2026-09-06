import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import {
  encodeStudioCanonicalBrushPlan,
  hashStudioCanonicalBrushPlan,
  parseStudioCanonicalBrushPlan,
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS,
  STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
  type StudioCanonicalBrushPlan,
} from "./studio-canonical-brush-plan";

const STATE = {
  sessionEpoch: 19,
  strokeEpoch: 7,
  lastAcceptedCommandSequence: 0,
};

function sample(sequence: number, x = sequence * 2, y = sequence * 3) {
  return {
    role: "authoritative",
    sequence,
    x,
    y,
    pressure: 0.55,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    timeMilliseconds: 1_000 + sequence,
    pointerId: 5,
    flags: 0,
  };
}

function curve(minimum = 1, maximum = 1, exponent = 1) {
  return { minimum, maximum, exponent };
}

function candidate(
  brushId = "g-pen",
  overrides: Record<string, unknown> = {},
) {
  const samples = [sample(10, 4, 5), sample(11, 8, 9)];
  return {
    kind: "studio-canonical-brush-plan",
    version: STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
    sessionEpoch: 19,
    strokeEpoch: 7,
    commandSequence: 1,
    strokeId: `stroke-${brushId}`,
    seed: 0x1234_5678,
    coordinateSpace: "document-css-px",
    transform: {
      encoding: "affine-f64-v1",
      m11: 1,
      m12: 0,
      m21: 0,
      m22: 1,
      translateX: 12,
      translateY: -4,
    },
    color: {
      space: "linear-srgb",
      alphaMode: "straight",
      components: [0.1, 0.2, 0.3, 0.9],
    },
    composite: {
      porterDuff: brushId === "eraser" ? "destination-out" : "source-over",
      blendMode: "normal",
      opacity: 0.8,
    },
    recipe: {
      version: 1,
      brushId,
      engine: "dab-v1",
      material: brushId === "pencil"
        ? "graphite"
        : brushId === "marker"
          ? "marker"
          : brushId === "airbrush"
            ? "air"
            : brushId === "eraser"
              ? "eraser"
              : "ink",
      tip: { kind: "analytic", shape: "round", edgeSoftness: 0.05 },
      size: 8,
      flow: 0.7,
      hardness: 0.9,
      spacingRatio: 0.12,
      scatter: {
        radiusRatio: brushId === "airbrush" ? 1.5 : 0,
        distribution: "uniform-disk",
      },
      angleRadians: 0,
      roundness: 1,
      pressure: {
        size: curve(0.2, 1, 1),
        opacity: curve(0.4, 1, 1),
        flow: curve(1, 1, 1),
      },
      grain: brushId === "pencil"
        ? {
            kind: "procedural-noise",
            assetId: null,
            contentHash: null,
            space: "document",
            scale: 6,
            depth: 0.45,
            contrast: 0.7,
            seed: 99,
          }
        : null,
      wetMedia: null,
    },
    source: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: samples[0]!.sequence,
      lastSequence: samples.at(-1)!.sequence,
      samples,
    },
    ...overrides,
  };
}

function ready(input: unknown): StudioCanonicalBrushPlan {
  const result = parseStudioCanonicalBrushPlan(input, STATE);
  if (!result.ok) throw new Error(`${result.reason} at ${result.path}`);
  return result.value.plan;
}

describe("studio canonical brush plan", () => {
  it.each([
    ["G-pen", "g-pen", undefined],
    ["pencil", "pencil", undefined],
    ["marker", "marker", undefined],
    ["airbrush", "airbrush", undefined],
    [
      "tap",
      "g-pen",
      {
        source: {
          encoding: "accepted-authoritative-samples-v1",
          firstSequence: 10,
          lastSequence: 10,
          samples: [sample(10, 4, 5)],
        },
      },
    ],
    ["eraser", "eraser", undefined],
  ])(
    "produces byte-identical live and committed %s plans from the same accepted source",
    (_label, brushId, overrides) => {
      const live = ready(candidate(brushId, overrides));
      const committed = ready(structuredClone(candidate(brushId, overrides)));

      expect(committed).toEqual(live);
      expect(encodeStudioCanonicalBrushPlan(committed)).toBe(
        encodeStudioCanonicalBrushPlan(live),
      );
      expect(hashStudioCanonicalBrushPlan(committed)).toBe(
        hashStudioCanonicalBrushPlan(live),
      );
      expect(Object.isFrozen(live)).toBe(true);
      expect(Object.isFrozen(live.recipe.pressure.size)).toBe(true);
      expect(structuredClone(live)).toEqual(live);
      expect(live.source.samples[0]).not.toHaveProperty("role");
    },
  );

  it("keeps wet-media parameters in the same durable renderer-neutral recipe", () => {
    const input = candidate("watercolor");
    input.recipe.engine = "wet-media-v1";
    input.recipe.material = "pigment";
    (input.recipe as { wetMedia: unknown }).wetMedia = {
      model: "pigment-water-v1",
      fieldScale: 4,
      fixedRateHz: 240,
      simulationSteps: 16,
      absorption: 0.021,
      bleed: 0.34,
      dryingRate: 0.034,
      edgeDarkening: 0.46,
      fixationRate: 0.112,
      granulation: 0.4,
      paperRoughness: 0.54,
      pigmentLoad: 0.76,
      waterLoad: 0.98,
      wetnessLoad: 0.96,
    };
    const plan = ready(input);

    expect(plan.recipe.wetMedia).toMatchObject({
      model: "pigment-water-v1",
      fieldScale: 4,
      simulationSteps: 16,
    });
    expect(hashStudioCanonicalBrushPlan(plan)).toMatch(/^fnv1a32-utf16:[0-9a-f]{8}$/);
  });

  it("parses recipe v2 paint and exact retained dynamics while preserving recipe v1 bytes", () => {
    const legacy = ready(candidate("g-pen"));
    expect(legacy.recipe.version).toBe(1);
    expect(encodeStudioCanonicalBrushPlan(legacy)).not.toContain("retainedDynamics");

    const input = candidate("airbrush");
    const recipe = input.recipe as unknown as Record<string, unknown>;
    recipe.version = 2;
    recipe.paint = {
      model: "bounded-flow-v2",
      depositionAlpha: "flow-times-dab-opacity",
      accumulation: "source-over-stroke-local-rgba",
      finalCompositeOpacity: "plan-composite-opacity-once",
      surface: "bounded-sparse-rgba-tiles",
    };
    recipe.retainedDynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: "causal-deposit-v3-segmented",
      seed: 202,
      spacingRatio: 0.145,
      scatterRatio: 0.04,
      taper: {
        enabled: true,
        startLength: 0.06,
        endLength: 0.1,
        minSizeRatio: 0.45,
        minOpacityRatio: 0.35,
        curve: 0.9,
      },
      tip: { shape: "soft", softness: 0.42 },
      width: {
        base: 32,
        mappings: [{ source: "pressure", from: 0.7, to: 1.25 }],
        jitter: { mode: "multiply", amount: 0.1 },
      },
      opacity: { base: 0.65, mappings: [{ source: "pressure", from: 0.4, to: 1 }] },
      flow: { base: 0.5, mappings: [{ source: "pressure", from: 0.45, to: 1 }] },
      spacing: { mappings: [] },
      scatter: { mappings: [{ source: "pressure", from: 1, to: 0.7 }] },
      angle: { base: 0, mappings: [] },
      roundness: { base: 1, mappings: [] },
    });
    const parsed = ready(input);

    expect(parsed.recipe).toMatchObject({
      version: 2,
      paint: {
        model: "bounded-flow-v2",
        surface: "bounded-sparse-rgba-tiles",
      },
      retainedDynamics: {
        depositPipeline: "causal-deposit-v3-segmented",
        seed: 202,
        taper: { enabled: true },
        width: {
          mappings: [{ source: "pressure", from: 0.7, to: 1.25 }],
          jitter: { mode: "multiply", amount: 0.1 },
        },
      },
    });
    if (parsed.recipe.version !== 2) throw new Error("Expected recipe v2.");
    expect(Object.isFrozen(parsed.recipe.retainedDynamics)).toBe(true);
  });

  it("never treats v1 paint fields or non-canonical v2 dynamics as a legacy fallback", () => {
    const v1WithPaint = candidate("g-pen");
    (v1WithPaint.recipe as unknown as Record<string, unknown>).paint = {
      model: "layered-flow-v1",
    };
    expect(parseStudioCanonicalBrushPlan(v1WithPaint, STATE)).toEqual({
      ok: false,
      reason: "unknown-field",
      path: "$.recipe.paint",
    });

    const v2 = candidate("airbrush");
    const recipe = v2.recipe as unknown as Record<string, unknown>;
    recipe.version = 2;
    recipe.paint = {
      model: "bounded-flow-v2",
      depositionAlpha: "flow-times-dab-opacity",
      accumulation: "source-over-stroke-local-rgba",
      finalCompositeOpacity: "plan-composite-opacity-once",
      surface: "bounded-sparse-rgba-tiles",
    };
    recipe.retainedDynamics = { version: 1, seed: 202 };
    expect(parseStudioCanonicalBrushPlan(v2, STATE)).toMatchObject({
      ok: false,
      reason: "invalid-field",
      path: "$.recipe.retainedDynamics",
    });
  });

  it("accepts exact v2 multi-tip semantics and rejects a composition that diverges from dynamics", () => {
    const dynamics = normalizeStudioBrushDynamicsSettings({
      seed: 401,
      tip: { shape: "soft", softness: 0.86 },
      tipLayers: [{
        tip: { shape: "grain", softness: 0.4 },
        scale: 1.2,
        opacity: 0.6,
        offsetX: 0.25,
        offsetY: -0.4,
        angle: 15,
        roundness: 0.8,
      }],
      dualBrush: {
        enabled: true,
        tip: { shape: "sponge", softness: 0.66 },
        blendMode: "screen",
        sizeRatio: 1.42,
      },
    });
    const input = candidate("watercolor");
    const composition = {
      model: "normalized-multi-tip-v1",
      primary: dynamics.tip,
      layers: dynamics.tipLayers,
      dualBrush: dynamics.dualBrush ?? null,
    };
    Object.assign(input.recipe, {
      version: 2,
      paint: {
        model: "bounded-flow-v2",
        depositionAlpha: "flow-times-dab-opacity",
        accumulation: "source-over-stroke-local-rgba",
        finalCompositeOpacity: "plan-composite-opacity-once",
        surface: "bounded-sparse-rgba-tiles",
      },
      retainedDynamics: dynamics,
      tipComposition: composition,
    });

    const parsed = parseStudioCanonicalBrushPlan(structuredClone(input), STATE);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        plan: {
          recipe: {
            version: 2,
            tipComposition: {
              model: "normalized-multi-tip-v1",
              layers: [{ scale: 1.2, opacity: 0.6 }],
              dualBrush: { enabled: true, blendMode: "screen", sizeRatio: 1.42 },
            },
          },
        },
      },
    });

    const conflicting = structuredClone(input);
    const conflictingComposition = (conflicting.recipe as Record<string, unknown>)
      .tipComposition as {
        dualBrush: Record<string, unknown> | null;
        layers: Array<Record<string, unknown>>;
      };
    conflictingComposition.dualBrush = {
      ...conflictingComposition.dualBrush,
      sizeRatio: 0.75,
    };
    expect(parseStudioCanonicalBrushPlan(conflicting, STATE)).toEqual({
      ok: false,
      reason: "invalid-field",
      path: "$.recipe",
    });

    const nonFinite = structuredClone(input);
    const nonFiniteRecipe = nonFinite.recipe as Record<string, unknown>;
    const nonFiniteComposition = structuredClone(nonFiniteRecipe.tipComposition) as {
      layers: Array<Record<string, unknown>>;
    };
    nonFiniteRecipe.tipComposition = nonFiniteComposition;
    nonFiniteComposition.layers[0]!.scale = Number.POSITIVE_INFINITY;
    expect(parseStudioCanonicalBrushPlan(nonFinite, STATE)).toMatchObject({
      ok: false,
      path: "$.recipe.tipComposition",
    });

    const legacy = candidate("legacy-watercolor");
    (legacy.recipe as Record<string, unknown>).tipComposition = composition;
    expect(parseStudioCanonicalBrushPlan(legacy, STATE)).toEqual({
      ok: false,
      reason: "unknown-field",
      path: "$.recipe.tipComposition",
    });
  });

  it("rejects predicted input instead of filtering it into durable history", () => {
    const input = candidate();
    input.source.samples[1]!.role = "predicted";

    expect(parseStudioCanonicalBrushPlan(input, STATE)).toEqual({
      ok: false,
      reason: "predicted-sample",
      path: "$.source.samples[1].role",
    });
  });

  it("fails closed on NaN, Infinity and a hostile getter without invoking it", () => {
    expect(
      parseStudioCanonicalBrushPlan(
        candidate("g-pen", {
          transform: {
            encoding: "affine-f64-v1",
            m11: Number.NaN,
            m12: 0,
            m21: 0,
            m22: 1,
            translateX: 0,
            translateY: 0,
          },
        }),
        STATE,
      ),
    ).toMatchObject({ ok: false, reason: "invalid-field", path: "$.transform" });
    const infinite = candidate();
    infinite.source.samples[0]!.x = Number.POSITIVE_INFINITY;
    expect(parseStudioCanonicalBrushPlan(infinite, STATE)).toMatchObject({
      ok: false,
      reason: "invalid-field",
      path: "$.source.samples[0]",
    });

    let getterCalls = 0;
    const hostile = candidate();
    Object.defineProperty(hostile.recipe, "size", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 8;
      },
    });
    expect(parseStudioCanonicalBrushPlan(hostile, STATE)).toMatchObject({
      ok: false,
      reason: "not-plain-data",
      path: "$.recipe.size",
    });
    expect(getterCalls).toBe(0);

    const sparseColor = candidate();
    delete sparseColor.color.components[2];
    expect(parseStudioCanonicalBrushPlan(sparseColor, STATE)).toMatchObject({
      ok: false,
      reason: "invalid-field",
      path: "$.color.components[2]",
    });
  });

  it("rejects oversize sources, duplicate/reordered samples and mismatched accepted prefixes", () => {
    const oversize = candidate();
    oversize.source.samples = Array.from(
      { length: STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSamples + 1 },
      (_, index) => sample(index),
    );
    oversize.source.firstSequence = 0;
    oversize.source.lastSequence = oversize.source.samples.length - 1;
    expect(parseStudioCanonicalBrushPlan(oversize, STATE)).toMatchObject({
      ok: false,
      reason: "budget-exceeded",
      path: "$.source.samples.length",
    });

    const duplicate = candidate();
    duplicate.source.samples[1]!.sequence = 10;
    duplicate.source.lastSequence = 10;
    expect(parseStudioCanonicalBrushPlan(duplicate, STATE)).toMatchObject({
      ok: false,
      reason: "duplicate-sample-sequence",
    });

    const reordered = candidate();
    reordered.source.samples[0]!.sequence = 12;
    expect(parseStudioCanonicalBrushPlan(reordered, STATE)).toMatchObject({
      ok: false,
      reason: "sample-sequence-order",
    });

    const badPrefix = candidate();
    badPrefix.source.lastSequence = 99;
    expect(parseStudioCanonicalBrushPlan(badPrefix, STATE)).toMatchObject({
      ok: false,
      reason: "accepted-prefix-mismatch",
    });
  });

  it("rejects epoch mismatches, duplicate commands and sequence gaps", () => {
    expect(
      parseStudioCanonicalBrushPlan(candidate(), { ...STATE, sessionEpoch: 20 }),
    ).toMatchObject({ ok: false, reason: "session-epoch-mismatch" });
    expect(
      parseStudioCanonicalBrushPlan(candidate(), { ...STATE, strokeEpoch: 8 }),
    ).toMatchObject({ ok: false, reason: "stroke-epoch-mismatch" });
    expect(
      parseStudioCanonicalBrushPlan(candidate(), {
        ...STATE,
        lastAcceptedCommandSequence: 1,
      }),
    ).toMatchObject({ ok: false, reason: "duplicate-command-sequence" });
    expect(
      parseStudioCanonicalBrushPlan(
        candidate("g-pen", { commandSequence: 3 }),
        STATE,
      ),
    ).toMatchObject({ ok: false, reason: "command-sequence-gap" });
  });

  it("hashes every rendering authority field and ignores caller property order", () => {
    const base = ready(candidate());
    const reordered = ready({
      ...candidate(),
      transform: {
        translateY: -4,
        translateX: 12,
        m22: 1,
        m21: 0,
        m12: 0,
        m11: 1,
        encoding: "affine-f64-v1",
      },
    });
    expect(hashStudioCanonicalBrushPlan(reordered)).toBe(
      hashStudioCanonicalBrushPlan(base),
    );

    const changedSeed = ready(candidate("g-pen", { seed: 2 }));
    const changedColor = candidate();
    changedColor.color.components[0] = 0.11;
    const changedBlend = candidate();
    changedBlend.composite.blendMode = "multiply";
    const changedTransform = candidate();
    changedTransform.transform.translateX = 13;
    const hashes = [
      base,
      changedSeed,
      ready(changedColor),
      ready(changedBlend),
      ready(changedTransform),
    ].map(hashStudioCanonicalBrushPlan);
    expect(new Set(hashes)).toHaveLength(hashes.length);
  });

  it("does not admit renderer or framework objects into the durable contract", () => {
    const source = readFileSync(
      new URL("./studio-canonical-brush-plan.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(?:CanvasRenderingContext2D|CanvasImageSource|OffscreenCanvas|GPUDevice|GPUTexture|React\.)\b/,
    );
  });
});
