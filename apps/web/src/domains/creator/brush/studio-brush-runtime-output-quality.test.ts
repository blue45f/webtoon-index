import { beforeAll, describe, expect, it } from "vitest";

import {
  buildStudioPerfectFreehandOutline,
  buildStudioPerfectFreehandPathData,
  loadStudioPerfectFreehandStroker,
  STUDIO_PERFECT_FREEHAND_PROFILES,
  type StudioPerfectFreehandStroker,
} from "../studio-perfect-freehand";

import {
  planNormalizedStudioDynamicBrushDabs,
  studioBrushDynamicsSettingsForBrushId,
  studioBrushDynamicsPresetSettings,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import { resolveNormalizedStudioBrushGrainAlphaMultiplierAt } from "./studio-brush-material-dynamics";
import { profileStudioBrushMaterialResponse } from "./studio-brush-material-response";
import { materializeStudioBrushPackSelection } from "./studio-brush-pack-runtime";
import { sampleStudioBrushTipProceduralAlpha } from "./studio-brush-tip-stamp";

function sampleGpenCurve(count: number): {
  points: number[];
  pressures: number[];
} {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = index / Math.max(1, count - 1);
    points.push(
      24 + progress * 220,
      90
        + Math.sin(progress * Math.PI * 1.8) * 46
        + Math.sin(progress * Math.PI * 4.2) * 8,
    );
    pressures.push(0.28 + Math.sin(progress * Math.PI) * 0.58);
  }
  return { points, pressures };
}

function bounds(outline: number[][]): {
  width: number;
  height: number;
} {
  const xs = outline.map((point) => point[0]!).filter(Number.isFinite);
  const ys = outline.map((point) => point[1]!).filter(Number.isFinite);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function maximumNeighborGap(outline: number[][]): number {
  let maximum = 0;
  for (let index = 1; index < outline.length; index += 1) {
    const previous = outline[index - 1]!;
    const current = outline[index]!;
    maximum = Math.max(
      maximum,
      Math.hypot(current[0]! - previous[0]!, current[1]! - previous[1]!),
    );
  }
  return maximum;
}

interface SlowStrokeCoverageProfile {
  readonly centreMeanAlpha: number;
  readonly dabCount: number;
  readonly maximumAlpha: number;
  readonly meanAlpha: number;
}

/**
 * Pixel-like deterministic probe of the real soft-tip falloff and arc-length station cadence.
 * It models the bounded-flow contract: opacity×flow×tip×grain accumulates on the stroke-local
 * surface, then the catalogue opacity is applied once. Sampling the whole nominal footprint
 * catches a bright centre surrounded by an almost-white shoulder that peak-only tests miss.
 */
function profileSlowStrokeCoverage(
  settings: NormalizedStudioBrushDynamicsSettings,
  defaultWidth: number,
  defaultOpacity: number,
): SlowStrokeCoverageProfile {
  const dabs = planNormalizedStudioDynamicBrushDabs({
    baseOpacity: 1,
    baseWidth: defaultWidth,
    maxDabs: 4096,
    points: [0, 0, 160, 0],
    pressures: [0.5, 0.5],
    seed: settings.seed,
    speeds: [0.08, 0.08],
  }, settings);
  let alphaTotal = 0;
  let centreAlphaTotal = 0;
  let centreSampleCount = 0;
  let maximumAlpha = 0;
  let sampleCount = 0;
  for (let y = -defaultWidth / 2; y <= defaultWidth / 2; y += 2) {
    for (let x = 32; x <= 128; x += 2) {
      let transparent = 1;
      for (const dab of dabs) {
        const angle = -dab.angle * Math.PI / 180;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const deltaX = x - dab.x;
        const deltaY = y - dab.y;
        const normalizedX = (
          cosine * deltaX - sine * deltaY
        ) / Math.max(0.125, dab.size / 2);
        const normalizedY = (
          sine * deltaX + cosine * deltaY
        ) / Math.max(0.125, dab.size * Math.max(0.01, dab.roundness) / 2);
        const tipAlpha = sampleStudioBrushTipProceduralAlpha(
          settings.tip.shape,
          normalizedX,
          normalizedY,
          settings.tip.softness,
        );
        if (tipAlpha <= 0) continue;
        const grain = resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
          x,
          y,
          0,
          0,
          settings.seed,
          settings.grain,
        );
        const deposition = Math.min(
          1,
          Math.max(0, dab.opacity * dab.flow * tipAlpha * grain),
        );
        transparent *= 1 - deposition;
      }
      const alpha = defaultOpacity * (1 - transparent);
      alphaTotal += alpha;
      maximumAlpha = Math.max(maximumAlpha, alpha);
      sampleCount += 1;
      if (Math.abs(y) < 1) {
        centreAlphaTotal += alpha;
        centreSampleCount += 1;
      }
    }
  }
  return {
    centreMeanAlpha: centreSampleCount > 0
      ? centreAlphaTotal / centreSampleCount
      : 0,
    dabCount: dabs.length,
    maximumAlpha,
    meanAlpha: sampleCount > 0 ? alphaTotal / sampleCount : 0,
  };
}

describe("shipped brush runtime output quality", () => {
  let stroker: StudioPerfectFreehandStroker;

  beforeAll(async () => {
    stroker = await loadStudioPerfectFreehandStroker();
  });

  it("keeps G-pen curves continuous at both sparse/fast and dense/slow sample cadences", () => {
    const sparse = sampleGpenCurve(19);
    const dense = sampleGpenCurve(109);
    const profile = STUDIO_PERFECT_FREEHAND_PROFILES.gpen;
    const strokeWidth = 11;
    const sparseOutline = buildStudioPerfectFreehandOutline(stroker, {
      ...sparse,
      profile,
      strokeWidth,
    });
    const denseOutline = buildStudioPerfectFreehandOutline(stroker, {
      ...dense,
      profile,
      strokeWidth,
    });

    for (const input of [sparse, dense]) {
      const path = buildStudioPerfectFreehandPathData(stroker, {
        ...input,
        profile,
        strokeWidth,
      });
      expect(path.match(/M/g)).toHaveLength(1);
      expect(path.match(/Q/g)?.length).toBeGreaterThan(18);
      expect(path.match(/Z/g)).toHaveLength(1);
      expect(path).not.toContain(" L");
    }

    expect(sparseOutline.length).toBeGreaterThan(20);
    expect(denseOutline.length).toBeGreaterThan(sparseOutline.length);
    expect(maximumNeighborGap(sparseOutline)).toBeLessThan(strokeWidth * 2.25);
    expect(maximumNeighborGap(denseOutline)).toBeLessThan(strokeWidth * 1.25);

    const sparseBounds = bounds(sparseOutline);
    const denseBounds = bounds(denseOutline);
    expect(sparseBounds.width).toBeCloseTo(denseBounds.width, -1);
    expect(sparseBounds.height / denseBounds.height).toBeGreaterThan(0.9);
    expect(sparseBounds.height / denseBounds.height).toBeLessThan(1.1);
  });

  it("keeps remaining ink/line outlines pressure-aware: G-pen swells, maru-pen stays a hairline", () => {
    const strokeWidth = 11;
    const outlineAt = (
      profile: (typeof STUDIO_PERFECT_FREEHAND_PROFILES)["gpen"],
      pressure: number,
    ) => buildStudioPerfectFreehandOutline(stroker, {
      points: [8, 40, 80, 40, 160, 40],
      pressures: [pressure, pressure, pressure],
      profile,
      strokeWidth,
    });
    const gpenLight = bounds(outlineAt(STUDIO_PERFECT_FREEHAND_PROFILES.gpen, 0.12));
    const gpenHeavy = bounds(outlineAt(STUDIO_PERFECT_FREEHAND_PROFILES.gpen, 0.94));
    expect(gpenHeavy.height).toBeGreaterThan(gpenLight.height * 1.45);

    const maruLight = bounds(outlineAt(STUDIO_PERFECT_FREEHAND_PROFILES["maru-pen"], 0.12));
    const maruHeavy = bounds(outlineAt(STUDIO_PERFECT_FREEHAND_PROFILES["maru-pen"], 0.94));
    expect(maruLight.height).toBeLessThan(gpenLight.height);
    expect(maruHeavy.height).toBeGreaterThan(maruLight.height * 1.6);
  });

  it("keeps soft airbrush arc-length cadence stable when pointer speed changes", () => {
    const settings = studioBrushDynamicsPresetSettings("airbrush");
    const planAtSpeed = (speed: number) => planNormalizedStudioDynamicBrushDabs({
      baseOpacity: 1,
      baseWidth: 32,
      maxDabs: 4096,
      points: [0, 0, 240, 0],
      pressures: [0.5, 0.5],
      seed: 202,
      speeds: [speed, speed],
    }, settings);
    const slow = planAtSpeed(0.08);
    const fast = planAtSpeed(2.5);

    expect(settings.spacingRatio).toBe(0.145);
    expect(settings.spacing.mappings).toHaveLength(0);
    expect(fast).toEqual(slow);
    expect(slow.length).toBeGreaterThan(45);
    // Ignore the intentionally narrowed taper caps; the body must stay substantially overlapped.
    const bodyStart = Math.max(1, Math.floor(slow.length * 0.15));
    const bodyEnd = Math.min(slow.length - 1, Math.ceil(slow.length * 0.85));
    for (let index = bodyStart; index < bodyEnd; index += 1) {
      const previous = slow[index - 1]!;
      const current = slow[index]!;
      expect(
        Math.hypot(
          current.sourceX - previous.sourceX,
          current.sourceY - previous.sourceY,
        ),
      ).toBeLessThanOrEqual(current.size * 0.18);
    }
  });

  it("keeps slow soft/spray strokes visible across their footprint without centre over-saturation", () => {
    const grandSoft = materializeStudioBrushPackSelection("airbrush-grand-soft");
    if (!grandSoft) throw new Error("airbrush-grand-soft pack is missing");
    const cases = [
      {
        id: "airbrush",
        settings: studioBrushDynamicsPresetSettings("airbrush"),
        width: 32,
        opacity: 0.7,
        minimumMean: 0.1,
        maximumPeak: 0.36,
      },
      {
        id: "soft-brush",
        settings: studioBrushDynamicsSettingsForBrushId("soft-brush")!,
        width: 36,
        opacity: 0.55,
        minimumMean: 0.125,
        maximumPeak: 0.39,
      },
      {
        id: "spray",
        settings: studioBrushDynamicsSettingsForBrushId("spray")!,
        width: 40,
        opacity: 0.55,
        minimumMean: 0.045,
        maximumPeak: 0.24,
      },
      {
        id: grandSoft.catalogId,
        settings: grandSoft.brushDynamics,
        width: grandSoft.defaultWidth,
        opacity: grandSoft.defaultOpacity,
        minimumMean: 0.08,
        maximumPeak: 0.3,
      },
    ] as const;
    const profiles = cases.map((entry) => ({
      ...entry,
      profile: profileSlowStrokeCoverage(
        entry.settings,
        entry.width,
        entry.opacity,
      ),
    }));

    for (const entry of profiles) {
      expect(entry.profile.dabCount, entry.id).toBeGreaterThan(8);
      expect(entry.profile.meanAlpha, entry.id).toBeGreaterThanOrEqual(
        entry.minimumMean,
      );
      expect(entry.profile.maximumAlpha, entry.id).toBeLessThanOrEqual(
        entry.maximumPeak,
      );
      expect(
        entry.profile.centreMeanAlpha / entry.profile.meanAlpha,
        entry.id,
      ).toBeLessThan(3);
    }
    expect(new Set(
      profiles.map(({ profile }) => profile.meanAlpha.toFixed(2)),
    ).size).toBe(profiles.length);
  });

  it("keeps a visible airbrush floor while flow accumulates below whole-stroke opacity", () => {
    const response = profileStudioBrushMaterialResponse({
      brushDynamics: studioBrushDynamicsPresetSettings("airbrush"),
      defaultWidth: 32,
      defaultOpacity: 0.72,
      seed: 202,
    });

    expect(response.deposition.overlap1Alpha).toBeGreaterThanOrEqual(0.06);
    expect(response.deposition.overlap4Alpha).toBeGreaterThan(
      response.deposition.overlap1Alpha,
    );
    expect(response.deposition.overlap16Alpha).toBeGreaterThan(
      response.deposition.overlap4Alpha,
    );
    expect(response.deposition.overlap16Alpha).toBeLessThanOrEqual(
      response.deposition.opacityCeiling,
    );
    expect(response.texture.materialMeanAlpha).toBeGreaterThan(0.04);
  });

  it("bounds dry-media velocity tooth without opening high-speed gaps", () => {
    const settings = studioBrushDynamicsPresetSettings("dry-media");
    const planAtSpeed = (speed: number) => planNormalizedStudioDynamicBrushDabs({
      baseOpacity: 1,
      baseWidth: 18,
      maxDabs: 4096,
      points: [0, 0, 240, 0],
      pressures: [0.65, 0.65],
      seed: 303,
      speeds: [speed, speed],
    }, settings);
    const slow = planAtSpeed(0.08);
    const fast = planAtSpeed(2.5);
    const maximumBodyGapRatio = (dabs: typeof slow): number => {
      const start = Math.max(1, Math.floor(dabs.length * 0.15));
      const end = Math.min(dabs.length - 1, Math.ceil(dabs.length * 0.85));
      let maximum = 0;
      for (let index = start; index < end; index += 1) {
        const previous = dabs[index - 1]!;
        const current = dabs[index]!;
        const sourceGap = Math.hypot(
          current.sourceX - previous.sourceX,
          current.sourceY - previous.sourceY,
        );
        maximum = Math.max(maximum, sourceGap / Math.max(0.25, current.size));
      }
      return maximum;
    };

    expect(settings.spacing.mappings).toEqual([
      expect.objectContaining({ source: "speed", from: 0.95, to: 1.12 }),
    ]);
    expect(fast.length).toBeLessThan(slow.length);
    expect(maximumBodyGapRatio(slow)).toBeLessThanOrEqual(0.35);
    expect(maximumBodyGapRatio(fast)).toBeLessThanOrEqual(0.35);
  });

  it("keeps pressure expressive across every continuous textured core medium", () => {
    for (const brushId of [
      "airbrush",
      "dry-media",
      "crayon",
      "chalk",
      "charcoal",
    ] as const) {
      const settings = studioBrushDynamicsSettingsForBrushId(brushId);
      if (!settings) throw new Error(`${brushId}: missing dynamics`);
      const planAtPressure = (pressure: number) => (
        planNormalizedStudioDynamicBrushDabs({
          baseOpacity: 1,
          baseWidth: settings.width.base,
          maxDabs: 1,
          points: [0, 0],
          pressures: [pressure],
          seed: settings.seed,
          speeds: [0.4],
        }, settings)[0]!
      );
      const light = planAtPressure(0.15);
      const firm = planAtPressure(0.9);

      expect(firm.size, `${brushId}: pressure does not change diameter`)
        .toBeGreaterThan(light.size);
      expect(
        firm.opacity * firm.flow,
        `${brushId}: pressure does not load more pigment`,
      ).toBeGreaterThan(light.opacity * light.flow);
    }
  });

  it("ships dry-media grain in stroke-fixed space so transformed marks keep their tooth", () => {
    const grain = studioBrushDynamicsPresetSettings("dry-media").grain;
    expect(grain).toMatchObject({
      space: "stroke-fixed",
      amount: 0.18,
      scale: 5.5,
      contrast: 0.55,
      seed: 303,
    });

    const first = resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
      24,
      31,
      8,
      12,
      303,
      grain,
    );
    const translatedWithStroke = resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
      144,
      231,
      128,
      212,
      303,
      grain,
    );
    const movedInsideStroke = resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
      29,
      36,
      8,
      12,
      303,
      grain,
    );

    expect(translatedWithStroke).toBe(first);
    expect(movedInsideStroke).not.toBe(first);
  });
});
