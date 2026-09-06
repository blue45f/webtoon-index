import { beforeAll, describe, expect, it } from "vitest";

import {
  buildCalligraphySegments,
  BRUSH_PRESETS,
  screentoneDotsForStroke,
} from "../studio-brush";
import { planStudioCausalInk } from "../studio-causal-ink";
import {
  applyStudioCroquisPulledStringPrefilter,
  buildStudioCroquisCapsuleStrokeLoops,
  resolveStudioCroquisCapsulePenProgram,
  studioCroquisCapsuleRadiiFromPressures,
} from "../studio-croquis-capsule-pen-v1";
import {
  isStudioFxPressureBrushId,
  planGlitterBrushParticles,
  planOilBrushDabs,
  planStudioFxBrushPressurePath,
} from "../studio-fx-brush";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "../studio-material-pressure-model";
import {
  buildStudioPerfectFreehandOutline,
  loadStudioPerfectFreehandStroker,
  resolveStudioPerfectFreehandProfile,
  type StudioPerfectFreehandStroker,
} from "../studio-perfect-freehand";
import {
  planStudioRetainedMediaPressureCurve,
  resolveStudioRetainedMediaPressureProfileId,
} from "../studio-retained-media-pressure";

import {
  mapStudioBrushAliasPressureSamples,
  resolveStudioBrushAliasWatercolorPlanSettings,
  studioBrushAliasEffectiveDiameter,
} from "./studio-brush-alias-profile";
import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./studio-brush-catalog";
import {
  planNormalizedStudioDynamicBrushDabs,
  studioBrushDynamicsSettingsForBrushId,
} from "./studio-brush-dynamics";
import { resolveStudioBrushEngineLaneCroquisCapsuleProgramId } from "./studio-brush-engine-lane-catalog";
import {
  materializeAllStudioBrushPackSelections,
  type StudioBrushPackSelection,
} from "./studio-brush-pack-runtime";
import {
  resolveStudioBrushRuntimeContract,
  type StudioBrushRuntimeEngine,
} from "./studio-brush-runtime-contract";
import {
  planStudioStampBrushDabs,
  resolveStudioStampBrushKind,
  resolveStudioStampBrushStyle,
} from "./studio-brush-stamp-engine";
import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
} from "./studio-ink-pressure-model";
import { planStudioOilRibbonCarrier } from "./studio-oil-ribbon-carrier";
import {
  planStudioAngledNibStrokeLocalCoverage,
  studioStrokeLocalCoverageSignedArea,
} from "./studio-stroke-local-coverage";
import { planWatercolorBrushDabs } from "./studio-watercolor-brush";

const LOW_PRESSURE = 0.12;
const HIGH_PRESSURE = 0.88;
const PROBE_POINTS = [0, 0, 18, 7, 37, -4, 58, 9, 80, 0] as const;
const PROBE_POINT_COUNT = PROBE_POINTS.length / 2;
const EPSILON = 1e-8;

/**
 * These brushes deliberately preserve a pressure-invariant construction:
 *
 * - screentone/crosshatch are canvas-global pattern masks. Pressure-dependent dots would move or
 *   resize the lattice and make overlapping strokes visibly break the tone.
 * - milli-pen-uniform explicitly promises an even technical-liner width in its catalogue hint.
 * - web-pressure-flat is the assist-kit flat-pressure control brush (no pressure mappings).
 */
const INTENTIONAL_FIXED_PRESSURE_BRUSH_IDS = new Set([
  "screentone",
  "crosshatch",
  "milli-pen-uniform",
  "web-pressure-flat",
  // Engine-lane grids / side-shade paths that intentionally ignore hardware pressure at the
  // planner-proxy surface (same contract as their base media).
  //
  // pen--perfect-taper and calligraphy--perfect-chisel used to sit here, and that was this list
  // recording a bug as an intention. Both declare engine "perfect-outline" and dynamics
  // "outline-pressure" in the lane catalogue, but neither was registered in
  // STUDIO_PERFECT_FREEHAND_PROFILE_BY_BRUSH, so the renderer resolved no profile and fell back to
  // a constant-width round-capped polyline — which is why pressure moved nothing. With the
  // registration in place they thin with pressure like the perfect-ink / perfect-marker profiles
  // they name as their canonicalId, so they belong in the responsive population.
  "screentone--sparse-grid",
  "pencil--side-shade",
]);

interface PressureProbe {
  readonly id: string;
  readonly engine: StudioBrushRuntimeEngine | "procedural-pack";
  readonly low: readonly number[];
  readonly high: readonly number[];
}

let perfectFreehandStroker: StudioPerfectFreehandStroker;

function changed(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return true;
  return left.some((value, index) => Math.abs(value - (right[index] ?? value)) > EPSILON);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function outlineArea(points: readonly (readonly number[])[]): number {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += (current[0] ?? 0) * (next[1] ?? 0)
      - (next[0] ?? 0) * (current[1] ?? 0);
  }
  return Math.abs(twiceArea) / 2;
}

function constantPressures(value: number): number[] {
  return Array.from({ length: PROBE_POINT_COUNT }, () => value);
}

function mappedPressures(brushId: string, value: number, fallback = 0.5): number[] {
  return mapStudioBrushAliasPressureSamples(
    brushId,
    constantPressures(value),
    PROBE_POINT_COUNT,
    fallback,
  );
}

function corePressureAxes(brushId: string, pressure: number): readonly number[] {
  const preset = BRUSH_PRESETS.find(({ id }) => id === brushId);
  const contract = resolveStudioBrushRuntimeContract(brushId);
  if (!preset || !contract) return [];

  const diameter = studioBrushAliasEffectiveDiameter(brushId, preset.defaultWidth);
  const pressures = mappedPressures(brushId, pressure);

  switch (contract.engine) {
    case "causal-ink": {
      const plan = planStudioCausalInk({
        points: PROBE_POINTS,
        pressures,
        size: diameter,
        minDistance: 0,
        pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
        maximumDabs: 512,
      });
      return [
        plan.dabs.length,
        sum(plan.dabs.map(({ radius }) => radius)),
        Math.max(...plan.dabs.map(({ radius }) => radius)),
      ];
    }
    case "stamp-dabs": {
      const kind = resolveStudioStampBrushKind(brushId);
      if (!kind) return [];
      const style = resolveStudioStampBrushStyle(kind, {
        color: "#000000",
        size: diameter,
        opacity: preset.defaultOpacity,
      });
      const dabs = planStudioStampBrushDabs(style, PROBE_POINTS, pressures, 512);
      return [
        dabs.length,
        sum(dabs.map(({ radius }) => radius)),
        sum(dabs.map(({ alpha }) => alpha)),
      ];
    }
    case "calligraphy-segments": {
      const segments = buildCalligraphySegments(
        PROBE_POINTS,
        pressures,
        [],
        diameter,
        { tiltEnabled: false, angleDeg: -30, roundness: 0.35 },
      );
      return [
        segments.length,
        sum(segments.map(({ width }) => width)),
        Math.max(...segments.map(({ width }) => width)),
      ];
    }
    case "perfect-outline": {
      const profile = resolveStudioPerfectFreehandProfile(brushId);
      if (!profile) return [];
      const outline = buildStudioPerfectFreehandOutline(perfectFreehandStroker, {
        points: PROBE_POINTS,
        pressures,
        strokeWidth: diameter,
        profile,
      });
      return [outline.length, outlineArea(outline)];
    }
    // 2026-08-13 wave 3: croquis capsule lanes — radii are linear in recorded pressure
    // (r = p × size / 2), so hull area is the honest pressure axis.
    case "capsule-outline": {
      const program = resolveStudioCroquisCapsulePenProgram(
        resolveStudioBrushEngineLaneCroquisCapsuleProgramId(brushId),
      );
      if (!program) return [];
      const capsulePoints = program.pulledStringLengthPx !== null
        ? applyStudioCroquisPulledStringPrefilter(PROBE_POINTS, {
            stringLengthPx: program.pulledStringLengthPx,
          })
        : [...PROBE_POINTS];
      const loops = buildStudioCroquisCapsuleStrokeLoops({
        points: capsulePoints,
        radii: studioCroquisCapsuleRadiiFromPressures(
          pressures.slice(0, Math.floor(capsulePoints.length / 2)),
          diameter,
        ),
        arcTolerancePx: program.arcTolerancePx,
      });
      return [
        loops.length,
        sum(loops.map((loop) => outlineArea(loop))),
      ];
    }
    case "particle-scatter": {
      const mode = brushId === "star-dust"
        ? "star-dust"
        : brushId === "sparkle-star" ? "sparkle-star" : "glitter";
      const particles = planGlitterBrushParticles({
        points: PROBE_POINTS,
        pressures,
        baseWidth: diameter,
        seed: 73,
        mode,
        maxParticles: 512,
      });
      return [
        particles.length,
        sum(particles.map(({ radius }) => radius)),
        sum(particles.map(({ opacity }) => opacity)),
      ];
    }
    case "angled-ribbon": {
      const profileId = brushId === "flat-brush" ? "flat-brush" : "brush";
      const plan = planStudioAngledNibStrokeLocalCoverage(
        PROBE_POINTS,
        diameter,
        -Math.PI / 6,
        { profileId, pressures },
      );
      return [
        plan.acceptedSegmentCount,
        sum(plan.polygons.map(({ points }) =>
          Math.abs(studioStrokeLocalCoverageSignedArea(points))
        )),
      ];
    }
    case "watercolor-dabs": {
      const settings = resolveStudioBrushAliasWatercolorPlanSettings(brushId, preset.defaultWidth);
      const dabs = planWatercolorBrushDabs({
        points: PROBE_POINTS,
        pressures,
        baseWidth: settings?.baseWidth ?? diameter,
        spacing: settings?.spacing,
        seed: 73,
        maxDabs: 512,
      });
      return [
        dabs.length,
        sum(dabs.map(({ radius }) => radius)),
        sum(dabs.map(({ opacity }) => opacity)),
      ];
    }
    case "oil-ribbon": {
      const dabs = planOilBrushDabs({
        points: PROBE_POINTS,
        pressures,
        baseWidth: diameter,
        seed: 73,
        maxDabs: 512,
      });
      const carrier = planStudioOilRibbonCarrier(dabs);
      return [
        carrier.sourceStationCount,
        carrier.body
          ? Math.abs(studioStrokeLocalCoverageSignedArea(carrier.body.points))
          : 0,
        carrier.bodyOpacity,
        sum(carrier.bristleLanes.map(({ lineWidth }) => lineWidth)),
      ];
    }
    case "dynamic-dabs": {
      const settings = studioBrushDynamicsSettingsForBrushId(brushId);
      if (!settings) return [];
      const dabs = planNormalizedStudioDynamicBrushDabs({
        points: PROBE_POINTS,
        pressures,
        speeds: constantPressures(0.45),
        baseWidth: diameter,
        baseOpacity: preset.defaultOpacity,
        seed: 73,
        maxDabs: 512,
      }, settings);
      return [
        dabs.length,
        sum(dabs.map(({ size }) => size)),
        sum(dabs.map(({ opacity, flow }) => opacity * flow)),
      ];
    }
    case "pencil-path": {
      const profileId = resolveStudioRetainedMediaPressureProfileId(brushId);
      if (!profileId) return [];
      const plan = planStudioRetainedMediaPressureCurve(
        PROBE_POINTS,
        pressures,
        profileId,
      );
      return [
        plan.segments.length,
        sum(plan.segments.map(({ sizeScale }) => sizeScale)),
        sum(plan.segments.map(({ opacityScale, flowScale }) =>
          opacityScale * flowScale
        )),
      ];
    }
    case "highlighter-path":
    case "neon-halo":
    case "glow-halo": {
      if (!isStudioFxPressureBrushId(brushId)) return [];
      const plan = planStudioFxBrushPressurePath({
        brushId,
        points: PROBE_POINTS,
        pressures,
        pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
        tension: 0.35,
      });
      return [
        plan.segments.length,
        sum(plan.segments.map(({ widthScale }) => widthScale)),
        sum(plan.segments.map(({ opacityScale }) => opacityScale)),
        sum(plan.segments.map(({ haloScale }) => haloScale)),
      ];
    }
    // The global lattice intentionally excludes local pressure from its geometry.
    case "screentone-dots":
      return [];
  }
}

function proceduralPressureAxes(
  selection: StudioBrushPackSelection,
  pressure: number,
): readonly number[] {
  const dabs = planNormalizedStudioDynamicBrushDabs({
    points: PROBE_POINTS,
    pressures: constantPressures(pressure),
    speeds: constantPressures(0.45),
    baseWidth: selection.defaultWidth,
    baseOpacity: selection.defaultOpacity,
    seed: 73,
    maxDabs: 512,
  }, selection.brushDynamics);
  return [
    dabs.length,
    sum(dabs.map(({ size }) => size)),
    sum(dabs.map(({ opacity, flow }) => opacity * flow)),
  ];
}

function allPressureProbes(): PressureProbe[] {
  const core = BRUSH_PRESETS.map(({ id }) => {
    const contract = resolveStudioBrushRuntimeContract(id)!;
    return {
      id,
      engine: contract.engine,
      low: corePressureAxes(id, LOW_PRESSURE),
      high: corePressureAxes(id, HIGH_PRESSURE),
    };
  });
  const procedural = materializeAllStudioBrushPackSelections().map((selection) => ({
    id: selection.catalogId,
    engine: "procedural-pack" as const,
    low: proceduralPressureAxes(selection, LOW_PRESSURE),
    high: proceduralPressureAxes(selection, HIGH_PRESSURE),
  }));
  return [...core, ...procedural];
}

describe("complete-catalogue hardware-pressure planner proxy", () => {
  beforeAll(async () => {
    perfectFreehandStroker = await loadStudioPerfectFreehandStroker();
  });

  it("audits every searchable identity through its materialized runtime planner", () => {
    const probes = allPressureProbes();
    expect(probes).toHaveLength(STUDIO_ALL_BRUSH_CATALOG_ITEMS.length);
    expect(new Set(probes.map(({ id }) => id))).toEqual(
      new Set(STUDIO_ALL_BRUSH_CATALOG_ITEMS.map(({ id }) => id)),
    );
    expect(probes.every(({ low, high }) => (
      low.every(Number.isFinite) && high.every(Number.isFinite)
    ))).toBe(true);
  });

  it("reports planner-level pressure deltas for every non-fixed catalogue identity", () => {
    const responsiveIds = allPressureProbes()
      .filter(({ low, high }) => changed(low, high))
      .map(({ id }) => id);
    const expectedResponsiveIds = STUDIO_ALL_BRUSH_CATALOG_ITEMS
      .map(({ id }) => id)
      .filter((id) => (
        !INTENTIONAL_FIXED_PRESSURE_BRUSH_IDS.has(id)
      ));

    expect(new Set(responsiveIds)).toEqual(new Set(expectedResponsiveIds));
    expect(responsiveIds).toHaveLength(expectedResponsiveIds.length);
  });

  it("proves the intentional fixed-pressure exceptions rather than silently ignoring input", () => {
    const probes = new Map(allPressureProbes().map((probe) => [probe.id, probe]));
    const screenToneContract = resolveStudioBrushRuntimeContract("screentone");
    const crosshatchContract = resolveStudioBrushRuntimeContract("crosshatch");
    const path = [...PROBE_POINTS];

    expect(screenToneContract?.dynamics).toBe("global-grid");
    expect(crosshatchContract?.dynamics).toBe("global-grid");
    expect(screentoneDotsForStroke(path, 16, 8)).toEqual(
      screentoneDotsForStroke(path, 16, 8),
    );

    const milliPen = materializeAllStudioBrushPackSelections().find(
      ({ catalogId }) => catalogId === "milli-pen-uniform",
    );
    expect(milliPen?.hint).toContain("필압을 무시");
    expect(milliPen?.brushDynamics.width.mappings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "pressure" })]),
    );
    expect(milliPen?.brushDynamics.opacity.mappings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "pressure" })]),
    );
    expect(milliPen?.brushDynamics.flow.mappings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "pressure" })]),
    );

    for (const id of INTENTIONAL_FIXED_PRESSURE_BRUSH_IDS) {
      const probe = probes.get(id);
      expect(probe, `${id}: missing pressure audit`).toBeDefined();
      expect(changed(probe!.low, probe!.high), `${id}: fixed contract drift`).toBe(false);
    }
  });

  it("detects no accidental planner-proxy invariant outside the intentional exceptions", () => {
    const observed = allPressureProbes()
      .filter(({ id, low, high }) => (
        !INTENTIONAL_FIXED_PRESSURE_BRUSH_IDS.has(id)
        && !changed(low, high)
      ))
      .map(({ id }) => id);
    expect(observed).toEqual([]);
  });
});
