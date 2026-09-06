import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { STUDIO_BRUSH_CATALOG_COUNTS } from "../apps/web/src/domains/creator/brush/studio-brush-catalog-core";
import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "../apps/web/src/domains/creator/brush/studio-brush-pack-index";
import { materializeAllStudioBrushPackSelections } from "../apps/web/src/domains/creator/brush/studio-brush-pack-runtime";
import {
  auditStudioBrushPlannerQualityCatalogue,
  type StudioBrushPlannerQualityCandidate,
} from "../apps/web/src/domains/creator/brush/studio-brush-planner-quality-audit";
import { studioCoreBrushCatalogSelection } from "../apps/web/src/domains/creator/brush/studio-brush-selection";
import { BRUSH_PRESETS } from "../apps/web/src/domains/creator/studio-brush";

import {
  benchmarkStudioCompetitiveBrushQuality,
  type StudioCompetitiveBrushQualityCandidate,
  type StudioCompetitiveBrushQualityTier,
} from "./studio-brush-competitive-quality-benchmark";

const OUTPUT_ROOT = resolve(
  process.env.TOONSPECTRUM_BRUSH_QUALITY_VERIFY_DIR?.trim()
    || join(tmpdir(), `toonspectrum-brush-planner-quality-${Date.now()}`),
);
const REPORT_PATH = join(OUTPUT_ROOT, "studio-brush-planner-quality-report.json");

function log(message: string): void {
  process.stdout.write(`[verify-studio-brush-planner-quality] ${message}\n`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function shippedCandidates(): (
  StudioBrushPlannerQualityCandidate & StudioCompetitiveBrushQualityCandidate
)[] {
  const core = BRUSH_PRESETS.map((preset) => ({
    ...studioCoreBrushCatalogSelection(preset),
    source: "core" as const,
  }));
  const professional = materializeAllStudioBrushPackSelections();
  return [
    ...core,
    ...professional.map((selection, index) => ({
      ...selection,
      source: "pro" as const,
      category: STUDIO_BRUSH_PACK_DESCRIPTORS[index]!.category,
      previewStyle: STUDIO_BRUSH_PACK_DESCRIPTORS[index]!.previewStyle,
    })),
  ];
}

function competitiveQualityTier(): StudioCompetitiveBrushQualityTier {
  return process.env.TOONSPECTRUM_BRUSH_QUALITY_TIER?.trim().toLowerCase() === "deep"
    ? "deep"
    : "ci";
}

function main(): void {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const started = performance.now();
  const candidates = shippedCandidates();
  const audit = auditStudioBrushPlannerQualityCatalogue(candidates);
  const competitiveQuality = benchmarkStudioCompetitiveBrushQuality(candidates, {
    tier: competitiveQualityTier(),
    classifications: audit.results.map((result) => ({
      catalogId: result.catalogId,
      renderStrategy: result.renderStrategy,
      renderFamily: result.renderFamily,
      intentionalDiscontinuity: result.intentionalDiscontinuity,
    })),
  });
  const report = {
    kind: "toonspectrum-studio-brush-planner-quality-v1",
    generatedAt: new Date().toISOString(),
    runtimeMs: performance.now() - started,
    outputRoot: OUTPUT_ROOT,
    policy: {
      shippedPresetCount: STUDIO_BRUSH_CATALOG_COUNTS.total,
      firstTapPeakChannelDeltaFloor: 4.5,
      continuousFirstTapPeakChannelDeltaFloor: 12,
      continuousCurveGapRatioMaximum: 1,
      continuousDensitySpanMaximum: 2.5,
      minimumMeanEffectiveAlpha: 0.05,
      exactFingerprintGroupsMaximum: 0,
      perceptualFingerprintGroupsMaximum: 0,
      warningCountMaximum: 0,
      competitiveQualityTier: competitiveQuality.tier,
    },
    summary: {
      presetCount: audit.results.length,
      errorCount: audit.errorCount,
      warningCount: audit.warningCount,
      exactFingerprintGroupCount: audit.exactFingerprintGroups.length,
      perceptualFingerprintGroupCount: audit.perceptualFingerprintGroups.length,
      competitiveRepresentativeCount: competitiveQuality.summary.representativeCount,
      competitiveMeasuredCount: competitiveQuality.summary.measuredCount,
      competitiveErrorCount: competitiveQuality.summary.errorCount,
      competitiveWarningCount: competitiveQuality.summary.warningCount,
      competitiveWaiverCount: competitiveQuality.summary.waiverCount,
      competitiveMaximumSourceSampleCount:
        competitiveQuality.summary.maximumSourceSampleCount,
    },
    worstOffenders: audit.rankedWorst.slice(0, 32),
    competitiveQuality,
    ...audit,
    ok:
      candidates.length === STUDIO_BRUSH_CATALOG_COUNTS.total
      && audit.results.length === STUDIO_BRUSH_CATALOG_COUNTS.total
      && audit.ok
      && audit.warningCount === 0
      && audit.exactFingerprintGroups.length === 0
      && audit.perceptualFingerprintGroups.length === 0
      && competitiveQuality.ok,
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  log(
    `${report.summary.presetCount} presets · `
    + `${report.summary.errorCount} errors · `
    + `${report.summary.warningCount} warnings · `
    + `${report.summary.exactFingerprintGroupCount} exact collisions · `
    + `${report.summary.perceptualFingerprintGroupCount} perceptual collisions`,
  );
  log(
    `competitive ${competitiveQuality.tier}: `
    + `${report.summary.competitiveMeasuredCount}/${report.summary.presetCount} measured · `
    + `${report.summary.competitiveErrorCount} errors · `
    + `${report.summary.competitiveWarningCount} warnings · `
    + `${report.summary.competitiveWaiverCount} explicit waivers · `
    + `${report.summary.competitiveMaximumSourceSampleCount} max source samples`,
  );
  for (const result of competitiveQuality.results
    .filter(({ findings }) => findings.length > 0)
    .slice(0, 12)) {
    log(
      `${result.catalogId}: ${result.status} · `
      + result.findings.map((finding) => (
        `${finding.level}/${finding.code}`
        + (finding.actual === undefined ? "" : `=${String(finding.actual)}`)
      )).join(", "),
    );
  }
  for (const result of report.worstOffenders.slice(0, 12)) {
    log(
      `${result.catalogId}: risk ${result.riskScore.toFixed(2)} · `
      + `tap Δ${result.tap.peakChannelDelta.toFixed(2)} · `
      + `gap ${result.curve.worstGapRatio.toFixed(3)}× · `
      + `spacing ${result.curve.spacingDiameterRatio.toFixed(3)}× · `
      + `density ${result.speed.densitySpan.toFixed(2)}× · `
      + `alpha ${result.opacity.minimumMeanEffectiveAlpha.toFixed(3)}`,
    );
  }
  log(`report ${REPORT_PATH}`);
  invariant(report.ok, "Studio brush planner quality gate failed; inspect its JSON report");
  log(`ALL ${STUDIO_BRUSH_CATALOG_COUNTS.total} SHIPPED BRUSH PLANNER QUALITY GATES OK`);
}

try {
  main();
} catch (error) {
  log(`FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
}
