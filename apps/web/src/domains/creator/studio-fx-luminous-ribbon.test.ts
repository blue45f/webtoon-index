import { describe, expect, it } from "vitest";

import {
  STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION,
  planStudioFxBrushPressurePath,
  planStudioFxLuminousRibbonPass,
  traceStudioFxLuminousRibbonPass,
  type StudioFxLuminousBrushId,
  type StudioFxLuminousRibbonPolygon,
} from "./studio-fx-brush";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "./studio-material-pressure-model";

const LUMINOUS_BRUSHES: readonly StudioFxLuminousBrushId[] = [
  "neon",
  "glow",
  "soft-glow",
];

type StraightRgba = readonly [number, number, number, number];

function sourceOver(source: StraightRgba, destination: StraightRgba): StraightRgba {
  const sourceAlpha = source[3];
  const destinationAlpha = destination[3];
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  const channel = (index: 0 | 1 | 2) => outputAlpha <= Number.EPSILON
    ? 0
    : (
        source[index] * sourceAlpha
        + destination[index] * destinationAlpha * (1 - sourceAlpha)
      ) / outputAlpha;
  return [channel(0), channel(1), channel(2), outputAlpha];
}

function additiveLighter(source: StraightRgba, destination: StraightRgba): StraightRgba {
  const outputAlpha = Math.min(1, source[3] + destination[3]);
  const channel = (index: 0 | 1 | 2) => outputAlpha <= Number.EPSILON
    ? 0
    : Math.min(
        1,
        source[index] * source[3] + destination[index] * destination[3],
      ) / outputAlpha;
  return [channel(0), channel(1), channel(2), outputAlpha];
}

function repeatComposite(
  operation: (source: StraightRgba, destination: StraightRgba) => StraightRgba,
  source: StraightRgba,
  destination: StraightRgba,
  count: number,
): StraightRgba {
  let output = destination;
  for (let index = 0; index < count; index += 1) {
    output = operation(source, output);
  }
  return output;
}

function rgbChroma(pixel: StraightRgba): number {
  return Math.max(pixel[0], pixel[1], pixel[2])
    - Math.min(pixel[0], pixel[1], pixel[2]);
}

function signedArea(points: readonly number[]): number {
  let area = 0;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += points[index]! * points[next + 1]!
      - points[next]! * points[index + 1]!;
  }
  return area / 2;
}

function polygonWindingAt(
  polygon: StudioFxLuminousRibbonPolygon,
  x: number,
  y: number,
): number {
  let winding = 0;
  const points = polygon.points;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const next = (index + 2) % points.length;
    const x1 = points[index]!;
    const y1 = points[index + 1]!;
    const x2 = points[next]!;
    const y2 = points[next + 1]!;
    const cross = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
    if (y1 <= y && y2 > y && cross > 0) winding += 1;
    if (y1 > y && y2 <= y && cross < 0) winding -= 1;
  }
  return winding;
}

function compoundCoverageAt(
  polygons: readonly StudioFxLuminousRibbonPolygon[],
  x: number,
  y: number,
): boolean {
  return polygons.reduce(
    (winding, polygon) => winding + polygonWindingAt(polygon, x, y),
    0,
  ) !== 0;
}

function polygonCoverageCountAt(
  polygons: readonly StudioFxLuminousRibbonPolygon[],
  x: number,
  y: number,
): number {
  return polygons.reduce(
    (count, polygon) => count + (polygonWindingAt(polygon, x, y) === 0 ? 0 : 1),
    0,
  );
}

function planFor(
  brushId: StudioFxLuminousBrushId,
  points: readonly number[],
  pressures: readonly number[],
) {
  const pressurePath = planStudioFxBrushPressurePath({
    brushId,
    points,
    pressures,
    pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
    tension: 0.3,
  });
  return planStudioFxLuminousRibbonPass({
    brushId,
    pressurePath,
    baseWidth: 18,
    passWidthScale: brushId === "soft-glow" ? 4.2 : 2.7,
    passOpacity: 0.24,
    luminousCore: false,
  });
}

describe("studio FX luminous pressure ribbon", () => {
  it.each([
    ["transparent", [0, 0, 0, 0]],
    ["dark", [0.03, 0.03, 0.03, 1]],
    ["white", [1, 1, 1, 1]],
  ] as const)(
    "keeps the selected hue under repeated crossings on a %s background",
    (_backgroundName, background) => {
      const ink: StraightRgba = [0.18, 0.62, 0.94, 0.22];
      const premultiplied = repeatComposite(sourceOver, ink, background, 32);
      const additive = repeatComposite(additiveLighter, ink, background, 32);

      expect(STUDIO_FX_LUMINOUS_COMPOSITE_OPERATION).toBe("source-over");
      expect(premultiplied.slice(0, 3)).toEqual(
        expect.arrayContaining([
          expect.closeTo(ink[0], 2),
          expect.closeTo(ink[1], 2),
          expect.closeTo(ink[2], 2),
        ]),
      );
      expect(rgbChroma(premultiplied)).toBeGreaterThan(0.7);
      expect(rgbChroma(additive)).toBeLessThan(0.001);
      expect(additive.slice(0, 3)).toEqual([
        expect.closeTo(1, 6),
        expect.closeTo(1, 6),
        expect.closeTo(1, 6),
      ]);
    },
  );

  it.each(LUMINOUS_BRUSHES)(
    "%s plans deterministic, same-winding single-fill coverage",
    (brushId) => {
      const inputPoints = [0, 0, 24, 18, 48, -8, 72, 16, 96, 0];
      const pressures = [0.2, 0.45, 0.8, 0.6, 1];
      const first = planFor(brushId, inputPoints, pressures);
      const replay = planFor(brushId, inputPoints, pressures);

      expect(replay).toEqual(first);
      expect(first).toMatchObject({
        brushId,
        coverageOperation: "stroke-local-single-fill",
        compositeOperation: "source-over",
        fillRule: "nonzero",
        cap: "round",
      });
      expect(first.polygons.length).toBeGreaterThan(first.sourceSegmentCount);
      expect(first.polygons.every((polygon) => signedArea(polygon.points) > 0))
        .toBe(true);
      expect(first.polygons.filter(({ role }) => role === "start-cap")).toHaveLength(1);
      expect(first.polygons.filter(({ role }) => role === "end-cap")).toHaveLength(1);
    },
  );

  it("keeps every interior round join, because the halo shells are what make a glow smooth", () => {
    // 한 번 시도했다가 되돌린 최적화: 쐐기 깊이가 서브픽셀인 조인을 생략하면 6~7배 빨라지지만
    // 넓고 옅은 외곽 글로우 헤일로가 방사형으로 너덜해진다(정착 프레임 육안 대조). 쐐기 깊이
    // 근사는 큰 반지름·저알파 패스에 쌓이는 스캘럽을 대표하지 못한다. 속도는 픽셀을 바꾸지 않는
    // 증분화로 얻어야 하고, 이 테스트는 그 최적화가 다시 슬며시 들어오는 것을 막는다.
    const circlePoints: number[] = [];
    const circlePressures: number[] = [];
    for (let index = 0; index < 240; index += 1) {
      const angle = (index / 239) * Math.PI * 2;
      circlePoints.push(300 + Math.cos(angle) * 150, 300 + Math.sin(angle) * 150);
      circlePressures.push(0.7);
    }
    const circle = planFor("glow", circlePoints, circlePressures);
    const bodies = circle.polygons.filter(({ role }) => role === "body");
    const joins = circle.polygons.filter(({ role }) => role === "join");
    expect(bodies.length).toBeGreaterThan(200);
    // 내부 경계마다 조인이 하나씩. 런이 하나면 joins === bodies - 1.
    expect(joins.length).toBe(bodies.length - 1);
    for (const sample of [0, 0.17, 0.41, 0.66, 0.89]) {
      const angle = sample * Math.PI * 2;
      expect(compoundCoverageAt(
        circle.polygons,
        300 + Math.cos(angle) * 150,
        300 + Math.sin(angle) * 150,
      )).toBe(true);
    }
    expect(compoundCoverageAt(circle.polygons, 300, 300)).toBe(false);
  });

  it("interpolates pressure into a continuous ribbon without an internal width seam", () => {
    const plan = planFor(
      "neon",
      [0, 0, 40, 0, 80, 0],
      [0, 0.35, 1],
    );
    const bodies = plan.polygons.filter(({ role }) => role === "body");
    expect(bodies).toHaveLength(2);

    const radiusAt = (
      polygon: StudioFxLuminousRibbonPolygon,
      x: number,
    ) => {
      const ordinates: number[] = [];
      for (let index = 0; index + 1 < polygon.points.length; index += 2) {
        if (Math.abs(polygon.points[index]! - x) <= 0.001) {
          ordinates.push(Math.abs(polygon.points[index + 1]!));
        }
      }
      return Math.max(...ordinates);
    };
    const leftJoinRadius = radiusAt(bodies[0]!, 40);
    const rightJoinRadius = radiusAt(bodies[1]!, 40);
    const startRadius = radiusAt(bodies[0]!, 0);
    const endRadius = radiusAt(bodies[1]!, 80);

    expect(leftJoinRadius).toBeCloseTo(rightJoinRadius, 4);
    expect(leftJoinRadius).toBeGreaterThan(startRadius);
    expect(endRadius).toBeGreaterThan(leftJoinRadius);
    expect(polygonCoverageCountAt(plan.polygons, 40, 0)).toBeGreaterThan(1);
    expect(compoundCoverageAt(plan.polygons, 40, 0)).toBe(true);
  });

  it("extends both endpoints with genuinely round caps instead of square butt ends", () => {
    const plan = planFor("glow", [10, 20, 70, 20], [0.8, 0.8]);
    const start = plan.polygons.find(({ role }) => role === "start-cap");
    const end = plan.polygons.find(({ role }) => role === "end-cap");
    expect(start).toBeDefined();
    expect(end).toBeDefined();

    const xs = (polygon: StudioFxLuminousRibbonPolygon) => (
      polygon.points.filter((_, index) => index % 2 === 0)
    );
    const ys = (polygon: StudioFxLuminousRibbonPolygon) => (
      polygon.points.filter((_, index) => index % 2 === 1)
    );
    expect(Math.min(...xs(start!))).toBeLessThan(10);
    expect(Math.max(...xs(end!))).toBeGreaterThan(70);
    expect(Math.min(...ys(start!))).toBeLessThan(20);
    expect(Math.max(...ys(start!))).toBeGreaterThan(20);
  });

  it.each([
    {
      name: "figure-eight",
      points: [0, 0, 30, 30, 60, 0, 30, -30, 0, 0, 30, 30, 60, 0],
      pressures: [0.8, 0.75, 0.9, 0.65, 0.8, 0.75, 0.9],
      probe: [30, 0] as const,
    },
    {
      name: "exact retrace",
      points: [0, 0, 60, 0, 0, 0, 60, 0],
      pressures: [0.8, 0.8, 0.8, 0.8],
      probe: [30, 0] as const,
    },
  ])(
    "caps same-stroke $name brightness at one pass while separate strokes build coverage",
    ({ points, pressures, probe }) => {
      const plan = planFor("soft-glow", points, pressures);
      const [probeX, probeY] = probe;

      expect(polygonCoverageCountAt(plan.polygons, probeX, probeY))
        .toBeGreaterThan(1);
      expect(compoundCoverageAt(plan.polygons, probeX, probeY)).toBe(true);

      let maximumSameStrokeAlpha = 0;
      for (let y = -50; y <= 50; y += 2) {
        for (let x = -15; x <= 75; x += 2) {
          const alpha = compoundCoverageAt(plan.polygons, x, y)
            ? plan.opacity
            : 0;
          maximumSameStrokeAlpha = Math.max(maximumSameStrokeAlpha, alpha);
        }
      }
      expect(maximumSameStrokeAlpha).toBeCloseTo(plan.opacity, 10);

      const separateStrokeAlpha = plan.opacity + plan.opacity * (1 - plan.opacity);
      expect(separateStrokeAlpha).toBeGreaterThan(maximumSameStrokeAlpha);
    },
  );

  it("traces every polygon into one caller-owned compound path without hidden fills", () => {
    const plan = planFor(
      "neon",
      [0, 0, 20, 20, 40, 0],
      [0.4, 0.8, 1],
    );
    const calls: string[] = [];
    traceStudioFxLuminousRibbonPass(
      {
        moveTo: (x, y) => calls.push(`M${x},${y}`),
        lineTo: (x, y) => calls.push(`L${x},${y}`),
        closePath: () => calls.push("Z"),
      },
      plan,
    );

    expect(calls.filter((call) => call.startsWith("M"))).toHaveLength(
      plan.polygons.length,
    );
    expect(calls.filter((call) => call === "Z")).toHaveLength(
      plan.polygons.length,
    );
    expect(calls.some((call) => call.startsWith("L"))).toBe(true);
  });
});
