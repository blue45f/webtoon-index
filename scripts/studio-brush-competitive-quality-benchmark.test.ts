import { beforeAll, describe, expect, it } from "vitest";

import {
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
} from "../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "../apps/web/src/domains/creator/brush/studio-brush-pack-index";
import { materializeAllStudioBrushPackSelections } from "../apps/web/src/domains/creator/brush/studio-brush-pack-runtime";
import { studioCoreBrushCatalogSelection } from "../apps/web/src/domains/creator/brush/studio-brush-selection";
import { BRUSH_PRESETS } from "../apps/web/src/domains/creator/studio-brush";

import {
  benchmarkStudioCompetitiveBrushQuality,
  STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ,
  STUDIO_COMPETITIVE_BRUSH_LONG_SAMPLE_FLOOR,
  STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_PATH_LENGTH_PX,
  STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_SAMPLE_COUNT,
  STUDIO_COMPETITIVE_BRUSH_QUALITY_SCHEMA_VERSION,
  type StudioCompetitiveBrushQualityCandidate,
  type StudioCompetitiveBrushQualityReport,
} from "./studio-brush-competitive-quality-benchmark";

function shippedCandidates(): StudioCompetitiveBrushQualityCandidate[] {
  const core = BRUSH_PRESETS.map((preset) => ({
    ...studioCoreBrushCatalogSelection(preset),
    source: "core" as const,
  }));
  const professional = materializeAllStudioBrushPackSelections().map((selection, index) => ({
    ...selection,
    source: "pro" as const,
    category: STUDIO_BRUSH_PACK_DESCRIPTORS[index]!.category,
    previewStyle: STUDIO_BRUSH_PACK_DESCRIPTORS[index]!.previewStyle,
  }));
  return [...core, ...professional];
}

describe("Studio competitive brush quality benchmark", () => {
  let report: StudioCompetitiveBrushQualityReport;
  const shipped = shippedCandidates();

  beforeAll(() => {
    report = benchmarkStudioCompetitiveBrushQuality(shipped);
  }, 30_000);

  it("indexes the complete shipped catalogue while measuring deterministic representative groups in CI", () => {
    expect(report.schemaVersion).toBe(STUDIO_COMPETITIVE_BRUSH_QUALITY_SCHEMA_VERSION);
    expect(report.tier).toBe("ci");
    expect(report.catalogue).toHaveLength(shipped.length);
    expect(new Set(report.catalogue.map(({ catalogId }) => catalogId))).toHaveLength(shipped.length);
    expect(report.catalogue.filter(({ source }) => source === "core")).toHaveLength(
      BRUSH_PRESETS.length,
    );
    expect(report.catalogue.filter(({ source }) => source === "pro")).toHaveLength(
      STUDIO_BRUSH_PACK_DESCRIPTORS.length,
    );
    expect(report.policy.expectedPresetCount).toBe(shipped.length);
    expect(report.summary.representativeCount).toBeGreaterThan(20);
    expect(report.summary.measuredCount).toBe(report.summary.representativeCount);

    const allGroups = new Set(report.catalogue.map(({ representativeGroup }) => representativeGroup));
    const measuredGroups = new Set(report.results.map(({ representativeGroup }) => representativeGroup));
    expect(measuredGroups).toEqual(allGroups);
  });

  it("exercises 60/120/240 Hz and includes a source route with at least 5,001 samples", () => {
    for (const result of report.results) {
      expect(result.cadence.map(({ rateHz }) => rateHz)).toEqual(
        STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ,
      );
      expect(Math.max(...result.cadence.map(({ sourceSampleCount }) => sourceSampleCount)))
        .toBeGreaterThanOrEqual(STUDIO_COMPETITIVE_BRUSH_LONG_SAMPLE_FLOOR);
      expect(result.cadence.every(({ runtimeMs }) => runtimeMs >= 0)).toBe(true);
    }
    expect(report.summary.maximumSourceSampleCount)
      .toBeGreaterThanOrEqual(STUDIO_COMPETITIVE_BRUSH_LONG_SAMPLE_FLOOR);
  });

  it("keeps incremental live geometry byte-exact with committed replay without planner caps", () => {
    expect(report.results.flatMap(({ cadence }) => cadence).every(
      ({ liveCommitGeometryExact, plannerCapped }) => liveCommitGeometryExact && !plannerCapped,
    )).toBe(true);
    expect(report.summary.errorCount).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("separates artistic pigment scatter from the canonical carrier on long 60/120/240 Hz curves", () => {
    const previouslyFlagged = [
      "dry-media",
      "ink-particle",
      "cloud-soft",
      "fiber-sketch",
    ] as const;

    for (const catalogId of previouslyFlagged) {
      const result = report.results.find((candidate) => candidate.catalogId === catalogId);
      expect(result, `${catalogId} must remain a measured representative`).toBeDefined();
      expect(result!.cadence.map(({ rateHz }) => rateHz)).toEqual(
        STUDIO_COMPETITIVE_BRUSH_INPUT_RATES_HZ,
      );
      expect(result!.findings.some(({ code }) => code === "curvature-spike")).toBe(false);
      expect(result!.cadence.every((profile) => (
        profile.maxCarrierTangentTurnRadians <= report.policy.warningTurnRadians
        && profile.liveCommitGeometryExact
        && profile.maxCarrierGapRatio <= report.policy.strictCarrierGapRatio
        && profile.exposedJointRatio === 0
      ))).toBe(true);
      // Grain/fibre/cloud scatter remains present and visible in the report instead of being
      // blurred away or silently reclassified as the centreline.
      expect(result!.cadence.some((profile) => (
        profile.maxTangentTurnRadians > profile.maxCarrierTangentTurnRadians
      ))).toBe(true);
      expect(result!.crossing?.alphaLossRatio ?? 0).toBeLessThanOrEqual(0.001);
    }

    expect(report.summary.warningCount).toBe(0);
  });

  it("reports pressure, crossing, DPR/4K and allocation proxies as finite values", () => {
    // Pressure remains a dense production-planner probe, but it is deliberately independent of
    // the 5,001-sample cadence route measured above. This guards against restoring the redundant
    // pair of long-stroke replays that made this quality gate load-dependent in CI.
    expect(STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_SAMPLE_COUNT).toBe(97);
    expect(STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_PATH_LENGTH_PX).toBe(192);
    expect(
      STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_PATH_LENGTH_PX
        / (STUDIO_COMPETITIVE_BRUSH_PRESSURE_PROBE_SAMPLE_COUNT - 1),
    ).toBe(2);

    for (const result of report.results) {
      expect(result.pressure).not.toBeNull();
      expect(Number.isFinite(result.pressure!.diameterResponseRatio)).toBe(true);
      expect(Number.isFinite(result.pressure!.depositionResponseRatio)).toBe(true);
      expect(Number.isFinite(result.pressure!.inkMassResponseRatio)).toBe(true);
      expect(Number.isFinite(result.pressure!.terminalDiameterResponseRatio)).toBe(true);
      expect(result.resourceProxy4k).not.toBeNull();
      const { dpr1, dpr2 } = result.resourceProxy4k!;
      expect(dpr1.fullSurfaceBytes).toBe(3_840 * 2_160 * 4);
      expect(dpr2.fullSurfaceBytes).toBe(3_840 * 2_160 * 4 * 4);
      expect(dpr2.estimatedPeakWorkingSetBytes).toBeGreaterThan(0);
      expect(dpr2.allocationObjectProxy).toBeGreaterThanOrEqual(
        STUDIO_COMPETITIVE_BRUSH_LONG_SAMPLE_FLOOR,
      );
      if (result.crossing?.available) {
        expect(result.crossing.alphaLossRatio).not.toBeNull();
        expect(Number.isFinite(result.crossing.alphaLossRatio!)).toBe(true);
      }
      if (result.pressure!.expected) {
        expect(Math.max(
          result.pressure!.diameterResponseRatio,
          result.pressure!.depositionResponseRatio,
          result.pressure!.inkMassResponseRatio,
          result.pressure!.terminalDiameterResponseRatio,
        )).toBeGreaterThanOrEqual(report.policy.pressureResponseRatioFloor);
        expect(result.pressure!.liveCommitGeometryExact).toBe(true);
      }
    }
  });

  it("promotes G-pen, calligraphy and Perfect Ink pressure from waivers to renderer evidence", () => {
    const expectedSources = new Map([
      ["gpen", "perfect-outline-cpu"],
      ["calligraphy", "calligraphy-ribbon-cpu"],
      ["perfect-ink", "perfect-outline-cpu"],
    ] as const);

    for (const [catalogId, expectedSource] of expectedSources) {
      const result = report.results.find((candidate) => candidate.catalogId === catalogId);
      expect(result, `${catalogId} must remain a CI representative`).toBeDefined();
      const pressure = result!.pressure!;
      expect(pressure.measurementSource).toBe(expectedSource);
      expect(pressure.liveCommitGeometryExact).toBe(true);
      expect(pressure.highMeanDiameter).toBeGreaterThan(pressure.lowMeanDiameter);
      expect(pressure.highInkMass).toBeGreaterThan(pressure.lowInkMass);
      expect(pressure.highTerminalDiameter).toBeGreaterThan(pressure.lowTerminalDiameter);
      expect(pressure.diameterResponseRatio).toBeGreaterThanOrEqual(
        report.policy.pressureResponseRatioFloor,
      );
      expect(pressure.inkMassResponseRatio).toBeGreaterThanOrEqual(
        report.policy.pressureResponseRatioFloor,
      );
      expect(pressure.terminalDiameterResponseRatio).toBeGreaterThanOrEqual(
        report.policy.pressureResponseRatioFloor,
      );
      expect(result!.findings.some(({ code }) => code === "pressure-response-flat"))
        .toBe(false);
      expect(result!.status).toBe("pass");
    }

    for (const catalogId of ["gpen", "perfect-ink"] as const) {
      const pressure = report.results.find((candidate) => candidate.catalogId === catalogId)!
        .pressure!;
      expect(pressure.lowTerminalToBodyRatio).toBeLessThan(0.95);
      expect(pressure.highTerminalToBodyRatio).toBeLessThan(0.95);
    }

    // Only the four explicitly browser-owned gates remain; renderer pressure is no longer waived.
    expect(report.summary.waiverCount).toBe(
      report.externalGates.filter(({ status }) => status === "waived").length,
    );
  });

  it("makes browser-only pixel, frame-pacing and heap evidence explicit instead of claiming it", () => {
    expect(report.externalGates.map(({ id }) => id).sort()).toEqual([
      "browser-frame-pacing",
      "browser-heap-gc",
      "pixel-crossing-color",
      "pixel-live-commit-parity",
    ]);
    expect(report.externalGates.every(({ status, command, reason }) => (
      status === "waived" && command.startsWith("pnpm run ") && reason.length > 40
    ))).toBe(true);
    expect(report.summary.waiverCount).toBeGreaterThanOrEqual(4);
  });

  it("fails visibly with metric, limit and reason when a continuous carrier exposes huge gaps", () => {
    const base = materializeAllStudioBrushPackSelections()[0]!;
    const pathological: StudioCompetitiveBrushQualityCandidate = {
      ...base,
      catalogId: "test-pathological-spacing",
      catalogName: "Pathological spacing",
      source: "pro",
      category: "line",
      previewStyle: "solid",
      defaultWidth: 1,
      brushDynamics: {
        ...base.brushDynamics,
        depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
        width: {
          ...base.brushDynamics.width,
          base: 1,
          min: 1,
          max: 1,
          mappings: [],
          jitter: null,
        },
        spacingRatio: null,
        spacing: {
          ...base.brushDynamics.spacing,
          base: 4_096,
          min: 4_096,
          max: 4_096,
          mappings: [],
          jitter: null,
        },
      },
    };
    const failed = benchmarkStudioCompetitiveBrushQuality([pathological], {
      expectedPresetCount: 1,
      tier: "deep",
      classifications: [{
        catalogId: pathological.catalogId,
        renderStrategy: "dynamic-dab",
        renderFamily: "pen",
        intentionalDiscontinuity: false,
      }],
    });

    expect(failed.ok).toBe(false);
    expect(failed.results).toHaveLength(1);
    expect(failed.results[0]!.status).toBe("fail");
    expect(failed.results[0]!.findings).toContainEqual(expect.objectContaining({
      level: "error",
      code: "carrier-gap",
      metric: "maxCarrierGapRatio",
      actual: expect.any(Number),
      limit: 1,
      reason: expect.stringContaining("continuous brush"),
    }));
    expect(failed.externalGates.every(({ status }) => status === "required")).toBe(true);
  }, 15_000);
});
