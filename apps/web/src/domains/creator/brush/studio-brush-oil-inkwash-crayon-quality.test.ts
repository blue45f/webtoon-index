/**
 * Competitive quality contracts for oil, ink-wash and crayon on the real shipped paths.
 *
 * These gates assert multi-lane / wet / anisotropic material structure and monotonic pressure
 * response without a browser compositor. Frame-budget and long-stroke freeze coverage lives in the
 * live overlay and dry-media long-stroke suites.
 */

import { describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  mapStudioBrushAliasPressure,
  resolveStudioBrushAliasWatercolorPlanSettings,
  applyStudioBrushAliasWatercolorMaterial,
} from "./studio-brush-alias-profile";
import {
  normalizeStudioBrushDynamicsSettings,
  planNormalizedStudioDynamicBrushDabs,
  studioBrushDynamicsSettingsForBrushId,
  studioDryMediaUnionComposableProgramPin,
} from "./studio-brush-dynamics";
import { resolveStudioBrushEngineLaneStampTuning } from "./studio-brush-engine-lane-catalog";
import { isStudioBrushQuarantinedPresetId } from "./studio-brush-quarantine";
import { resolveStudioBrushRuntimeContract } from "./studio-brush-runtime-contract";
import {
  STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1,
  resolveStudioDryMediaAnisotropicDabResponseV1,
  resolveStudioDryMediaAnisotropicPresetIdV1,
} from "./studio-dry-media-anisotropic-grain-v1";
import {
  bridgeStudioDynamicDabsToDryMediaV1,
  resolveStudioDynamicBrushMaterialIdentity,
  studioDryMediaDynamicBridgeMarkMultiplier,
} from "./studio-dry-media-dynamic-bridge";
import {
  STUDIO_DRY_MEDIA_KERNEL_TIP_ASPECT_BAND_REPRESENTATIVES,
  studioDryMediaKernelTipAspectBand,
} from "./studio-dry-media-kernel-tip";
import { planStudioDryMediaUnionRibbonCarrier } from "./studio-dry-media-union-ribbon-carrier";
import { isStudioInkwashFluidBrush } from "./studio-inkwash-fluid-brushes";
import { planStudioOilRibbonCarrier } from "./studio-oil-ribbon-carrier";
import {
  resolveStudioWetInkBrushPhysicalRecipe,
} from "./studio-wet-ink-brush-runtime";

import type { DrawEl } from "../studio-element-model";

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

describe("oil / ink-wash / crayon competitive material quality", () => {
  it("oil ships multi-lane bristle structure with monotonic pressure hand-feel", () => {
    const lightDabs = planOilBrushDabs({
      points: [0, 0, 160, 18, 320, -12, 480, 8],
      pressures: [0.1, 0.1, 0.1, 0.1],
      baseWidth: 26,
      seed: 41,
    });
    const heavyDabs = planOilBrushDabs({
      points: [0, 0, 160, 18, 320, -12, 480, 8],
      pressures: [0.92, 0.92, 0.92, 0.92],
      baseWidth: 26,
      seed: 41,
    });
    expect(lightDabs.every((dab) => dab.bristles.length >= 5)).toBe(true);
    expect(heavyDabs.every((dab) => dab.bristles.length >= 5)).toBe(true);

    const light = planStudioOilRibbonCarrier(lightDabs);
    const heavy = planStudioOilRibbonCarrier(heavyDabs);
    expect(light.repeatedBodyStampCount).toBe(0);
    expect(heavy.repeatedBodyStampCount).toBe(0);
    expect(light.bristleLanes.length).toBeGreaterThanOrEqual(2);
    expect(heavy.bristleLanes.length).toBeGreaterThanOrEqual(2);

    const lightRadius = mean(lightDabs.map((dab) => dab.radiusX + dab.radiusY));
    const heavyRadius = mean(heavyDabs.map((dab) => dab.radiusX + dab.radiusY));
    expect(heavyRadius).toBeGreaterThan(lightRadius * 1.25);
    expect(mean(heavyDabs.map((dab) => dab.opacity)))
      .toBeGreaterThan(mean(lightDabs.map((dab) => dab.opacity)) * 1.2);
    const heavyBristleLoad = mean(
      heavyDabs.flatMap((dab) => dab.bristles.map((bristle) => bristle.opacity)),
    );
    const lightBristleLoad = mean(
      lightDabs.flatMap((dab) => dab.bristles.map((bristle) => bristle.opacity)),
    );
    expect(heavyBristleLoad).toBeGreaterThan(lightBristleLoad * 1.15);

    const aliasLight = mapStudioBrushAliasPressure("oil", 0.12);
    const aliasHeavy = mapStudioBrushAliasPressure("oil", 0.95);
    expect(aliasHeavy).toBeGreaterThan(aliasLight * 1.4);
  });

  it("ink-wash is denser at the core, broader in the wash, and pressure-responsive", () => {
    const watercolor = resolveStudioBrushAliasWatercolorPlanSettings("watercolor", 24);
    const inkWash = resolveStudioBrushAliasWatercolorPlanSettings("ink-wash", 24);
    expect(inkWash).not.toBeNull();
    expect(watercolor).not.toBeNull();
    expect(inkWash!.spacing).toBeLessThan(watercolor!.spacing);
    expect(inkWash!.baseWidth).toBeLessThan(watercolor!.baseWidth);

    const source = [
      { x: 0, y: 0, radius: 10, opacity: 0.55, role: "core" as const },
      { x: 0, y: 0, radius: 10, opacity: 0.35, role: "diffuse" as const },
    ];
    const wash = applyStudioBrushAliasWatercolorMaterial("ink-wash", source);
    const soft = applyStudioBrushAliasWatercolorMaterial("watercolor", source);
    const washCore = wash.find((dab) => dab.role === "core")!;
    const washDiffuse = wash.find((dab) => dab.role === "diffuse")!;
    const softCore = soft.find((dab) => dab.role === "core")!;
    const softDiffuse = soft.find((dab) => dab.role === "diffuse")!;
    expect(washCore.radius).toBeLessThan(softCore.radius);
    expect(washCore.opacity).toBeGreaterThan(softCore.opacity);
    expect(washDiffuse.radius).toBeGreaterThan(softDiffuse.radius);

    expect(mapStudioBrushAliasPressure("ink-wash", 0.9))
      .toBeGreaterThan(mapStudioBrushAliasPressure("ink-wash", 0.15) * 1.6);

    const recipe = resolveStudioWetInkBrushPhysicalRecipe({
      id: "ink-wash-quality",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      brush: "ink-wash",
      stroke: "#20282c",
      strokeWidth: 18,
      opacity: 1,
      points: [0, 0, 40, 8, 80, -4],
      pressures: [0.4, 0.7, 0.55],
      watercolorPipeline: "causal-walker-v2",
    } as DrawEl);
    expect(recipe).not.toBeNull();
    expect(recipe!.material.edgeDarkening).toBeGreaterThan(0.75);
    expect(recipe!.material.granulation).toBeGreaterThan(0.65);
    expect(recipe!.material.bleed).toBeGreaterThan(0.4);
    expect(recipe!.material.pigmentLoad).toBeGreaterThan(1.2);
  });

  it("crayon ships anisotropic wax grain with continuous tooth and pressure coverage", () => {
    expect(resolveStudioDryMediaAnisotropicPresetIdV1("crayon")).toBe("crayon");
    const preset = STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1.crayon;
    expect(preset.shape).toBe("wax-ribbon");
    expect(preset.minimumAspectRatio).toBeGreaterThanOrEqual(3.5);
    expect(preset.grainFrequency.maximum).toBeGreaterThan(
      STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1.pastel.grainFrequency.minimum,
    );

    const light = resolveStudioDryMediaAnisotropicDabResponseV1({
      presetId: "crayon",
      seed: 0x51a7_c0de,
      stationIndex: 11,
      pressure: 0.08,
      tangentRadians: Math.PI / 6,
    })!;
    const heavy = resolveStudioDryMediaAnisotropicDabResponseV1({
      presetId: "crayon",
      seed: 0x51a7_c0de,
      stationIndex: 11,
      pressure: 0.94,
      tangentRadians: Math.PI / 6,
    })!;
    expect(heavy.widthScale).toBeGreaterThan(light.widthScale * 1.35);
    expect(heavy.opacityScale).toBeGreaterThan(light.opacityScale * 1.35);
    expect(heavy.flowScale).toBeGreaterThan(light.flowScale * 1.2);
    expect(heavy.majorAxisScale / Math.max(1e-6, heavy.roundness * heavy.majorAxisScale))
      .toBeGreaterThanOrEqual(preset.minimumAspectRatio - 1e-6);

    const dynamics = studioBrushDynamicsSettingsForBrushId("crayon")!;
    const lightDabs = planNormalizedStudioDynamicBrushDabs({
      points: [0, 0, 40, 6, 80, -4, 120, 8],
      pressures: [0.12, 0.12, 0.12, 0.12],
      baseWidth: dynamics.width.base,
      baseOpacity: 0.9,
      seed: dynamics.seed,
    }, dynamics);
    const heavyDabs = planNormalizedStudioDynamicBrushDabs({
      points: [0, 0, 40, 6, 80, -4, 120, 8],
      pressures: [0.92, 0.92, 0.92, 0.92],
      baseWidth: dynamics.width.base,
      baseOpacity: 0.9,
      seed: dynamics.seed,
    }, dynamics);
    expect(mean(heavyDabs.map((dab) => dab.size)))
      .toBeGreaterThan(mean(lightDabs.map((dab) => dab.size)) * 1.2);
    expect(mean(heavyDabs.map((dab) => dab.opacity * dab.flow)))
      .toBeGreaterThan(mean(lightDabs.map((dab) => dab.opacity * dab.flow)) * 1.15);

    const identity = resolveStudioDynamicBrushMaterialIdentity("crayon")!;
    expect(studioDryMediaDynamicBridgeMarkMultiplier(identity)).toBe(5);
    const bridged = bridgeStudioDynamicDabsToDryMediaV1({
      brushId: "crayon",
      seed: dynamics.seed,
      dabs: heavyDabs,
    });
    expect(bridged.ok).toBe(true);
    if (!bridged.ok) return;
    expect(bridged.receipt.laneCount).toBe(5);
    expect(bridged.receipt.marks.every((mark) => (
      mark.shape === "wax-ribbon"
      && mark.radiusX / mark.radiusY >= preset.minimumAspectRatio - 1e-8
    ))).toBe(true);

    const charcoal = bridgeStudioDynamicDabsToDryMediaV1({
      brushId: "charcoal",
      seed: dynamics.seed,
      dabs: heavyDabs,
    });
    expect(charcoal.ok).toBe(true);
    if (!charcoal.ok) return;
    const crayonSig = JSON.stringify(bridged.receipt.marks[9]);
    const charcoalSig = JSON.stringify(charcoal.receipt.marks[9]);
    expect(crayonSig).not.toBe(charcoalSig);

    // The union carrier is a pinned legacy-replay authority after the T1 de-polygon flip;
    // its connected-transport quality contract is asserted through the explicit program pin.
    const carrier = planStudioDryMediaUnionRibbonCarrier({
      dabs: bridged.receipt.adjustedDabs,
      marks: bridged.receipt.marks.map((mark) => ({
        x: mark.x,
        y: mark.y,
        radiusX: mark.radiusX,
        radiusY: mark.radiusY,
        angleRadians: mark.angleRadians,
        alpha: 1,
        color: "#3a2a18",
      })),
      materialIdentity: identity,
      dynamics: normalizeStudioBrushDynamicsSettings({
        ...dynamics,
        dryMediaUnionProgram: studioDryMediaUnionComposableProgramPin(),
      }),
    });
    expect(carrier.applied).toBe(true);
    if (!carrier.applied) return;
    expect(carrier.marks).toHaveLength(1);
    expect(carrier.marks[0]!.ribbon.polygons.length).toBeGreaterThan(
      bridged.receipt.adjustedDabs.length,
    );
  });

  it("charges crayon multi-lane expansion at budget admission time (not all-or-nothing later)", () => {
    const identity = resolveStudioDynamicBrushMaterialIdentity("crayon")!;
    expect(studioDryMediaDynamicBridgeMarkMultiplier(identity)).toBe(5);
    expect(studioDryMediaDynamicBridgeMarkMultiplier(null)).toBe(1);
    expect(
      studioDryMediaDynamicBridgeMarkMultiplier(
        resolveStudioDynamicBrushMaterialIdentity("g-pen"),
      ),
    ).toBe(1);
  });

  it("keeps remaining listed wet/oil/dry representatives on distinct shipped paths", () => {
    for (const id of [
      "oil",
      "watercolor",
      "gouache",
      "inkwash-pen",
      "inkwash-water-brush",
      "crayon",
      "crayon--klecks-stamp",
      "chalk--klecks-stamp",
      "charcoal--mypaint-stamp",
    ] as const) {
      expect(isStudioBrushQuarantinedPresetId(id), id).toBe(false);
    }

    expect(resolveStudioBrushRuntimeContract("inkwash-pen")).toMatchObject({
      engine: "watercolor-dabs",
      engineVariant: "stam-fluid-pen",
      distinctness: "engine-variant",
    });
    expect(resolveStudioBrushRuntimeContract("inkwash-water-brush")).toMatchObject({
      engine: "watercolor-dabs",
      engineVariant: "stam-fluid-water",
      distinctness: "engine-variant",
    });
    expect(isStudioInkwashFluidBrush("inkwash-pen")).toBe(true);
    expect(isStudioInkwashFluidBrush("ink-wash")).toBe(true);
    expect(isStudioInkwashFluidBrush("watercolor")).toBe(false);

    const source = [
      { x: 0, y: 0, radius: 10, opacity: 0.55, role: "core" as const },
      { x: 0, y: 0, radius: 10, opacity: 0.35, role: "diffuse" as const },
    ];
    const watercolorWash = applyStudioBrushAliasWatercolorMaterial("watercolor", source);
    const gouacheWash = applyStudioBrushAliasWatercolorMaterial("gouache", source);
    const watercolorCore = watercolorWash.find((dab) => dab.role === "core")!;
    const gouacheCore = gouacheWash.find((dab) => dab.role === "core")!;
    expect(gouacheCore.opacity).not.toBe(watercolorCore.opacity);
    expect(gouacheCore.radius).not.toBe(watercolorCore.radius);
    const watercolorPlan = resolveStudioBrushAliasWatercolorPlanSettings("watercolor", 24)!;
    const gouachePlan = resolveStudioBrushAliasWatercolorPlanSettings("gouache", 24)!;
    expect(gouachePlan.spacing).toBeGreaterThan(watercolorPlan.spacing);

    const klecksCrayon = resolveStudioBrushEngineLaneStampTuning("crayon--klecks-stamp");
    const klecksChalk = resolveStudioBrushEngineLaneStampTuning("chalk--klecks-stamp");
    expect(klecksCrayon?.spacingRatio).toBeLessThanOrEqual(0.2);
    expect(klecksChalk?.spacingRatio).toBeLessThanOrEqual(0.2);
    expect(klecksCrayon?.spacingRatio).not.toBe(klecksChalk?.spacingRatio);

    expect(studioDryMediaKernelTipAspectBand("crayon", 0.25)).toBe(0);
    expect(studioDryMediaKernelTipAspectBand("chalk", 0.25)).toBeGreaterThan(0);
    expect(STUDIO_DRY_MEDIA_KERNEL_TIP_ASPECT_BAND_REPRESENTATIVES.length).toBe(3);
  });
});
