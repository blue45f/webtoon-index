import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import {
  classifyStudioBrushBackendQuality,
} from "./studio-brush-backend-quality-policy";
import {
  auditStudioBrushCatalogueContinuity,
  type StudioBrushContinuityAuditCandidate,
} from "./studio-brush-continuity-audit";
import {
  planNormalizedStudioDynamicBrushDabs,
  resolveStudioBrushDynamicsPresetId,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
} from "./studio-brush-dynamics";
import {
  STUDIO_BRUSH_PACK_DESCRIPTORS,
} from "./studio-brush-pack-index";
import {
  materializeAllStudioBrushPackSelections,
} from "./studio-brush-pack-runtime";
import {
  studioCoreBrushCatalogSelection,
} from "./studio-brush-selection";
import {
  bridgeStudioDynamicDabsToDryMediaV1,
} from "./studio-dry-media-dynamic-bridge";

function catalogueCandidates(): StudioBrushContinuityAuditCandidate[] {
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

function figureEightSamples(pointCount: number, turns = 4): {
  readonly points: readonly number[];
  readonly pressures: readonly number[];
  readonly speeds: readonly number[];
} {
  const points: number[] = [];
  const pressures: number[] = [];
  const speeds: number[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    const progress = pointCount <= 1 ? 0 : index / (pointCount - 1);
    const angle = progress * Math.PI * 2 * turns;
    points.push(
      256 + Math.sin(angle) * 180,
      256 + Math.sin(angle) * Math.cos(angle) * 118,
    );
    pressures.push(0.38 + (Math.sin(angle * 0.5) + 1) * 0.26);
    speeds.push(0.15 + (Math.cos(angle * 0.25) + 1) * 0.7);
  }
  return { points, pressures, speeds };
}

const CANDIDATES = catalogueCandidates();
const RESULTS = auditStudioBrushCatalogueContinuity(CANDIDATES);

describe("full catalogue crossing and long-stroke matrix", () => {
  it("classifies every core and professional brush into an explicit live/commit family", () => {
    expect(CANDIDATES).toHaveLength(CANDIDATES.length);
    for (const candidate of CANDIDATES) {
      const classification = classifyStudioBrushBackendQuality({
        brushId: candidate.runtimeBrushId,
        catalogId: candidate.catalogId,
      });
      expect(
        classification.status,
        `${candidate.catalogId}: missing quality route`,
      ).toBe("classified");
      if (classification.status !== "classified") continue;
      expect(classification.policy.parity).toMatchObject({
        requirement: "explicit-live-commit-pair",
        source: "same-authoritative-samples",
        recipe: "same-versioned-recipe",
        seed: "same-persisted-seed",
      });
      expect(
        classification.policy.forbiddenFallbacks,
        `${candidate.catalogId}: family permits silent substitution`,
      ).toContain("silent-backend-substitution");
    }
  });

  it("keeps soft smoke/cloud effects in the continuous audit instead of hiding them as particles", () => {
    const byId = new Map(RESULTS.map((result) => [result.catalogId, result]));
    for (const catalogId of [
      "cloud-billow-soft",
      "smoke-wisp-layered",
      "cloud-cirrus-stream",
    ]) {
      const result = byId.get(catalogId);
      expect(result, catalogId).toBeDefined();
      expect(result?.intentionalDiscontinuity, catalogId).toBe(false);
      for (const profile of result?.profiles ?? []) {
        expect(
          profile.maxRenderedCarrierGapRatio,
          `${catalogId}/${profile.speed}: circular carrier lattice`,
        ).toBeLessThanOrEqual(1);
      }
    }

    // Authored ray/particle motifs remain exempt; this is not a blanket relaxation for FX.
    expect(byId.get("focus-ray-streak")?.intentionalDiscontinuity).toBe(true);
    expect(byId.get("sparkle-glint-cross")?.intentionalDiscontinuity).toBe(true);
  });

  it.each(["pastel", "oil-pastel"] as const)(
    "routes core %s through causal anisotropic fibres instead of the repeated ellipse specialist",
    (brushId) => {
      const preset = BRUSH_PRESETS.find(({ id }) => id === brushId);
      expect(preset).toBeDefined();
      if (!preset) return;
      const selection = studioCoreBrushCatalogSelection(preset);
      const dynamics = selection.brushDynamics;

      expect(resolveStudioBrushDynamicsPresetId(brushId)).toBe("dry-media");
      expect(dynamics?.depositPipeline).toBe(
        STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      );
      expect(dynamics).not.toBeNull();
      if (!dynamics) return;

      const source = figureEightSamples(2_049);
      const dabs = planNormalizedStudioDynamicBrushDabs({
        ...source,
        baseOpacity: 1,
        baseWidth: selection.defaultWidth,
        maxDabs: 4_096,
        seed: dynamics.seed,
      }, dynamics);
      const material = bridgeStudioDynamicDabsToDryMediaV1({
        brushId,
        seed: dynamics.seed,
        dabs,
      });

      expect(dabs.length).toBeGreaterThan(1_000);
      expect(dabs.length).toBeLessThanOrEqual(4_096);
      expect(material.ok).toBe(true);
      if (!material.ok) return;
      expect(material.receipt.presetId).toBe("pastel");
      expect(material.receipt.laneCount).toBe(5);
      expect(material.receipt.marks).toHaveLength(dabs.length * 5);
      expect(
        new Set(material.receipt.marks.map(({ shape }) => shape)),
      ).toEqual(new Set(["soft-pigment-fiber"]));
      expect(material.receipt.marks.every((mark) => (
        mark.radiusX / mark.radiusY >= 3 - 1e-10
      ))).toBe(true);
    },
  );

  it("keeps anisotropic long-stroke work linear and bounded by one fixed material constant", () => {
    const selection = studioCoreBrushCatalogSelection(
      BRUSH_PRESETS.find(({ id }) => id === "pastel")!,
    );
    const dynamics = selection.brushDynamics!;
    const emitted = [
      { pointCount: 257, turns: 1 },
      { pointCount: 1_025, turns: 4 },
      { pointCount: 4_097, turns: 16 },
    ].map(({ pointCount, turns }) => {
      const dabs = planNormalizedStudioDynamicBrushDabs({
        ...figureEightSamples(pointCount, turns),
        baseOpacity: 1,
        baseWidth: selection.defaultWidth,
        maxDabs: 4_096,
        seed: dynamics.seed,
      }, dynamics);
      const material = bridgeStudioDynamicDabsToDryMediaV1({
        brushId: "pastel",
        seed: dynamics.seed,
        dabs,
      });
      expect(material.ok).toBe(true);
      if (!material.ok) throw new Error(material.reason);
      return {
        dabs: dabs.length,
        marks: material.receipt.marks.length,
      };
    });

    for (const work of emitted) {
      expect(work.dabs).toBeLessThanOrEqual(4_096);
      expect(work.marks).toBe(work.dabs * 5);
      expect(work.marks).toBeLessThanOrEqual(20_480);
    }
    expect(emitted[1]!.marks).toBeGreaterThan(emitted[0]!.marks);
    expect(emitted[2]!.marks).toBeGreaterThan(emitted[1]!.marks);
  });
});
