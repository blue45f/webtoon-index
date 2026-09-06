import { describe, expect, it } from "vitest";

import {
  planCausalWatercolorBrushDabs,
} from "../studio-causal-watercolor-brush";

import {
  applyStudioBrushAliasWatercolorMaterial,
  mapStudioBrushAliasPressureSamples,
  resolveStudioBrushAliasWatercolorPlanSettings,
} from "./studio-brush-alias-profile";
import {
  DEFAULT_STUDIO_WET_RIBBON_MAX_FOOTPRINTS,
  planStudioWetRibbonCarrier,
  STUDIO_WET_RIBBON_OPACITY_BUCKET_COUNT,
  STUDIO_WET_RIBBON_CARRIER_VERSION,
  studioWetRibbonCarrierBatchPathData,
  traceStudioWetRibbonCarrierBatch,
  type StudioWetRibbonFootprint,
  type StudioWetRibbonSourceDab,
} from "./studio-wet-ribbon-carrier";

/** 양자 계단은 캐리어가 소유한 계약이다 — 리터럴을 복사해 두면 재튜닝 때 조용히 갈린다. */
const BUCKETS = STUDIO_WET_RIBBON_OPACITY_BUCKET_COUNT;

const SETTINGS = {
  baseWidth: 20,
  spacing: 5,
  seed: 441,
  diffuse: true,
  maxDabs: 8_192,
} as const;

function bounds(points: readonly number[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    xs.push(points[index]!);
    ys.push(points[index + 1]!);
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function layerOf(
  footprint: StudioWetRibbonFootprint,
  layer: StudioWetRibbonFootprint["layers"][number]["layer"],
) {
  const planned = footprint.layers.find((candidate) => candidate.layer === layer);
  if (!planned) throw new Error(`missing ${layer}`);
  return planned;
}

function polygonContains(
  points: readonly number[],
  x: number,
  y: number,
): boolean {
  let inside = false;
  const pointCount = points.length / 2;
  for (
    let current = 0, previous = pointCount - 1;
    current < pointCount;
    previous = current, current += 1
  ) {
    const currentX = points[current * 2]!;
    const currentY = points[current * 2 + 1]!;
    const previousX = points[previous * 2]!;
    const previousY = points[previous * 2 + 1]!;
    const crosses = (currentY > y) !== (previousY > y)
      && x < (
        (previousX - currentX) * (y - currentY)
          / (previousY - currentY)
        + currentX
      );
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonSignedArea(points: readonly number[]): number {
  let twiceArea = 0;
  const pointCount = points.length / 2;
  for (let index = 0; index < pointCount; index += 1) {
    const next = (index + 1) % pointCount;
    twiceArea += points[index * 2]! * points[next * 2 + 1]!
      - points[next * 2]! * points[index * 2 + 1]!;
  }
  return twiceArea / 2;
}

function compositedLayerOpacityAt(
  plan: ReturnType<typeof planStudioWetRibbonCarrier>,
  layer: StudioWetRibbonFootprint["layers"][number]["layer"],
  x: number,
  y: number,
): number {
  let opacity = 0;
  for (const batch of plan.batches) {
    if (
      batch.layer !== layer
      || !batch.polygons.some((candidate) => (
        polygonContains(candidate.points, x, y)
      ))
    ) {
      continue;
    }
    opacity = batch.opacity + opacity * (1 - batch.opacity);
  }
  return opacity;
}

describe("studio wet ribbon carrier geometry", () => {
  it("uses direction-following polygon ribbons and four nested pigment bands, never circles", () => {
    const dabs: StudioWetRibbonSourceDab[] = [
      { x: 0, y: 0, radius: 3, opacity: 0.2, role: "core" },
      { x: 0, y: 0, radius: 6, opacity: 0.1, role: "diffuse" },
      { x: 12, y: 0, radius: 7, opacity: 0.8, role: "core" },
      { x: 12, y: 0, radius: 12, opacity: 0.24, role: "diffuse" },
    ];
    const plan = planStudioWetRibbonCarrier(dabs, { seed: 12 });

    expect(plan.version).toBe(STUDIO_WET_RIBBON_CARRIER_VERSION);
    expect(plan.footprints.map(({ kind }) => kind)).toEqual(["segment"]);
    expect(plan.polygonCount).toBe(plan.footprintCount * 4);
    expect(plan.footprints.every((footprint) => footprint.layers.length === 4))
      .toBe(true);
    expect(plan.footprints[0]?.layers.every(
      ({ polygon }) => polygon.points.length === 8,
    )).toBe(true);

    const segment = plan.footprints[0]!;
    const coreBounds = bounds(layerOf(segment, "core").polygon.points);
    const innerBounds = bounds(layerOf(segment, "diffuse-inner").polygon.points);
    const outerBounds = bounds(layerOf(segment, "diffuse-outer").polygon.points);
    expect(outerBounds.maxY - outerBounds.minY)
      .toBeGreaterThan(innerBounds.maxY - innerBounds.minY);
    expect(innerBounds.maxY - innerBounds.minY)
      .toBeGreaterThan(coreBounds.maxY - coreBounds.minY);

    const segmentCore = layerOf(segment, "core");
    expect(segment.endX).toBeGreaterThan(segment.startX);
    expect(bounds(segmentCore.polygon.points).maxX).toBeGreaterThanOrEqual(12);
    expect(segmentCore.opacity).toBeGreaterThan(0);
  });

  it("keeps a directional tap only until the first real segment replaces it", () => {
    const tap = planStudioWetRibbonCarrier([
      { x: 3, y: 4, radius: 5, opacity: 0.6, role: "core" },
    ], { seed: 12 });
    const moved = planStudioWetRibbonCarrier([
      { x: 3, y: 4, radius: 5, opacity: 0.6, role: "core" },
      { x: 12, y: 7, radius: 6, opacity: 0.7, role: "core" },
    ], { seed: 12 });

    expect(tap.footprints.map(({ kind }) => kind)).toEqual(["tap"]);
    expect(tap.footprints[0]?.layers.every(
      ({ polygon }) => polygon.points.length === 12,
    )).toBe(true);
    expect(moved.footprints.map(({ kind }) => kind)).toEqual(["segment"]);
    expect(moved.footprints[0]?.layers.every(
      ({ polygon }) => polygon.points.length === 8,
    )).toBe(true);
  });

  it("preserves every previously emitted footprint when a causal prefix grows", () => {
    const headPoints = [0, 0, 7, 2, 16, 7, 24, 10];
    const tailPoints = [34, 7, 45, 1, 58, 4];
    const headPressures = [0.2, 0.35, 0.65, 0.85];
    const tailPressures = [0.55, 0.4, 0.9];
    const head = planStudioWetRibbonCarrier(
      planCausalWatercolorBrushDabs({
        ...SETTINGS,
        points: headPoints,
        pressures: headPressures,
      }, false),
      { seed: SETTINGS.seed },
    );
    const extended = planStudioWetRibbonCarrier(
      planCausalWatercolorBrushDabs({
        ...SETTINGS,
        points: [...headPoints, ...tailPoints],
        pressures: [...headPressures, ...tailPressures],
      }, false),
      { seed: SETTINGS.seed },
    );

    expect(extended.footprints.length).toBeGreaterThan(head.footprints.length);
    expect(extended.footprints.slice(0, head.footprints.length))
      .toEqual(head.footprints);
    for (const headBatch of head.batches) {
      const extendedBatch = extended.batches.find((candidate) => (
        candidate.layer === headBatch.layer
        && candidate.coverageCeiling === headBatch.coverageCeiling
      ));
      expect(extendedBatch).toBeDefined();
      expect(extendedBatch?.opacity).toBe(headBatch.opacity);
      expect(extendedBatch?.polygons.slice(0, headBatch.polygons.length))
        .toEqual(headBatch.polygons);
    }
  });

  it("shares one exact edge between neighbours without longitudinal overlap wedges", () => {
    const plan = planStudioWetRibbonCarrier([
      { x: 0, y: 0, radius: 5, opacity: 0.4, role: "core" },
      { x: 9, y: 2, radius: 7, opacity: 0.6, role: "core" },
      { x: 17, y: -3, radius: 4, opacity: 0.8, role: "core" },
      { x: 28, y: 1, radius: 6, opacity: 0.7, role: "core" },
    ], { seed: 9 });
    const segments = plan.footprints.filter(
      (footprint) => footprint.kind === "segment",
    );

    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      for (const layer of segment.layers) {
        // A segment is a single non-overlapping quad. The old six-vertex carrier included
        // backward/forward centre tips, so adjacent segments painted triangular wedges twice.
        expect(layer.polygon.points).toHaveLength(8);
      }
    }
    for (let index = 1; index < segments.length; index += 1) {
      const previous = layerOf(segments[index - 1]!, "core").polygon.points;
      const current = layerOf(segments[index]!, "core").polygon.points;
      expect(current.slice(0, 2)).toEqual(previous.slice(2, 4));
      expect(current.slice(6, 8)).toEqual(previous.slice(4, 6));
    }
  });

  it("uses exactly the same quantized polygon coordinates for Canvas tracing and SVG", () => {
    const dabs = planCausalWatercolorBrushDabs({
      ...SETTINGS,
      points: [0, 0, 10, 4, 22, -3, 37, 8],
      pressures: [0.2, 0.5, 0.9, 0.4],
    }, true);
    const plan = planStudioWetRibbonCarrier(dabs, { seed: SETTINGS.seed });

    for (const batch of plan.batches) {
      const canvasCoordinates: number[] = [];
      traceStudioWetRibbonCarrierBatch({
        moveTo: (x, y) => canvasCoordinates.push(x, y),
        lineTo: (x, y) => canvasCoordinates.push(x, y),
        closePath: () => undefined,
      }, batch);
      const svgCoordinates = (
        studioWetRibbonCarrierBatchPathData(batch)
          .match(/-?(?:\d+\.\d+|\d+)/g)
        ?? []
      ).map(Number);
      expect(svgCoordinates).toEqual(canvasCoordinates);
      expect(studioWetRibbonCarrierBatchPathData(batch)).not.toContain("A");
    }
  });

  it("joins UI-like ink-wash station quads into one Canvas/SVG contour without exposing seams", () => {
    const settings = resolveStudioBrushAliasWatercolorPlanSettings(
      "ink-wash",
      30,
    )!;
    const sourcePointCount = 81;
    const points = Array.from(
      { length: sourcePointCount },
      (_, index) => [20 + index * 5, 80],
    ).flat();
    const pressures = mapStudioBrushAliasPressureSamples(
      "ink-wash",
      Array.from({ length: sourcePointCount }, () => 0.5),
      sourcePointCount,
      0.55,
    );
    const dabs = applyStudioBrushAliasWatercolorMaterial(
      "ink-wash",
      planCausalWatercolorBrushDabs({
        points,
        pressures,
        baseWidth: settings.baseWidth,
        spacing: settings.spacing,
        seed: 441,
        diffuse: true,
        maxDabs: 8_192,
      }, true),
    );
    const plan = planStudioWetRibbonCarrier(dabs, { seed: 441 });
    const coreBulkBatch = plan.batches.find(
      ({ coverageCeiling, layer }) => (
        layer === "core" && coverageCeiling === 0.5
      ),
    )!;

    // The retained causal model still owns one immutable quad per station pair.
    expect(coreBulkBatch.polygons.length).toBeGreaterThan(60);

    // The raster/export boundary removes every coincident internal edge. Before this regression,
    // Canvas antialiased those 60+ independent subpaths at fractional zoom and produced the
    // visible pale vertical bars in the Studio screenshot.
    const svgPath = studioWetRibbonCarrierBatchPathData(coreBulkBatch);
    expect(svgPath.match(/M/g)).toHaveLength(1);
    expect(svgPath.match(/Z/g)).toHaveLength(1);
    const canvasPath = {
      closes: 0,
      moves: 0,
      lines: 0,
    };
    traceStudioWetRibbonCarrierBatch({
      moveTo: () => {
        canvasPath.moves += 1;
      },
      lineTo: () => {
        canvasPath.lines += 1;
      },
      closePath: () => {
        canvasPath.closes += 1;
      },
    }, coreBulkBatch);
    expect(canvasPath).toEqual({
      closes: 1,
      moves: 1,
      lines: coreBulkBatch.polygons.length * 2 + 1,
    });
  });

  it("preserves zero pigment opacity exactly and omits invisible render batches", () => {
    const plan = planStudioWetRibbonCarrier([
      { x: 4, y: 8, radius: 6, opacity: 0, role: "core" },
      { x: 4, y: 8, radius: 10, opacity: 0, role: "diffuse" },
    ], { seed: 8 });

    expect(plan.footprints).toHaveLength(1);
    expect(plan.footprints[0]?.layers.every(({ opacity }) => opacity === 0)).toBe(true);
    expect(plan.batches).toEqual([]);
  });

  it("uses stroke-local max coverage at self-crossings while leaving inter-stroke glazing", () => {
    const plan = planStudioWetRibbonCarrier([
      { x: 0, y: 0, radius: 3, opacity: 0.2, role: "core" },
      { x: 20, y: 20, radius: 3, opacity: 0.2, role: "core" },
      { x: 0, y: 20, radius: 3, opacity: 0.8, role: "core" },
      { x: 20, y: 0, radius: 3, opacity: 0.8, role: "core" },
    ], { seed: 41 });

    const crossing = compositedLayerOpacityAt(plan, "core", 10, 10);
    const isolatedStrong = compositedLayerOpacityAt(plan, "core", 15, 5);
    const isolatedLight = compositedLayerOpacityAt(plan, "core", 5, 5);

    expect(crossing).toBeCloseTo(isolatedStrong, 12);
    expect(crossing).toBeCloseTo(Math.round(0.8 * BUCKETS) / BUCKETS, 12);
    expect(isolatedLight).toBeCloseTo(Math.round(0.2 * BUCKETS) / BUCKETS, 12);
    expect(crossing).toBeLessThan(
      isolatedStrong + isolatedLight * (1 - isolatedStrong),
    );

    const coreBatches = plan.batches.filter(({ layer }) => layer === "core");
    expect(coreBatches.map(({ coverageCeiling }) => coverageCeiling))
      .toEqual([...coreBatches].map(({ coverageCeiling }) => coverageCeiling)
        .sort((left, right) => left - right));
    for (const batch of coreBatches) {
      expect(batch.polygons.length).toBeGreaterThan(0);
      expect(batch.polygons.every((polygon) => (
        polygonSignedArea(polygon.points) < 0
      ))).toBe(true);
    }
  });

  it("reconstructs every quantized local target exactly without additive crossing seams", () => {
    const authored = [0.03125, 0.21875, 0.5, 0.78125, 1];
    const plan = planStudioWetRibbonCarrier(
      authored.map((opacity, index) => ({
        x: index * 20,
        y: 0,
        radius: 4,
        opacity,
        role: "core" as const,
      })),
      { seed: 9 },
    );

    for (let segment = 0; segment < authored.length - 1; segment += 1) {
      const expected = (authored[segment]! + authored[segment + 1]!) * 0.5;
      expect(
        compositedLayerOpacityAt(plan, "core", segment * 20 + 10, 0),
      ).toBeCloseTo(Math.round(expected * BUCKETS) / BUCKETS, 12);
    }
  });

  it("interpolates endpoint coverage through a segment instead of emitting a station-wide plateau", () => {
    const plan = planStudioWetRibbonCarrier([
      { x: 0, y: 0, radius: 4, opacity: 0.2, role: "core" },
      { x: 20, y: 0, radius: 4, opacity: 0.8, role: "core" },
    ], { seed: 9 });
    const quantized = (value: number) => Math.round(value * BUCKETS) / BUCKETS;

    expect(compositedLayerOpacityAt(plan, "core", 5, 0))
      .toBeCloseTo(quantized(0.35), 12);
    expect(compositedLayerOpacityAt(plan, "core", 10, 0))
      .toBeCloseTo(quantized(0.5), 12);
    expect(compositedLayerOpacityAt(plan, "core", 15, 0))
      .toBeCloseTo(quantized(0.65), 12);
    expect(new Set(plan.batches
      .filter(({ layer }) => layer === "core")
      .map(({ polygons }) => polygons[0]?.points.join(","))).size)
      .toBeGreaterThan(2);
  });
});

describe("studio wet ribbon carrier long-stroke budget", () => {
  it("keeps an 8k-pixel stroke continuous with bounded linear geometry planning", () => {
    const startedAt = performance.now();
    const dabs = planCausalWatercolorBrushDabs({
      ...SETTINGS,
      points: [0, 0, 8_000, 0],
      pressures: [0.25, 0.9],
    }, true);
    const plan = planStudioWetRibbonCarrier(dabs, { seed: SETTINGS.seed });
    const elapsed = performance.now() - startedAt;

    expect(plan.footprintCount).toBeGreaterThan(1_500);
    expect(plan.footprintCount)
      .toBeLessThanOrEqual(DEFAULT_STUDIO_WET_RIBBON_MAX_FOOTPRINTS);
    expect(plan.polygonCount).toBe(plan.footprintCount * 4);
    expect(plan.batches.length).toBeLessThanOrEqual(4 * BUCKETS);
    expect(elapsed).toBeLessThan(750);

    const segments = plan.footprints.filter(({ kind }) => kind === "segment");
    for (let index = 1; index < segments.length; index += 1) {
      const previous = segments[index - 1]!;
      const current = segments[index]!;
      expect(current.startX).toBe(previous.endX);
      expect(current.startY).toBe(previous.endY);
      const previousBounds = bounds(layerOf(previous, "core").polygon.points);
      const currentBounds = bounds(layerOf(current, "core").polygon.points);
      expect(previousBounds.maxX).toBeGreaterThanOrEqual(currentBounds.minX);
    }
  });

  it("fails boundedly when an untrusted source exceeds the explicit footprint cap", () => {
    const dabs: StudioWetRibbonSourceDab[] = Array.from(
      { length: 260 },
      (_, index) => ({
        x: index,
        y: index % 3,
        radius: 4,
        opacity: 0.5,
        role: "core" as const,
      }),
    );
    const plan = planStudioWetRibbonCarrier(dabs, {
      seed: 1,
      maxFootprints: 128,
    });
    expect(plan.capped).toBe(true);
    expect(plan.sourceStationCount).toBe(128);
    expect(plan.footprintCount).toBe(127);
    expect(plan.polygonCount).toBe(508);
  });
});

/**
 * The coverage ladder is built by grouping each deposit onto its rung span once, rather than by
 * rescanning every deposit at every rung. These assertions pin the properties that made the two
 * equivalent, so a future re-tuning cannot quietly reintroduce per-rung geometry drift.
 *
 * Composite order is the load-bearing one: batch polygons are translucent, so reordering them
 * inside a batch changes pixels even when the set is unchanged.
 */
function coverageThresholdOf(
  batch: ReturnType<typeof planStudioWetRibbonCarrier>["batches"][number],
): number {
  const bucket = Math.round(batch.coverageCeiling * BUCKETS);
  return bucket === 1 ? 0 : (bucket - 0.5) / BUCKETS;
}

function includedAtThreshold(opacity: number, threshold: number): boolean {
  return threshold <= 0 ? opacity > 0 : opacity >= threshold;
}

function layerDepositsOf(
  plan: ReturnType<typeof planStudioWetRibbonCarrier>,
  layer: StudioWetRibbonFootprint["layers"][number]["layer"],
) {
  return plan.footprints.flatMap((footprint) => {
    const planned = footprint.layers.find(
      (candidate) => candidate.layer === layer,
    );
    return planned
      && Math.max(planned.startOpacity, planned.endOpacity) > 0
      ? [planned]
      : [];
  });
}

function assertLadderMatchesDepositScan(
  plan: ReturnType<typeof planStudioWetRibbonCarrier>,
): void {
  const depositCache = new Map<
    string,
    ReturnType<typeof layerDepositsOf>
  >();
  for (const batch of plan.batches) {
    let deposits = depositCache.get(batch.layer);
    if (!deposits) {
      deposits = layerDepositsOf(plan, batch.layer);
      depositCache.set(batch.layer, deposits);
    }
    const threshold = coverageThresholdOf(batch);
    const fullyIncluded = deposits.filter((deposit) => includedAtThreshold(
      Math.min(deposit.startOpacity, deposit.endOpacity),
      threshold,
    ));
    const partiallyIncluded = deposits.filter((deposit) => includedAtThreshold(
      Math.max(deposit.startOpacity, deposit.endOpacity),
      threshold,
    ));
    const unclipped = new Set(fullyIncluded.map(({ polygon }) => polygon));
    const actualUnclipped = batch.polygons.filter(
      (candidate) => unclipped.has(candidate),
    );

    // Deposits whose whole span clears the rung must be the planner's own frozen polygon, shared by
    // reference — that is what proves no re-quantization happened on the grouped path.
    expect(actualUnclipped.length).toBe(fullyIncluded.length);
    for (let index = 0; index < fullyIncluded.length; index += 1) {
      expect(actualUnclipped[index]).toBe(fullyIncluded[index]!.polygon);
    }
    // Mixed-span deposits contribute a real clip (or fail closed), never an extra polygon.
    expect(batch.polygons.length).toBeGreaterThanOrEqual(fullyIncluded.length);
    expect(batch.polygons.length).toBeLessThanOrEqual(partiallyIncluded.length);
  }
}

describe("studio wet ribbon carrier coverage-ladder grouping", () => {
  it.each([
    ["short", 12],
    ["medium", 120],
    ["long", 900],
  ] as const)(
    "matches a per-rung deposit scan on a %s stroke",
    (_label, pointCount) => {
      const points: number[] = [];
      const pressures: number[] = [];
      for (let index = 0; index < pointCount; index += 1) {
        points.push(20 + index * 3.1, 60 + Math.sin(index * 0.09) * 24);
        pressures.push(0.2 + 0.75 * Math.abs(Math.sin(index * 0.013)));
      }
      const plan = planStudioWetRibbonCarrier(
        planCausalWatercolorBrushDabs({ ...SETTINGS, points, pressures }, true),
        { seed: SETTINGS.seed },
      );

      expect(plan.batches.length).toBeGreaterThan(0);
      assertLadderMatchesDepositScan(plan);
    },
  );

  it("emits every layer's rungs contiguously in ascending coverage order", () => {
    const points: number[] = [];
    const pressures: number[] = [];
    for (let index = 0; index < 200; index += 1) {
      points.push(15 + index * 2.7, 50 + Math.cos(index * 0.07) * 18);
      pressures.push(0.15 + 0.8 * Math.abs(Math.sin(index * 0.021)));
    }
    const plan = planStudioWetRibbonCarrier(
      planCausalWatercolorBrushDabs({ ...SETTINGS, points, pressures }, true),
      { seed: SETTINGS.seed },
    );

    const seenLayers: string[] = [];
    let previousLayer: string | null = null;
    let previousBucket = 0;
    for (const batch of plan.batches) {
      const bucket = Math.round(batch.coverageCeiling * BUCKETS);
      if (batch.layer !== previousLayer) {
        expect(seenLayers).not.toContain(batch.layer);
        seenLayers.push(batch.layer);
        previousLayer = batch.layer;
        previousBucket = 0;
      }
      // A contiguous ladder is what keeps a later input suffix from inserting an intermediate pass.
      expect(bucket).toBe(previousBucket + 1);
      expect(batch.opacity).toBeGreaterThan(0);
      previousBucket = bucket;
    }
    expect(seenLayers.length).toBeGreaterThan(1);
  });

  it.each([
    ["cap - 1", -1],
    ["cap", 0],
    ["cap + 1", 1],
  ] as const)(
    "groups identically across the footprint cap boundary at %s",
    (_label, offset) => {
      const cap = 96;
      const stationCount = cap + offset;
      const dabs: StudioWetRibbonSourceDab[] = Array.from(
        { length: stationCount },
        (_, index) => ({
          x: 12 + index * 1.7,
          y: 40 + Math.sin(index * 0.13) * 20,
          radius: 3 + (index % 5) * 0.4,
          opacity: 0.1 + ((index * 29) % 67) / 100,
          role: "core" as const,
        }),
      );
      const plan = planStudioWetRibbonCarrier(dabs, {
        seed: 41,
        maxFootprints: cap,
      });

      expect(plan.capped).toBe(offset > 0);
      expect(plan.sourceStationCount).toBe(Math.min(cap, stationCount));
      assertLadderMatchesDepositScan(plan);
    },
  );

  it("keeps a fully saturated stroke on the complete ladder", () => {
    const plan = planStudioWetRibbonCarrier(
      Array.from({ length: 24 }, (_, index) => ({
        x: 10 + index * 4,
        y: 30,
        radius: 6,
        opacity: 1,
        role: "core" as const,
      })),
      { seed: 7 },
    );

    const coreBuckets = plan.batches
      .filter(({ layer }) => layer === "core")
      .map(({ coverageCeiling }) => Math.round(coverageCeiling * BUCKETS));
    expect(coreBuckets.at(-1)).toBe(BUCKETS);
    assertLadderMatchesDepositScan(plan);
  });
});
