import { describe, expect, it } from "vitest";

import { studioBrushPackDescriptorById } from "./brush/studio-brush-pack-index";
import { materializeStudioBrushPackDynamics } from "./brush/studio-brush-pack-runtime";
import { resolveStudioDynamicBrushMaterialIdentity } from "./brush/studio-dry-media-dynamic-bridge";
import { exportPageToSvg } from "./export/studio-svg-export";
import { planStudioDynamicBrushCoverageMarks } from "./studio-dynamic-brush-coverage-renderer";
import {
  planStudioProfessionalShelfRibbonCarrier,
  STUDIO_PROFESSIONAL_SHELF_RIBBON_CARRIER_VERSION,
  STUDIO_PROFESSIONAL_SHELF_RIBBON_CATALOG_IDS,
  STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_CONTOURS,
  STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_STATIONS,
  studioProfessionalShelfRibbonCarrierOwnsMaterial,
  studioProfessionalShelfRibbonCarrierWorkMultiplier,
  type StudioProfessionalShelfRibbonCatalogId,
  type StudioProfessionalShelfRibbonSourceMark,
} from "./studio-professional-shelf-ribbon-carrier";

import type { StudioDynamicBrushDab } from "./brush/studio-brush-dynamics";

const RUNTIME_BY_ID = Object.freeze({
  "bristle-round-loaded": "ink-particle",
  "bristle-fan-dry": "dry-media",
  "bristle-flat-streak": "dry-media",
  "oil-filbert": "dry-media",
  "palette-knife-edge": "ink-particle",
} as const satisfies Readonly<
  Record<StudioProfessionalShelfRibbonCatalogId, string>
>);

const EXPECTED_PROFILE = Object.freeze({
  "bristle-round-loaded": ["loaded-round-bristle", 7],
  "bristle-fan-dry": ["dry-fan-bristle", 10],
  "bristle-flat-streak": ["flat-streak-bristle", 8],
  "oil-filbert": ["oil-filbert-bristle", 7],
  "palette-knife-edge": ["palette-knife-edge", 2],
} as const);

function dynamics(id: StudioProfessionalShelfRibbonCatalogId) {
  const result = materializeStudioBrushPackDynamics(id);
  if (!result) throw new Error(`missing dynamics: ${id}`);
  return result;
}

function identity(id: StudioProfessionalShelfRibbonCatalogId) {
  const result = resolveStudioDynamicBrushMaterialIdentity(
    RUNTIME_BY_ID[id],
    id,
  );
  if (!result) throw new Error(`missing material identity: ${id}`);
  return result;
}

function dabs(count = 8): readonly StudioDynamicBrushDab[] {
  const result: StudioDynamicBrushDab[] = [];
  for (let index = 0; index < count; index += 1) {
    const direction = index === 0 ? 0 : 4 + index * 1.75;
    const sourceX = 24 + index * 7;
    const sourceY = 48 + Math.sin(index * 0.45) * 6;
    const previous = result[index - 1];
    result.push({
      index,
      progress: index / Math.max(1, count - 1),
      sourceX,
      sourceY,
      direction,
      distanceFromPrevious: previous
        ? Math.hypot(sourceX - previous.sourceX, sourceY - previous.sourceY)
        : 0,
      ...(previous
        ? {
            segmentStartFrame: {
              index: previous.index,
              sourceX: previous.sourceX,
              sourceY: previous.sourceY,
              direction: previous.direction ?? previous.angle,
              size: previous.size,
              roundness: previous.roundness,
            },
          }
        : {}),
      // Scatter-bearing source marks are intentionally ignored as position authorities by the
      // specialist carrier; canonical source stations own the connected path.
      x: sourceX + (index % 2 === 0 ? 0.22 : -0.18),
      y: sourceY + (index % 3 === 0 ? -0.14 : 0.19),
      size: 28 + Math.sin(index * 0.3) * 3,
      opacity: 0.86,
      flow: 0.74,
      spacing: 5,
      scatter: 0.2,
      angle: direction - 9,
      roundness: 0.52 + Math.sin(index * 0.2) * 0.08,
    });
  }
  return Object.freeze(result);
}

function marks(
  plannedDabs: readonly StudioDynamicBrushDab[],
): readonly StudioProfessionalShelfRibbonSourceMark[] {
  return Object.freeze(plannedDabs.map((dab) => Object.freeze({
    x: dab.x,
    y: dab.y,
    radiusX: dab.size / 2,
    radiusY: dab.size / 2 * dab.roundness,
    angleRadians: dab.angle * Math.PI / 180,
    alpha: dab.opacity * dab.flow,
    color: "#274060",
  })));
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

function unionAlphaNear(
  mark: Parameters<typeof unionAlphaAt>[0],
  x: number,
  y: number,
  radius = 4,
): number {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (unionAlphaAt(mark, x + offsetX, y + offsetY) > 0) return mark.alpha;
    }
  }
  return 0;
}

function fixtureDabs(
  points: readonly (readonly [number, number])[],
): readonly StudioDynamicBrushDab[] {
  return Object.freeze(points.map(([sourceX, sourceY], index) => {
    const previousPoint = points[index - 1];
    const deltaX = previousPoint ? sourceX - previousPoint[0] : 1;
    const deltaY = previousPoint ? sourceY - previousPoint[1] : 0;
    const direction = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
    return Object.freeze({
      index,
      progress: index / Math.max(1, points.length - 1),
      sourceX,
      sourceY,
      direction,
      distanceFromPrevious: previousPoint
        ? Math.hypot(deltaX, deltaY)
        : 0,
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
              size: 20,
              roundness: 0.72,
            },
          }
        : {}),
      x: sourceX,
      y: sourceY,
      size: 20,
      opacity: 0.82,
      flow: 0.74,
      spacing: 4,
      scatter: 0,
      angle: direction,
      roundness: 0.72,
    });
  }));
}

describe("professional shelf connected ribbon carrier", () => {
  it("keeps its expected runtime table identical to the pack descriptor authority", () => {
    // The catalogue descriptor is the single durable source of each preset's runtime carrier.
    // Pinning the carrier's admission table to it means a runtime reassignment must be made at
    // the descriptor (and route contract), never by widening admission with an anonymous
    // special-case pair such as the once-shipped `oil-filbert` + `ink-particle` escape hatch.
    for (const id of STUDIO_PROFESSIONAL_SHELF_RIBBON_CATALOG_IDS) {
      expect(
        studioBrushPackDescriptorById(id)?.runtimeBrushId,
        `${id}: descriptor runtime`,
      ).toBe(RUNTIME_BY_ID[id]);
    }
  });

  it.each(STUDIO_PROFESSIONAL_SHELF_RIBBON_CATALOG_IDS)(
    "owns the exact runtime/catalog pair and emits a distinct connected profile: %s",
    (id) => {
      const plannedDabs = dabs(4);
      const result = planStudioProfessionalShelfRibbonCarrier({
        dabs: plannedDabs,
        marks: marks(plannedDabs),
        materialIdentity: identity(id),
        dynamics: dynamics(id),
      });

      expect(studioProfessionalShelfRibbonCarrierOwnsMaterial(identity(id)))
        .toBe(true);
      expect(studioProfessionalShelfRibbonCarrierWorkMultiplier(
        identity(id),
        dynamics(id),
      )).toBe(EXPECTED_PROFILE[id][1]);
      expect(result.applied).toBe(true);
      if (!result.applied) return;
      expect(result.catalogId).toBe(id);
      expect(result.semanticProfile).toBe(EXPECTED_PROFILE[id][0]);
      expect(result.marks).toHaveLength(1);
      expect(result.marks[0]?.ribbon).toMatchObject({
        kind: "professional-shelf-ribbon-polygon",
        version: STUDIO_PROFESSIONAL_SHELF_RIBBON_CARRIER_VERSION,
        role: "stroke-union",
        semanticProfile: EXPECTED_PROFILE[id][0],
      });
      expect(result.marks[0]?.ribbon.polygons).toHaveLength(
        plannedDabs.length * EXPECTED_PROFILE[id][1],
      );
      expect(result.marks.every((mark) => (
        mark.ribbon.polygons.every((polygon) => (
          polygon.length >= 8
          && polygon.length % 2 === 0
          && polygon.every(Number.isFinite)
        ))
        && !("texture" in mark)
        && !("falloff" in mark)
      ))).toBe(true);
    },
  );

  it("is deterministic and preserves a live prefix byte-for-byte", () => {
    const id = "bristle-fan-dry";
    const plannedDabs = dabs(12);
    const full = planStudioProfessionalShelfRibbonCarrier({
      dabs: plannedDabs,
      marks: marks(plannedDabs),
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });
    const prefix = planStudioProfessionalShelfRibbonCarrier({
      dabs: plannedDabs.slice(0, 7),
      marks: marks(plannedDabs.slice(0, 7)),
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });
    const replay = planStudioProfessionalShelfRibbonCarrier({
      dabs: plannedDabs,
      marks: marks(plannedDabs),
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });

    expect(full.applied).toBe(true);
    expect(prefix.applied).toBe(true);
    expect(replay).toEqual(full);
    if (!full.applied || !prefix.applied) return;
    expect(full.marks[0]!.ribbon.polygons.slice(
      0,
      prefix.marks[0]!.ribbon.polygons.length,
    )).toEqual(prefix.marks[0]!.ribbon.polygons);
    expect(full.marks[0]!.alpha).toBe(prefix.marks[0]!.alpha);
  });

  it("connects long segments without circular dab primitives or scattered-centre drift", () => {
    const id = "oil-filbert";
    const plannedDabs = dabs(160);
    const result = planStudioProfessionalShelfRibbonCarrier({
      dabs: plannedDabs,
      marks: marks(plannedDabs),
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.marks).toHaveLength(1);
    expect(result.marks[0]!.ribbon.role).toBe("stroke-union");
    expect(result.marks[0]!.angleRadians).toBe(0);
    expect(result.marks[0]!.ribbon.polygons).toHaveLength(
      160 * EXPECTED_PROFILE[id][1],
    );
    expect(result.marks[0]!.ribbon.polygons.every((polygon) => (
      polygon.length >= 8
      && polygon.length <= 12
    ))).toBe(true);
    expect(new Set(result.marks.map(({ ribbon }) => ribbon.kind))).toEqual(
      new Set(["professional-shelf-ribbon-polygon"]),
    );
  });

  it("fails closed for identity mismatches, malformed geometry, count mismatch and budget overflow", () => {
    const id = "bristle-round-loaded";
    const plannedDabs = dabs(2);
    const sourceMarks = marks(plannedDabs);
    const wrongRuntime = resolveStudioDynamicBrushMaterialIdentity(
      "dry-media",
      id,
    );
    const mismatch = planStudioProfessionalShelfRibbonCarrier({
      dabs: plannedDabs,
      marks: sourceMarks,
      materialIdentity: wrongRuntime ?? undefined,
      dynamics: dynamics(id),
    });
    // Exactly the pair a deleted transitional special-case used to admit. No production or
    // persistence path emits it, so admission must stay fail-closed instead of guessing.
    const retiredSpecialCasePair = planStudioProfessionalShelfRibbonCarrier({
      dabs: plannedDabs,
      marks: sourceMarks,
      materialIdentity: resolveStudioDynamicBrushMaterialIdentity(
        "ink-particle",
        "oil-filbert",
      ) ?? undefined,
      dynamics: dynamics("oil-filbert"),
    });
    const countMismatch = planStudioProfessionalShelfRibbonCarrier({
      dabs: plannedDabs,
      marks: sourceMarks.slice(0, 1),
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });
    const malformed = planStudioProfessionalShelfRibbonCarrier({
      dabs: plannedDabs,
      marks: [
        { ...sourceMarks[0]!, radiusX: Number.NaN },
        sourceMarks[1]!,
      ],
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });
    const budget = planStudioProfessionalShelfRibbonCarrier({
      dabs: {
        length: STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_STATIONS + 1,
      } as unknown as readonly StudioDynamicBrushDab[],
      marks: {
        length: STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_STATIONS + 1,
      } as unknown as readonly StudioProfessionalShelfRibbonSourceMark[],
      materialIdentity: identity(id),
      dynamics: dynamics(id),
    });
    const contourBudget = planStudioProfessionalShelfRibbonCarrier({
      dabs: {
        length:
          Math.floor(
            STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_CONTOURS
              / EXPECTED_PROFILE["bristle-fan-dry"][1],
          ) + 1,
      } as unknown as readonly StudioDynamicBrushDab[],
      marks: {
        length:
          Math.floor(
            STUDIO_PROFESSIONAL_SHELF_RIBBON_MAX_CONTOURS
              / EXPECTED_PROFILE["bristle-fan-dry"][1],
          ) + 1,
      } as unknown as readonly StudioProfessionalShelfRibbonSourceMark[],
      materialIdentity: identity("bristle-fan-dry"),
      dynamics: dynamics("bristle-fan-dry"),
    });

    expect(mismatch).toMatchObject({
      applied: false,
      reason: "ineligible-material",
    });
    expect(retiredSpecialCasePair).toMatchObject({
      applied: false,
      reason: "ineligible-material",
    });
    expect(countMismatch).toMatchObject({
      applied: false,
      reason: "mark-dab-mismatch",
    });
    expect(malformed).toMatchObject({
      applied: false,
      reason: "invalid-geometry",
    });
    expect(budget).toMatchObject({
      applied: false,
      reason: "station-budget",
    });
    expect(contourBudget).toMatchObject({
      applied: false,
      reason: "contour-budget",
    });
  });

  it.each(STUDIO_PROFESSIONAL_SHELF_RIBBON_CATALOG_IDS)(
    "replaces the product coverage path with one specialist mark per dab: %s",
    (id) => {
      const plannedDabs = dabs(3);
      const plan = planStudioDynamicBrushCoverageMarks({
        dabVariations: [plannedDabs],
        strokeOrigins: [{
          x: plannedDabs[0]!.sourceX,
          y: plannedDabs[0]!.sourceY,
        }],
        dynamics: dynamics(id),
        materialIdentity: identity(id),
        dynamicSeed: 0x73e4_1a2b,
        stroke: "#274060",
        stampGrid: 3,
        markBudget: plannedDabs.length * EXPECTED_PROFILE[id][1],
      });

      expect(plan.ok, id).toBe(true);
      if (!plan.ok) return;
      expect(plan.marks, id).toHaveLength(1);
      expect(plan.marks.every((mark) => (
        mark.ribbon?.kind === "professional-shelf-ribbon-polygon"
        && mark.ribbon.role === "stroke-union"
        && mark.texture === undefined
        && mark.falloff === undefined
      )), id).toBe(true);
    },
  );

  it("exports the exact connected material contours instead of reviving alpha-map dabs", () => {
    const id = "bristle-round-loaded";
    const exported = exportPageToSvg({
      width: 360,
      height: 220,
      bg: "#ffffff",
      elements: [{
        id: "professional-shelf-svg-parity",
        type: "draw",
        kind: "freehand",
        mode: "pen",
        brush: RUNTIME_BY_ID[id],
        brushCatalogId: id,
        brushDynamics: dynamics(id),
        paintModel: "bounded-flow-v2",
        points: [24, 120, 86, 84, 154, 132, 232, 72, 330, 112],
        pressures: [0.42, 0.64, 0.88, 0.71, 0.55],
        tiltXs: [14, 18, 24, 20, 16],
        tiltYs: [22, 26, 30, 27, 23],
        twists: [2, 4, 7, 9, 12],
        stroke: "#274060",
        strokeWidth: 24,
        opacity: 0.9,
      }],
    });

    expect(exported.skipped).toEqual([]);
    expect(exported.svg).toContain(
      'data-brush-coverage="professional-shelf-ribbon"',
    );
    expect(exported.svg).toContain(
      'data-brush-material-profile="loaded-round-bristle"',
    );
    expect(exported.svg).not.toContain('data-brush-coverage="alpha-map"');
    expect(exported.svg).not.toContain('data-brush-coverage="ellipse"');
  });

  it.each([
    ["tight curve", [[20, 50], [34, 20], [64, 16], [86, 40], [76, 72], [46, 82], [22, 60]]],
    ["near-180 cusp", [[20, 50], [82, 50], [22, 51]]],
    ["self crossing", [[20, 20], [82, 82], [20, 82], [82, 20]]],
  ] as const)(
    "keeps one bounded, non-darkening software coverage union through a %s",
    (_label, points) => {
      const plannedDabs = fixtureDabs(points);
      const result = planStudioProfessionalShelfRibbonCarrier({
        dabs: plannedDabs,
        marks: marks(plannedDabs),
        materialIdentity: identity("oil-filbert"),
        dynamics: dynamics("oil-filbert"),
      });
      expect(result.applied).toBe(true);
      if (!result.applied) return;
      const mark = result.marks[0]!;
      expect(mark.ribbon.role).toBe("stroke-union");
      expect(mark.ribbon.polygons.every((polygon) => (
        polygon.length >= 8
        && polygon.length <= 12
        && Math.abs(polygon.reduce(
          (maximum, coordinate) => Math.max(maximum, coordinate),
          0,
        )) < 1_000
      ))).toBe(true);
      for (const [x, y] of points) {
        expect(unionAlphaNear(mark, x, y)).toBe(mark.alpha);
      }
      if (_label === "self crossing") {
        expect(unionAlphaNear(mark, 51, 51)).toBe(mark.alpha);
        expect(mark.alpha).toBeLessThan(1);
      }
    },
  );

  it("keeps straight and curved centerline coverage uniformly at one stroke alpha", () => {
    const points = [[18, 48], [36, 48], [54, 48], [70, 42], [84, 30]] as const;
    const plannedDabs = fixtureDabs(points);
    const result = planStudioProfessionalShelfRibbonCarrier({
      dabs: plannedDabs,
      marks: marks(plannedDabs),
      materialIdentity: identity("bristle-round-loaded"),
      dynamics: dynamics("bristle-round-loaded"),
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
