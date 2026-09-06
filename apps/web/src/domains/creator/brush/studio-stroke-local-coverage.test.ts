import { describe, expect, it } from "vitest";

import {
  normalizeStudioStrokeLocalCoveragePolygon,
  planStudioAngledNibStrokeLocalCoverage,
  studioStrokeLocalCoverageSignedArea,
  type StudioStrokeLocalCoveragePolygon,
} from "./studio-stroke-local-coverage";

type PremultipliedRgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

const NIB_ANGLE = -Math.PI / 6;
const NIB_WIDTH = 10;
const COLOR = [0.2, 0.55, 0.85] as const;
const OPACITY = 0.6;

function rawLegacyPolygons(
  points: readonly number[],
  width = NIB_WIDTH,
  angle = NIB_ANGLE,
): StudioStrokeLocalCoveragePolygon[] {
  const radius = width / 2;
  const nibX = radius * Math.cos(angle);
  const nibY = radius * Math.sin(angle);
  const polygons: StudioStrokeLocalCoveragePolygon[] = [];
  for (let offset = 0; offset + 3 < points.length; offset += 2) {
    const startX = points[offset]!;
    const startY = points[offset + 1]!;
    const endX = points[offset + 2]!;
    const endY = points[offset + 3]!;
    polygons.push({
      points: [
        startX - nibX,
        startY - nibY,
        startX + nibX,
        startY + nibY,
        endX + nibX,
        endY + nibY,
        endX - nibX,
        endY - nibY,
      ],
    });
  }
  return polygons;
}

function isLeft(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  x: number,
  y: number,
): number {
  return (endX - startX) * (y - startY) - (x - startX) * (endY - startY);
}

/** Deterministic Canvas non-zero winding oracle for one logical pixel centre. */
function windingAt(
  polygons: readonly StudioStrokeLocalCoveragePolygon[],
  x: number,
  y: number,
): number {
  let winding = 0;
  for (const polygon of polygons) {
    const pointCount = polygon.points.length / 2;
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const nextIndex = (pointIndex + 1) % pointCount;
      const startX = polygon.points[pointIndex * 2]!;
      const startY = polygon.points[pointIndex * 2 + 1]!;
      const endX = polygon.points[nextIndex * 2]!;
      const endY = polygon.points[nextIndex * 2 + 1]!;
      if (startY <= y) {
        if (endY > y && isLeft(startX, startY, endX, endY, x, y) > 0) {
          winding += 1;
        }
      } else if (
        endY <= y
        && isLeft(startX, startY, endX, endY, x, y) < 0
      ) {
        winding -= 1;
      }
    }
  }
  return winding;
}

function premultiplied(
  color: readonly [number, number, number],
  alpha: number,
): PremultipliedRgba {
  return [
    color[0] * alpha,
    color[1] * alpha,
    color[2] * alpha,
    alpha,
  ];
}

function sourceOver(
  destination: PremultipliedRgba,
  source: PremultipliedRgba,
): PremultipliedRgba {
  const retainedDestination = 1 - source[3];
  return [
    source[0] + destination[0] * retainedDestination,
    source[1] + destination[1] * retainedDestination,
    source[2] + destination[2] * retainedDestination,
    source[3] + destination[3] * retainedDestination,
  ];
}

/**
 * Stroke-local opacity-once oracle: winding magnitude does not multiply opacity. Non-zero
 * coverage produces exactly one premultiplied source layer over the destination.
 */
function renderCoveragePixel(
  polygons: readonly StudioStrokeLocalCoveragePolygon[],
  x: number,
  y: number,
  destination: PremultipliedRgba = [0, 0, 0, 0],
): PremultipliedRgba {
  return windingAt(polygons, x, y) === 0
    ? destination
    : sourceOver(destination, premultiplied(COLOR, OPACITY));
}

function expectPremultipliedMonotonic(
  previous: PremultipliedRgba,
  next: PremultipliedRgba,
): void {
  for (let channel = 0; channel < 4; channel += 1) {
    expect(next[channel]).toBeGreaterThanOrEqual(previous[channel]! - 1e-12);
  }
  expect(next[0]).toBeLessThanOrEqual(next[3] + 1e-12);
  expect(next[1]).toBeLessThanOrEqual(next[3] + 1e-12);
  expect(next[2]).toBeLessThanOrEqual(next[3] + 1e-12);
}

describe("studio stroke-local polygon coverage", () => {
  it("reproduces the legacy reverse-winding erasure and canonicalizes both directions", () => {
    const retraced = [0, 0, 20, 0, 0, 0];
    const legacy = rawLegacyPolygons(retraced);
    const canonical = planStudioAngledNibStrokeLocalCoverage(
      retraced,
      NIB_WIDTH,
      NIB_ANGLE,
    );

    expect(legacy.map((polygon) =>
      Math.sign(studioStrokeLocalCoverageSignedArea(polygon.points))))
      .toEqual([1, -1]);
    expect(windingAt(legacy, 10, 0)).toBe(0);
    expect(renderCoveragePixel(legacy, 10, 0)[3]).toBe(0);

    expect(canonical.polygons).toHaveLength(2);
    expect(canonical.polygons.every((polygon) =>
      studioStrokeLocalCoverageSignedArea(polygon.points) > 0))
      .toBe(true);
    expect(windingAt(canonical.polygons, 10, 0)).toBe(2);
    expect(renderCoveragePixel(canonical.polygons, 10, 0)).toEqual(
      premultiplied(COLOR, OPACITY),
    );
  });

  it("keeps a short live prefix pixel-identical when its reverse segment is committed", () => {
    const livePrefix = planStudioAngledNibStrokeLocalCoverage(
      [0, 0, 20, 0],
      NIB_WIDTH,
      NIB_ANGLE,
    );
    const committed = planStudioAngledNibStrokeLocalCoverage(
      [0, 0, 20, 0, 0, 0],
      NIB_WIDTH,
      NIB_ANGLE,
    );
    const livePixel = renderCoveragePixel(livePrefix.polygons, 10, 0);
    const committedPixel = renderCoveragePixel(committed.polygons, 10, 0);

    expect(livePixel).toEqual(premultiplied(COLOR, OPACITY));
    expect(committedPixel).toEqual(livePixel);
    expectPremultipliedMonotonic(livePixel, committedPixel);
  });

  it("never peels premultiplied colour or alpha across a long repeated retrace", () => {
    const points: number[] = [0, 0];
    for (let segmentIndex = 0; segmentIndex < 128; segmentIndex += 1) {
      points.push(segmentIndex % 2 === 0 ? 40 : 0, 0);
    }
    let previous = [0, 0, 0, 0] as PremultipliedRgba;
    for (let pointCount = 2; pointCount <= points.length / 2; pointCount += 1) {
      const prefix = points.slice(0, pointCount * 2);
      const plan = planStudioAngledNibStrokeLocalCoverage(prefix, NIB_WIDTH);
      const pixel = renderCoveragePixel(plan.polygons, 20, 0);
      expectPremultipliedMonotonic(previous, pixel);
      if (pointCount >= 2) {
        expect(pixel).toEqual(premultiplied(COLOR, OPACITY));
      }
      previous = pixel;
    }

    const committed = planStudioAngledNibStrokeLocalCoverage(points, NIB_WIDTH);
    expect(committed.acceptedSegmentCount).toBe(128);
    expect(renderCoveragePixel(committed.polygons, 20, 0)).toEqual(previous);
  });

  it("keeps every sampled self-crossing pixel monotonic as the live prefix grows", () => {
    const points = [
      -24, -18,
      24, 18,
      -24, 18,
      24, -18,
      -24, -18,
      24, 18,
    ];
    const samplePixels = [
      [-3, -2],
      [0, 0],
      [3, 2],
      [-8, 6],
      [8, -6],
    ] as const;
    const previous = new Map<string, PremultipliedRgba>();

    for (let pointCount = 2; pointCount <= points.length / 2; pointCount += 1) {
      const plan = planStudioAngledNibStrokeLocalCoverage(
        points.slice(0, pointCount * 2),
        NIB_WIDTH,
      );
      for (const [x, y] of samplePixels) {
        const key = `${x}:${y}`;
        const before = previous.get(key) ?? [0, 0, 0, 0];
        const pixel = renderCoveragePixel(plan.polygons, x, y);
        expectPremultipliedMonotonic(before, pixel);
        previous.set(key, pixel);
      }
    }
  });

  it("maps retained brush pressure into a continuous variable-width nib", () => {
    const points = [0, 0, 20, 0, 40, 0];
    const lightToHeavy = planStudioAngledNibStrokeLocalCoverage(
      points,
      NIB_WIDTH,
      NIB_ANGLE,
      { profileId: "brush", pressures: [0, 0.5, 1] },
    );
    const heavyToLight = planStudioAngledNibStrokeLocalCoverage(
      points,
      NIB_WIDTH,
      NIB_ANGLE,
      { profileId: "brush", pressures: [1, 0.5, 0] },
    );

    expect(lightToHeavy.polygons).toHaveLength(2);
    expect(heavyToLight.polygons).toHaveLength(2);
    const firstWidth = (plan: typeof lightToHeavy) => Math.hypot(
      plan.polygons[0]!.points[2]! - plan.polygons[0]!.points[0]!,
      plan.polygons[0]!.points[3]! - plan.polygons[0]!.points[1]!,
    );
    expect(firstWidth(heavyToLight)).toBeGreaterThan(firstWidth(lightToHeavy) * 2);
    expect(lightToHeavy.polygons.every((polygon) => (
      studioStrokeLocalCoverageSignedArea(polygon.points) > 0
    ))).toBe(true);
  });

  it("keeps source-over monotonic over an existing same-colour destination", () => {
    const coverage = planStudioAngledNibStrokeLocalCoverage(
      [0, 0, 20, 0, 0, 0],
      NIB_WIDTH,
    );
    let pixel = premultiplied(COLOR, 0.35);
    for (let stroke = 0; stroke < 12; stroke += 1) {
      const next = renderCoveragePixel(coverage.polygons, 10, 0, pixel);
      expectPremultipliedMonotonic(pixel, next);
      pixel = next;
    }
    expect(pixel[3]).toBeGreaterThan(0.9999);
  });

  it("keeps a mark with no resolvable tonal range on the single legacy coverage fill", () => {
    const points = [0, 0, 20, 0, 40, 0, 60, 0];
    const constant = planStudioAngledNibStrokeLocalCoverage(
      points,
      NIB_WIDTH,
      NIB_ANGLE,
      { profileId: "brush", pressures: [0.7, 0.7, 0.7, 0.7], elementOpacity: 0.6 },
    );
    const legacy = planStudioAngledNibStrokeLocalCoverage(points, NIB_WIDTH, NIB_ANGLE);

    // One shell carrying every polygon at the element's own opacity IS the historical emission:
    // both renderers take their byte-identical single-fill branch on exactly this shape.
    for (const plan of [constant, legacy]) {
      expect(plan.shells).toHaveLength(1);
      expect(plan.shells[0]!.polygons).toBe(plan.polygons);
    }
    expect(constant.shells[0]!.opacity).toBe(0.6);
    expect(legacy.shells[0]!.opacity).toBe(1);
  });

  it("folds cumulative density shells onto a monotone tone that peaks at the element opacity", () => {
    const points: number[] = [];
    const pressures: number[] = [];
    for (let index = 0; index < 24; index += 1) {
      points.push(index * 8, 0);
      pressures.push(0.1 + 0.85 * Math.sin((Math.PI * index) / 23));
    }
    const elementOpacity = 0.8;
    const plan = planStudioAngledNibStrokeLocalCoverage(
      points,
      NIB_WIDTH,
      NIB_ANGLE,
      { profileId: "brush", pressures, elementOpacity },
    );

    expect(plan.shells.length).toBeGreaterThan(1);
    // Shell 0 is the whole mark, so the silhouette is the same set of polygons as before.
    expect(plan.shells[0]!.polygons).toBe(plan.polygons);

    const folds: number[] = [];
    let transmittance = 1;
    for (const [index, shell] of plan.shells.entries()) {
      // Nested: every shell is a subset of the one outside it, which is what makes a pixel's cover
      // set a prefix and lets the fold telescope.
      const outer = new Set(plan.shells[index - 1]?.polygons ?? shell.polygons);
      expect(shell.polygons.every((polygon) => outer.has(polygon))).toBe(true);
      expect(shell.opacity).toBeGreaterThanOrEqual(0);
      expect(shell.opacity).toBeLessThanOrEqual(1);
      transmittance *= 1 - shell.opacity;
      folds.push(1 - transmittance);
    }

    for (const [index, fold] of folds.entries()) {
      if (index > 0) expect(fold).toBeGreaterThan(folds[index - 1]!);
      // A pixel is only ever covered by a PREFIX of the shells, so no pixel — including one under
      // a self-crossing, which merely lands on the deeper band's prefix — can exceed this.
      expect(fold).toBeLessThanOrEqual(elementOpacity + 1e-9);
    }
    // The heaviest touch still lands on exactly the tone the flat union painted.
    expect(folds.at(-1)).toBeCloseTo(elementOpacity, 10);
  });

  it("gives the disjoint bands the tone the cumulative shells fold onto, polygon for polygon", () => {
    // The two forms are what keep canvas and SVG painting the same picture from the same plan: SVG
    // has no private surface so it composites the cumulative shells, while the canvas paints each
    // band ONCE into an offscreen with destination-over. If these ever disagreed, the exported file
    // would stop matching the artboard — so the equivalence is asserted rather than reasoned about.
    const points: number[] = [];
    const pressures: number[] = [];
    for (let index = 0; index < 24; index += 1) {
      points.push(index * 8, 0);
      pressures.push(0.1 + 0.85 * Math.sin((Math.PI * index) / 23));
    }
    const elementOpacity = 0.8;
    const plan = planStudioAngledNibStrokeLocalCoverage(
      points,
      NIB_WIDTH,
      NIB_ANGLE,
      { profileId: "brush", pressures, elementOpacity },
    );

    expect(plan.bands.length).toBe(plan.shells.length);
    expect(plan.bands.length).toBeGreaterThan(1);
    // Darkest first — the order destination-over needs, since the first band to reach a pixel is
    // the one that keeps it.
    for (const [index, band] of plan.bands.entries()) {
      if (index > 0) expect(band.band).toBeLessThan(plan.bands[index - 1]!.band);
    }

    // Disjoint and complete: every polygon of the mark sits in exactly one band.
    const seen = new Map<unknown, number>();
    for (const band of plan.bands) {
      for (const polygon of band.polygons) {
        expect(seen.has(polygon)).toBe(false);
        seen.set(polygon, band.opacity);
      }
    }
    expect(seen.size).toBe(plan.polygons.length);
    for (const polygon of plan.polygons) expect(seen.has(polygon)).toBe(true);

    // And the tone matches: a polygon's band alpha is what the shells covering that polygon fold
    // onto. That is the whole equivalence — same picture, one fill per polygon instead of ~21.
    for (const polygon of plan.polygons) {
      let transmittance = 1;
      for (const shell of plan.shells) {
        if (shell.polygons.includes(polygon)) transmittance *= 1 - shell.opacity;
      }
      expect(seen.get(polygon)).toBeCloseTo(1 - transmittance, 10);
    }
  });

  it("puts the mark's peak at the head of the bands, on exactly the element opacity", () => {
    // The canvas renderer leans on both halves of this. It normalises the raster by bands[0] so
    // that an overlap between two bands clamps at the deepest one instead of summing past it, and
    // it hands bands[0] to the Shape as the mark's opacity. If the head stopped being the peak the
    // mark would be painted too dark; if the peak stopped being the element opacity, a brush
    // stroke would no longer honour its own opacity setting.
    for (const elementOpacity of [1, 0.85, 0.4]) {
      const points: number[] = [];
      const pressures: number[] = [];
      for (let index = 0; index < 24; index += 1) {
        points.push(index * 8, 0);
        pressures.push(0.1 + 0.85 * Math.sin((Math.PI * index) / 23));
      }
      const plan = planStudioAngledNibStrokeLocalCoverage(points, NIB_WIDTH, NIB_ANGLE, {
        profileId: "brush",
        pressures,
        elementOpacity,
      });
      expect(plan.bands.length, `${elementOpacity}`).toBeGreaterThan(1);
      const peak = Math.max(...plan.bands.map((band) => band.opacity));
      expect(plan.bands[0]!.opacity, `${elementOpacity} head is the peak`).toBe(peak);
      expect(plan.bands[0]!.opacity, `${elementOpacity} peak is the opacity`)
        .toBeCloseTo(elementOpacity, 10);
    }
  });

  it("keeps the disjoint band form on the single legacy layer when there is no tonal range", () => {
    const plan = planStudioAngledNibStrokeLocalCoverage(
      [0, 0, 20, 0, 40, 0, 60, 0],
      NIB_WIDTH,
      NIB_ANGLE,
      { profileId: "brush", pressures: [0.7, 0.7, 0.7, 0.7], elementOpacity: 0.6 },
    );
    // Same object, not merely equal: "no resolvable tonal range" has to be ONE condition, or the
    // canvas could take its tonal path while SVG takes its byte-identical legacy one.
    expect(plan.bands).toBe(plan.shells);
    expect(plan.bands[0]!.polygons).toBe(plan.polygons);
  });

  it("copies, freezes, bounds, and rejects malformed or degenerate coverage geometry", () => {
    const input = [0, 0, 20, 0, 0, 0];
    const plan = planStudioAngledNibStrokeLocalCoverage(input, NIB_WIDTH);
    input[2] = 999;

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.polygons)).toBe(true);
    expect(Object.isFrozen(plan.polygons[0])).toBe(true);
    expect(Object.isFrozen(plan.polygons[0]!.points)).toBe(true);
    expect(plan.polygons[0]!.points).not.toContain(999);
    expect(planStudioAngledNibStrokeLocalCoverage(
      [0, 0, Number.NaN, 1],
      NIB_WIDTH,
    ).polygons).toEqual([]);
    expect(planStudioAngledNibStrokeLocalCoverage([0, 0, 1, 0], 0).polygons)
      .toEqual([]);
    expect(normalizeStudioStrokeLocalCoveragePolygon([0, 0, 1, 0, 2, 0]))
      .toBeNull();
  });
});
