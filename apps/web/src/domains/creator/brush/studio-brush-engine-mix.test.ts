import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsForBrushId,
  studioDryMediaKernelDabProgramPin,
} from "./studio-brush-dynamics";
import {
  analyzeStudioBrushMixQuality,
  applyStudioBrushMixRecipe,
  describeStudioBrushEngineStack,
  isStudioBrushMixTraitSectionId,
  mergeStudioBrushMixTraitSection,
  STUDIO_BRUSH_MIX_RECIPES,
  STUDIO_BRUSH_MIX_TRAIT_SECTIONS,
  stabilizeStudioBrushMixQuality,
  suggestStudioBrushMixName,
} from "./studio-brush-engine-mix";
import {
  studioBrushEngineProgramSetFromOil,
  studioOilProgramSetForBrush,
} from "./studio-brush-engine-program-set";

const dryMediaBase = studioBrushDynamicsSettingsForBrushId("dry-media");
const crayon = studioBrushDynamicsSettingsForBrushId("crayon");
const airbrush = studioBrushDynamicsSettingsForBrushId("airbrush");
const inkParticle = studioBrushDynamicsSettingsForBrushId("ink-particle");
const hardAirbrush = studioBrushDynamicsSettingsForBrushId("hard-airbrush");
const mirrorPen = studioBrushDynamicsSettingsForBrushId("sketchpad-mirror");

const dryMedia = dryMediaBase
  ? normalizeStudioBrushDynamicsSettings({
      ...dryMediaBase,
      dryMediaKernelProgram: studioDryMediaKernelDabProgramPin(),
    })
  : null;

describe("studio brush engine mix trait sections", () => {
  it("exposes granular portable modules plus legacy-compatible bundles", () => {
    expect(STUDIO_BRUSH_MIX_TRAIT_SECTIONS.map((section) => section.id)).toEqual([
      "tip",
      "dual-tip",
      "surface",
      "pigment",
      "size-opacity",
      "flow-spacing",
      "scatter-orientation",
      "taper",
      "grain",
      "response",
      "material",
      "expression",
    ]);
    expect(isStudioBrushMixTraitSectionId("surface")).toBe(true);
    expect(isStudioBrushMixTraitSectionId("expression")).toBe(true);
    expect(isStudioBrushMixTraitSectionId("carrier")).toBe(false);
  });

  it("ships distinct multi-source recipes", () => {
    expect(STUDIO_BRUSH_MIX_RECIPES).toHaveLength(8);
    expect(new Set(STUDIO_BRUSH_MIX_RECIPES.map((recipe) => recipe.id)).size).toBe(8);
    expect(STUDIO_BRUSH_MIX_RECIPES.every((recipe) => recipe.steps.length >= 3)).toBe(true);
  });
});

describe("mergeStudioBrushMixTraitSection", () => {
  it("replaces only the tip section and keeps carrier identity fields", () => {
    expect(dryMedia && airbrush).toBeTruthy();
    const merged = mergeStudioBrushMixTraitSection("tip", dryMedia!, airbrush!);
    expect(merged.tip).toEqual(airbrush!.tip);
    expect(merged.grain).toEqual(dryMedia!.grain);
    expect(merged.seed).toBe(dryMedia!.seed);
    expect(merged.depositPipeline).toBe(dryMedia!.depositPipeline);
    expect(merged.presetId).toBe(dryMedia!.presetId);
    expect(merged.softFalloffLinearProgram).toBeUndefined();
  });

  it("copies tip layers and dual brush for the dual-tip section", () => {
    const merged = mergeStudioBrushMixTraitSection("dual-tip", dryMedia!, crayon ?? dryMedia!);
    if (crayon) {
      expect(merged.tipLayers).toEqual(crayon.tipLayers);
      expect(merged.dualBrush).toEqual(crayon.dualBrush);
    } else {
      expect(merged.tipLayers).toEqual([]);
    }
    expect(merged.tip).toEqual(dryMedia!.tip);
  });

  it("separates surface grain from pigment dynamics", () => {
    const source = normalizeStudioBrushDynamicsSettings({
      ...airbrush!,
      grain: { space: "stroke-fixed", amount: 0.71, scale: 3.5, contrast: 0.8, seed: 55 },
      colorDynamics: {
        backgroundColor: "#223344",
        foregroundBackgroundMix: 0.4,
        hueJitter: 28,
      },
    });
    const surface = mergeStudioBrushMixTraitSection("surface", dryMedia!, source);
    expect(surface.grain).toEqual(source.grain);
    expect(surface.colorDynamics).toEqual(dryMedia!.colorDynamics);

    const pigment = mergeStudioBrushMixTraitSection("pigment", dryMedia!, source);
    expect(pigment.colorDynamics).toEqual(source.colorDynamics);
    expect(pigment.grain).toEqual(dryMedia!.grain);
  });

  it("copies each dynamics family without replacing unrelated properties", () => {
    const sizeOpacity = mergeStudioBrushMixTraitSection("size-opacity", dryMedia!, airbrush!);
    expect(sizeOpacity.width).toEqual(airbrush!.width);
    expect(sizeOpacity.opacity).toEqual(airbrush!.opacity);
    expect(sizeOpacity.roundness).toEqual(airbrush!.roundness);
    expect(sizeOpacity.flow).toEqual(dryMedia!.flow);

    const flowSpacing = mergeStudioBrushMixTraitSection("flow-spacing", dryMedia!, airbrush!);
    expect(flowSpacing.flow).toEqual(airbrush!.flow);
    expect(flowSpacing.spacing).toMatchObject({
      min: airbrush!.spacing.min,
      max: airbrush!.spacing.max,
      mappings: airbrush!.spacing.mappings,
      jitter: airbrush!.spacing.jitter,
    });
    expect(flowSpacing.spacingRatio).toBe(airbrush!.spacingRatio);
    // Relative spacing is the portable behavior. Normalization projects it through the retained
    // carrier width instead of copying the source brush's stale absolute-pixel cache.
    const expectedSpacingBase = airbrush!.spacingRatio === null
      ? airbrush!.spacing.base
      : Math.min(
          airbrush!.spacing.max,
          Math.max(
            airbrush!.spacing.min,
            dryMedia!.width.base * airbrush!.spacingRatio,
          ),
        );
    expect(flowSpacing.spacing.base).toBeCloseTo(expectedSpacingBase, 10);
    expect(flowSpacing.width).toEqual(dryMedia!.width);

    const scatter = mergeStudioBrushMixTraitSection("scatter-orientation", dryMedia!, airbrush!);
    expect(scatter.scatter).toMatchObject({
      min: airbrush!.scatter.min,
      max: airbrush!.scatter.max,
      mappings: airbrush!.scatter.mappings,
      jitter: airbrush!.scatter.jitter,
    });
    expect(scatter.angle).toEqual(airbrush!.angle);
    expect(scatter.scatterRatio).toBe(airbrush!.scatterRatio);
    // Scatter uses the same relative portable contract as spacing and is projected through the
    // retained carrier width during normalization.
    const expectedScatterBase = airbrush!.scatterRatio === null
      ? airbrush!.scatter.base
      : Math.min(
          airbrush!.scatter.max,
          Math.max(
            airbrush!.scatter.min,
            dryMedia!.width.base * airbrush!.scatterRatio,
          ),
        );
    expect(scatter.scatter.base).toBeCloseTo(expectedScatterBase, 10);

    const taper = mergeStudioBrushMixTraitSection("taper", dryMedia!, airbrush!);
    expect(taper.taper).toEqual(airbrush!.taper);
    expect(taper.width).toEqual(dryMedia!.width);
  });

  it("keeps the legacy response and grain bundles compatible", () => {
    const response = mergeStudioBrushMixTraitSection("response", dryMedia!, airbrush!);
    expect(response.width).toEqual(airbrush!.width);
    expect(response.flow).toEqual(airbrush!.flow);
    expect(response.taper).toEqual(airbrush!.taper);
    expect(response.tip).toEqual(dryMedia!.tip);

    const grain = mergeStudioBrushMixTraitSection("grain", airbrush!, dryMedia!);
    expect(grain.grain).toEqual(dryMedia!.grain);
    expect(grain.colorDynamics).toEqual(dryMedia!.colorDynamics);
    expect(grain.width).toEqual(airbrush!.width);
  });

  it("copies complete portable material and expression bundles", () => {
    const material = mergeStudioBrushMixTraitSection("material", airbrush!, dryMedia!);
    expect(material.tip).toEqual(dryMedia!.tip);
    expect(material.tipLayers).toEqual(dryMedia!.tipLayers);
    expect(material.grain).toEqual(dryMedia!.grain);
    expect(material.width).toEqual(airbrush!.width);

    const expression = mergeStudioBrushMixTraitSection("expression", airbrush!, dryMedia!);
    expect(expression.width).toEqual(dryMedia!.width);
    expect(expression.flow).toEqual(dryMedia!.flow);
    expect(expression.tip).toEqual(airbrush!.tip);
  });
});

describe("applyStudioBrushMixRecipe", () => {
  it("applies a multi-source recipe in order while retaining the base carrier contract", () => {
    expect(dryMedia && hardAirbrush && inkParticle && mirrorPen).toBeTruthy();
    const result = applyStudioBrushMixRecipe("webtoon-clean-line", dryMedia!, {
      "hard-airbrush": hardAirbrush,
      "ink-particle": inkParticle,
      "sketchpad-mirror": mirrorPen,
    });
    expect(result.appliedStepCount).toBe(3);
    expect(result.missingSourceBrushIds).toEqual([]);
    expect(result.settings.tip).toEqual(hardAirbrush!.tip);
    expect(result.settings.width).toEqual(inkParticle!.width);
    expect(result.settings.flow).toEqual(mirrorPen!.flow);
    expect(result.settings.depositPipeline).toBe(dryMedia!.depositPipeline);
    expect(result.settings.seed).toBe(dryMedia!.seed);
    expect(result.settings.dryMediaKernelProgram).toEqual(dryMedia!.dryMediaKernelProgram);
  });

  it("skips unavailable sources without mutating the original settings", () => {
    const result = applyStudioBrushMixRecipe("webtoon-clean-line", dryMedia!, {
      "hard-airbrush": hardAirbrush,
    });
    expect(result.appliedStepCount).toBe(1);
    expect(result.missingSourceBrushIds).toEqual(["ink-particle", "sketchpad-mirror"]);
    expect(result.settings.tip).toEqual(hardAirbrush!.tip);
    expect(result.settings.width).toEqual(dryMedia!.width);
    expect(dryMedia!.tip).toEqual(dryMediaBase!.tip);
  });
});

describe("analyzeStudioBrushMixQuality", () => {
  it("reports deterministic quality risks for wide spacing and scatter", () => {
    const risky = normalizeStudioBrushDynamicsSettings({
      ...dryMedia!,
      spacingRatio: 0.62,
      scatterRatio: 0.88,
      tipLayers: [],
    });
    const first = analyzeStudioBrushMixQuality("dry-media", risky, null);
    const second = analyzeStudioBrushMixQuality("dry-media", risky, null);
    expect(first).toEqual(second);
    expect(first.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(["carrier-gaps", "scatter-holes"]),
    );
    expect(first.qualityScore).toBeLessThan(100);
    expect(first.activeModuleCount).toBeGreaterThan(0);
    expect(first.estimatedMarksPerDab).toBeGreaterThanOrEqual(1);
  });

  it("stabilizes reported carrier, grain and color risks without changing identity", () => {
    const risky = normalizeStudioBrushDynamicsSettings({
      ...dryMedia!,
      spacingRatio: 0.62,
      scatterRatio: 0.88,
      grain: { amount: 0.96, scale: 0.5, contrast: 0.9, seed: 12 },
      colorDynamics: {
        backgroundColor: "#ffffff",
        foregroundBackgroundJitter: 0.9,
        hueJitter: 160,
        saturationJitter: 0.9,
        valueJitter: 0.9,
      },
    });
    const fixed = stabilizeStudioBrushMixQuality(risky);
    expect(fixed.spacingRatio).toBe(0.22);
    expect(fixed.scatterRatio).toBe(0.22);
    expect(fixed.grain.amount).toBe(0.72);
    expect(fixed.grain.scale).toBe(2);
    expect(fixed.colorDynamics.hueJitter).toBe(32);
    expect(fixed.colorDynamics.valueJitter).toBe(0.25);
    expect(fixed.depositPipeline).toBe(risky.depositPipeline);
    expect(fixed.seed).toBe(risky.seed);
    expect(fixed.dryMediaKernelProgram).toEqual(risky.dryMediaKernelProgram);
    expect(analyzeStudioBrushMixQuality("dry-media", fixed, null).issues.length)
      .toBeLessThan(analyzeStudioBrushMixQuality("dry-media", risky, null).issues.length);
  });

  it("includes active oil programs in complexity", () => {
    const none = analyzeStudioBrushMixQuality(
      "oil--filbert-ribbon",
      dryMedia!,
      studioBrushEngineProgramSetFromOil({
        bristlePhysics: false,
        bristleLoadDynamics: false,
        impastoRelief: false,
      }),
    );
    const all = analyzeStudioBrushMixQuality(
      "oil--filbert-ribbon",
      dryMedia!,
      studioBrushEngineProgramSetFromOil({
        bristlePhysics: true,
        bristleLoadDynamics: true,
        impastoRelief: true,
      }),
    );
    expect(all.complexityScore).toBeGreaterThan(none.complexityScore);
    expect(all.activeModuleCount).toBeGreaterThan(none.activeModuleCount);
  });
});

describe("describeStudioBrushEngineStack", () => {
  it("always names the carrier first and exposes material modules", () => {
    const stack = describeStudioBrushEngineStack("pen", dryMedia!, null);
    expect(stack[0]).toMatchObject({ id: "carrier", active: true });
    expect(stack.some((entry) => entry.id === "runtime-semantics")).toBe(true);
    expect(stack.some((entry) => entry.id === "primary-tip")).toBe(true);
    expect(stack.some((entry) => entry.id === "grain")).toBe(true);
    expect(stack.some((entry) => entry.id === "mix-complexity")).toBe(true);
    expect(stack.some((entry) => entry.id.startsWith("oil-"))).toBe(false);
  });

  it("lists oil programs with overrides winning over the baseline", () => {
    const baseline = studioOilProgramSetForBrush("oil--filbert-ribbon");
    expect(baseline.bristlePhysics).toBe(true);
    const stack = describeStudioBrushEngineStack(
      "oil--filbert-ribbon",
      dryMedia!,
      studioBrushEngineProgramSetFromOil({
        bristlePhysics: false,
        bristleLoadDynamics: false,
        impastoRelief: true,
      }),
    );
    const byId = new Map(stack.map((entry) => [entry.id, entry]));
    expect(byId.get("oil-bristlePhysics")?.active).toBe(false);
    expect(byId.get("oil-impastoRelief")?.active).toBe(true);
  });

  it("surfaces carrier program pins recorded on settings", () => {
    const stack = describeStudioBrushEngineStack("dry-media", dryMedia!, null);
    expect(stack.some((entry) => entry.id === "dry-media-kernel" && entry.active)).toBe(true);
  });
});

describe("suggestStudioBrushMixName", () => {
  it("appends the combination suffix to a trimmed base name", () => {
    expect(suggestStudioBrushMixName(" 크레용 ")).toBe("크레용 조합");
    expect(suggestStudioBrushMixName("  ")).toBe("커스텀 브러시 조합");
  });
});
