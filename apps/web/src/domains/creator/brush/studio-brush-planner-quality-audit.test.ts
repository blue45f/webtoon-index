import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "./studio-brush-pack-index";
import { materializeAllStudioBrushPackSelections } from "./studio-brush-pack-runtime";
import {
  auditStudioBrushPlannerQualityCatalogue,
  type StudioBrushPlannerQualityCandidate,
} from "./studio-brush-planner-quality-audit";
import { studioCoreBrushCatalogSelection } from "./studio-brush-selection";

function shippedCandidates(): StudioBrushPlannerQualityCandidate[] {
  const core = BRUSH_PRESETS.map(studioCoreBrushCatalogSelection);
  const professional = materializeAllStudioBrushPackSelections();
  return [
    ...core,
    ...professional.map((selection, index) => ({
      ...selection,
      category: STUDIO_BRUSH_PACK_DESCRIPTORS[index]!.category,
      previewStyle: STUDIO_BRUSH_PACK_DESCRIPTORS[index]!.previewStyle,
    })),
  ];
}

const SHIPPED_CANDIDATES = shippedCandidates();
const SHIPPED_REPORT = auditStudioBrushPlannerQualityCatalogue(SHIPPED_CANDIDATES);

describe("studio brush planner quality audit", () => {
  it("deterministically audits every shipped preset without planner failures", () => {
    const replay = auditStudioBrushPlannerQualityCatalogue(SHIPPED_CANDIDATES);

    expect(SHIPPED_CANDIDATES).toHaveLength(SHIPPED_CANDIDATES.length);
    expect(SHIPPED_REPORT.results).toHaveLength(SHIPPED_CANDIDATES.length);
    expect(new Set(SHIPPED_REPORT.results.map((result) => result.catalogId)).size).toBe(SHIPPED_CANDIDATES.length);
    expect(replay).toEqual(SHIPPED_REPORT);
    expect(SHIPPED_REPORT).toMatchObject({
      errorCount: 0,
      warningCount: 0,
      ok: true,
    });
  });

  it("keeps every first tap visible and every continuous curved path overlap-safe", () => {
    for (const result of SHIPPED_REPORT.results) {
      expect(result.tap.markCount, `${result.catalogId}: tap has no mark`).toBeGreaterThan(0);
      expect(
        result.tap.peakChannelDelta,
        `${result.catalogId}: tap disappears on white paper`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        result.opacity.minimumMeanEffectiveAlpha,
        `${result.catalogId}: pigment falls below the planner floor`,
      ).toBeGreaterThanOrEqual(0.05);
      if (result.intentionalDiscontinuity) continue;
      expect(
        result.tap.peakChannelDelta,
        `${result.catalogId}: continuous medium has a weak first tap`,
      ).toBeGreaterThanOrEqual(12);
      expect(
        result.curve.worstGapRatio,
        `${result.catalogId}: curve exposes a diameter-sized gap`,
      ).toBeLessThanOrEqual(1);
      expect(
        result.curve.spacingDiameterRatio,
        `${result.catalogId}: spacing exceeds its useful tip diameter`,
      ).toBeLessThanOrEqual(1);
      expect(
        result.curve.worstRenderedCarrierGapRatio,
        `${result.catalogId}: rendered carriers bead after scatter`,
      ).toBeLessThanOrEqual(1);
      expect(
        result.speed.densitySpan,
        `${result.catalogId}: speed collapses planner density`,
      ).toBeLessThanOrEqual(2.5);
    }
  });

  it("keeps exact and perceptually quantized planner fingerprints distinct", () => {
    expect(SHIPPED_REPORT.exactFingerprintGroups).toEqual([]);
    expect(SHIPPED_REPORT.perceptualFingerprintGroups).toEqual([]);
    expect(new Set(
      SHIPPED_REPORT.results.map((result) => result.exactFingerprint),
    ).size).toBe(SHIPPED_CANDIDATES.length);
    expect(new Set(
      SHIPPED_REPORT.results.map((result) => result.perceptualFingerprint),
    ).size).toBe(SHIPPED_CANDIDATES.length);
  });

  it("raises the weakest soft-media taps without flattening their low-opacity intent", () => {
    const tunedIds = [
      "bleeding-stain",
      "cotton-fiber",
      "watercolor-backrun-ring",
      "watercolor-dry-granule",
      "watercolor-edge-stain",
      "watercolor-flat-wash",
      "watercolor-wet-wash",
    ] as const;
    const byId = new Map(
      SHIPPED_REPORT.results.map((result) => [result.catalogId, result]),
    );

    for (const catalogId of tunedIds) {
      const result = byId.get(catalogId)!;
      expect(result.tap.peakChannelDelta, `${catalogId}: visibility tuning regressed`)
        .toBeGreaterThanOrEqual(12);
      expect(result.opacity.maximumMeanEffectiveAlpha, `${catalogId}: wash became opaque`)
        .toBeLessThan(0.3);
      expect(result.curve.worstGapRatio, `${catalogId}: tuning opened curve gaps`)
        .toBeLessThan(0.4);
    }
  });
});
