import { describe, expect, it, vi } from "vitest";

import { resolveStudioDynamicBrushCoverageBudgetContract } from "../studio-dynamic-brush-coverage-renderer";

import {
  DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS,
  STUDIO_BRUSH_DYNAMICS_PRESETS,
  STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
  normalizeStudioBrushDynamicsSample,
  normalizeStudioBrushDynamicsSettings,
  planNormalizedStudioDynamicBrushDabs,
  planStudioDynamicBrush,
  resolveStudioBrushDynamics,
  serializeStudioBrushDynamicsSettingsCanonical,
  studioBrushDynamicsSeedFromKey,
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSettingsForBrushId,
  studioBrushDynamicsSettingsEqual,
  studioDryMediaUnionComposableProgramPin,
  studioBrushTaperFactors,
  studioReplaySafeBrushDynamicsSettingsForBrushId,
  type StudioBrushDynamicsRecipe,
  type StudioBrushDynamicsSettings,
  type StudioDynamicBrushPlan,
  type StudioDynamicBrushPlanInput,
} from "./studio-brush-dynamics";
import {
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2,
  selectStudioDynamicBrushCausalStampGrid,
  studioDynamicBrushCausalStampGridRuleOf,
} from "./studio-brush-render-budget";
import {
  buildStudioBrushTipAlphaMap,
  DEFAULT_STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE,
  sampleStudioBrushTipProceduralAlpha,
} from "./studio-brush-tip-stamp";
import { resolveStudioDynamicBrushMaterialIdentity } from "./studio-dry-media-dynamic-bridge";

function expectFiniteRecipe(recipe: StudioBrushDynamicsRecipe): void {
  for (const value of Object.values(recipe)) expect(Number.isFinite(value)).toBe(true);
  expect(recipe.size).toBeGreaterThanOrEqual(STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS.width.min);
  expect(recipe.size).toBeLessThanOrEqual(STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS.width.max);
  expect(recipe.opacity).toBeGreaterThanOrEqual(0);
  expect(recipe.opacity).toBeLessThanOrEqual(1);
  expect(recipe.flow).toBeGreaterThanOrEqual(0);
  expect(recipe.flow).toBeLessThanOrEqual(1);
  expect(recipe.spacing).toBeGreaterThanOrEqual(STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS.spacing.min);
  expect(recipe.scatter).toBeGreaterThanOrEqual(0);
  expect(recipe.angle).toBeGreaterThanOrEqual(-180);
  expect(recipe.angle).toBeLessThanOrEqual(180);
  expect(recipe.roundness).toBeGreaterThanOrEqual(STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS.roundness.min);
  expect(recipe.roundness).toBeLessThanOrEqual(1);
}

function expectFinitePlan(plan: StudioDynamicBrushPlan): void {
  expect(Number.isFinite(plan.totalLength)).toBe(true);
  for (const dab of plan.dabs) {
    for (const value of Object.values(dab)) {
      if (typeof value === "number") {
        expect(Number.isFinite(value)).toBe(true);
        continue;
      }
      for (const frameValue of Object.values(value)) {
        expect(Number.isFinite(frameValue)).toBe(true);
      }
    }
    expect(dab.size).toBeGreaterThan(0);
    expect(dab.opacity).toBeGreaterThanOrEqual(0);
    expect(dab.opacity).toBeLessThanOrEqual(1);
    expect(dab.flow).toBeGreaterThanOrEqual(0);
    expect(dab.flow).toBeLessThanOrEqual(1);
    expect(dab.spacing).toBeGreaterThanOrEqual(0.25);
    expect(dab.roundness).toBeGreaterThanOrEqual(0.08);
    expect(dab.roundness).toBeLessThanOrEqual(1);
  }
}

/** Stable FNV-1a digest so large planner outputs can be pinned byte-for-byte without megabyte literals. */
function fnv1aHex(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

describe("studio brush dynamics input normalization", () => {
  it("normalizes PointerEvent pressure, barrel pressure, speed, tilt, twist and direction ranges", () => {
    const normalized = normalizeStudioBrushDynamicsSample(
      {
        pressure: Number.NaN,
        tangentialPressure: 4,
        speed: 99,
        tiltX: 120,
        tiltY: -140,
        twist: 720,
        direction: 630,
        stampIndex: -3,
      },
      { fallbackPressure: 0.7, maxSpeed: 2 }
    );

    expect(normalized).toMatchObject({
      pressure: 0.7,
      tangentialPressure: 1,
      tangentialPressureNormalized: 1,
      speed: 64,
      speedNormalized: 1,
      tiltX: 90,
      tiltY: -90,
      tiltMagnitude: 1,
      tiltAzimuth: -45,
      twist: 359,
      direction: -90,
      hasTilt: true,
      hasDirection: true,
      stampIndex: 0,
    });
  });

  it("separates tilt magnitude and azimuth and marks absent circular inputs inactive", () => {
    const tilted = normalizeStudioBrushDynamicsSample({ tiltX: 0, tiltY: 45 });
    expect(tilted.tiltMagnitude).toBeCloseTo(0.5, 10);
    expect(tilted.tiltAzimuth).toBe(90);
    expect(tilted.hasTilt).toBe(true);

    const neutral = normalizeStudioBrushDynamicsSample({ direction: Number.NaN, tiltX: Number.NaN });
    expect(neutral).toMatchObject({
      tiltMagnitude: 0,
      tiltAzimuth: 0,
      hasTilt: false,
      direction: 0,
      hasDirection: false,
    });
  });

  it("does not mutate the caller's sample", () => {
    const sample = { pressure: 2, tiltX: 100, direction: 400 };
    const before = { ...sample };
    normalizeStudioBrushDynamicsSample(sample);
    expect(sample).toEqual(before);
  });
});

describe("studio brush dynamics mapping", () => {
  it("preserves existing G-pen width behavior and follows a supplied travel direction by default", () => {
    const result = resolveStudioBrushDynamics({ pressure: 0.5, direction: 90 });
    expect(result).toMatchObject({
      size: 6,
      width: 6,
      opacity: 1,
      flow: 1,
      spacing: 2.04,
      scatter: 0,
      angle: 90,
      roundness: 1,
    });
    expect(result.scatterOffsetX).toBe(0);
    expect(result.scatterOffsetY).toBe(0);
    expectFiniteRecipe(result);
  });

  it("maps low and high pressure to the compatible 0.3x and 1.7x width endpoints", () => {
    expect(resolveStudioBrushDynamics({ pressure: 0 }).size).toBeCloseTo(1.8, 10);
    expect(resolveStudioBrushDynamics({ pressure: 1 }).size).toBeCloseTo(10.2, 10);
  });

  it("combines pressure, velocity, tangential pressure, tilt and twist in serialized order", () => {
    const settings: StudioBrushDynamicsSettings = {
      maxSpeed: 2,
      width: {
        base: 10,
        min: 0.05,
        max: 100,
        mappings: [
          { source: "pressure", mode: "multiply", from: 0.5, to: 1.5 },
          { source: "speed", mode: "multiply", from: 1, to: 0.5 },
          { source: "tilt-magnitude", mode: "add", from: 0, to: 4 },
          { source: "tangential-pressure", mode: "add", from: -2, to: 2 },
          { source: "twist", mode: "add", from: 0, to: 4 },
        ],
      },
    };

    const result = resolveStudioBrushDynamics(
      { pressure: 0.75, speed: 2, tiltX: 45, tiltY: 0, tangentialPressure: 0.5, twist: 180 },
      settings
    );
    // 10 * 1.25 * .5 + 2 + 1 + 2
    expect(result.size).toBeCloseTo(11.25, 10);
  });

  it("combines travel direction, tilt azimuth and barrel twist as circular angle sources", () => {
    const settings: StudioBrushDynamicsSettings = {
      angle: {
        base: 0,
        mappings: [
          { source: "direction", mode: "add", from: 0, to: 360 },
          { source: "tilt-azimuth", mode: "add", from: 0, to: 360 },
          { source: "twist", mode: "add", from: 0, to: 360 },
        ],
      },
    };
    expect(resolveStudioBrushDynamics({ direction: 0, tiltX: 0, tiltY: 45, twist: 45 }, settings).angle).toBe(135);
    // An absent tilt direction is skipped instead of applying an arbitrary azimuth.
    expect(resolveStudioBrushDynamics({ direction: 30, twist: 30 }, settings).angle).toBe(60);
  });

  it("supports inverse response curves, opacity, flow, spacing and tilt roundness recipes", () => {
    const settings: StudioBrushDynamicsSettings = {
      maxSpeed: 2,
      opacity: { base: 1, mappings: [{ source: "speed", from: 0.2, to: 1, invert: true, curve: 2 }] },
      flow: { base: 1, mappings: [{ source: "pressure", from: 0.25, to: 1 }] },
      spacing: { base: 4, mappings: [{ source: "speed", from: 0.5, to: 2 }] },
      roundness: { base: 1, mappings: [{ source: "tilt", from: 1, to: 0.2 }] },
    };

    const slow = resolveStudioBrushDynamics({ speed: 0, pressure: 0, tiltX: 0 }, settings);
    const fastTilted = resolveStudioBrushDynamics({ speed: 2, pressure: 1, tiltX: 90 }, settings);
    expect(slow.opacity).toBe(1);
    expect(fastTilted.opacity).toBeCloseTo(0.2, 10);
    expect(slow.flow).toBeCloseTo(0.25, 10);
    expect(fastTilted.flow).toBe(1);
    expect(slow.spacing).toBe(2);
    expect(fastTilted.spacing).toBe(8);
    expect(slow.roundness).toBe(1);
    expect(fastTilted.roundness).toBeCloseTo(0.2, 10);
  });

  it("uses a stable seed and dab index for jitter and uniform-disk scatter", () => {
    const settings: StudioBrushDynamicsSettings = {
      seed: 42,
      width: { base: 10, mappings: [], jitter: { mode: "multiply", amount: 0.4 } },
      scatter: { base: 12, mappings: [] },
    };
    const first = resolveStudioBrushDynamics({ stampIndex: 7 }, settings);
    const replay = resolveStudioBrushDynamics({ stampIndex: 7 }, JSON.parse(JSON.stringify(settings)));
    const next = resolveStudioBrushDynamics({ stampIndex: 8 }, settings);

    expect(replay).toEqual(first);
    expect(next).not.toEqual(first);
    expect(Math.hypot(first.scatterOffsetX, first.scatterOffsetY)).toBeLessThanOrEqual(first.scatter);
    expect(first.size).toBeGreaterThanOrEqual(6);
    expect(first.size).toBeLessThanOrEqual(14);
  });

  it("never consults ambient Math.random", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("ambient randomness must not be used");
    });
    expect(() => resolveStudioBrushDynamics(
      { pressure: 0.7, stampIndex: 9 },
      { seed: 81, scatter: { base: 20 }, angle: { base: 30, jitter: { mode: "add", amount: 15 } } }
    )).not.toThrow();
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});

describe("studio brush dynamics settings safety", () => {
  it("sanitizes corrupt values, reversed ranges and hostile mapping magnitudes", () => {
    const raw = {
      seed: -9,
      fallbackPressure: Number.NaN,
      maxSpeed: 0,
      width: {
        base: Number.POSITIVE_INFINITY,
        min: 999,
        max: -999,
        mappings: [
          null,
          { source: "unknown" },
          { source: "pressure", from: -99, to: 99, amount: 9, curve: 0, invert: "yes" },
        ],
        jitter: { mode: "multiply", amount: 9 },
      },
      opacity: { base: -10, min: 7, max: -7 },
      angle: { base: 9999, min: 30, max: -30 },
      roundness: { base: Number.NaN, mappings: "broken" },
    };
    const normalized = normalizeStudioBrushDynamicsSettings(raw);

    expect(normalized.seed).toBe(0);
    expect(normalized.fallbackPressure).toBe(0.5);
    expect(normalized.maxSpeed).toBe(0.01);
    expect(normalized.width).toMatchObject({ base: 6, min: 0.05, max: 999 });
    expect(normalized.width.mappings).toEqual([
      { source: "pressure", mode: "multiply", from: 0, to: 8, amount: 1, curve: 0.05, invert: false },
    ]);
    expect(normalized.width.jitter).toEqual({ mode: "multiply", amount: 1 });
    expect(normalized.opacity).toMatchObject({ base: 0, min: 0, max: 1 });
    expect(normalized.angle).toMatchObject({ base: 30, min: -30, max: 30 });
    expectFiniteRecipe(resolveStudioBrushDynamics(
      { pressure: Number.NaN },
      raw as unknown as StudioBrushDynamicsSettings
    ));
  });

  it("accepts size as a persisted alias while giving width precedence", () => {
    expect(resolveStudioBrushDynamics({ pressure: 0.5 }, { size: { base: 20, mappings: [] } }).size).toBe(20);
    expect(resolveStudioBrushDynamics(
      { pressure: 0.5 },
      { size: { base: 20, mappings: [] }, width: { base: 12, mappings: [] } }
    ).size).toBe(12);
  });

  it("caps mapping count, emits a canonical version and round-trips through JSON", () => {
    const settings: StudioBrushDynamicsSettings = {
      seed: 987,
      width: {
        base: 17,
        mappings: Array.from({ length: 40 }, () => ({ source: "pressure" as const, from: 0.9, to: 1.1 })),
      },
    };
    const normalized = normalizeStudioBrushDynamicsSettings(settings);
    expect(normalized.version).toBe(1);
    expect(normalized.width.mappings).toHaveLength(24);
    expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized);
    expect(resolveStudioBrushDynamics({ pressure: 0.7, stampIndex: 5 }, normalized)).toEqual(
      resolveStudioBrushDynamics({ pressure: 0.7, stampIndex: 5 }, JSON.parse(JSON.stringify(normalized)))
    );
  });

  it("canonicalizes equivalent partial settings and detects meaningful recipe differences", () => {
    const partial = { width: { base: 6 } };
    const normalized = normalizeStudioBrushDynamicsSettings(partial);
    expect(studioBrushDynamicsSettingsEqual(partial, normalized)).toBe(true);
    expect(studioBrushDynamicsSettingsEqual(partial, { width: { base: 7 } })).toBe(false);
    expect(serializeStudioBrushDynamicsSettingsCanonical(partial)).toBe(JSON.stringify(normalized));
  });

  it("provides detached, serializable ink, airbrush and dry-media presets", () => {
    expect(STUDIO_BRUSH_DYNAMICS_PRESETS.map((preset) => preset.id)).toEqual([
      "ink-particle",
      "airbrush",
      "dry-media",
    ]);
    const recipes = STUDIO_BRUSH_DYNAMICS_PRESETS.map((preset) =>
      resolveStudioBrushDynamics({ pressure: 0.7, speed: 1, direction: 30, tiltX: 35, twist: 25 }, preset.settings)
    );
    expect(new Set(recipes.map((recipe) => JSON.stringify(recipe))).size).toBe(3);
    for (const preset of STUDIO_BRUSH_DYNAMICS_PRESETS) {
      expect(JSON.parse(JSON.stringify(preset.settings))).toEqual(preset.settings);
      expect(preset.settings.depositPipeline).toBe(
        STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3
      );
      expectFiniteRecipe(resolveStudioBrushDynamics({}, studioBrushDynamicsPresetSettings(preset.id)));
    }
    const first = studioBrushDynamicsPresetSettings("ink-particle");
    first.width.base = 99;
    expect(studioBrushDynamicsPresetSettings("ink-particle").width.base).toBe(8);
  });

  it("gives every air and dry-media toolbar brush a distinct physical execution signature", () => {
    const brushIds = [
      "airbrush",
      "soft-brush",
      "spray",
      "dry-media",
      "crayon",
      "chalk",
      "charcoal",
    ] as const;
    const settings = brushIds.map((brushId) => {
      const value = studioBrushDynamicsSettingsForBrushId(brushId);
      expect(value).not.toBeNull();
      expect(value?.depositPipeline).toBe(
        STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3
      );
      return value!;
    });

    const jitterSignature = (value: (typeof settings)[number]) => JSON.stringify({
      width: value.width.jitter,
      opacity: value.opacity.jitter,
      flow: value.flow.jitter,
      spacing: value.spacing.jitter,
      scatter: value.scatter.jitter,
      angle: value.angle.jitter,
      roundness: value.roundness.jitter,
    });
    const executionSignature = (value: (typeof settings)[number]) => JSON.stringify({
      tip: value.tip,
      spacingRatio: value.spacingRatio,
      scatterRatio: value.scatterRatio,
      flow: value.flow,
      jitter: jitterSignature(value),
      roundness: value.roundness,
      recipes: [0, 5, 11].map((stampIndex) => {
        const recipe = resolveStudioBrushDynamics(
          {
            pressure: 0.68,
            speed: 0.9,
            direction: 32,
            tiltX: 38,
            tiltY: 12,
            twist: 57,
            stampIndex,
          },
          { ...value, seed: 0x5eed_1234 }
        );
        return {
          spacing: recipe.spacing,
          scatter: recipe.scatter,
          scatterOffsetX: recipe.scatterOffsetX,
          scatterOffsetY: recipe.scatterOffsetY,
          flow: recipe.flow,
          angle: recipe.angle,
          roundness: recipe.roundness,
        };
      }),
    });

    // Each axis is deliberately independent so future tuning cannot accidentally collapse two
    // toolbar choices back into cosmetic aliases of the same engine preset.
    expect(new Set(settings.map((value) => value.tip.shape)).size).toBe(brushIds.length);
    expect(new Set(settings.map((value) => value.spacingRatio)).size).toBe(brushIds.length);
    expect(new Set(settings.map((value) => value.scatterRatio)).size).toBe(brushIds.length);
    expect(new Set(settings.map((value) => JSON.stringify(value.flow))).size).toBe(brushIds.length);
    expect(new Set(settings.map(jitterSignature)).size).toBe(brushIds.length);
    expect(new Set(settings.map((value) => JSON.stringify(value.roundness))).size).toBe(brushIds.length);
    expect(new Set(settings.map(executionSignature)).size).toBe(brushIds.length);

    for (const value of settings) {
      expect(JSON.parse(JSON.stringify(value))).toEqual(value);
      expectFiniteRecipe(resolveStudioBrushDynamics({ pressure: 0.5, stampIndex: 3 }, value));
    }
  });

  it("keeps canonical presets compatible and returns detached alias settings", () => {
    // The causal alpha-tip toolbar ids additionally mint the second-wave stamp-grid rule pin at
    // brush-id resolution; everything else stays byte-identical to the raw canonical preset.
    for (const id of ["ink-particle", "dry-media"] as const) {
      expect(studioBrushDynamicsSettingsForBrushId(id)).toEqual({
        ...studioBrushDynamicsPresetSettings(id),
        causalStampGridRule: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2,
      });
    }
    // The analytic-falloff airbrush stays unminted and resolves the pristine preset.
    expect(studioBrushDynamicsSettingsForBrushId("airbrush")).toEqual(
      studioBrushDynamicsPresetSettings("airbrush")
    );
    expect(studioBrushDynamicsSettingsForBrushId("pencil")).toBeNull();
    expect(studioBrushDynamicsSettingsForBrushId(null)).toBeNull();

    const first = studioBrushDynamicsSettingsForBrushId("spray")!;
    first.tip.softness = 1;
    first.flow.base = 1;
    expect(studioBrushDynamicsSettingsForBrushId("spray")).toMatchObject({
      tip: { shape: "flake", softness: 0.12 },
      flow: { base: 0.3 },
    });
    expect(studioBrushDynamicsPresetSettings("airbrush")).toMatchObject({
      tip: { shape: "soft", softness: 0.42 },
      flow: { base: 0.5 },
    });
  });

  it("de-correlates the low-pigment water-brush edge with deterministic spacing variation", () => {
    const settings = studioBrushDynamicsSettingsForBrushId("inkwash-water-brush");
    expect(settings?.spacing.jitter).toEqual({ mode: "multiply", amount: 0.08 });
    const spacings = Array.from({ length: 16 }, (_, stampIndex) =>
      resolveStudioBrushDynamics({ pressure: 0.55, stampIndex }, settings!).spacing
    );
    expect(new Set(spacings).size).toBeGreaterThan(8);
    expect(Array.from({ length: 16 }, (_, stampIndex) =>
      resolveStudioBrushDynamics({ pressure: 0.55, stampIndex }, settings!).spacing
    )).toEqual(spacings);
  });

  it("keeps airbrush aliases visible on mouse taps without making long strokes opaque", () => {
    const settings = studioBrushDynamicsPresetSettings("airbrush");
    const tap = planStudioDynamicBrush({
      points: [40, 40],
      pressures: [0.5],
      baseWidth: settings.width.base,
      baseOpacity: settings.opacity.base,
      settings,
    });
    expect(tap.dabs).toHaveLength(1);

    const centreTipAlpha = Math.max(...buildStudioBrushTipAlphaMap(settings.tip).alphas);
    // These are the built-in toolbar opacities for airbrush, soft-brush and spray. Include the
    // procedural soft-tip alpha so this contract measures the pixel artists actually see. The
    // normalized soft centre must clear a useful first-contact floor without becoming marker-dense.
    for (const toolOpacity of [0.7, 0.55, 0.55]) {
      const effectiveTapAlpha = tap.dabs[0]!.opacity
        * tap.dabs[0]!.flow
        * toolOpacity
        * centreTipAlpha;
      expect(effectiveTapAlpha).toBeGreaterThanOrEqual(0.085);
      expect(effectiveTapAlpha).toBeLessThan(0.12);
    }

    const stroke = planStudioDynamicBrush({
      points: [0, 0, 200, 0],
      pressures: [0.5, 0.5],
      speeds: [0, 0],
      baseWidth: settings.width.base,
      baseOpacity: settings.opacity.base,
      settings,
      seed: 202,
    });
    const compositeAlphaAt = (x: number, y: number): number => {
      let remaining = 1;
      for (const dab of stroke.dabs) {
        // This intentionally treats the whole soft-tip radius as solid. It is a conservative upper
        // bound; the renderer's procedural soft alpha map makes the real composited alpha lower.
        if (Math.hypot(dab.x - x, dab.y - y) > dab.size / 2) continue;
        remaining *= 1 - dab.opacity * dab.flow * 0.7;
      }
      return 1 - remaining;
    };
    const sampledAlpha = Array.from({ length: 33 }, (_, index) => compositeAlphaAt(index * 6.25, 0));
    expect(Math.max(...sampledAlpha)).toBeGreaterThan(0.12);
    expect(Math.max(...sampledAlpha)).toBeLessThan(0.65);

    // Measure a conservative continuous-tip composite at every interior deposited dab. This locks
    // the practical accumulation range rather than accepting a visible tap that becomes a patchy
    // long stroke.
    const accumulatedAtInteriorDabCentres = stroke.dabs.slice(5, -5).map((centreDab) => {
      let remaining = 1;
      for (const dab of stroke.dabs) {
        const radius = dab.size / 2;
        const distance = Math.hypot(dab.x - centreDab.x, dab.y - centreDab.y);
        if (distance > radius) continue;
        const tipAlpha = sampleStudioBrushTipProceduralAlpha(
          "soft",
          distance / radius,
          0,
          settings.tip.softness
        );
        remaining *= 1 - dab.opacity * dab.flow * 0.7 * tipAlpha;
      }
      return 1 - remaining;
    });
    const meanAccumulatedAlpha = accumulatedAtInteriorDabCentres.reduce(
      (total, alpha) => total + alpha,
      0
    ) / accumulatedAtInteriorDabCentres.length;
    expect(Math.min(...accumulatedAtInteriorDabCentres)).toBeGreaterThanOrEqual(0.1);
    expect(meanAccumulatedAlpha).toBeGreaterThanOrEqual(0.14);
    // The broader, centre-aligned envelope remains translucent but no longer reads as a row of
    // pale circular puffs while the pointer is moving.
    expect(meanAccumulatedAlpha).toBeLessThanOrEqual(0.25);
  });

  it("keeps exported defaults detached from runtime normalization", () => {
    const originalBase = DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.width.base;
    (DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.width as { base: number }).base = 123;
    expect(normalizeStudioBrushDynamicsSettings().width.base).toBe(6);
    (DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.width as { base: number }).base = originalBase;
  });

  it("derives stable unsigned seeds from stroke keys", () => {
    expect(studioBrushDynamicsSeedFromKey("stroke-42")).toBe(studioBrushDynamicsSeedFromKey("stroke-42"));
    expect(studioBrushDynamicsSeedFromKey("stroke-42")).not.toBe(studioBrushDynamicsSeedFromKey("stroke-43"));
    expect(studioBrushDynamicsSeedFromKey(null)).toBe(1);
    expect(studioBrushDynamicsSeedFromKey("")).toBe(1);
  });
});

describe("studio dynamic brush arc-length dab planner", () => {
  it("reuses normalized renderer settings without changing deterministic dab output", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      seed: 93,
      spacingRatio: null,
      spacing: { base: 2.5, mappings: [{ source: "pressure", from: 1.2, to: 0.8 }] },
      scatter: { base: 1.5, mappings: [] },
      tip: { shape: "grain", softness: 0.25 },
      grain: { amount: 0.4, scale: 7 },
      tipLayers: [{ tip: { shape: "star" }, opacity: 0.45 }],
    });
    const input = {
      points: [0, 0, 8, 1, 18, 4, 30, 6],
      pressures: [0.2, 0.45, 0.8, 0.6],
      baseWidth: 11,
      baseOpacity: 0.72,
      seed: 401,
      maxDabs: 128,
    } as const;
    const before = structuredClone(settings);

    const normalized = planNormalizedStudioDynamicBrushDabs(input, settings);
    const arbitraryInput = planStudioDynamicBrush({ ...input, settings }).dabs;

    expect(normalized).toEqual(arbitraryInput);
    expect(settings).toEqual(before);
  });

  it("resolves each uncapped station recipe once in the normalized renderer hot path", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      spacingRatio: null,
      spacing: { base: 2.5, mappings: [] },
      scatter: { base: 0, mappings: [] },
      width: {
        base: 12,
        mappings: [{ source: "pressure", from: 0.6, to: 1.4 }],
      },
    });
    const mapping = settings.width.mappings[0]!;
    let sourceReads = 0;
    Object.defineProperty(mapping, "source", {
      configurable: true,
      get() {
        sourceReads += 1;
        return "pressure";
      },
    });

    const dabs = planNormalizedStudioDynamicBrushDabs({
      points: [0, 0, 80, 0],
      pressures: [0.25, 0.85],
      baseWidth: 12,
      baseOpacity: 0.8,
      seed: 31,
      maxDabs: 256,
    }, settings);

    expect(dabs.length).toBeGreaterThan(10);
    expect(sourceReads).toBe(dabs.length);
  });

  it("lets plan-level baseWidth and baseOpacity override persisted property bases", () => {
    const plan = planStudioDynamicBrush({
      points: [0, 0],
      pressures: [0.5],
      baseWidth: 12,
      baseOpacity: 0.7,
      settings: {
        width: { base: 99, mappings: [] },
        opacity: { base: 0.1, mappings: [] },
        scatter: { base: 0 },
      },
    });
    expect(plan.settings.width.base).toBe(12);
    expect(plan.settings.opacity.base).toBe(0.7);
    expect(plan.settings.spacing.base).toBeCloseTo(12 * 0.34, 10);
    expect(plan.dabs[0]).toMatchObject({ size: 12, opacity: 0.7 });
  });

  it("stores spacing and scatter as tip-width ratios that scale with plan baseWidth", () => {
    const common = {
      points: [0, 0] as const,
      baseOpacity: 1,
      settings: {
        spacingRatio: 0.25,
        scatterRatio: 0.5,
        spacing: { mappings: [] },
        scatter: { mappings: [] },
      },
    };
    const small = planStudioDynamicBrush({ ...common, baseWidth: 20 });
    const large = planStudioDynamicBrush({ ...common, baseWidth: 40 });

    expect(small.settings).toMatchObject({ spacingRatio: 0.25, scatterRatio: 0.5 });
    expect(small.dabs[0]).toMatchObject({ spacing: 5, scatter: 10 });
    expect(large.dabs[0]).toMatchObject({ spacing: 10, scatter: 20 });
  });

  it("applies ratios to each pressure-adjusted dab size, not only the nominal toolbar width", () => {
    const plan = planStudioDynamicBrush({
      points: [0, 0],
      pressures: [1],
      baseWidth: 20,
      baseOpacity: 1,
      settings: { spacingRatio: 0.25, scatterRatio: 0.5 },
    });
    // Default pressure response at p=1 is 1.7x: 20px -> 34px tip.
    expect(plan.dabs[0]).toMatchObject({ size: 34, spacing: 8.5, scatter: 17 });
  });

  it("preserves legacy absolute spacing and scatter when explicit bases opt out of ratios", () => {
    const make = (baseWidth: number) => planStudioDynamicBrush({
      points: [0, 0],
      baseWidth,
      baseOpacity: 1,
      settings: {
        spacing: { base: 3, mappings: [] },
        scatter: { base: 2, mappings: [] },
      },
    });
    for (const plan of [make(10), make(40)]) {
      expect(plan.settings).toMatchObject({ spacingRatio: null, scatterRatio: null });
      expect(plan.dabs[0]).toMatchObject({ spacing: 3, scatter: 2 });
    }
  });

  it("places constant-spacing dabs by arc length and preserves exact endpoints", () => {
    const plan = planStudioDynamicBrush({
      points: [0, 0, 10, 0],
      baseWidth: 10,
      baseOpacity: 0.8,
      settings: { spacing: { base: 3, mappings: [] }, scatter: { base: 0 } },
    });

    expect(plan.dabs.map((dab) => dab.sourceX)).toEqual([0, 3, 6, 9, 10]);
    expect(plan.dabs.every((dab) => dab.sourceY === 0)).toBe(true);
    expect(plan.dabs.map((dab) => dab.x)).toEqual([0, 3, 6, 9, 10]);
    expect(plan.dabs[0]).toMatchObject({ progress: 0, angle: 0, opacity: 0.8 });
    expect(plan.dabs.at(-1)).toMatchObject({ progress: 1, sourceX: 10, x: 10 });
    expect(plan.totalLength).toBe(10);
    expect(plan.capped).toBe(false);
  });

  it("follows corners by cumulative arc length rather than endpoint interpolation", () => {
    const plan = planStudioDynamicBrush({
      points: [0, 0, 3, 0, 3, 4],
      baseWidth: 6,
      baseOpacity: 1,
      settings: { spacing: { base: 2, mappings: [] }, scatter: { base: 0 } },
    });
    expect(plan.totalLength).toBe(7);
    expect(plan.dabs.map((dab) => [dab.sourceX, dab.sourceY])).toEqual([
      [0, 0],
      [2, 0],
      [3, 1],
      [3, 3],
      [3, 4],
    ]);
    expect(plan.dabs[2]!.angle).toBe(90);
  });

  it("maps pressure to size, opacity and flow, and tilt/twist to tip geometry", () => {
    const input = {
      points: [0, 0, 10, 0],
      pressures: [0, 1],
      tiltXs: [0, 90],
      tiltYs: [0, 0],
      twists: [0, 90],
      baseWidth: 10,
      baseOpacity: 0.8,
      seed: 123,
      settings: {
        spacing: { base: 2, mappings: [] },
        scatter: { base: 2, mappings: [] },
        opacity: { mappings: [{ source: "pressure" as const, from: 0.2, to: 1 }] },
        flow: { mappings: [{ source: "pressure" as const, from: 0.3, to: 1 }] },
        angle: { mappings: [{ source: "twist" as const, mode: "add" as const, from: 0, to: 360 }] },
        roundness: { mappings: [{ source: "tilt-magnitude" as const, from: 1, to: 0.2 }] },
      },
    };
    const plan = planStudioDynamicBrush(input);
    const replay = planStudioDynamicBrush(JSON.parse(JSON.stringify(input)));
    const first = plan.dabs[0]!;
    const last = plan.dabs.at(-1)!;

    expect(replay).toEqual(plan);
    expect(first.size).toBeCloseTo(3, 10);
    expect(last.size).toBeCloseTo(17, 10);
    expect(first.opacity).toBeCloseTo(0.16, 10);
    expect(last.opacity).toBeCloseTo(0.8, 10);
    expect(first.flow).toBeCloseTo(0.3, 10);
    expect(last.flow).toBe(1);
    expect(first.roundness).toBe(1);
    expect(last.roundness).toBeCloseTo(0.2, 10);
    expect(first.angle).toBe(0);
    expect(last.angle).toBe(90);
    for (const dab of plan.dabs) {
      expect(Math.hypot(dab.x - dab.sourceX, dab.y - dab.sourceY)).toBeLessThanOrEqual(2);
    }
  });

  it("interpolates twist across the 359/0 seam via the shortest circular route", () => {
    const plan = planStudioDynamicBrush({
      points: [0, 0, 10, 0],
      twists: [350, 10],
      baseWidth: 6,
      baseOpacity: 1,
      settings: {
        spacing: { base: 5, mappings: [] },
        angle: { mappings: [{ source: "twist", mode: "add", from: 0, to: 360 }] },
      },
    });
    expect(plan.dabs).toHaveLength(3);
    expect(plan.dabs[0]!.angle).toBe(-10);
    expect(plan.dabs[1]!.angle).toBe(0);
    expect(plan.dabs[2]!.angle).toBe(10);
  });

  it("keeps first and last source stations when the hard dab cap is reached", () => {
    const plan = planStudioDynamicBrush({
      points: [0, 0, 100, 0],
      baseWidth: 5,
      baseOpacity: 1,
      maxDabs: 3,
      settings: { spacing: { base: 0.25, mappings: [] }, scatter: { base: 0 } },
    });
    expect(plan.capped).toBe(true);
    expect(plan.dabs).toHaveLength(3);
    expect(plan.dabs[0]).toMatchObject({ sourceX: 0, sourceY: 0, progress: 0 });
    expect(plan.dabs.at(-1)).toMatchObject({ sourceX: 100, sourceY: 0, progress: 1 });
    expect(plan.dabs.map((dab) => dab.sourceX)).toEqual([0, 50, 100]);
  });

  it.each(["ink-particle", "airbrush", "dry-media"] as const)(
    "redistributes a capped 10,000px %s stroke across the whole path without a final hole",
    (presetId) => {
      const settings = studioBrushDynamicsPresetSettings(presetId);
      const input = {
        points: [0, 0, 10_000, 0],
        pressures: [0.5, 0.5],
        speeds: [0, 0],
        baseWidth: settings.width.base,
        baseOpacity: settings.opacity.base,
        settings,
        seed: 0x1234_abcd,
        maxDabs: 1024,
      };
      const plan = planStudioDynamicBrush(input);
      const replay = planStudioDynamicBrush(JSON.parse(JSON.stringify(input)));
      const gaps = plan.dabs.slice(1).map((dab, index) => (
        dab.sourceX - plan.dabs[index]!.sourceX
      ));
      const averageGap = plan.totalLength / (plan.dabs.length - 1);

      expect(replay).toEqual(plan);
      expect(plan).toMatchObject({ capped: true, totalLength: 10_000 });
      expect(plan.dabs).toHaveLength(1024);
      expect(plan.dabs[0]).toMatchObject({ sourceX: 0, sourceY: 0, progress: 0 });
      expect(plan.dabs.at(-1)).toMatchObject({ sourceX: 10_000, sourceY: 0, progress: 1 });
      expect(Math.max(...gaps)).toBeLessThanOrEqual(averageGap * 1.01);
      expect(Math.min(...gaps)).toBeGreaterThan(0);
    }
  );

  it("retains wider speed-driven intervals while fitting a variable-spacing stroke to the cap", () => {
    const plan = planStudioDynamicBrush({
      points: [0, 0, 1000, 0],
      speeds: [0, 1],
      baseWidth: 10,
      baseOpacity: 1,
      maxDabs: 10,
      settings: {
        maxSpeed: 1,
        spacing: {
          base: 1,
          mappings: [{ source: "speed", mode: "add", from: 0, to: 400 }],
        },
        scatter: { base: 0 },
      },
    });
    const gaps = plan.dabs.slice(1).map((dab, index) => (
      dab.sourceX - plan.dabs[index]!.sourceX
    ));

    expect(plan.capped).toBe(true);
    expect(plan.dabs.length).toBeLessThanOrEqual(10);
    expect(plan.dabs[0]!.sourceX).toBe(0);
    expect(plan.dabs.at(-1)!.sourceX).toBe(1000);
    // The budget floor fills the early low-speed region, while the requested large high-speed
    // spacing is still allowed to widen later intervals instead of flattening everything uniformly.
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) * 2);
    expect(gaps.every((gap) => gap > 0)).toBe(true);
  });

  it("keeps capped redistribution finite and evenly bounded for malformed extreme input", () => {
    const plan = planStudioDynamicBrush({
      points: [-1_000_000, 0, Number.NaN, 9, 1_000_000, 0],
      pressures: [Number.NaN, Number.POSITIVE_INFINITY, -99],
      tangentialPressures: [Number.NEGATIVE_INFINITY, 99],
      speeds: [Number.NaN, Number.POSITIVE_INFINITY],
      tiltXs: [Number.NaN, -999, 999],
      tiltYs: [Number.POSITIVE_INFINITY],
      twists: [Number.NaN, 999],
      baseWidth: Number.NaN,
      baseOpacity: Number.POSITIVE_INFINITY,
      maxDabs: 4096,
      settings: {
        spacing: { base: -999, mappings: [{ source: "speed", from: -99, to: 99 }] },
        scatter: { base: Number.POSITIVE_INFINITY },
      },
    });
    const gaps = plan.dabs.slice(1).map((dab, index) => (
      dab.sourceX - plan.dabs[index]!.sourceX
    ));
    const averageGap = plan.totalLength / (plan.dabs.length - 1);

    expectFinitePlan(plan);
    expect(plan).toMatchObject({ capped: true, sourcePointCount: 2, totalLength: 2_000_000 });
    expect(plan.dabs).toHaveLength(4096);
    expect(plan.dabs[0]).toMatchObject({ sourceX: -1_000_000, sourceY: 0, progress: 0 });
    expect(plan.dabs.at(-1)).toMatchObject({ sourceX: 1_000_000, sourceY: 0, progress: 1 });
    expect(Math.max(...gaps)).toBeLessThanOrEqual(averageGap * 1.01);
    expect(Math.min(...gaps)).toBeGreaterThan(0);
  });

  it("handles a single point as one stable pressure-aware dab", () => {
    const plan = planStudioDynamicBrush({
      points: [3, 4],
      pressures: [1],
      baseWidth: 10,
      baseOpacity: 0.75,
      maxDabs: 99,
      settings: { scatter: { base: 0 } },
    });
    expect(plan).toMatchObject({ sourcePointCount: 1, totalLength: 0, capped: false });
    expect(plan.dabs).toHaveLength(1);
    expect(plan.dabs[0]).toMatchObject({ sourceX: 3, sourceY: 4, x: 3, y: 4, size: 17, opacity: 0.75 });
  });

  it("drops invalid coordinate pairs, collapses duplicates and makes every malformed channel finite", () => {
    const points = [Number.NaN, 0, 1, 2, Number.POSITIVE_INFINITY, 3, 4, 5, 4, 5];
    const pressures = [Number.NaN, -10, Number.POSITIVE_INFINITY, 10];
    const pointsBefore = points.slice();
    const pressuresBefore = pressures.slice();
    const plan = planStudioDynamicBrush({
      points,
      pressures,
      tangentialPressures: [Number.NaN, -99, 99],
      speeds: [Number.NaN, -5, Number.POSITIVE_INFINITY],
      tiltXs: [Number.NaN, -999, 999],
      tiltYs: [Number.POSITIVE_INFINITY],
      twists: [Number.NaN, 999],
      directions: [Number.NaN, 999],
      baseWidth: Number.NaN,
      baseOpacity: Number.POSITIVE_INFINITY,
      maxDabs: 8,
      settings: {
        spacing: { base: Number.NaN, mappings: [{ source: "speed", from: -99, to: 99 }] },
        scatter: { base: 99999 },
      },
    });

    expect(plan.sourcePointCount).toBe(2);
    expect(plan.dabs.length).toBeLessThanOrEqual(8);
    expectFinitePlan(plan);
    expect(points).toEqual(pointsBefore);
    expect(pressures).toEqual(pressuresBefore);
  });

  it("returns an empty finite plan when no coordinate pair is usable", () => {
    const plan = planStudioDynamicBrush({
      points: [Number.NaN, 0, 1, Number.POSITIVE_INFINITY, 7],
      baseWidth: 6,
      baseOpacity: 1,
    });
    expect(plan.dabs).toEqual([]);
    expect(plan).toMatchObject({ sourcePointCount: 0, totalLength: 0, capped: false });
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it("honors a one-dab cap without unbounded work on a huge stroke", () => {
    const plan = planStudioDynamicBrush({
      points: [-1_000_000, 0, 1_000_000, 0],
      baseWidth: 1,
      baseOpacity: 1,
      maxDabs: 0,
      settings: { spacing: { base: 0.25, mappings: [] } },
    });
    expect(plan.dabs).toHaveLength(1);
    expect(plan.dabs[0]!.sourceX).toBe(-1_000_000);
    expect(plan.capped).toBe(true);
  });

  it("applies shared start/end taper so both ends are thinner than the mid-stroke", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      width: { base: 10, mappings: [] },
      opacity: { base: 1, mappings: [] },
      spacing: { base: 5, mappings: [] },
      scatter: { base: 0 },
      taper: {
        enabled: true,
        startLength: 0.25,
        endLength: 0.25,
        minSizeRatio: 0.2,
        minOpacityRatio: 0.5,
        curve: 1,
      },
      tip: { shape: "round" },
    });
    const plan = planStudioDynamicBrush({
      points: [0, 0, 100, 0],
      pressures: Array(21).fill(0.7),
      baseWidth: 10,
      baseOpacity: 1,
      settings,
      seed: 7,
    });
    const mid = plan.dabs.find((dab) => dab.progress > 0.45 && dab.progress < 0.55)
      ?? plan.dabs[Math.floor(plan.dabs.length / 2)]!;
    const first = plan.dabs[0]!;
    const last = plan.dabs.at(-1)!;
    expect(first.size).toBeLessThan(mid.size);
    expect(last.size).toBeLessThan(mid.size);
    expect(first.opacity).toBeLessThan(mid.opacity);
    expect(last.opacity).toBeLessThan(mid.opacity);
    expect(first.progress).toBe(0);
    expect(last.progress).toBe(1);

    const replay = planStudioDynamicBrush({
      points: [0, 0, 100, 0],
      pressures: Array(21).fill(0.7),
      baseWidth: 10,
      baseOpacity: 1,
      settings,
      seed: 7,
    });
    expect(replay).toEqual(plan);
  });

  it("skips taper on zero-length point taps so a single dab keeps full size", () => {
    const plan = planStudioDynamicBrush({
      points: [5, 5],
      pressures: [0.5],
      baseWidth: 12,
      baseOpacity: 0.9,
      settings: {
        width: { mappings: [] },
        opacity: { mappings: [] },
        taper: {
          enabled: true,
          startLength: 0.4,
          endLength: 0.4,
          minSizeRatio: 0.1,
          minOpacityRatio: 0.1,
        },
      },
    });
    expect(plan.dabs).toHaveLength(1);
    expect(plan.dabs[0]!.size).toBe(12);
    expect(plan.dabs[0]!.opacity).toBe(0.9);
  });

  it("applies the persisted pressure floor to diameter only", () => {
    const shared = {
      points: [5, 5],
      pressures: [0],
      baseWidth: 20,
      baseOpacity: 0.8,
      settings: {
        taper: { enabled: false },
        width: {
          mappings: [{ source: "pressure" as const, from: 0.05, to: 1 }],
          jitter: null,
        },
        opacity: {
          mappings: [{ source: "pressure" as const, from: 0.2, to: 1 }],
          jitter: null,
        },
        flow: {
          base: 0.6,
          mappings: [{ source: "pressure" as const, from: 0.3, to: 1 }],
          jitter: null,
        },
      },
    };
    const unbounded = planStudioDynamicBrush({
      ...shared,
      settings: { ...shared.settings, minimumDiameterRatio: 0 },
    }).dabs[0]!;
    const fullDiameterFloor = planStudioDynamicBrush({
      ...shared,
      settings: { ...shared.settings, minimumDiameterRatio: 1 },
    }).dabs[0]!;

    expect(unbounded.size).toBeCloseTo(1, 10);
    expect(fullDiameterFloor.size).toBe(20);
    expect(fullDiameterFloor.opacity).toBe(unbounded.opacity);
    expect(fullDiameterFloor.flow).toBe(unbounded.flow);
  });

  it("keeps the optional minimum diameter legacy-safe and canonically bounded", () => {
    const legacy = {
      seed: 23,
      width: { base: 14, mappings: [] },
      taper: { enabled: false },
    };
    const normalizedLegacy = normalizeStudioBrushDynamicsSettings(legacy);
    const legacyCanonical = serializeStudioBrushDynamicsSettingsCanonical(legacy);

    expect(normalizedLegacy.minimumDiameterRatio).toBeUndefined();
    expect(legacyCanonical).not.toContain("minimumDiameterRatio");
    expect(serializeStudioBrushDynamicsSettingsCanonical({
      ...legacy,
      minimumDiameterRatio: "invalid",
    })).toBe(legacyCanonical);
    expect(normalizeStudioBrushDynamicsSettings({
      ...legacy,
      minimumDiameterRatio: -2,
    }).minimumDiameterRatio).toBe(0);
    expect(normalizeStudioBrushDynamicsSettings({
      ...legacy,
      minimumDiameterRatio: 4,
    }).minimumDiameterRatio).toBe(1);

    const legacyDabs = planStudioDynamicBrush({
      points: [0, 0, 20, 0],
      pressures: [0, 0],
      baseWidth: 14,
      baseOpacity: 1,
      settings: legacy,
    }).dabs;
    const explicitZeroDabs = planStudioDynamicBrush({
      points: [0, 0, 20, 0],
      pressures: [0, 0],
      baseWidth: 14,
      baseOpacity: 1,
      settings: { ...legacy, minimumDiameterRatio: 0 },
    }).dabs;
    expect(explicitZeroDabs).toEqual(legacyDabs);
  });

  it("normalizes missing dual brush to identity defaults without disturbing legacy snapshots", () => {
    const legacy = {
      seed: 11,
      tip: { shape: "grain" as const, softness: 0.4 },
      width: { base: 9 },
    };
    const normalized = normalizeStudioBrushDynamicsSettings(legacy);
    // Identity dual settings are omitted so legacy canonical serializations stay byte-stable.
    expect(normalized.dualBrush).toBeUndefined();
    const canonical = serializeStudioBrushDynamicsSettingsCanonical(legacy);
    expect(canonical).not.toContain("dualBrush");
    // Regression: null/absent/garbage/explicit-identity dualBrush values all normalize to the
    // identical canonical serialization a pre-dual-brush snapshot produced.
    expect(serializeStudioBrushDynamicsSettingsCanonical({ ...legacy, dualBrush: null })).toBe(canonical);
    expect(serializeStudioBrushDynamicsSettingsCanonical({
      ...legacy,
      dualBrush: { enabled: "yes", blendMode: 3, sizeRatio: "x" },
    })).toBe(canonical);
    expect(serializeStudioBrushDynamicsSettingsCanonical({
      ...legacy,
      dualBrush: { enabled: false, blendMode: "multiply", sizeRatio: 1 },
    })).toBe(canonical);
    expect(studioBrushDynamicsSettingsEqual(legacy, { ...legacy, dualBrush: null })).toBe(true);
    // Idempotent: normalized output re-normalizes byte-identically.
    expect(serializeStudioBrushDynamicsSettingsCanonical(normalized)).toBe(JSON.stringify(normalized));
  });

  it("keeps an omitted or unknown deposit pipeline on the exact legacy replay contract", () => {
    const legacy = {
      seed: 17,
      tip: { shape: "grain" as const, softness: 0.35 },
      width: { base: 8 },
    };
    const normalized = normalizeStudioBrushDynamicsSettings(legacy);
    const canonical = serializeStudioBrushDynamicsSettingsCanonical(legacy);

    expect(normalized.depositPipeline).toBeUndefined();
    expect(canonical).not.toContain("depositPipeline");
    expect(normalizeStudioBrushDynamicsSettings({
      ...legacy,
      depositPipeline: "future-or-corrupt-pipeline",
    }).depositPipeline).toBeUndefined();
    expect(serializeStudioBrushDynamicsSettingsCanonical({
      ...legacy,
      depositPipeline: "future-or-corrupt-pipeline",
    })).toBe(canonical);
  });

  it("pins v3 dry-media compositing explicitly while absent snapshots remain legacy v2", () => {
    const legacy = normalizeStudioBrushDynamicsSettings({ seed: 17 });
    expect(legacy.dryMediaUnionProgram).toBeUndefined();
    expect(serializeStudioBrushDynamicsSettingsCanonical(legacy))
      .not.toContain("dryMediaUnionProgram");

    const pin = studioDryMediaUnionComposableProgramPin();
    const pinned = normalizeStudioBrushDynamicsSettings({
      seed: 17,
      dryMediaUnionProgram: pin,
    });
    expect(pinned.dryMediaUnionProgram).toEqual({
      version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
      programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
    });
    expect(JSON.parse(serializeStudioBrushDynamicsSettingsCanonical(pinned)))
      .toMatchObject({ dryMediaUnionProgram: pin });
    expect(() => normalizeStudioBrushDynamicsSettings({
      dryMediaUnionProgram: {
        version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
        programDigest: "0".repeat(64),
      },
    })).toThrow(/Unsupported dry-media union program pin/u);
    expect(() => normalizeStudioBrushDynamicsSettings({
      dryMediaUnionProgram: { ...pin, extra: true },
    })).toThrow(/Unsupported dry-media union program pin/u);
  });

  it("preserves the causal stamp-grid rule pin byte-for-byte and drops malformed values closed", () => {
    const v2 = STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2;
    const legacy = normalizeStudioBrushDynamicsSettings({ seed: 17 });
    expect(legacy.causalStampGridRule).toBeUndefined();
    expect(serializeStudioBrushDynamicsSettingsCanonical(legacy))
      .not.toContain("causalStampGridRule");

    const pinned = normalizeStudioBrushDynamicsSettings({
      seed: 17,
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      causalStampGridRule: v2,
    });
    expect(pinned.causalStampGridRule).toBe(v2);
    expect(studioDynamicBrushCausalStampGridRuleOf(pinned)).toBe(v2);
    // Round-trip: the normalized output re-normalizes byte-identically with the pin retained.
    expect(normalizeStudioBrushDynamicsSettings(JSON.parse(JSON.stringify(pinned))))
      .toEqual(pinned);
    expect(serializeStudioBrushDynamicsSettingsCanonical(pinned)).toBe(JSON.stringify(pinned));
    // Fail closed: anything but the exact rule string drops without ever injecting a default.
    const canonical = serializeStudioBrushDynamicsSettingsCanonical({ seed: 17 });
    for (const malformed of [
      "causal-stamp-grid-v3",
      "CAUSAL-STAMP-GRID-V2",
      2,
      true,
      {},
      [v2],
      null,
    ]) {
      const dropped = normalizeStudioBrushDynamicsSettings({
        seed: 17,
        causalStampGridRule: malformed,
      });
      expect(dropped.causalStampGridRule).toBeUndefined();
      expect(serializeStudioBrushDynamicsSettingsCanonical({
        seed: 17,
        causalStampGridRule: malformed,
      })).toBe(canonical);
    }
  });

  it("carries the pin through canonical serialization so save/reopen replays the same grid", () => {
    const v2 = STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2;
    const canonical = serializeStudioBrushDynamicsSettingsCanonical({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      causalStampGridRule: v2,
      tip: { shape: "bristle" as const, softness: 0.58 },
      width: { base: 72 },
    });
    expect(JSON.parse(canonical)).toMatchObject({ causalStampGridRule: v2 });
    const reopened = normalizeStudioBrushDynamicsSettings(JSON.parse(canonical));
    expect(studioDynamicBrushCausalStampGridRuleOf(reopened)).toBe(v2);
    expect(serializeStudioBrushDynamicsSettingsCanonical(reopened)).toBe(canonical);
    expect(selectStudioDynamicBrushCausalStampGrid({
      rule: studioDynamicBrushCausalStampGridRuleOf(reopened),
      baseWidth: reopened.width.base,
    })).toBe(7);
  });

  it("mints the rule pin for fresh dry-media authoring and strips it from replay re-derivation", () => {
    const v2 = STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2;
    for (const brushId of ["crayon", "chalk", "charcoal", "pastel", "oil-pastel"] as const) {
      const fresh = studioBrushDynamicsSettingsForBrushId(brushId);
      expect(fresh?.causalStampGridRule).toBe(v2);
      expect(fresh?.dryMediaKernelProgram).toBeDefined();
      expect(studioDynamicBrushCausalStampGridRuleOf(fresh!)).toBe(v2);
      // Snapshot-less persisted strokes re-derive from today's catalogue and must never inherit
      // the pin — inheriting it would re-lattice already accepted causal dabs.
      expect(
        studioReplaySafeBrushDynamicsSettingsForBrushId(brushId)?.causalStampGridRule,
      ).toBeUndefined();
    }
    // Raw canonical preset settings stay unpinned — they are the merge base for every derived
    // alias, and persisted preset-only serialization must not change. The canonical toolbar ids
    // mint the pin at brush-id resolution instead (second-wave test below).
    expect(studioBrushDynamicsPresetSettings("dry-media").causalStampGridRule).toBeUndefined();
    expect(studioBrushDynamicsPresetSettings("ink-particle").causalStampGridRule).toBeUndefined();
    expect(studioBrushDynamicsPresetSettings("airbrush").causalStampGridRule).toBeUndefined();

    // Fresh large charcoal/crayon strokes now lattice 5/7; the authored small nibs keep grid 3.
    const charcoal = studioBrushDynamicsSettingsForBrushId("charcoal")!;
    const gridFor = (baseWidth: number) => selectStudioDynamicBrushCausalStampGrid({
      rule: studioDynamicBrushCausalStampGridRuleOf(normalizeStudioBrushDynamicsSettings({
        ...charcoal,
        width: { ...charcoal.width, base: baseWidth },
      })),
      baseWidth,
    });
    expect(gridFor(charcoal.width.base)).toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    expect(gridFor(48)).toBe(5);
    expect(gridFor(96)).toBe(7);
  });

  it("mints the second-wave rule pin for the remaining causal alpha-tip toolbar ids", () => {
    const v2 = STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2;
    const secondWaveBrushIds = [
      // Canonical causal presets used directly as toolbar ids (their sampled hard/grain tips
      // lattice on the stamp grid; the analytic-falloff airbrush is checked separately below).
      "ink-particle",
      "dry-media",
      // Engine-lane dry-media variants.
      "charcoal--vine-soft",
      "charcoal--compressed-edge",
      "crayon--wax-scrape",
      "chalk--klecks-powder",
      "pastel--cake-soft",
      "oil-pastel--waxy-film",
      "oil-pastel--wgm-mix",
      "brush--dry-rake",
    ] as const;
    for (const brushId of secondWaveBrushIds) {
      const fresh = studioBrushDynamicsSettingsForBrushId(brushId);
      expect(fresh?.causalStampGridRule, brushId).toBe(v2);
      expect(fresh?.depositPipeline, brushId)
        .toBe(STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3);
      // Fresh dynamics select the width-appropriate lattice once the authored width grows.
      const gridFor = (baseWidth: number) => selectStudioDynamicBrushCausalStampGrid({
        rule: studioDynamicBrushCausalStampGridRuleOf(normalizeStudioBrushDynamicsSettings({
          ...fresh!,
          width: { ...fresh!.width, base: baseWidth },
        })),
        baseWidth,
      });
      expect(gridFor(8), brushId).toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
      expect(gridFor(48), brushId).toBe(5);
      expect(gridFor(96), brushId).toBe(7);
      // Snapshot-less persisted strokes re-derive replay-safe and stay on legacy grid 3.
      const replay = studioReplaySafeBrushDynamicsSettingsForBrushId(brushId);
      expect(replay?.causalStampGridRule, brushId).toBeUndefined();
      expect(selectStudioDynamicBrushCausalStampGrid({
        rule: studioDynamicBrushCausalStampGridRuleOf(replay!),
        baseWidth: 96,
      }), brushId).toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    }
    // The canonical airbrush is deliberately NOT minted: its analytic soft-falloff tip renders as
    // one analytic-radial command, so the sampled stamp lattice the rule selects never applies.
    expect(studioBrushDynamicsSettingsForBrushId("airbrush")?.causalStampGridRule)
      .toBeUndefined();
  });

  it("keeps the pin through the coverage-budget contract, including the ribbon copy branch", () => {
    const v2 = STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2;
    const pinned = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      causalStampGridRule: v2,
      tip: { shape: "bristle" as const, softness: 0.4 },
      tipLayers: [{ tip: { shape: "grain" as const }, opacity: 0.8 }],
      width: { base: 96 },
    });
    expect(pinned.tipLayers.length).toBeGreaterThan(0);

    // Ordinary identities pass the settings through by reference with the pin intact.
    const plain = resolveStudioDynamicBrushCoverageBudgetContract(
      resolveStudioDynamicBrushMaterialIdentity("charcoal") ?? undefined,
      pinned,
    );
    expect(plain.settings).toBe(pinned);
    expect(studioDynamicBrushCausalStampGridRuleOf(plain.settings)).toBe(v2);

    // The professional-shelf ribbon branch copies fields while stripping decorative tip layers;
    // that spread must still carry the pin so live/retained/SVG select the identical grid.
    const ribbon = resolveStudioDynamicBrushCoverageBudgetContract(
      resolveStudioDynamicBrushMaterialIdentity("dry-media", "bristle-fan-dry") ?? undefined,
      pinned,
    );
    expect(ribbon.specialistCarrier).toBe("professional-shelf-ribbon");
    expect(ribbon.settings).not.toBe(pinned);
    expect(ribbon.settings.tipLayers).toEqual([]);
    expect(ribbon.settings.causalStampGridRule).toBe(v2);
    expect(studioDynamicBrushCausalStampGridRuleOf(ribbon.settings)).toBe(v2);
  });

  it("round-trips enabled dual brush fields through normalization, JSON and the planner", () => {
    const normalized = normalizeStudioBrushDynamicsSettings({
      dualBrush: {
        enabled: true,
        tip: { shape: "halftone", softness: 2 },
        blendMode: "screen",
        sizeRatio: 9,
      },
    });
    expect(normalized.dualBrush).toEqual({
      enabled: true,
      tip: {
        shape: "halftone",
        softness: 1,
        alphaMapBase64: null,
        alphaMapSize: DEFAULT_STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE,
      },
      blendMode: "screen",
      sizeRatio: 2,
    });
    expect(normalizeStudioBrushDynamicsSettings(JSON.parse(JSON.stringify(normalized))))
      .toEqual(normalized);
    const plan = planStudioDynamicBrush({
      points: [0, 0, 40, 0],
      pressures: [0.5, 0.5],
      baseWidth: 8,
      baseOpacity: 1,
      settings: normalized,
    });
    // The planner hands renderers a detached copy of the dual-brush contract.
    expect(plan.settings.dualBrush).toEqual(normalized.dualBrush);
    expect(plan.settings.dualBrush).not.toBe(normalized.dualBrush);
    // Non-identity but still-disabled settings persist so the artist's setup survives toggling.
    const configuredButDisabled = normalizeStudioBrushDynamicsSettings({
      dualBrush: { enabled: false, tip: { shape: "star" }, blendMode: "screen", sizeRatio: 0.5 },
    });
    expect(configuredButDisabled.dualBrush).toMatchObject({
      enabled: false,
      blendMode: "screen",
      sizeRatio: 0.5,
      tip: { shape: "star" },
    });
    expect(DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS.dualBrush).toBeUndefined();
  });

  it("normalizes taper + tip and keeps them in the canonical serialization", () => {
    const normalized = normalizeStudioBrushDynamicsSettings({
      taper: { enabled: true, startLength: 0.9, minSizeRatio: -1, curve: 99 },
      tip: { shape: "grain", softness: 2, alphaMapSize: 3 },
    });
    expect(normalized.taper).toMatchObject({
      enabled: true,
      startLength: 0.5,
      minSizeRatio: 0,
      curve: 8,
    });
    expect(normalized.tip).toMatchObject({ shape: "grain", softness: 1, alphaMapSize: 8 });
    expect(JSON.parse(serializeStudioBrushDynamicsSettingsCanonical(normalized))).toMatchObject({
      taper: normalized.taper,
      tip: normalized.tip,
    });
    expect(studioBrushTaperFactors(0, normalized.taper).size).toBe(0);
    expect(studioBrushTaperFactors(0.5, normalized.taper).size).toBe(1);
  });

  it("ships commercial presets with taper and textured tip stamp settings", () => {
    for (const id of ["ink-particle", "airbrush", "dry-media"] as const) {
      const preset = studioBrushDynamicsPresetSettings(id);
      expect(preset.taper.enabled).toBe(true);
      expect(preset.tip.shape).not.toBe("round");
      const plan = planStudioDynamicBrush({
        points: [0, 0, 60, 0],
        pressures: [0.5, 0.5],
        baseWidth: preset.width.base,
        baseOpacity: preset.opacity.base,
        settings: preset,
      });
      expect(plan.dabs.length).toBeGreaterThan(1);
      expect(plan.settings.tip.shape).toBe(preset.tip.shape);
    }
  });

  it("pins byte-identical planner output for a representative ratio/jitter/mapping brush", () => {
    const input = {
      points: [0, 0, 14, 6, 30, 10, 46, 10],
      pressures: [0.35, 0.6, 0.9, 0.5],
      speeds: [0.1, 0.5, 0.9, 0.2],
      tiltXs: [8, 20, 42, 6],
      tiltYs: [-6, 12, 24, 0],
      twists: [10, 80, 200, 340],
      baseWidth: 14,
      baseOpacity: 0.85,
      seed: 0xbead_cafe,
      maxDabs: 64,
      settings: {
        seed: 7,
        spacingRatio: 0.75,
        scatterRatio: 0.4,
        width: {
          base: 14,
          mappings: [{ source: "pressure", from: 0.5, to: 1.6 }],
          jitter: { mode: "multiply", amount: 0.2 },
        },
        opacity: { base: 0.85, mappings: [{ source: "speed", from: 1, to: 0.6 }] },
        angle: {
          base: 0,
          mappings: [{ source: "tilt-azimuth", mode: "add", from: -40, to: 40 }],
          jitter: { mode: "add", amount: 6 },
        },
      },
    } satisfies Partial<StudioDynamicBrushPlanInput>;

    const plan = planStudioDynamicBrush(input);
    const replay = planStudioDynamicBrush(structuredClone(input));

    expect(JSON.stringify(replay.dabs)).toBe(JSON.stringify(plan.dabs));
    expect(plan.dabs.map((dab) => JSON.stringify(dab))).toMatchInlineSnapshot(`
      [
        "{"index":0,"progress":0,"sourceX":0,"sourceY":0,"direction":23.19859051364824,"distanceFromPrevious":0,"distanceFromStrokeStart":0,"contactLoadFromStrokeStart":0,"contactFactor":11.96336485991475,"x":-2.2050014418566226,"y":0.5793137207782181,"size":14.43543271181267,"opacity":0.82875,"flow":1,"spacing":10.826574533859503,"scatter":5.774173084725068,"angle":28.825643557756734,"roundness":1}",
        "{"index":1,"progress":0.22685821874320491,"sourceX":9.951192174917034,"sourceY":4.264796646393014,"direction":23.19859051364824,"distanceFromPrevious":10.826574533859503,"distanceFromStrokeStart":10.826574533859503,"contactLoadFromStrokeStart":137.08414974506198,"contactFactor":13.360277316350514,"segmentStartFrame":{"index":0,"sourceX":0,"sourceY":0,"direction":23.19859051364824,"size":14.43543271181267,"roundness":1,"distanceFromStrokeStart":0,"contactLoadFromStrokeStart":0,"contactFactor":11.96336485991475},"x":11.873935069588327,"y":7.06062329235702,"size":17.388676366758606,"opacity":0.7683320475094322,"flow":1,"spacing":13.041507275068955,"scatter":6.955470546703443,"angle":-36.54382596997311,"roundness":1}",
        "{"index":2,"progress":0.5001277649783433,"sourceX":22.378670236862387,"sourceY":8.094667559215598,"direction":14.03624346792651,"distanceFromPrevious":13.041507275068955,"distanceFromStrokeStart":23.86808180892846,"contactLoadFromStrokeStart":308.09958400179573,"contactFactor":12.866052301800085,"segmentStartFrame":{"index":1,"sourceX":9.951192174917034,"sourceY":4.264796646393014,"direction":23.19859051364824,"size":17.388676366758606,"roundness":1,"distanceFromStrokeStart":10.826574533859503,"contactLoadFromStrokeStart":137.08414974506198,"contactFactor":13.360277316350514},"x":27.76579543378267,"y":4.944738895200652,"size":18.400096272546858,"opacity":0.6992383143666685,"flow":1,"spacing":13.800072204410142,"scatter":7.360038509018743,"angle":-34.239076674552734,"roundness":1}",
        "{"index":3,"progress":0.7892921529414184,"sourceX":35.94418529914014,"sourceY":10,"direction":0,"distanceFromPrevious":13.800072204410142,"distanceFromStrokeStart":37.6681540133386,"contactLoadFromStrokeStart":475.47725166977875,"contactFactor":11.391453773348353,"segmentStartFrame":{"index":2,"sourceX":22.378670236862387,"sourceY":8.094667559215598,"direction":14.03624346792651,"size":18.400096272546858,"roundness":1,"distanceFromStrokeStart":23.86808180892846,"contactLoadFromStrokeStart":308.09958400179573,"contactFactor":12.866052301800085},"x":36.021811727860545,"y":9.904733732360922,"size":15.954141143351254,"opacity":0.7140123477029435,"flow":1,"spacing":11.965605857513442,"scatter":6.381656457340502,"angle":-33.143428475072255,"roundness":1}",
        "{"index":4,"progress":1,"sourceX":46,"sourceY":10,"direction":0,"distanceFromPrevious":10.055814700859862,"distanceFromStrokeStart":47.72396871419846,"contactLoadFromStrokeStart":588.0633759419451,"contactFactor":11.000789445401335,"segmentStartFrame":{"index":3,"sourceX":35.94418529914014,"sourceY":10,"direction":0,"size":15.954141143351254,"roundness":1,"distanceFromStrokeStart":37.6681540133386,"contactLoadFromStrokeStart":475.47725166977875,"contactFactor":11.391453773348353},"x":43.87073216758048,"y":5.673295918088508,"size":13.623268663035708,"opacity":0.8075,"flow":1,"spacing":10.21745149727678,"scatter":5.449307465214283,"angle":-41.8289495781064,"roundness":1}",
      ]
    `);
  });

  it("pins byte-identical capped redistribution output for the commercial presets", () => {
    const digests = {} as Record<string, string>;
    for (const presetId of ["ink-particle", "airbrush", "dry-media"] as const) {
      const settings = studioBrushDynamicsPresetSettings(presetId);
      const plan = planStudioDynamicBrush({
        points: [0, 0, 10_000, 40],
        pressures: [0.3, 0.8],
        speeds: [0.1, 0.7],
        baseWidth: settings.width.base,
        baseOpacity: settings.opacity.base,
        settings,
        seed: 0x51ce_d001,
        maxDabs: 96,
      });
      const json = JSON.stringify(plan.dabs);

      expect(plan.capped).toBe(true);
      expect(plan.dabs).toHaveLength(96);
      expect(plan.dabs[0]).toMatchObject({ sourceX: 0, sourceY: 0, progress: 0 });
      expect(plan.dabs.at(-1)).toMatchObject({ sourceX: 10_000, sourceY: 40, progress: 1 });
      digests[presetId] = `${json.length}:${fnv1aHex(json)}`;
    }
    expect(digests).toMatchInlineSnapshot(`
      {
        "airbrush": "75575:72f60e1d",
        "dry-media": "80736:5a6c0115",
        "ink-particle": "77377:5bcb0fdf",
      }
    `);
  });

  it("keeps capped-prefix stations identical to the natural pass where spacing beats the budget floor", () => {
    const input = {
      points: [0, 0, 1000, 0],
      speeds: [1, 0],
      baseWidth: 10,
      baseOpacity: 1,
      settings: {
        maxSpeed: 1,
        spacing: { base: 1, mappings: [{ source: "speed", mode: "add", from: 0, to: 400 }] },
        scatter: { base: 0 },
      },
    } satisfies Partial<StudioDynamicBrushPlanInput>;
    const capped = planStudioDynamicBrush({ ...input, maxDabs: 10 });
    const natural = planStudioDynamicBrush({ ...input, maxDabs: 4096 });

    expect(capped.capped).toBe(true);
    expect(natural.capped).toBe(false);
    // The early high-speed region asks for ~401px natural spacing, well above the ~111px budget
    // floor, so the bounded second pass must reproduce the natural pass byte-for-byte there.
    expect(capped.dabs[1]).toEqual(natural.dabs[1]);
    expect(capped.dabs.at(-1)!.sourceX).toBe(1000);
  });

  it("freezes per-dab segment receipts under dev invariants", () => {
    const plan = planStudioDynamicBrush({
      points: [0, 0, 10, 0],
      baseWidth: 6,
      baseOpacity: 1,
      settings: { spacing: { base: 3, mappings: [] }, scatter: { base: 0 } },
    });
    const frame = plan.dabs.at(-1)?.segmentStartFrame;
    expect(frame).toBeDefined();
    // Vitest runs with import.meta.env.DEV=true; prod skips the freeze guard but keeps the exact
    // same receipt shape and values.
    expect(Object.isFrozen(frame)).toBe(true);
  });
});
