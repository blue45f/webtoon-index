import { describe, expect, it, vi } from "vitest";

import { exportPageToSvg } from "../export/studio-svg-export";

import {
  planStudioStampBrushDabs,
  resolveStudioStampBrushStyle,
} from "./studio-brush-stamp-engine";
import { isDirectLiveStampDraftEl } from "./studio-draw-rendering";
import {
  planStudioStampInkRibbon,
  traceStudioStampInkRibbon,
  type StudioStampInkRibbonPolygon,
} from "./studio-stamp-ink-ribbon";
import { drawStudioStampStrokeWithSymmetry } from "./studio-stamp-symmetry-rendering";

import type { DrawEl } from "../studio-element-model";

const POINTS = [
  0, 0,
  30, 30,
  60, 0,
  30, -30,
  0, 0,
  30, 30,
  60, 0,
] as const;
const PRESSURES = [0.8, 0.75, 0.9, 0.65, 0.8, 0.75, 0.9] as const;

function style(opacity = 0.56) {
  return resolveStudioStampBrushStyle(
    "ink",
    {
      color: "#20344f",
      size: 18,
      opacity,
    },
  );
}

function polygonWindingAt(
  polygon: StudioStampInkRibbonPolygon,
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

function coverageCountAt(
  polygons: readonly StudioStampInkRibbonPolygon[],
  x: number,
  y: number,
): number {
  return polygons.filter((polygon) => (
    polygonWindingAt(polygon, x, y) !== 0
  )).length;
}

function compoundCoverageAt(
  polygons: readonly StudioStampInkRibbonPolygon[],
  x: number,
  y: number,
): boolean {
  return polygons.reduce(
    (winding, polygon) => winding + polygonWindingAt(polygon, x, y),
    0,
  ) !== 0;
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

function plan(
  points: readonly number[] = POINTS,
  pressures: readonly number[] = PRESSURES,
) {
  const dabs = planStudioStampBrushDabs(style(), points, pressures);
  return planStudioStampInkRibbon(dabs);
}

describe("stamp ink stroke-local ribbon", () => {
  it("is deterministic and replaces the exposed circular carrier train with connected bodies", () => {
    const first = plan();
    const replay = plan();

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      coverageOperation: "stroke-local-single-fill",
      fillRule: "nonzero",
      cap: "round",
    });
    expect(first.acceptedDabCount).toBeGreaterThan(20);
    expect(first.polygons.filter(({ role }) => role === "body")).toHaveLength(
      first.acceptedDabCount - 1,
    );
    expect(first.polygons.filter(({ role }) => role === "start-cap")).toHaveLength(1);
    expect(first.polygons.filter(({ role }) => role === "end-cap")).toHaveLength(1);
    expect(first.polygons.every((polygon) => signedArea(polygon.points) > 0))
      .toBe(true);
  });

  it.each([
    {
      name: "A→B→A exact retrace",
      points: [0, 0, 80, 0, 0, 0],
      pressures: [0.8, 0.8, 0.8],
      probe: [40, 0] as const,
    },
    {
      name: "figure-eight",
      points: POINTS,
      pressures: PRESSURES,
      probe: [0, 0] as const,
    },
  ])(
    "caps same-stroke $name alpha while a separate stroke remains independently composited",
    ({ points, pressures, probe }) => {
      const ribbon = plan(points, pressures);
      expect(coverageCountAt(ribbon.polygons, probe[0], probe[1]))
        .toBeGreaterThan(1);
      expect(compoundCoverageAt(ribbon.polygons, probe[0], probe[1])).toBe(true);

      let maximumSameStrokeAlpha = 0;
      for (let y = -45; y <= 45; y += 2) {
        for (let x = -15; x <= 95; x += 2) {
          maximumSameStrokeAlpha = Math.max(
            maximumSameStrokeAlpha,
            compoundCoverageAt(ribbon.polygons, x, y) ? ribbon.opacity : 0,
          );
        }
      }
      expect(maximumSameStrokeAlpha).toBeCloseTo(ribbon.opacity, 10);
      const separateStrokeSourceOver =
        ribbon.opacity + ribbon.opacity * (1 - ribbon.opacity);
      expect(separateStrokeSourceOver).toBeGreaterThan(maximumSameStrokeAlpha);
    },
  );

  it("keeps a long pressure-varying stroke connected and bounded without a terminal square", () => {
    const points = Array.from({ length: 2_001 }, (_, index) => [
      index * 2,
      Math.sin(index / 37) * 18,
    ]).flat();
    const pressures = Array.from(
      { length: 2_001 },
      (_, index) => 0.2 + 0.8 * (index / 2_000),
    );
    const ribbon = plan(points, pressures);
    const startCap = ribbon.polygons.find(({ role }) => role === "start-cap");
    const endCap = ribbon.polygons.find(({ role }) => role === "end-cap");

    expect(ribbon.acceptedDabCount).toBeGreaterThan(1_000);
    expect(ribbon.polygons.length).toBeLessThan(
      ribbon.acceptedDabCount * 3,
    );
    expect(startCap?.points).toHaveLength(48);
    expect(endCap?.points).toHaveLength(48);
    expect(ribbon.polygons.some(({ role }) => role === "join")).toBe(true);
  });

  it("shares exact geometry and alpha between retained Canvas and SVG export", () => {
    const brushStyle = style();
    const calls: number[][] = [];
    const alphas: number[] = [];
    let active: number[] = [];
    let compound: number[] = [];
    let globalAlpha = 1;
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      transform: vi.fn(),
      beginPath: () => {
        active = [];
        compound = [];
      },
      moveTo: (x: number, y: number) => {
        active = [x, y];
        compound.push(x, y);
      },
      lineTo: (x: number, y: number) => {
        active.push(x, y);
        compound.push(x, y);
      },
      closePath: vi.fn(),
      fill: () => {
        if (active.length >= 6) {
          calls.push([...compound]);
          alphas.push(globalAlpha);
        }
      },
      fillStyle: "",
      set globalAlpha(value: number) {
        globalAlpha = value;
      },
      get globalAlpha() {
        return globalAlpha;
      },
    } as unknown as CanvasRenderingContext2D;
    drawStudioStampStrokeWithSymmetry(
      context,
      brushStyle,
      POINTS,
      PRESSURES,
      undefined,
    );

    const element: DrawEl = {
      id: "stamp-ink-ribbon-parity",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      brush: "ink-brush",
      stampPipeline: "causal-walker-v2",
      points: [...POINTS],
      pressures: [...PRESSURES],
      stroke: brushStyle.color,
      strokeWidth: brushStyle.size,
      opacity: brushStyle.opacity,
    };
    const exported = exportPageToSvg({
      width: 120,
      height: 100,
      bg: "#ffffff",
      elements: [element],
    }).svg;
    const svgPath = /data-stamp-ink-ribbon="[^"]+"[^>]*\sd="([^"]+)"/u
      .exec(exported)?.[1] ?? "";
    const svgCoordinates = Array.from(
      svgPath.matchAll(/-?\d+(?:\.\d+)?/gu),
      (match) => Number(match[0]),
    );
    const roundCoordinates = (coordinates: readonly number[]) => (
      coordinates.map((coordinate) => Math.round(coordinate * 100) / 100 + 0)
    );
    const svgOpacity = Number(
      /data-stamp-ink-ribbon="[^"]+"[^>]*opacity="([^"]+)"/u
        .exec(exported)?.[1] ?? 0,
    );

    expect(calls).toHaveLength(1);
    expect(svgCoordinates).toEqual(roundCoordinates(calls[0]!));
    expect(svgOpacity).toBeCloseTo(alphas[0]!, 6);
    expect(exported).toContain('data-stamp-ink-cap="round"');
    expect(exported).not.toContain('data-stamp-brush="ink"><circle');
    expect(isDirectLiveStampDraftEl(element)).toBe(false);
  });

  it("appends all contours to one caller-owned fill path", () => {
    const ribbon = plan();
    const moves: number[][] = [];
    let active: number[] = [];
    traceStudioStampInkRibbon(
      {
        moveTo: (x, y) => {
          active = [x, y];
          moves.push(active);
        },
        lineTo: (x, y) => active.push(x, y),
        closePath: vi.fn(),
      },
      ribbon,
    );
    expect(moves).toHaveLength(ribbon.polygons.length);
    expect(moves.every((polygon) => polygon.length >= 6)).toBe(true);
  });
});
