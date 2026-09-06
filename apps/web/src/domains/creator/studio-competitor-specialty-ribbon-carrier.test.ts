import { describe, expect, it } from "vitest";

import {
  studioBrushDynamicsSettingsForBrushId,
  type StudioDynamicBrushDab,
} from "./brush/studio-brush-dynamics";
import { resolveStudioDynamicBrushMaterialIdentity } from "./brush/studio-dry-media-dynamic-bridge";
import { exportPageToSvg } from "./export/studio-svg-export";
import {
  appendStudioCausalDynamicBrushDepositsV3,
  beginStudioCausalDynamicBrushDepositV3,
  planStudioCausalDynamicBrushDepositsV3,
  type StudioCausalDynamicBrushSampleV2,
} from "./studio-causal-dynamic-brush-deposit-v2";
import {
  planStudioCompetitorSpecialtyRibbonCarrier,
  STUDIO_COMPETITOR_SPECIALTY_RIBBON_CARRIER_VERSION,
  STUDIO_COMPETITOR_SPECIALTY_RIBBON_CATALOG_IDS,
  STUDIO_COMPETITOR_SPECIALTY_RIBBON_MAX_CONTOURS,
  STUDIO_COMPETITOR_SPECIALTY_RIBBON_MAX_STATIONS,
  studioCompetitorSpecialtyRibbonCarrierOwnsMaterial,
  studioCompetitorSpecialtyRibbonCarrierWorkMultiplier,
  type StudioCompetitorSpecialtyRibbonCatalogId,
  type StudioCompetitorSpecialtyRibbonSourceMark,
} from "./studio-competitor-specialty-ribbon-carrier";
import {
  planStudioDynamicBrushCoverageMarks,
  renderStudioDynamicBrushCoverageMark,
  type StudioDynamicBrushLegacyDestinationContext,
} from "./studio-dynamic-brush-coverage-renderer";

const EXPECTED_PROFILE = Object.freeze({
  "hard-airbrush": ["hard-airbrush-envelope", 1],
  "erodible-pencil": ["progressive-erodible-tip", 1],
  "paint-tube": ["extruded-paint-bead", 3],
  "tangent-normal-brush": ["tangent-normal-vector", 1],
} as const);

function dynamics(id: StudioCompetitorSpecialtyRibbonCatalogId) {
  const result = studioBrushDynamicsSettingsForBrushId(id);
  if (!result) throw new Error(`missing dynamics: ${id}`);
  return result;
}

function identity(id: StudioCompetitorSpecialtyRibbonCatalogId) {
  const result = resolveStudioDynamicBrushMaterialIdentity(id, id);
  if (!result) throw new Error(`missing material identity: ${id}`);
  return result;
}

function dabs(count = 8): readonly StudioDynamicBrushDab[] {
  const result: StudioDynamicBrushDab[] = [];
  for (let index = 0; index < count; index += 1) {
    const sourceX = 18 + index * 6.5;
    const sourceY = 42 + Math.sin(index * 0.39) * 8;
    const previous = result[index - 1];
    const deltaX = previous ? sourceX - previous.sourceX : 1;
    const deltaY = previous ? sourceY - previous.sourceY : 0;
    const direction = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    const distanceFromPrevious = previous
      ? Math.hypot(deltaX, deltaY)
      : 0;
    const distanceFromStrokeStart =
      (previous?.distanceFromStrokeStart ?? 0) + distanceFromPrevious;
    const size = 24 + Math.sin(index * 0.27) * 2.5;
    const opacity = 0.88;
    const flow = 0.82;
    const contactFactor = size * opacity * flow;
    const contactLoadFromStrokeStart = previous
      ? (
          (previous.contactLoadFromStrokeStart ?? 0)
          + distanceFromPrevious
            * ((previous.contactFactor ?? contactFactor) + contactFactor) / 2
        )
      : 0;
    result.push(Object.freeze({
      index,
      progress: index / Math.max(1, count - 1),
      sourceX,
      sourceY,
      direction,
      distanceFromPrevious,
      distanceFromStrokeStart,
      contactLoadFromStrokeStart,
      contactFactor,
      ...(previous
        ? {
            segmentStartFrame: {
              index: previous.index,
              sourceX: previous.sourceX,
              sourceY: previous.sourceY,
              direction: previous.direction ?? previous.angle,
              size: previous.size,
              roundness: previous.roundness,
              distanceFromStrokeStart: previous.distanceFromStrokeStart!,
              contactLoadFromStrokeStart:
                previous.contactLoadFromStrokeStart!,
              contactFactor: previous.contactFactor!,
            },
          }
        : {}),
      x: sourceX + (index % 2 === 0 ? 0.17 : -0.13),
      y: sourceY + (index % 3 === 0 ? -0.11 : 0.16),
      size,
      opacity,
      flow,
      spacing: 3.8,
      scatter: 0.14,
      angle: direction,
      roundness: 0.74 + Math.sin(index * 0.17) * 0.08,
    }));
  }
  return Object.freeze(result);
}

function marks(
  plannedDabs: readonly StudioDynamicBrushDab[],
): readonly StudioCompetitorSpecialtyRibbonSourceMark[] {
  return Object.freeze(plannedDabs.map((dab) => Object.freeze({
    x: dab.x,
    y: dab.y,
    radiusX: dab.size / 2,
    radiusY: dab.size / 2 * dab.roundness,
    angleRadians: dab.angle * Math.PI / 180,
    alpha: dab.opacity * dab.flow,
    color: "#294860",
  })));
}

function straightWearDabs(step: number, length = 600): readonly StudioDynamicBrushDab[] {
  const result: StudioDynamicBrushDab[] = [];
  const size = 12;
  const opacity = 0.8;
  const flow = 0.7;
  const contactFactor = size * opacity * flow;
  for (let distance = 0, index = 0; distance <= length; distance += step, index += 1) {
    const x = Math.min(length, distance);
    const previous = result.at(-1);
    const distanceFromPrevious = previous ? x - previous.sourceX : 0;
    const contactLoadFromStrokeStart = x * contactFactor;
    result.push(Object.freeze({
      index,
      progress: x / length,
      sourceX: x,
      sourceY: 40,
      direction: 0,
      distanceFromPrevious,
      distanceFromStrokeStart: x,
      contactLoadFromStrokeStart,
      contactFactor,
      ...(previous
        ? {
            segmentStartFrame: {
              index: previous.index,
              sourceX: previous.sourceX,
              sourceY: previous.sourceY,
              direction: 0,
              size: previous.size,
              roundness: previous.roundness,
              distanceFromStrokeStart: previous.distanceFromStrokeStart!,
              contactLoadFromStrokeStart:
                previous.contactLoadFromStrokeStart!,
              contactFactor: previous.contactFactor!,
            },
          }
        : {}),
      x,
      y: 40,
      size,
      opacity,
      flow,
      spacing: step,
      scatter: 0,
      angle: 0,
      roundness: 0.7,
    }));
    if (x === length) break;
  }
  return Object.freeze(result);
}

function signedArea(points: readonly number[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += points[index]! * points[next + 1]!
      - points[next]! * points[index + 1]!;
  }
  return area / 2;
}

function pointInPolygon(
  x: number,
  y: number,
  polygon: readonly number[],
): boolean {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 2;
    current < polygon.length;
    previous = current, current += 2
  ) {
    const currentX = polygon[current]!;
    const currentY = polygon[current + 1]!;
    const previousX = polygon[previous]!;
    const previousY = polygon[previous + 1]!;
    const segmentLength = Math.hypot(previousX - currentX, previousY - currentY);
    const cross = Math.abs(
      (x - currentX) * (previousY - currentY)
      - (y - currentY) * (previousX - currentX),
    );
    if (
      segmentLength > 0
      && cross / segmentLength <= 1e-6
      && x >= Math.min(currentX, previousX) - 1e-6
      && x <= Math.max(currentX, previousX) + 1e-6
      && y >= Math.min(currentY, previousY) - 1e-6
      && y <= Math.max(currentY, previousY) + 1e-6
    ) return true;
    if (
      (currentY > y) !== (previousY > y)
      && x < (
        (previousX - currentX) * (y - currentY)
        / (previousY - currentY) + currentX
      )
    ) inside = !inside;
  }
  return inside;
}

function unionAlphaAt(
  mark: Readonly<{
    alpha: number;
    ribbon: Readonly<{ polygons: readonly (readonly number[])[] }>;
  }>,
  x: number,
  y: number,
): number {
  return mark.ribbon.polygons.some((polygon) => pointInPolygon(x, y, polygon))
    ? mark.alpha
    : 0;
}

function fixtureDabs(
  points: readonly (readonly [number, number])[],
): readonly StudioDynamicBrushDab[] {
  let distanceFromStrokeStart = 0;
  let contactLoadFromStrokeStart = 0;
  const size = 20;
  const opacity = 0.82;
  const flow = 0.74;
  const contactFactor = size * opacity * flow;
  return Object.freeze(points.map(([sourceX, sourceY], index) => {
    const previousPoint = points[index - 1];
    const deltaX = previousPoint ? sourceX - previousPoint[0] : 1;
    const deltaY = previousPoint ? sourceY - previousPoint[1] : 0;
    const direction = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    const distanceFromPrevious = previousPoint
      ? Math.hypot(deltaX, deltaY)
      : 0;
    distanceFromStrokeStart += distanceFromPrevious;
    contactLoadFromStrokeStart += distanceFromPrevious * contactFactor;
    return Object.freeze({
      index,
      progress: index / Math.max(1, points.length - 1),
      sourceX,
      sourceY,
      direction,
      distanceFromPrevious,
      distanceFromStrokeStart,
      contactLoadFromStrokeStart,
      contactFactor,
      ...(previousPoint
        ? {
            segmentStartFrame: {
              index: index - 1,
              sourceX: previousPoint[0],
              sourceY: previousPoint[1],
              direction: index > 1
                ? Math.atan2(
                    previousPoint[1] - points[index - 2]![1],
                    previousPoint[0] - points[index - 2]![0],
                  ) * 180 / Math.PI
                : direction,
              size,
              roundness: 0.8,
              distanceFromStrokeStart:
                distanceFromStrokeStart - distanceFromPrevious,
              contactLoadFromStrokeStart:
                contactLoadFromStrokeStart
                  - distanceFromPrevious * contactFactor,
              contactFactor,
            },
          }
        : {}),
      x: sourceX,
      y: sourceY,
      size,
      opacity,
      flow,
      spacing: 4,
      scatter: 0,
      angle: direction,
      roundness: 0.8,
    });
  }));
}

describe("competitor specialty connected ribbon carrier", () => {
  it.each(STUDIO_COMPETITOR_SPECIALTY_RIBBON_CATALOG_IDS)(
    "owns one exact core identity and emits its distinct connected profile: %s",
    (id) => {
      const plannedDabs = dabs(5);
      const result = planStudioCompetitorSpecialtyRibbonCarrier({
        dabs: plannedDabs,
        marks: marks(plannedDabs),
        materialIdentity: identity(id),
        dynamics: dynamics(id),
      });

      expect(studioCompetitorSpecialtyRibbonCarrierOwnsMaterial(
        identity(id),
        dynamics(id),
      )).toBe(true);
      expect(studioCompetitorSpecialtyRibbonCarrierWorkMultiplier(
        identity(id),
        dynamics(id),
      )).toBe(EXPECTED_PROFILE[id][1]);
      expect(result.applied).toBe(true);
      if (!result.applied) return;
      expect(result).toMatchObject({
        catalogId: id,
        semanticProfile: EXPECTED_PROFILE[id][0],
      });
      expect(result.marks).toHaveLength(1);
      expect(result.marks[0]?.ribbon).toMatchObject({
        kind: "competitor-specialty-ribbon-polygon",
        version: STUDIO_COMPETITOR_SPECIALTY_RIBBON_CARRIER_VERSION,
        role: "stroke-union",
        semanticProfile: EXPECTED_PROFILE[id][0],
      });
      expect(result.marks[0]!.ribbon.polygons).toHaveLength(
        plannedDabs.length * EXPECTED_PROFILE[id][1],
      );
      expect(result.marks.every((mark) => (
        mark.ribbon.polygons.every((polygon) => (
          polygon.length >= 8
          && polygon.every(Number.isFinite)
        ))
        && !("texture" in mark)
        && !("falloff" in mark)
      ))).toBe(true);
    },
  );

  it("uses three semantic paint-relief shades and direction-encoded normal colours", () => {
    const plannedDabs = dabs(6);
    const paintTube = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: plannedDabs,
      marks: marks(plannedDabs),
      materialIdentity: identity("paint-tube"),
      dynamics: dynamics("paint-tube"),
    });
    const normal = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: plannedDabs,
      marks: marks(plannedDabs),
      materialIdentity: identity("tangent-normal-brush"),
      dynamics: dynamics("tangent-normal-brush"),
    });

    expect(paintTube.applied).toBe(true);
    expect(normal.applied).toBe(true);
    if (!paintTube.applied || !normal.applied) return;
    const paintContours = paintTube.marks[0]!.ribbon.polygons;
    expect(signedArea(paintContours[0]!)).toBeGreaterThan(0);
    expect(signedArea(paintContours[1]!)).toBeGreaterThan(0);
    expect(signedArea(paintContours[2]!)).toBeGreaterThan(0);
    expect(paintTube.marks[0]!.ribbon.contourStyles).toHaveLength(18);
    expect(paintTube.marks[0]!.ribbon.contourStyles?.[0]).toEqual({
        role: "body",
        color: "#294860",
        alphaMultiplier: 1,
      });
    expect(paintTube.marks[0]!.ribbon.contourStyles?.[6]).toEqual({
        role: "highlight",
        color: expect.stringMatching(/^#[0-9a-f]{6}$/),
        alphaMultiplier: 0.58,
      });
    expect(paintTube.marks[0]!.ribbon.contourStyles?.[12]).toEqual({
        role: "shadow",
        color: expect.stringMatching(/^#[0-9a-f]{6}$/),
        alphaMultiplier: 0.46,
      });
    expect(new Set(
      paintTube.marks[0]!.ribbon.contourStyles?.map(({ color }) => color),
    ).size).toBe(3);
    expect(new Set(
      normal.marks[0]!.ribbon.contourStyles?.map(({ color }) => color),
    ).size)
      .toBeGreaterThan(1);
    expect(normal.marks[0]!.ribbon.contourStyles?.every(
      (style) => /^#[0-9a-f]{6}$/.test(style.color),
    ))
      .toBe(true);
  });

  it("paints body, highlight and shadow as three real Canvas contours", () => {
    const plannedDabs = dabs(3);
    const result = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: plannedDabs,
      marks: marks(plannedDabs),
      materialIdentity: identity("paint-tube"),
      dynamics: dynamics("paint-tube"),
    });
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    const fills: Array<{ color: string; alpha: number }> = [];
    const context = {
      globalAlpha: 1,
      fillStyle: "",
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill(this: { fillStyle: string; globalAlpha: number }) {
        fills.push({
          color: String(this.fillStyle),
          alpha: this.globalAlpha,
        });
      },
    } as unknown as StudioDynamicBrushLegacyDestinationContext;

    renderStudioDynamicBrushCoverageMark(context, result.marks[0]!);

    expect(fills).toHaveLength(3);
    expect(fills.map(({ color }) => color)).toEqual([
      result.marks[0]!.ribbon.contourStyles?.[0]?.color,
      result.marks[0]!.ribbon.contourStyles?.[3]?.color,
      result.marks[0]!.ribbon.contourStyles?.[6]?.color,
    ]);
    expect(fills.map(({ alpha }) => alpha)).toEqual(
      [1, 0.58, 0.46].map(
        (alphaMultiplier) => result.marks[0]!.alpha * alphaMultiplier,
      ),
    );
  });

  it("uses one rounded 16-vertex hard-airbrush tap followed by scallop-free swept segments", () => {
    const plannedDabs = dabs(9);
    const result = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: plannedDabs,
      marks: marks(plannedDabs),
      materialIdentity: identity("hard-airbrush"),
      dynamics: dynamics("hard-airbrush"),
    });

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    const union = result.marks[0]!;
    const tapPoints = union.ribbon.polygons[0]!;
    expect(union.ribbon.role).toBe("stroke-union");
    expect(tapPoints).toHaveLength(32);
    const radialDistances: number[] = [];
    for (let index = 0; index < tapPoints.length; index += 2) {
      radialDistances.push(Math.hypot(
        tapPoints[index]! - plannedDabs[0]!.sourceX,
        tapPoints[index + 1]! - plannedDabs[0]!.sourceY,
      ));
    }
    expect(Math.max(...radialDistances) - Math.min(...radialDistances))
      .toBeLessThan(0.001);
    expect(result.marks[0]!.ribbon.polygons.slice(1).every(
      (polygon) => polygon.length >= 8 && polygon.length <= 12,
    )).toBe(true);
  });

  it("drives erodible wear from distance and integrated contact instead of dab count", () => {
    const fine = straightWearDabs(6);
    const coarse = straightWearDabs(12);
    const finePlan = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: fine,
      marks: marks(fine),
      materialIdentity: identity("erodible-pencil"),
      dynamics: dynamics("erodible-pencil"),
    });
    const coarsePlan = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: coarse,
      marks: marks(coarse),
      materialIdentity: identity("erodible-pencil"),
      dynamics: dynamics("erodible-pencil"),
    });

    expect(finePlan.applied).toBe(true);
    expect(coarsePlan.applied).toBe(true);
    if (!finePlan.applied || !coarsePlan.applied) return;
    const finePolygon = finePlan.marks[0]!.ribbon.polygons.at(-1)!;
    const coarsePolygon = coarsePlan.marks[0]!.ribbon.polygons.at(-1)!;
    const endVerticalSpan = (polygon: readonly number[]) => {
      const xs = polygon.filter((_, index) => index % 2 === 0);
      const maximumX = Math.max(...xs);
      const ys = polygon.flatMap((coordinate, index) => (
        index % 2 === 0 && Math.abs(coordinate - maximumX) <= 1e-4
          ? [polygon[index + 1]!]
          : []
      ));
      return Math.max(...ys) - Math.min(...ys);
    };
    const fineSpan = endVerticalSpan(finePolygon);
    const coarseSpan = endVerticalSpan(coarsePolygon);
    expect(fineSpan).toBeCloseTo(coarseSpan, 3);
    const tapYs = finePlan.marks[0]!.ribbon.polygons[0]!
      .filter((_, index) => index % 2 === 1);
    const startSpan = Math.max(...tapYs) - Math.min(...tapYs);
    expect(fineSpan).toBeLessThan(startSpan * 0.9);
  });

  it("keeps causal wear receipts identical across incremental append and full rebuild", () => {
    const settings = dynamics("erodible-pencil");
    const samples: readonly StudioCausalDynamicBrushSampleV2[] = [
      { x: 0, y: 0, pressure: 0.32, tangentialPressure: 0, speed: 0.4, tiltX: 8, tiltY: 18, twist: 0 },
      { x: 64, y: 12, pressure: 0.56, tangentialPressure: 0, speed: 0.5, tiltX: 12, tiltY: 22, twist: 4 },
      { x: 132, y: -6, pressure: 0.82, tangentialPressure: 0, speed: 0.6, tiltX: 18, tiltY: 27, twist: 8 },
      { x: 208, y: 16, pressure: 0.68, tangentialPressure: 0, speed: 0.5, tiltX: 14, tiltY: 24, twist: 12 },
      { x: 296, y: 2, pressure: 0.46, tangentialPressure: 0, speed: 0.4, tiltX: 10, tiltY: 20, twist: 16 },
    ];
    const full = planStudioCausalDynamicBrushDepositsV3({
      points: samples.flatMap(({ x, y }) => [x, y]),
      pressures: samples.map(({ pressure }) => pressure),
      tangentialPressures: samples.map(({ tangentialPressure }) => tangentialPressure),
      speeds: samples.map(({ speed }) => speed),
      tiltXs: samples.map(({ tiltX }) => tiltX),
      tiltYs: samples.map(({ tiltY }) => tiltY),
      twists: samples.map(({ twist }) => twist),
      settings,
    });
    const begun = beginStudioCausalDynamicBrushDepositV3(samples[0]!, settings);
    expect(full.ok).toBe(true);
    expect(begun.ok).toBe(true);
    if (!full.ok || !begun.ok) return;
    const first = appendStudioCausalDynamicBrushDepositsV3(
      begun.state,
      samples.slice(1, 3),
      settings,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const incremental = first.replaceInitialTap
      ? [...first.dabs]
      : [begun.dab, ...first.dabs];
    const second = appendStudioCausalDynamicBrushDepositsV3(
      first.state,
      samples.slice(3),
      settings,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    incremental.push(...second.dabs);

    expect(incremental).toEqual(full.dabs);
    expect(full.dabs.every((dab, index) => (
      Number.isFinite(dab.distanceFromStrokeStart)
      && Number.isFinite(dab.contactLoadFromStrokeStart)
      && Number.isFinite(dab.contactFactor)
      && (
        index === 0
        || (
          dab.distanceFromStrokeStart! >= full.dabs[index - 1]!.distanceFromStrokeStart!
          && dab.contactLoadFromStrokeStart! >= full.dabs[index - 1]!.contactLoadFromStrokeStart!
        )
      )
    ))).toBe(true);
  });

  it("keeps legacy manual dabs without wear receipts deterministic and renderable", () => {
    const legacy = dabs(8).map((dab) => {
      const {
        contactFactor: _contactFactor,
        contactLoadFromStrokeStart: _contactLoad,
        distanceFromStrokeStart: _distance,
        segmentStartFrame,
        ...rest
      } = dab;
      const legacyFrame = segmentStartFrame
        ? {
            index: segmentStartFrame.index,
            sourceX: segmentStartFrame.sourceX,
            sourceY: segmentStartFrame.sourceY,
            direction: segmentStartFrame.direction,
            size: segmentStartFrame.size,
            roundness: segmentStartFrame.roundness,
          }
        : undefined;
      return {
        ...rest,
        ...(legacyFrame ? { segmentStartFrame: legacyFrame } : {}),
      };
    });
    const first = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: legacy,
      marks: marks(legacy),
      materialIdentity: identity("erodible-pencil"),
      dynamics: dynamics("erodible-pencil"),
    });
    const replay = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: legacy,
      marks: marks(legacy),
      materialIdentity: identity("erodible-pencil"),
      dynamics: dynamics("erodible-pencil"),
    });
    expect(first.applied).toBe(true);
    expect(replay).toEqual(first);
  });

  it.each(STUDIO_COMPETITOR_SPECIALTY_RIBBON_CATALOG_IDS)(
    "is deterministic, prefix stable and free of round-dab transport for long strokes: %s",
    (id) => {
      const plannedDabs = dabs(160);
      const full = planStudioCompetitorSpecialtyRibbonCarrier({
        dabs: plannedDabs,
        marks: marks(plannedDabs),
        materialIdentity: identity(id),
        dynamics: dynamics(id),
      });
      const prefixDabs = plannedDabs.slice(0, 73);
      const prefix = planStudioCompetitorSpecialtyRibbonCarrier({
        dabs: prefixDabs,
        marks: marks(prefixDabs),
        materialIdentity: identity(id),
        dynamics: dynamics(id),
      });
      const replay = planStudioCompetitorSpecialtyRibbonCarrier({
        dabs: plannedDabs,
        marks: marks(plannedDabs),
        materialIdentity: identity(id),
        dynamics: dynamics(id),
      });

      expect(full.applied).toBe(true);
      expect(prefix.applied).toBe(true);
      expect(replay).toEqual(full);
      if (!full.applied || !prefix.applied) return;
      expect(full.marks).toHaveLength(1);
      expect(full.marks[0]!.ribbon.role).toBe("stroke-union");
      expect(full.marks[0]!.angleRadians).toBe(0);
      expect(full.marks[0]!.ribbon.polygons).toHaveLength(
        160 * EXPECTED_PROFILE[id][1],
      );
      if (id === "paint-tube") {
        for (let contourIndex = 0; contourIndex < 3; contourIndex += 1) {
          const fullOffset = contourIndex * 160;
          const prefixOffset = contourIndex * 73;
          expect(full.marks[0]!.ribbon.polygons.slice(
            fullOffset,
            fullOffset + 73,
          )).toEqual(prefix.marks[0]!.ribbon.polygons.slice(
            prefixOffset,
            prefixOffset + 73,
          ));
        }
      } else {
        expect(full.marks[0]!.ribbon.polygons.slice(
          0,
          prefix.marks[0]!.ribbon.polygons.length,
        )).toEqual(prefix.marks[0]!.ribbon.polygons);
      }
      expect(full.marks[0]!.ribbon.polygons.every(
        (polygon) => polygon.length >= 8,
      )).toBe(true);
    },
  );

  it("fails closed for wrong identity, malformed geometry, mismatch and both budgets", () => {
    const id = "hard-airbrush";
    const plannedDabs = dabs(2);
    const sourceMarks = marks(plannedDabs);
    const wrongIdentity = resolveStudioDynamicBrushMaterialIdentity(
      "airbrush",
      id,
    );
    const wrong = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: plannedDabs,
      marks: sourceMarks,
      materialIdentity: wrongIdentity ?? undefined,
      dynamics: dynamics(id),
    });
    const mismatch = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: plannedDabs,
      marks: sourceMarks.slice(0, 1),
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });
    const malformed = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: plannedDabs,
      marks: [{ ...sourceMarks[0]!, radiusY: Number.NaN }, sourceMarks[1]!],
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });
    const stationBudget = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: {
        length: STUDIO_COMPETITOR_SPECIALTY_RIBBON_MAX_STATIONS + 1,
      } as unknown as readonly StudioDynamicBrushDab[],
      marks: {
        length: STUDIO_COMPETITOR_SPECIALTY_RIBBON_MAX_STATIONS + 1,
      } as unknown as readonly StudioCompetitorSpecialtyRibbonSourceMark[],
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });
    const contourLength =
      Math.floor(STUDIO_COMPETITOR_SPECIALTY_RIBBON_MAX_CONTOURS / 3) + 1;
    const contourBudget = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: {
        length: contourLength,
      } as unknown as readonly StudioDynamicBrushDab[],
      marks: {
        length: contourLength,
      } as unknown as readonly StudioCompetitorSpecialtyRibbonSourceMark[],
      materialIdentity: identity("paint-tube"),
      dynamics: dynamics("paint-tube"),
    });

    expect(wrong).toMatchObject({
      applied: false,
      reason: "ineligible-material",
    });
    expect(mismatch).toMatchObject({
      applied: false,
      reason: "mark-dab-mismatch",
    });
    expect(malformed).toMatchObject({
      applied: false,
      reason: "invalid-geometry",
    });
    expect(stationBudget).toMatchObject({
      applied: false,
      reason: "station-budget",
    });
    expect(contourBudget).toMatchObject({
      applied: false,
      reason: "contour-budget",
    });
  });

  it.each(STUDIO_COMPETITOR_SPECIALTY_RIBBON_CATALOG_IDS)(
    "replaces every visible primary dab with the specialist coverage path: %s",
    (id) => {
      const plannedDabs = dabs(4);
      const plan = planStudioDynamicBrushCoverageMarks({
        dabVariations: [plannedDabs],
        strokeOrigins: [{
          x: plannedDabs[0]!.sourceX,
          y: plannedDabs[0]!.sourceY,
        }],
        dynamics: dynamics(id),
        materialIdentity: identity(id),
        dynamicSeed: 0x2a7d_94e1,
        stroke: "#294860",
        stampGrid: 3,
        markBudget:
          plannedDabs.length * EXPECTED_PROFILE[id][1],
      });

      expect(plan.ok, id).toBe(true);
      if (!plan.ok) return;
      expect(plan.marks, id).toHaveLength(1);
      expect(plan.marks.every((mark) => (
        mark.ribbon?.kind === "competitor-specialty-ribbon-polygon"
        && mark.ribbon.role === "stroke-union"
        && mark.texture === undefined
        && mark.falloff === undefined
      )), id).toBe(true);
    },
  );

  it.each(STUDIO_COMPETITOR_SPECIALTY_RIBBON_CATALOG_IDS)(
    "exports connected specialist paths without ellipse or alpha-map fallback: %s",
    (id) => {
      const exported = exportPageToSvg({
        width: 320,
        height: 190,
        bg: "#ffffff",
        elements: [{
          id: `competitor-specialty-svg-${id}`,
          type: "draw",
          kind: "freehand",
          mode: "pen",
          brush: id,
          brushCatalogId: id,
          brushDynamics: dynamics(id),
          paintModel: "bounded-flow-v2",
          points: [18, 118, 72, 72, 136, 126, 206, 64, 294, 108],
          pressures: [0.38, 0.64, 0.92, 0.72, 0.48],
          tiltXs: [12, 18, 24, 19, 14],
          tiltYs: [21, 27, 31, 26, 20],
          twists: [2, 5, 8, 11, 14],
          stroke: "#294860",
          strokeWidth: 24,
          opacity: 0.9,
        }],
      });

      expect(exported.skipped, id).toEqual([]);
      expect(exported.svg, id).toContain(
        'data-brush-coverage="competitor-specialty-ribbon"',
      );
      expect(exported.svg, id).toContain(
        `data-brush-material-profile="${EXPECTED_PROFILE[id][0]}"`,
      );
      expect(exported.svg, id).not.toContain(
        'data-brush-coverage="alpha-map"',
      );
      expect(exported.svg, id).not.toContain(
        'data-brush-coverage="ellipse"',
      );
      if (id === "paint-tube") {
        expect(exported.svg).toContain('data-brush-contour-role="body"');
        expect(exported.svg).toContain('data-brush-contour-role="highlight"');
        expect(exported.svg).toContain('data-brush-contour-role="shadow"');
      }
    },
  );

  it.each([
    ["tight curve", [[20, 50], [34, 20], [64, 16], [86, 40], [76, 72], [46, 82], [22, 60]]],
    ["near-180 cusp", [[20, 50], [82, 50], [22, 51]]],
    ["self crossing", [[20, 20], [82, 82], [20, 82], [82, 20]]],
  ] as const)(
    "keeps a bounded, gap-free, non-darkening pixel union through a %s",
    (label, points) => {
      const plannedDabs = fixtureDabs(points);
      const result = planStudioCompetitorSpecialtyRibbonCarrier({
        dabs: plannedDabs,
        marks: marks(plannedDabs),
        materialIdentity: identity("hard-airbrush"),
        dynamics: dynamics("hard-airbrush"),
      });
      expect(result.applied).toBe(true);
      if (!result.applied) return;
      const mark = result.marks[0]!;
      expect(mark.ribbon.role).toBe("stroke-union");
      expect(mark.ribbon.polygons.every((polygon) => (
        polygon.length >= 8
        && polygon.length <= 32
        && polygon.every((coordinate) => Math.abs(coordinate) < 1_000)
      ))).toBe(true);
      for (const [x, y] of points) {
        expect(unionAlphaAt(mark, x, y), `${label} station ${x},${y}`)
          .toBe(mark.alpha);
      }
      if (label === "self crossing") {
        expect(unionAlphaAt(mark, 51, 51)).toBe(mark.alpha);
        expect(mark.alpha).toBeLessThan(1);
      }
    },
  );

  it("keeps straight and curved centerline pixels at one internal flow alpha", () => {
    const points = [[18, 48], [36, 48], [54, 48], [70, 42], [84, 30]] as const;
    const plannedDabs = fixtureDabs(points);
    const result = planStudioCompetitorSpecialtyRibbonCarrier({
      dabs: plannedDabs,
      marks: marks(plannedDabs),
      materialIdentity: identity("hard-airbrush"),
      dynamics: dynamics("hard-airbrush"),
    });
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    const mark = result.marks[0]!;
    const samples = [
      [27, 48],
      [45, 48],
      [62, 45],
      [77, 36],
    ] as const;
    expect(samples.map(([x, y]) => unionAlphaAt(mark, x, y)))
      .toEqual(samples.map(() => mark.alpha));
  });
});
