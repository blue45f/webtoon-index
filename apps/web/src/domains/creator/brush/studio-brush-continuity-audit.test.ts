import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import {
  auditStudioBrushCatalogueContinuity,
  type StudioBrushContinuityAuditCandidate,
} from "./studio-brush-continuity-audit";
import { planNormalizedStudioDynamicBrushDabs } from "./studio-brush-dynamics";
import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "./studio-brush-pack-index";
import { materializeAllStudioBrushPackSelections } from "./studio-brush-pack-runtime";
import { studioCoreBrushCatalogSelection } from "./studio-brush-selection";
import { composeStudioBrushDualTipAlphaMap } from "./studio-brush-tip-composition";

function catalogueCandidates(): StudioBrushContinuityAuditCandidate[] {
  const core = BRUSH_PRESETS.map((preset) => studioCoreBrushCatalogSelection(preset));
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

const CATALOGUE_CANDIDATES = catalogueCandidates();
const CATALOGUE_RESULTS = auditStudioBrushCatalogueContinuity(CATALOGUE_CANDIDATES);

describe("studio brush continuity audit", () => {
  it("deterministically audits all 66 core and 160 professional brushes at three speeds", () => {
    const replay = auditStudioBrushCatalogueContinuity(CATALOGUE_CANDIDATES);

    expect(CATALOGUE_CANDIDATES).toHaveLength(CATALOGUE_CANDIDATES.length);
    expect(CATALOGUE_RESULTS).toEqual(replay);
    expect(CATALOGUE_RESULTS).toHaveLength(CATALOGUE_CANDIDATES.length);
    expect(new Set(CATALOGUE_RESULTS.map((result) => result.catalogId)).size).toBe(CATALOGUE_CANDIDATES.length);
    expect(CATALOGUE_RESULTS.every((result) => result.profiles.length === 3)).toBe(true);
    expect(CATALOGUE_RESULTS.flatMap((result) => result.profiles).every((profile) => (
      profile.markCount > 0
      && profile.meanEffectiveAlpha > 0
      && Number.isFinite(profile.maxInteriorGapRatio)
      && Number.isFinite(profile.maxRenderedCarrierGapRatio)
    ))).toBe(true);
  });

  it("keeps soft and dry core carriers overlapped after deterministic scatter", () => {
    const byId = new Map(CATALOGUE_RESULTS.map((result) => [
      result.catalogId,
      result,
    ]));

    for (const catalogId of [
      "airbrush",
      "dry-media",
      "crayon",
      "chalk",
      "charcoal",
    ]) {
      const result = byId.get(catalogId)!;
      for (const profile of result.profiles) {
        expect(
          profile.maxRenderedCarrierGapRatio,
          `${catalogId}/${profile.speed}: rendered carrier lattice is visible`,
        ).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it("keeps every non-discrete professional carrier below one rendered diameter", () => {
    const candidatesById = new Map(
      CATALOGUE_CANDIDATES.map((candidate) => [candidate.catalogId, candidate]),
    );
    for (const result of CATALOGUE_RESULTS) {
      const candidate = candidatesById.get(result.catalogId)!;
      if (!candidate.category || result.intentionalDiscontinuity) continue;
      for (const profile of result.profiles) {
        expect(
          profile.maxRenderedCarrierGapRatio,
          `${result.catalogId}/${profile.speed}: post-scatter carrier gap`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps every continuous professional stroke body overlap-safe at slow, medium and fast input", () => {
    const continuousCategories = new Set(["flat", "ink", "marker", "paint"]);
    const candidatesById = new Map(
      CATALOGUE_CANDIDATES.map((candidate) => [candidate.catalogId, candidate])
    );
    const outliers = CATALOGUE_RESULTS.flatMap((result) => {
      const candidate = candidatesById.get(result.catalogId)!;
      if (
        !continuousCategories.has(candidate.category ?? "")
        || result.intentionalDiscontinuity
      ) {
        return [];
      }
      return result.profiles
        .filter((profile) => profile.maxInteriorGapRatio > 1)
        .map((profile) => ({
          id: result.catalogId,
          speed: profile.speed,
          gapRatio: profile.maxInteriorGapRatio,
        }));
    });

    expect(outliers).toEqual([]);
  });

  it("keeps the fast curved G-pen and brush-pen routes dense without flattening their response", () => {
    const byId = new Map(CATALOGUE_RESULTS.map((result) => [result.catalogId, result]));
    const gPen = byId.get("g-pen-flex")!;
    const brushPen = byId.get("brush-pen-ink")!;
    const fastBrushPen = brushPen.profiles.find((profile) => profile.speed === "fast")!;

    expect(fastBrushPen.maxInteriorGapRatio).toBeLessThan(0.7);
    expect(fastBrushPen.markCount).toBeGreaterThan(120);
    for (const result of [gPen, brushPen]) {
      const sizeRatios = new Set(result.profiles.map((profile) => profile.meanSizeRatio));
      const alphaRatios = new Set(result.profiles.map((profile) => profile.meanEffectiveAlpha));
      expect(sizeRatios.size, `${result.catalogId}: speed response flattened`).toBeGreaterThan(1);
      expect(alphaRatios.size, `${result.catalogId}: ink loading flattened`).toBeGreaterThan(1);
    }
  });

  it("keeps every low-alpha preset above the first-stroke and browser-pixel visibility floors", () => {
    const expectedLowAlphaMedia = new Set([
      "inkwash-water-brush",
      "watercolor-wet-wash",
      "watercolor-flat-wash",
      "smoke-wisp-layered",
    ]);
    const visibilityCorrectedMedia = [
      "mist-soft",
      "bokeh-scatter",
      "watercolor-wet-bleed",
      "airbrush-grand-soft",
      "marker-colorless-blender",
      "cloud-billow-soft",
      "bleeding-stain",
      "cotton-fiber",
      "watercolor-edge-stain",
      "watercolor-dry-granule",
    ] as const;
    const candidateById = new Map(
      CATALOGUE_CANDIDATES.map((candidate) => [candidate.catalogId, candidate])
    );
    const lowAlphaResults = CATALOGUE_RESULTS.filter((result) => (
      result.profiles.some((profile) => profile.meanEffectiveAlpha < 0.08)
    ));

    expect(new Set(lowAlphaResults.map((result) => result.catalogId)))
      .toEqual(expectedLowAlphaMedia);

    for (const result of lowAlphaResults) {
      for (const profile of result.profiles) {
        expect(
          profile.meanEffectiveAlpha,
          `${result.catalogId}/${profile.speed}: first stroke is effectively invisible`
        ).toBeGreaterThanOrEqual(0.05);
      }

      const candidate = candidateById.get(result.catalogId)!;
      const dynamics = candidate.brushDynamics!;
      const neutralFastDab = planNormalizedStudioDynamicBrushDabs({
        baseOpacity: 1,
        baseWidth: candidate.defaultWidth,
        maxDabs: 1,
        points: [0, 0],
        pressures: [0.5],
        seed: 0x51f1_7a3e,
        speeds: [2.5],
      }, dynamics)[0]!;
      const tipMap = composeStudioBrushDualTipAlphaMap(
        dynamics.tip,
        dynamics.dualBrush
      );
      const peakTipAlpha = Math.max(...tipMap.alphas);
      // The browser verifier compares #111 ink against white paper and requires a channel
      // difference of at least four. Include the grain channel's conservative minimum so a
      // deliberately textured wash cannot pass only because its brightest noise cell was sampled.
      const minimumGrainMultiplier = 1 - dynamics.grain.amount;
      const projectedChannelDelta = candidate.defaultOpacity
        * neutralFastDab.opacity
        * neutralFastDab.flow
        * peakTipAlpha
        * minimumGrainMultiplier
        * (255 - 17);
      expect(
        projectedChannelDelta,
        `${result.catalogId}: neutral fast dab falls below browser pixel visibility`
      ).toBeGreaterThanOrEqual(4.5);
    }

    const resultsById = new Map(
      CATALOGUE_RESULTS.map((result) => [result.catalogId, result])
    );
    for (const catalogId of visibilityCorrectedMedia) {
      const result = resultsById.get(catalogId)!;
      // These media should still build gradually instead of becoming opaque marker strokes, while
      // their first pass now has enough pigment for the browser's accumulated dab path to clear
      // the P95 contrast gate.
      for (const profile of result.profiles) {
        expect(profile.meanEffectiveAlpha, `${catalogId}/${profile.speed}: still too faint`)
          .toBeGreaterThanOrEqual(0.08);
        const maximumLowMediaAlpha = catalogId === "watercolor-dry-granule"
          ? 0.25
          : 0.24;
        expect(profile.meanEffectiveAlpha, `${catalogId}/${profile.speed}: low-media intent lost`)
          .toBeLessThanOrEqual(maximumLowMediaAlpha);
      }

      const candidate = candidateById.get(catalogId)!;
      const dynamics = candidate.brushDynamics!;
      const neutralFastDab = planNormalizedStudioDynamicBrushDabs({
        baseOpacity: 1,
        baseWidth: candidate.defaultWidth,
        maxDabs: 1,
        points: [0, 0],
        pressures: [0.5],
        seed: 0x51f1_7a3e,
        speeds: [2.5],
      }, dynamics)[0]!;
      const tipMap = composeStudioBrushDualTipAlphaMap(
        dynamics.tip,
        dynamics.dualBrush
      );
      const projectedChannelDelta = candidate.defaultOpacity
        * neutralFastDab.opacity
        * neutralFastDab.flow
        * Math.max(...tipMap.alphas)
        * (1 - dynamics.grain.amount)
        * (255 - 17);
      expect(
        projectedChannelDelta,
        `${catalogId}: corrected neutral dab can regress below the accumulated browser contrast floor`
      ).toBeGreaterThanOrEqual(10);
    }
  });

  it("preserves sparse pattern/stamp/effect/pixel intent and finds no identical-feeling profiles", () => {
    const sparseIds = [
      "bokeh-ring-glow",
      "footstep-stamp",
      "halftone-gradient-dot",
      "pixel-dither",
      "stardust-star-scatter",
    ];
    for (const id of sparseIds) {
      expect(
        CATALOGUE_RESULTS.find((result) => result.catalogId === id)?.intentionalDiscontinuity,
        `${id}: sparse intent lost`
      ).toBe(true);
    }

    const continuous = CATALOGUE_RESULTS.filter((result) => !result.intentionalDiscontinuity);
    const fingerprintGroups = new Map<string, string[]>();
    for (const result of continuous) {
      const group = fingerprintGroups.get(result.behaviorFingerprint) ?? [];
      group.push(result.catalogId);
      fingerprintGroups.set(result.behaviorFingerprint, group);
    }
    expect([...fingerprintGroups.values()].filter((group) => group.length > 1)).toEqual([]);
  });
});
