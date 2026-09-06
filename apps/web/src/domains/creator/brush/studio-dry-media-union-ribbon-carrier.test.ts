import { describe, expect, it } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import {
  normalizeStudioBrushDynamicsSettings,
  planNormalizedStudioDynamicBrushDabs,
  studioBrushDynamicsSettingsForBrushId,
  studioDryMediaUnionComposableProgramPin,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
} from "./studio-brush-dynamics";
import {
  bridgeStudioDynamicDabsToDryMediaV1,
  resolveStudioDynamicBrushMaterialIdentity,
} from "./studio-dry-media-dynamic-bridge";
import {
  planStudioDryMediaUnionRibbonCarrier,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
  type StudioDryMediaUnionComposableGroup,
  type StudioDryMediaUnionRibbonCoverageMark,
  type StudioDryMediaUnionRibbonSourceMark,
} from "./studio-dry-media-union-ribbon-carrier";

const CORE_DRY_MEDIA_IDS = [
  "crayon",
  "chalk",
  "charcoal",
  "pastel",
  "oil-pastel",
] as const;

type CoreDryMediaId = (typeof CORE_DRY_MEDIA_IDS)[number];

const LEGACY_CARRIER_SHA256: Readonly<Record<CoreDryMediaId, string>> = Object.freeze({
  // Competitive anisotropic wax tooth (10-pt pore ellipses; denser travel-aligned slits).
  // Re-captured 2026-08-15 for PRODUCT_LANE_COUNT.crayon 3 -> 5. The carrier reads its lane count
  // from the bridge, so restoring the two dropped native wax fibres legitimately changes the union
  // bytes; nothing in the carrier itself moved (the other four rows are untouched, which is the
  // proof). Not a free re-record: see the pinned row below for the replay consequence.
  crayon: "619097e1cb934eff00a994e4f749959a380bd86c302fa95f968e05c589aaa451",
  chalk: "33b358794aa321406c6afca80fd41373af44c5f858294784842cc9c74d2a0d45",
  charcoal: "73d5a05fbe1c85ad27d9545fe4cb0166e17beec8b953c0b6c829de7f55c316c0",
  pastel: "afd6a285bf45c3fae76a6d4120247551993b98b555a4737b6b738ba5ea6dd4de",
  // Re-captured with the restored brushId-keyed negative-grain policy: the original T1 capture
  // was taken while the carrier mis-keyed oil-pastel onto the "pastel" row (dryMediaPresetId),
  // so it pinned the regression, not the pre-wave production bytes. The other four rows are
  // unchanged under both keyings and prove the rest of the byte pipeline is untouched.
  "oil-pastel": "d045a0840ae9860f8f00512433137569453d6a838c9bbb6a1da9d94d564bccf5",
});

/**
 * Serialized carrier plans for PINNED dynamics, captured from the pre-T1 production code.
 * An element whose dynamics carry the `dryMediaUnionProgram` pin must replay these exact bytes
 * forever (provider pinning; the de-polygon flip must not disturb the legacy union output).
 */
const PINNED_CARRIER_SHA256: Readonly<Record<CoreDryMediaId, string>> = Object.freeze({
  // Re-captured 2026-08-15 for PRODUCT_LANE_COUNT.crayon 3 -> 5, and this row is the one with a
  // user-visible consequence, so it is recorded rather than quietly refreshed.
  //
  // `dryMediaUnionProgram` pins the RENDERING PROGRAM (the de-polygon flip must not disturb legacy
  // union output). It does not pin lane count: this fixture reaches the carrier through
  // bridgeStudioDynamicDabsToDryMediaV1, which reads PRODUCT_LANE_COUNT. So a saved document whose
  // crayon strokes carry the pin re-renders with five fibres instead of three.
  //
  // That is intended. Three lanes dropped native fibres k=1/k=3 and left ~1.1px bare bands - the
  // defect this wave exists to remove. Freezing the pinned path at three would preserve that defect
  // in existing artwork forever, which trades texture for byte-stability - the opposite of the
  // standing priority. The alternative (lane count as a per-element pinned parameter) would be the
  // right move only if a customer needed frozen crayon pixels; no such contract exists today.
  crayon: "72b181e4806d8ebc24e8b806821cc791c24222621006e7aa539e73c273eb11ed",
  chalk: "80530301e273c109833d00b9d98ddeb358eddcd5eba739aac31c1abed321b8c6",
  charcoal: "4a620ecebdf8e8c4bf7092d9020b49178f35f8722cf2970aa3f06aca5b8b9346",
  pastel: "8a183f80b1142acd9dfa93a80e7c37d2f32b6b0c76e63ff61a783a1d1df34af9",
  // Re-captured for the same reason as the legacy row above: the original capture pinned the
  // mis-keyed "pastel" grain policy instead of the pre-wave "oil-pastel" row.
  "oil-pastel": "f6cb50875cbc039067013708b68651aa77dfce7b218fc6df872376c72f49cb0e",
});

const POINTS = Object.freeze([
  0, 0,
  10, 2,
  18, 9,
  7, 16,
  22, 23,
  35, 20,
]);
const PRESSURES = Object.freeze([0.2, 0.55, 0.9, 0.4, 0.75, 0.6]);

function settingsFor(
  brushId: CoreDryMediaId,
  mode: "authored" | "pinned" | "pre-wave-causal" | "legacy-pipeline",
): NormalizedStudioBrushDynamicsSettings {
  const authored = studioBrushDynamicsSettingsForBrushId(brushId);
  if (!authored) throw new Error(`Missing ${brushId} dynamics`);
  if (mode === "authored") return authored;
  if (mode === "pinned") {
    return normalizeStudioBrushDynamicsSettings({
      ...authored,
      dryMediaUnionProgram: studioDryMediaUnionComposableProgramPin(),
    });
  }
  if (mode === "pre-wave-causal") {
    // Persisted pre-wave stroke shape: causal pipeline, no fresh-authoring kernel marker and no
    // wave-added preset identity (normalization omits both, keeping the snapshot byte-stable).
    return normalizeStudioBrushDynamicsSettings({
      ...authored,
      presetId: undefined,
      dryMediaKernelProgram: undefined,
    });
  }
  // Historical persisted snapshot without a causal deposit pipeline.
  return normalizeStudioBrushDynamicsSettings({
    ...authored,
    presetId: undefined,
    dryMediaKernelProgram: undefined,
    depositPipeline: undefined,
  });
}

function sourceDabsFor(
  settings: NormalizedStudioBrushDynamicsSettings,
): readonly StudioDynamicBrushDab[] {
  return planNormalizedStudioDynamicBrushDabs({
    points: POINTS,
    pressures: PRESSURES,
    baseWidth: 18,
    baseOpacity: 0.82,
  }, settings);
}

function sourceMarksFor(
  brushId: CoreDryMediaId,
  settings: NormalizedStudioBrushDynamicsSettings,
  dabs: readonly StudioDynamicBrushDab[],
): Readonly<{
  dabs: readonly StudioDynamicBrushDab[];
  marks: readonly StudioDryMediaUnionRibbonSourceMark[];
  laneCount: number;
}> {
  const bridged = bridgeStudioDynamicDabsToDryMediaV1({
    brushId,
    seed: settings.seed,
    dabs,
  });
  if (!bridged.ok) throw new Error(`${brushId}: ${bridged.reason}`);
  return Object.freeze({
    dabs: bridged.receipt.adjustedDabs,
    marks: Object.freeze(bridged.receipt.marks.map((mark) => Object.freeze({
      x: mark.x,
      y: mark.y,
      radiusX: mark.radiusX,
      radiusY: mark.radiusY,
      angleRadians: mark.angleRadians,
      alpha: 1,
      color: "#264466",
    }))),
    laneCount: bridged.receipt.laneCount,
  });
}

function requireCarrier(
  brushId: CoreDryMediaId,
  settings: NormalizedStudioBrushDynamicsSettings,
  sourceDabs: readonly StudioDynamicBrushDab[],
  skipLeadingSourceDabs = 0,
): StudioDryMediaUnionRibbonCoverageMark {
  const bridged = sourceMarksFor(brushId, settings, sourceDabs);
  const result = planStudioDryMediaUnionRibbonCarrier({
    dabs: bridged.dabs,
    marks: bridged.marks,
    materialIdentity: resolveStudioDynamicBrushMaterialIdentity(brushId) ?? undefined,
    dynamics: settings,
    ...(skipLeadingSourceDabs > 0
      ? { skipLeadingMarks: skipLeadingSourceDabs * bridged.laneCount }
      : {}),
  });
  if (!result.applied) throw new Error(`${brushId}: ${result.reason}`);
  expect(result.marks).toHaveLength(1);
  return result.marks[0]!;
}

function composableGroups(
  mark: StudioDryMediaUnionRibbonCoverageMark,
): readonly StudioDryMediaUnionComposableGroup[] {
  const compositing = mark.ribbon.compositing;
  expect(compositing).toMatchObject({
    kind: "causal-group-alpha-max",
    version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
    programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  });
  if (!compositing) throw new Error("Missing composable dry-media groups");
  return compositing.groups;
}

describe("dry-media union ribbon carrier v3 representation", () => {
  it("rejects freshly authored strokes — the explicit kernel marker owns them, zero union polygons", () => {
    for (const brushId of CORE_DRY_MEDIA_IDS) {
      const settings = settingsFor(brushId, "authored");
      expect(settings.dryMediaUnionProgram, brushId).toBeUndefined();
      // Fresh authoring is the only marker mint; it is what routes the stroke off this carrier.
      expect(settings.dryMediaKernelProgram, brushId).toBeDefined();
      const bridged = sourceMarksFor(brushId, settings, sourceDabsFor(settings));
      const result = planStudioDryMediaUnionRibbonCarrier({
        dabs: bridged.dabs,
        marks: bridged.marks,
        materialIdentity:
          resolveStudioDynamicBrushMaterialIdentity(brushId) ?? undefined,
        dynamics: settings,
      });
      expect(result.applied, brushId).toBe(false);
      if (!result.applied) {
        expect(result.reason, brushId).toBe("ineligible-material");
      }
    }
  });

  it("replays stored pre-wave causal strokes (no kernel marker) through the union carrier byte-identically", () => {
    // Reviewer probe D3/F5: pre-wave persisted core dry-media strokes are unpinned causal
    // snapshots. Before the marker gate they were re-routed to the kernel dab path; they must
    // plan the exact union geometry captured pre-flip. The pinned capture is SHA-pinned below,
    // and the pin only contributes the compositing metadata, so polygon equality against the
    // pinned plan is byte equality against the pre-flip production output.
    for (const brushId of CORE_DRY_MEDIA_IDS) {
      const persisted = settingsFor(brushId, "pre-wave-causal");
      expect(persisted.dryMediaKernelProgram, brushId).toBeUndefined();
      expect(persisted.dryMediaUnionProgram, brushId).toBeUndefined();
      expect(persisted.depositPipeline, brushId).toBe("causal-deposit-v3-segmented");
      const mark = requireCarrier(brushId, persisted, sourceDabsFor(persisted));
      // No explicit pin ⇒ no composable-program metadata, exactly as the pre-flip carrier.
      expect(mark.ribbon.compositing, brushId).toBeUndefined();

      const pinned = settingsFor(brushId, "pinned");
      const pinnedMark = requireCarrier(brushId, pinned, sourceDabsFor(pinned));
      expect(mark.ribbon.polygons, brushId).toEqual(pinnedMark.ribbon.polygons);
      expect(
        {
          x: mark.x,
          y: mark.y,
          radiusX: mark.radiusX,
          radiusY: mark.radiusY,
          alpha: mark.alpha,
          color: mark.color,
        },
        brushId,
      ).toEqual({
        x: pinnedMark.x,
        y: pinnedMark.y,
        radiusX: pinnedMark.radiusX,
        radiusY: pinnedMark.radiusY,
        alpha: pinnedMark.alpha,
        color: pinnedMark.color,
      });
    }
  });

  it("keeps unpinned legacy-pipeline snapshots byte-identical to the historical baseline", () => {
    for (const brushId of CORE_DRY_MEDIA_IDS) {
      const settings = settingsFor(brushId, "legacy-pipeline");
      expect(settings.dryMediaUnionProgram, brushId).toBeUndefined();
      expect(settings.depositPipeline, brushId).toBeUndefined();
      const mark = requireCarrier(brushId, settings, sourceDabsFor(settings));
      expect(mark.ribbon.compositing, brushId).toBeUndefined();
      const serialized = JSON.stringify({ applied: true, marks: [mark] });
      expect(
        sha256HexPortable(new TextEncoder().encode(serialized)),
        brushId,
      ).toBe(LEGACY_CARRIER_SHA256[brushId]);
    }
  });

  it("replays pinned dynamics byte-identically to the pre-de-polygon capture", () => {
    for (const brushId of CORE_DRY_MEDIA_IDS) {
      const settings = settingsFor(brushId, "pinned");
      const mark = requireCarrier(brushId, settings, sourceDabsFor(settings));
      expect(mark.ribbon.compositing, brushId).toBeDefined();
      const serialized = JSON.stringify({ applied: true, marks: [mark] });
      expect(
        sha256HexPortable(new TextEncoder().encode(serialized)),
        brushId,
      ).toBe(PINNED_CARRIER_SHA256[brushId]);
    }
  });

  it("pins immutable station groups whose arbitrary delivery chunks flatten to one full plan", () => {
    for (const brushId of CORE_DRY_MEDIA_IDS) {
      const settings = settingsFor(brushId, "pinned");
      const sourceDabs = sourceDabsFor(settings);
      const full = requireCarrier(brushId, settings, sourceDabs);
      const fullGroups = composableGroups(full);
      expect(fullGroups.length, brushId).toBeGreaterThan(0);
      expect(fullGroups.flatMap((group) => group.polygons), brushId)
        .toEqual(full.ribbon.polygons);
      expect(Object.isFrozen(fullGroups), brushId).toBe(true);
      for (let index = 0; index < fullGroups.length; index += 1) {
        const group = fullGroups[index]!;
        expect(Number.isSafeInteger(group.stationIndex), brushId).toBe(true);
        expect(group.polygons.length, brushId).toBeGreaterThan(0);
        expect(Object.isFrozen(group), brushId).toBe(true);
        if (index > 0) {
          expect(group.stationIndex, brushId)
            .toBeGreaterThan(fullGroups[index - 1]!.stationIndex);
        }
      }

      const chunkEnds = [1, 3, 7, 13, 31, sourceDabs.length]
        .filter((end, index, values) => (
          end <= sourceDabs.length && end > (values[index - 1] ?? 0)
        ));
      if (chunkEnds.at(-1) !== sourceDabs.length) chunkEnds.push(sourceDabs.length);
      const chunkedGroups: StudioDryMediaUnionComposableGroup[] = [];
      let start = 0;
      for (const end of chunkEnds) {
        const predecessor = start > 0 ? start - 1 : 0;
        const chunk = sourceDabs.slice(predecessor, end);
        const mark = requireCarrier(
          brushId,
          settings,
          chunk,
          start > 0 ? 1 : 0,
        );
        chunkedGroups.push(...composableGroups(mark));
        start = end;
      }
      expect(chunkedGroups, brushId).toEqual(fullGroups);
      expect(chunkedGroups.flatMap((group) => group.polygons), brushId)
        .toEqual(full.ribbon.polygons);
    }
  });
});
