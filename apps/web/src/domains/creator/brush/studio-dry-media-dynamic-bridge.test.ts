import { describe, expect, it } from "vitest";

import {
  STUDIO_DRY_MEDIA_ANISOTROPIC_CATALOG_PRESETS_V1,
  STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1,
} from "./studio-dry-media-anisotropic-grain-v1";
import {
  bridgeStudioDynamicDabVariationToDryMediaV1,
  bridgeStudioDynamicDabsToDryMediaV1,
  resolveStudioDynamicBrushMaterialIdentity,
  studioDryMediaDynamicBridgeMarkMultiplier,
} from "./studio-dry-media-dynamic-bridge";

import type { StudioDynamicBrushDab } from "./studio-brush-dynamics";

function dynamicDabs(
  count: number,
  spacing = 2.2,
): StudioDynamicBrushDab[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    progress: count <= 1 ? 0 : index / (count - 1),
    sourceX: index * spacing,
    sourceY: Math.sin(index / 31) * 5,
    x: index * spacing,
    y: Math.sin(index / 31) * 5,
    size: 18 + Math.sin(index / 17) * 2,
    opacity: 0.36 + (index % 5) * 0.04,
    flow: 0.54 + (index % 7) * 0.035,
    spacing,
    scatter: 0,
    angle: 0,
    roundness: 0.85,
  }));
}

function requireBridge(
  brushId: string,
  dabs = dynamicDabs(96),
) {
  const result = bridgeStudioDynamicDabsToDryMediaV1({
    brushId,
    seed: 0x5eed_cafe,
    dabs,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.receipt;
}

describe("dry-media dynamic bridge v1", () => {
  it("lowers the four core media to materially distinct anisotropic coverage", () => {
    const receipts = (
      ["crayon", "charcoal", "chalk", "pastel"] as const
    ).map((brushId) => requireBridge(brushId));
    const signatures = receipts.map((receipt) => {
      const mark = receipt.marks[17]!;
      return JSON.stringify([
        receipt.presetId,
        mark.shape,
        mark.radiusX.toFixed(5),
        mark.radiusY.toFixed(5),
        mark.angleRadians.toFixed(5),
        mark.coverageScale.toFixed(5),
      ]);
    });

    expect(new Set(signatures).size).toBe(4);
    for (const receipt of receipts) {
      const preset = STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1[receipt.presetId];
      expect([3, 5]).toContain(receipt.laneCount);
      expect(receipt.adjustedDabs).toHaveLength(96 * receipt.laneCount);
      expect(receipt.marks).toHaveLength(96 * receipt.laneCount);
      for (let sourceDabIndex = 0; sourceDabIndex < 96; sourceDabIndex += 1) {
        const lanes = receipt.marks.filter(
          (mark) => mark.sourceDabIndex === sourceDabIndex,
        );
        expect(lanes.map((mark) => mark.laneIndex)).toEqual(
          Array.from({ length: receipt.laneCount }, (_, laneIndex) => laneIndex),
        );
        expect(lanes.every((mark) => mark.laneCount === receipt.laneCount))
          .toBe(true);
      }
      expect(receipt.marks.every((mark) => (
        mark.shape === preset.shape
        && mark.radiusX / mark.radiusY
          >= preset.minimumAspectRatio - 1e-8
      ))).toBe(true);
    }
  });

  it("uses already pressure-resolved dab channels exactly once", () => {
    const source = dynamicDabs(8);
    const receipt = requireBridge("charcoal", source);

    for (const [index, adjusted] of receipt.adjustedDabs.entries()) {
      const mark = receipt.marks[index]!;
      const original = source[mark.sourceDabIndex]!;
      expect(adjusted.opacity).toBe(original.opacity);
      expect(mark.opacity).toBe(original.opacity);
      expect(mark.flow).toBe(original.flow);
      expect(adjusted.flow).toBeCloseTo(
        original.flow * mark.coverageScale,
        12,
      );
      expect(mark.alpha).toBeCloseTo(
        original.opacity * original.flow * mark.coverageScale,
        12,
      );
    }
  });

  it("keeps dense long-stroke fibres overlapping and every accepted prefix byte-stable", () => {
    const source = dynamicDabs(4_096, 2.1);
    const prefix = requireBridge("pastel", source.slice(0, 1_337));
    const complete = requireBridge("pastel", source);
    const prefixMarkCount = prefix.sourceDabCount * prefix.laneCount;

    expect(complete.adjustedDabs.slice(0, prefixMarkCount)).toEqual(
      prefix.adjustedDabs,
    );
    expect(complete.marks.slice(0, prefixMarkCount)).toEqual(prefix.marks);
    let maximumSupportGap = 0;
    for (let laneIndex = 0; laneIndex < complete.laneCount; laneIndex += 1) {
      const laneMarks = complete.marks.filter(
        (mark) => mark.laneIndex === laneIndex,
      );
      for (let index = 1; index < laneMarks.length; index += 1) {
        const previous = laneMarks[index - 1]!;
        const current = laneMarks[index]!;
        const gap = Math.hypot(
          current.x - previous.x,
          current.y - previous.y,
        );
        maximumSupportGap = Math.max(
          maximumSupportGap,
          gap / Math.max(0.25, previous.radiusX + current.radiusX),
        );
      }
    }
    expect(maximumSupportGap).toBeLessThan(1);

    const chunked = [
      source.slice(0, 311),
      source.slice(311, 1_337),
      source.slice(1_337, 2_971),
      source.slice(2_971),
    ].flatMap((chunk) => requireBridge("pastel", chunk).adjustedDabs);
    expect(chunked).toEqual(complete.adjustedDabs);
  });

  it("keeps every product lane continuous and suppresses exposed confetti-sized gaps", () => {
    for (const brushId of [
      "crayon",
      "charcoal",
      "chalk",
      "pastel",
    ] as const) {
      const expectedLaneCount = 5;
      const source = dynamicDabs(384, 1.8);
      const receipt = requireBridge(brushId, source);
      expect(receipt.laneCount).toBe(expectedLaneCount);

      let maximumLaneJumpRatio = 0;
      let maximumBandGapRatio = 0;
      for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
        const sourceDab = source[sourceIndex]!;
        const station = receipt.marks
          .filter((mark) => mark.sourceDabIndex === sourceIndex)
          .toSorted((left, right) => left.y - right.y);
        expect(station).toHaveLength(expectedLaneCount);
        for (let laneIndex = 1; laneIndex < station.length; laneIndex += 1) {
          const previous = station[laneIndex - 1]!;
          const current = station[laneIndex]!;
          const gap = current.y - current.radiusY
            - (previous.y + previous.radiusY);
          maximumBandGapRatio = Math.max(
            maximumBandGapRatio,
            gap / sourceDab.size,
          );
        }
      }
      for (let laneIndex = 0; laneIndex < receipt.laneCount; laneIndex += 1) {
        const lane = receipt.marks.filter((mark) => mark.laneIndex === laneIndex);
        for (let index = 1; index < lane.length; index += 1) {
          const previous = lane[index - 1]!;
          const current = lane[index]!;
          const sourceDab = source[current.sourceDabIndex]!;
          const sourcePrevious = source[previous.sourceDabIndex]!;
          const expectedDeltaY = sourceDab.y - sourcePrevious.y;
          maximumLaneJumpRatio = Math.max(
            maximumLaneJumpRatio,
            Math.abs((current.y - previous.y) - expectedDeltaY)
              / sourceDab.size,
          );
        }
      }

      // Large independent flakes required roughly 0.25-0.5 nib widths of station-local travel.
      // Product lanes now stay within fine paper-tooth scale and leave no macroscopic gap between
      // neighbouring pigment supports before the carrier applies deterministic negative grain.
      expect(maximumLaneJumpRatio, brushId).toBeLessThan(0.09);
      expect(maximumBandGapRatio, brushId).toBeLessThan(0.055);
    }
  });

  it("applies the same fine-grain continuity gate to every mapped catalogue dry medium", () => {
    const source = dynamicDabs(72, 1.8);
    for (const [catalogId, expectedPresetId] of Object.entries(
      STUDIO_DRY_MEDIA_ANISOTROPIC_CATALOG_PRESETS_V1,
    )) {
      const result = bridgeStudioDynamicDabsToDryMediaV1({
        brushId: "dry-media",
        brushCatalogId: catalogId,
        seed: 0x5eed_cafe,
        dabs: source,
      });
      expect(result.ok, catalogId).toBe(true);
      if (!result.ok) continue;
      const expectedLaneCount = 5;
      expect(result.receipt.presetId, catalogId).toBe(expectedPresetId);
      expect(result.receipt.laneCount, catalogId).toBe(expectedLaneCount);

      let maximumLaneJumpRatio = 0;
      let maximumBandGapRatio = 0;
      for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
        const sourceDab = source[sourceIndex]!;
        const station = result.receipt.marks
          .slice(sourceIndex * expectedLaneCount, (sourceIndex + 1) * expectedLaneCount)
          .toSorted((left, right) => left.y - right.y);
        for (let laneIndex = 1; laneIndex < station.length; laneIndex += 1) {
          const previous = station[laneIndex - 1]!;
          const current = station[laneIndex]!;
          const gap = current.y - current.radiusY
            - (previous.y + previous.radiusY);
          maximumBandGapRatio = Math.max(
            maximumBandGapRatio,
            gap / sourceDab.size,
          );
        }
      }
      for (let laneIndex = 0; laneIndex < result.receipt.laneCount; laneIndex += 1) {
        for (let sourceIndex = 1; sourceIndex < source.length; sourceIndex += 1) {
          const previous = result.receipt.marks[(sourceIndex - 1) * result.receipt.laneCount + laneIndex]!;
          const current = result.receipt.marks[sourceIndex * result.receipt.laneCount + laneIndex]!;
          const expectedDeltaY = source[sourceIndex]!.y - source[sourceIndex - 1]!.y;
          maximumLaneJumpRatio = Math.max(
            maximumLaneJumpRatio,
            Math.abs((current.y - previous.y) - expectedDeltaY)
              / source[sourceIndex]!.size,
          );
        }
      }

      expect(maximumLaneJumpRatio, catalogId).toBeLessThan(0.09);
      expect(maximumBandGapRatio, catalogId).toBeLessThan(0.055);
    }
  });

  it("preserves a visible multi-lane width for a tapered 7px coloured-pencil flick", () => {
    const shortStroke: StudioDynamicBrushDab[] = Array.from({ length: 9 }, (_, index) => ({
      index,
      progress: index / 8,
      sourceX: index * 2.5,
      sourceY: -index * 0.75,
      x: index * 2.5,
      y: -index * 0.75,
      size: Math.max(1, 7 * (1 - index / 8)),
      opacity: Math.max(0.2, 0.85 * (1 - index / 8)),
      flow: 0.8,
      spacing: 1.4,
      scatter: 0,
      angle: -15.95,
      roundness: 0.82,
    }));
    const result = bridgeStudioDynamicDabsToDryMediaV1({
      brushId: "dry-media",
      brushCatalogId: "pencil-colored-soft",
      seed: 0x5eed_cafe,
      dabs: shortStroke,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { laneCount, marks } = result.receipt;
    expect(laneCount).toBe(5);
    expect(marks).toHaveLength(shortStroke.length * laneCount);

    const tangentRadians = shortStroke[0]!.angle * Math.PI / 180;
    const normalX = -Math.sin(tangentRadians);
    const normalY = Math.cos(tangentRadians);
    let minimumNormal = Number.POSITIVE_INFINITY;
    let maximumNormal = Number.NEGATIVE_INFINITY;
    let estimatedPigmentArea = 0;
    let hasNegativeLane = false;
    let hasPositiveLane = false;
    for (const mark of marks) {
      const normalCenter = mark.x * normalX + mark.y * normalY;
      const relativeAngle = mark.angleRadians - tangentRadians;
      const normalSupport =
        Math.abs(mark.radiusX * Math.sin(relativeAngle))
        + Math.abs(mark.radiusY * Math.cos(relativeAngle));
      minimumNormal = Math.min(minimumNormal, normalCenter - normalSupport);
      maximumNormal = Math.max(maximumNormal, normalCenter + normalSupport);
      estimatedPigmentArea += Math.PI
        * mark.radiusX
        * mark.radiusY
        * mark.alpha
        * 0.78;
      hasNegativeLane ||= normalCenter < -0.25;
      hasPositiveLane ||= normalCenter > 0.25;
      expect(mark.radiusX / mark.radiusY).toBeGreaterThan(3);
    }

    // The former representative lane covered less than one physical pixel in the minor axis.
    // Multiple deterministic fibres now occupy both sides of the authored path, retain over half
    // of the selected 7px nib width and carry enough integrated pigment for a short click-flick.
    expect(hasNegativeLane).toBe(true);
    expect(hasPositiveLane).toBe(true);
    expect(maximumNormal - minimumNormal).toBeGreaterThan(3.5);
    expect(estimatedPigmentArea).toBeGreaterThan(4);
  });

  it("preserves causal-v3 segments while applying one explicit material identity", () => {
    const materialIdentity = resolveStudioDynamicBrushMaterialIdentity(
      "dry-media",
      "chalk-rough",
    );
    expect(materialIdentity).toMatchObject({
      brushId: "dry-media",
      brushCatalogId: "chalk-rough",
      dryMediaPresetId: "chalk",
    });
    if (!materialIdentity) throw new Error("missing material identity");
    const source = dynamicDabs(64);
    const segmented = bridgeStudioDynamicDabVariationToDryMediaV1({
      materialIdentity,
      seed: 19,
      variation: {
        kind: "studio-dynamic-brush-segmented-dab-variation",
        segments: [
          source.slice(0, 7),
          source.slice(7, 31),
          source.slice(31),
        ],
      },
    });
    const complete = bridgeStudioDynamicDabVariationToDryMediaV1({
      materialIdentity,
      seed: 19,
      variation: source,
    });
    expect(segmented.ok).toBe(true);
    expect(complete.ok).toBe(true);
    if (
      !segmented.ok
      || !complete.ok
      || !("segments" in segmented.variation)
    ) return;
    expect(segmented.applied).toBe(true);
    expect(segmented.variation.segments.flat()).toEqual(complete.variation);
  });

  it("passes pre-wave engine-lane strokes through as identity — null material, multiplier 1 (probe D1)", () => {
    // These runtime lane ids predate the wave and exist in persisted/collaborative documents.
    // Their material identity is null, so the bridge must return the authored dabs untouched;
    // resolving them onto a core preset would multiply every stored dab into 3–5 lanes.
    const source = dynamicDabs(24);
    for (const engineLaneId of [
      "crayon--wax-scrape",
      "charcoal--vine-soft",
      "charcoal--compressed-edge",
      "chalk--klecks-powder",
      "pastel--cake-soft",
      "oil-pastel--waxy-film",
    ]) {
      const materialIdentity =
        resolveStudioDynamicBrushMaterialIdentity(engineLaneId);
      expect(materialIdentity, engineLaneId).toMatchObject({
        brushId: engineLaneId,
        dryMediaPresetId: null,
      });
      if (!materialIdentity) throw new Error(`missing ${engineLaneId} identity`);
      expect(
        studioDryMediaDynamicBridgeMarkMultiplier(materialIdentity),
        engineLaneId,
      ).toBe(1);
      const bridged = bridgeStudioDynamicDabVariationToDryMediaV1({
        materialIdentity,
        seed: 19,
        variation: source,
      });
      expect(bridged.ok, engineLaneId).toBe(true);
      if (!bridged.ok) continue;
      expect(bridged.applied, engineLaneId).toBe(false);
      expect(bridged.variation, engineLaneId).toBe(source);
    }
  });

  it("keeps a stored core runtime id on its own material over the catalogue classification (probe D4)", () => {
    const materialIdentity = resolveStudioDynamicBrushMaterialIdentity(
      "chalk",
      "velvet-charcoal",
    );
    expect(materialIdentity).toMatchObject({
      brushId: "chalk",
      brushCatalogId: "velvet-charcoal",
      dryMediaPresetId: "chalk",
    });
    if (!materialIdentity) throw new Error("missing chalk identity");
    const receipt = bridgeStudioDynamicDabsToDryMediaV1({
      brushId: "chalk",
      brushCatalogId: "velvet-charcoal",
      seed: 19,
      dabs: dynamicDabs(24),
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(receipt.receipt.presetId).toBe("chalk");
  });

  it("keeps same-colour source-over self-overlap alpha monotonic", () => {
    const receipt = requireBridge("chalk", dynamicDabs(512, 0.4));
    let accumulatedAlpha = 0;
    for (const mark of receipt.marks) {
      const nextAlpha = mark.alpha
        + accumulatedAlpha * (1 - mark.alpha);
      expect(nextAlpha + Number.EPSILON).toBeGreaterThanOrEqual(
        accumulatedAlpha,
      );
      accumulatedAlpha = nextAlpha;
    }
    expect(accumulatedAlpha).toBeGreaterThan(0.99);
    expect(accumulatedAlpha).toBeLessThanOrEqual(1);
  });

  it("resolves explicit catalogue identities and fails closed for every invalid route", () => {
    const catalogue = bridgeStudioDynamicDabsToDryMediaV1({
      brushId: "dry-media",
      brushCatalogId: "pastel-paper-soft",
      seed: 17,
      dabs: dynamicDabs(4),
    });
    expect(catalogue).toMatchObject({
      ok: true,
      receipt: { presetId: "pastel" },
    });
    expect(bridgeStudioDynamicDabsToDryMediaV1({
      brushId: "dry-media",
      brushCatalogId: "sponge-stipple-dab",
      seed: 17,
      dabs: dynamicDabs(4),
    })).toEqual({ ok: false, reason: "unsupported-identity" });
    expect(bridgeStudioDynamicDabsToDryMediaV1({
      brushId: "chalk",
      seed: -1,
      dabs: dynamicDabs(4),
    })).toEqual({ ok: false, reason: "invalid-seed" });
    expect(bridgeStudioDynamicDabsToDryMediaV1({
      brushId: "chalk",
      seed: 17,
      dabs: [
        ...dynamicDabs(2),
        { ...dynamicDabs(1)[0]!, index: 1 },
      ],
    })).toEqual({ ok: false, reason: "invalid-dab" });
    expect(bridgeStudioDynamicDabsToDryMediaV1({
      brushId: "chalk",
      seed: 17,
      dabs: [{ ...dynamicDabs(1)[0]!, size: Number.NaN }],
    })).toEqual({ ok: false, reason: "invalid-dab" });
  });
});
