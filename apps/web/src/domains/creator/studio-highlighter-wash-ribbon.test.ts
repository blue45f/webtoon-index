import { describe, expect, it } from "vitest";

import { planStudioFxBrushPressurePath } from "./studio-fx-brush";
import {
  planStudioHighlighterWashRibbon,
  planStudioHighlighterWashTap,
  studioHighlighterWashPlanPathData,
  traceStudioHighlighterWashPlan,
} from "./studio-highlighter-wash-ribbon";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "./studio-material-pressure-model";

import type { StudioHighlighterWashBrushId } from "./studio-highlighter-wash-ribbon";

function pressurePath(
  brushId: StudioHighlighterWashBrushId,
  points: readonly number[],
  pressure: number,
) {
  return planStudioFxBrushPressurePath({
    brushId,
    points,
    pressures: Array.from(
      { length: Math.floor(points.length / 2) },
      () => pressure,
    ),
    pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
    tension: 0.35,
  });
}

function bounds(points: readonly number[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
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

function planPoints(plan: ReturnType<typeof planStudioHighlighterWashRibbon>) {
  return plan.runs.flatMap(({ outlinePoints }) => outlinePoints);
}

function signedArea(points: readonly number[]) {
  let area = 0;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const nextIndex = (index + 2) % points.length;
    area += points[index]! * points[nextIndex + 1]!
      - points[nextIndex]! * points[index + 1]!;
  }
  return area / 2;
}

describe("Studio highlighter one-wash ribbon", () => {
  it("turns a self-crossing gesture into one deterministic same-winding compound fill", () => {
    const plan = planStudioHighlighterWashRibbon({
      brushId: "highlighter",
      pressurePath: pressurePath(
        "highlighter",
        [0, 0, 40, 40, 0, 40, 40, 0, 0, 0],
        0.6,
      ),
      baseWidth: 18,
    });
    const trace = {
      moves: 0,
      lines: 0,
      closes: 0,
      moveTo: () => {
        trace.moves += 1;
      },
      lineTo: () => {
        trace.lines += 1;
      },
      closePath: () => {
        trace.closes += 1;
      },
    };
    traceStudioHighlighterWashPlan(trace, plan);

    expect(plan).toMatchObject({
      version: "highlighter-wash-ribbon-v2",
      capProfile: "round-superellipse",
      gesture: "stroke",
      capped: false,
    });
    expect(plan.runs.filter(({ role }) => role === "body")).toHaveLength(
      plan.flattenedSegmentCount,
    );
    expect(plan.runs.filter(({ role }) => role === "join")).toHaveLength(
      plan.flattenedSegmentCount - 1,
    );
    expect(plan.runs.filter(({ role }) => role.endsWith("cap"))).toHaveLength(2);
    expect(trace.moves).toBe(plan.runs.length);
    expect(trace.closes).toBe(plan.runs.length);
    expect(trace.lines).toBeGreaterThan(30);
    expect(plan.runs.every(({ outlinePoints }) => signedArea(outlinePoints) > 0))
      .toBe(true);
    const pathData = studioHighlighterWashPlanPathData(plan);
    expect(pathData.match(/M/gu)).toHaveLength(plan.runs.length);
    expect(pathData.match(/Z/gu)).toHaveLength(plan.runs.length);
    expect(pathData).toBe(studioHighlighterWashPlanPathData(plan));
  });

  it("keeps pressure-local width while applying pigment as one whole-stroke wash", () => {
    const make = (pressure: number) => planStudioHighlighterWashRibbon({
      brushId: "highlighter",
      pressurePath: pressurePath(
        "highlighter",
        [0, 0, 25, 0, 50, 0, 75, 0],
        pressure,
      ),
      baseWidth: 20,
    });
    const light = make(0);
    const heavy = make(1);
    const lightBounds = bounds(planPoints(light));
    const heavyBounds = bounds(planPoints(heavy));

    expect(heavyBounds.maxY - heavyBounds.minY).toBeGreaterThan(
      lightBounds.maxY - lightBounds.minY,
    );
    expect(heavy.opacityScale).toBeGreaterThan(light.opacityScale);
    expect(heavy.opacityScale).toBeLessThanOrEqual(1);
  });

  it("uses rounded felt, softened chisel and natural pastel terminal profiles", () => {
    const plan = (brushId: StudioHighlighterWashBrushId) => (
      planStudioHighlighterWashRibbon({
        brushId,
        pressurePath: pressurePath(brushId, [0, 0, 50, 0], 0.5),
        baseWidth: 20,
      })
    );
    const rounded = plan("highlighter");
    const chisel = plan("chisel-highlighter");
    const pastel = plan("pastel-highlighter");
    const terminalPoints = (
      candidate: ReturnType<typeof planStudioHighlighterWashRibbon>,
    ) => candidate.runs
      .filter(({ role }) => role === "start-cap" || role === "end-cap")
      .flatMap(({ outlinePoints }) => outlinePoints);
    const roundedBounds = bounds(terminalPoints(rounded));
    const chiselBounds = bounds(terminalPoints(chisel));

    expect(rounded.capProfile).toBe("round-superellipse");
    expect(chisel.capProfile).toBe("soft-flat");
    expect(pastel.capProfile).toBe("pastel-natural");
    expect(roundedBounds.maxX - 50).toBeGreaterThan(chiselBounds.maxX - 50);
    expect(chiselBounds.maxX).toBeGreaterThan(50);
    expect(terminalPoints(pastel)).not.toEqual(
      terminalPoints(rounded),
    );
    expect(plan("pastel-highlighter")).toEqual(pastel);
  });

  it("keeps exact retraces and repeated reversals as bounded positive-winding coverage", () => {
    const plan = planStudioHighlighterWashRibbon({
      brushId: "highlighter",
      pressurePath: pressurePath(
        "highlighter",
        [20, 30, 50, 30, 20, 30, 50, 30, 20, 30],
        0.5,
      ),
      baseWidth: 10,
    });
    const bodies = plan.runs.filter(({ role }) => role === "body");
    const joins = plan.runs.filter(({ role }) => role === "join");

    expect(bodies).toHaveLength(plan.flattenedSegmentCount);
    expect(joins).toHaveLength(plan.flattenedSegmentCount - 1);
    expect(plan.runs).toHaveLength(plan.flattenedSegmentCount * 2 + 1);
    expect(plan.runs.every(({ outlinePoints }) => signedArea(outlinePoints) > 0))
      .toBe(true);
    expect(plan.runs.every(({ outlinePoints }) => (
      outlinePoints.every(Number.isFinite)
    ))).toBe(true);
  });

  it("renders taps as bounded natural footprints instead of hard square fallback rects", () => {
    const rounded = planStudioHighlighterWashTap({
      brushId: "highlighter",
      x: 12,
      y: 18,
      width: 24,
      opacityScale: 0.62,
    });
    const chisel = planStudioHighlighterWashTap({
      brushId: "chisel-highlighter",
      x: 12,
      y: 18,
      width: 24,
      opacityScale: 0.62,
    });
    const pastel = planStudioHighlighterWashTap({
      brushId: "pastel-highlighter",
      x: 12,
      y: 18,
      width: 24,
      opacityScale: 0.62,
    });

    expect(rounded.gesture).toBe("tap");
    expect(rounded.runs[0]!.outlinePoints).toHaveLength(28 * 2);
    expect(rounded.runs[0]!.role).toBe("tap");
    expect(rounded.opacityScale).toBe(0.62);
    expect(chisel.runs[0]!.outlinePoints).not.toEqual(
      rounded.runs[0]!.outlinePoints,
    );
    expect(pastel.runs[0]!.outlinePoints).not.toEqual(
      rounded.runs[0]!.outlinePoints,
    );
    expect(studioHighlighterWashPlanPathData(rounded)).not.toContain("NaN");
  });

  it("fails closed on invalid geometry without allocating a fallback carrier", () => {
    const emptyStroke = planStudioHighlighterWashRibbon({
      brushId: "highlighter",
      pressurePath: pressurePath("highlighter", [0, 0, 20, 0], 0.5),
      baseWidth: Number.NaN,
    });
    const emptyTap = planStudioHighlighterWashTap({
      brushId: "pastel-highlighter",
      x: Number.POSITIVE_INFINITY,
      y: 0,
      width: 12,
    });

    expect(emptyStroke.runs).toEqual([]);
    expect(emptyTap.runs).toEqual([]);
    expect(studioHighlighterWashPlanPathData(emptyTap)).toBe("");
  });
});
