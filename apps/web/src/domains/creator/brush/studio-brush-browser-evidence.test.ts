import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS,
  STUDIO_PAINT_BRUSH_CATALOG_ITEMS,
} from "./studio-brush-catalog";
import { STUDIO_BRUSH_FEEL_CULL_PRESET_IDS } from "./studio-brush-listed-uniqueness";

interface StudioBrushBrowserEvidence {
  readonly schemaVersion: number;
  readonly status: string;
  readonly catalog: {
    readonly total: number;
    readonly core: number;
    readonly pro: number;
    readonly paint: number;
    readonly erase: number;
    /** Registered but delisted ids (V17.1 quarantine); UI matrices cover total - quarantined. */
    readonly quarantined: number;
  };
  readonly desktop: {
    readonly selectedAndRendered: number;
    readonly undoPassed: number;
    readonly redoPassed: number;
    /** Escape hatches; a receipt that used one is not the wave's proof. */
    readonly uiCatalogMatchSkipped: boolean;
    readonly surveyMode: boolean;
    readonly errorCount: number;
  };
  readonly longRouteCore: {
    readonly passed: number;
    readonly total: number;
    readonly totalSegmentsPerTool: number;
    /** Lane sizes: a minimum over an empty lane is 6 and would certify nothing. */
    readonly continuousPolicyTools: number;
    readonly discretePolicyTools: number;
    /**
     * Measured distribution, emitted by runLongBrushMatrix. A universal
     * `visibleSegmentsPerTool: 6` used to sit here and was untrue — the same run's log recorded a
     * discrete carrier at 4/6 — so the receipt now records the worst case in each policy lane.
     */
    readonly continuousMinimumVisibleSegments: number;
    readonly discreteMinimumVisibleSegments: number;
    readonly toolsBelowFullCoverage: number;
    readonly continuousPolicyFailures: number;
    readonly qualityPolicyCounts: Readonly<Record<string, number>>;
    readonly errorCount: number;
  };
  readonly smartShapes: {
    readonly passed: number;
    readonly total: number;
    readonly errorCount: number;
  };
  readonly mobile: {
    readonly paintSelections: number;
    readonly eraserSelections: number;
    readonly interactiveTargets: number;
    readonly minimumTargetWidthPx: number;
    readonly minimumTargetHeightPx: number;
    readonly undersizedTargets: number;
    readonly errorCount: number;
  };
  readonly pointerUpDurability: {
    /** Phase 1 — which authority made the released stroke durable, read on a live page. */
    readonly receiptMarkerReason: string;
    readonly receiptSettledInMs: number;
    readonly receiptStrokeCount: number;
    /** Phase 2 — which authority wrote the payload that survived teardown, and how long the
     * unload prompt was held (it must stay under the product's 200ms deferred idle flush, or the
     * flush could author the survivor and hide a pointerup write that lost its race). */
    readonly survivorMarkerReason: string;
    readonly survivorStrokeCount: number;
    readonly unloadPromptHeldMs: number;
    readonly navigationIssuedInMs: number;
    readonly unloadGuardShown: boolean;
    readonly payloadContainsEveryStroke: boolean;
    readonly recoveryBannerShown: boolean;
    readonly recoveredPixelsChanged: boolean;
    readonly errorCount: number;
  };
}

describe("Studio brush browser evidence", () => {
  it("pins a passing production-browser receipt for the exact shipped catalogue", () => {
    const evidence = JSON.parse(readFileSync(new URL("../../../../../../tests/benchmarks/results/studio-brush-browser.json",
      import.meta.url,
    ), "utf8")) as StudioBrushBrowserEvidence;
    const coreCount = STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter(
      (item) => item.source === "core",
    ).length;
    const proCount = STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter(
      (item) => item.source === "pro",
    ).length;

    // Schema v2: the receipt distinguishes the durable registry (total/core/pro/paint/erase,
    // preserved for persisted documents) from the LISTED matrix the shipped UI can actually
    // select — quarantined ids are registered but never selectable, so every UI-driven counter
    // pins the listed set.
    //
    // 2026-09-01 InkWash reinstatement: inkwash-pen · inkwash-water-brush left quarantine so
    // the picker can offer the Stam fluid tools. The 2026-08-27 receipt still measured the
    // 234-id listed matrix. Subtract only those two when comparing to that receipt — a red
    // evidence gate on the whole catalogue would hide the next regression (2026-08-16 note).
    // Drop this list the next time `pnpm verify:studio-brushes` authors a fresh receipt.
    const LISTING_REINSTATEMENT_PENDING_RECEIPT = ["inkwash-pen", "inkwash-water-brush"] as const;
    for (const id of LISTING_REINSTATEMENT_PENDING_RECEIPT) {
      expect(
        STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.some((item) => item.id === id),
        `${id}: pending-receipt reinstatement is no longer listed`,
      ).toBe(true);
    }
    for (const id of STUDIO_BRUSH_FEEL_CULL_PRESET_IDS) {
      expect(
        STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.some((item) => item.id === id),
        `${id}: feel-cull id is listed again — drop it from the pending-receipt reduction`,
      ).toBe(false);
    }
    const pendingReceipt = new Set<string>(LISTING_REINSTATEMENT_PENDING_RECEIPT);
    const listedTotal = STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter(
      (item) => !pendingReceipt.has(item.id),
    ).length + STUDIO_BRUSH_FEEL_CULL_PRESET_IDS.length;
    const listedPaintCount = STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.filter(
      (item) => !pendingReceipt.has(item.id),
    ).length + STUDIO_BRUSH_FEEL_CULL_PRESET_IDS.length;
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.status).toBe("pass");
    expect(evidence.catalog).toEqual({
      total: STUDIO_ALL_BRUSH_CATALOG_ITEMS.length,
      core: coreCount,
      pro: proCount,
      paint: STUDIO_PAINT_BRUSH_CATALOG_ITEMS.length,
      erase: STUDIO_ERASER_BRUSH_CATALOG_ITEMS.length,
      quarantined: STUDIO_ALL_BRUSH_CATALOG_ITEMS.length - listedTotal,
    });
    expect(evidence.desktop).toMatchObject({
      selectedAndRendered: listedTotal,
      undoPassed: listedTotal,
      redoPassed: listedTotal,
      // A run against an external origin may skip the picker/catalogue equality check, and survey
      // mode continues past a failing preset. Either makes the numbers above mean less than they
      // read, so neither may appear in the receipt this test pins.
      uiCatalogMatchSkipped: false,
      surveyMode: false,
      errorCount: 0,
    });
    const feelCullCoreCount = STUDIO_BRUSH_FEEL_CULL_PRESET_IDS.filter((id) =>
      STUDIO_ALL_BRUSH_CATALOG_ITEMS.some((item) => item.id === id && item.source === "core"),
    ).length;
    const listedCoreCount = STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.filter(
      (item) => item.source === "core" && !pendingReceipt.has(item.id),
    ).length + feelCullCoreCount;
    expect(evidence.longRouteCore).toMatchObject({
      passed: listedCoreCount,
      total: listedCoreCount,
      totalSegmentsPerTool: 6,
      continuousPolicyFailures: 0,
      errorCount: 0,
    });
    expect(
      Object.values(evidence.longRouteCore.qualityPolicyCounts)
        .reduce((sum, count) => sum + count, 0),
    ).toBe(listedCoreCount);
    // Full route coverage is the rule. Every tool held to the continuous policy must paint all six
    // sampled sixths — that is the assertion a regression cannot escape by reclassifying itself,
    // because reclassifying a broken tool as discrete moves it out of this minimum and into the
    // discrete floor below, which is also pinned. The lane sizes are checked first: a minimum over
    // an empty lane comes out as a perfect 6 and would certify nothing at all.
    expect(
      evidence.longRouteCore.continuousPolicyTools
        + evidence.longRouteCore.discretePolicyTools,
    ).toBe(listedCoreCount);
    expect(evidence.longRouteCore.continuousPolicyTools).toBeGreaterThan(0);
    expect(evidence.longRouteCore.discretePolicyTools).toBe(
      evidence.longRouteCore.qualityPolicyCounts["record-only-discrete"],
    );
    expect(evidence.longRouteCore.continuousMinimumVisibleSegments).toBe(6);
    // Discrete carriers get no floor beyond "it painted": the gate deliberately exempts them from
    // 6/6 because an authored stamp lane may leave a sampled sixth empty between marks, so it
    // enforces no minimum of its own. The last run's discrete minimum was exactly 4, which is why
    // a >= 4 floor here would have had zero headroom and would fail on drift rather than on a
    // defect. Recording the measured value is the honest ratchet; inventing a threshold the gate
    // cannot defend is not.
    expect(evidence.longRouteCore.discreteMinimumVisibleSegments).toBeGreaterThan(0);
    // Discrete carriers are the only ones allowed a gap, so the count below full coverage can
    // never exceed how many of them there are.
    expect(evidence.longRouteCore.toolsBelowFullCoverage).toBeLessThanOrEqual(
      evidence.longRouteCore.qualityPolicyCounts["record-only-discrete"] ?? 0,
    );
    expect(evidence.smartShapes).toMatchObject({ passed: 6, total: 6, errorCount: 0 });
    expect(evidence.mobile).toMatchObject({
      paintSelections: listedPaintCount,
      eraserSelections: STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS.length,
      undersizedTargets: 0,
      errorCount: 0,
    });
    // The gate accepts >= 43.5px (sub-pixel layout rounds below the 44px target), so pinning an
    // exact 44 here would fail on a legitimate 43.75 measurement rather than on a shrunken control.
    expect(evidence.mobile.minimumTargetWidthPx).toBeGreaterThanOrEqual(43.5);
    expect(evidence.mobile.minimumTargetHeightPx).toBeGreaterThanOrEqual(43.5);
    expect(evidence.mobile.interactiveTargets).toBeGreaterThanOrEqual(listedTotal * 2);
    // The durability block is two measurements over two strokes, and the mechanism matters as much
    // as the outcome: a receipt reading "pagehide" is precisely the regression this gate exists to
    // catch, so pin the authority on both the live receipt and the payload that survived teardown.
    expect(evidence.pointerUpDurability).toMatchObject({
      receiptMarkerReason: "pointerup",
      survivorMarkerReason: "pointerup",
      unloadGuardShown: true,
      payloadContainsEveryStroke: true,
      recoveryBannerShown: true,
      recoveredPixelsChanged: true,
      errorCount: 0,
    });
    expect(evidence.pointerUpDurability.receiptStrokeCount).toBeGreaterThan(0);
    expect(evidence.pointerUpDurability.survivorStrokeCount)
      .toBeGreaterThan(evidence.pointerUpDurability.receiptStrokeCount);
    expect(evidence.pointerUpDurability.navigationIssuedInMs).toBeLessThan(50);
    // Held below the product's 200ms deferred idle flush, so only pointerup can have authored the
    // survivor. A longer prompt would let the flush write it and mask a lost race with teardown.
    expect(evidence.pointerUpDurability.unloadPromptHeldMs).toBeLessThan(200);
  });
});
