import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  planStudioDynamicBrush,
  type StudioDynamicBrushDab,
  type StudioDynamicBrushSegmentStartFrame,
} from "./brush/studio-brush-dynamics";
import { materializeStudioBrushPackDynamics } from "./brush/studio-brush-pack-runtime";
import { transformStudioDynamicBrushDab } from "./brush/studio-brush-symmetry";
import { buildStudioBrushTipAlphaMap } from "./brush/studio-brush-tip-stamp";
import { resolveStudioDynamicBrushMaterialIdentity } from "./brush/studio-dry-media-dynamic-bridge";
import { exportPageToSvg } from "./export/studio-svg-export";
import {
  planStudioCausalDynamicBrushDepositsV2,
  planStudioCausalDynamicBrushDepositsV3,
} from "./studio-causal-dynamic-brush-deposit-v2";
import {
  planStudioDynamicBrushCoverageMarks,
  renderStudioDynamicBrushCoverageMark,
} from "./studio-dynamic-brush-coverage-renderer";
import {
  planStudioPaintRollerRibbonCarrier,
  studioPaintRollerRibbonCarrierOwnsMaterial,
  STUDIO_PAINT_ROLLER_RIBBON_CARRIER_VERSION,
  STUDIO_PAINT_ROLLER_RIBBON_MAX_STATIONS,
  type StudioPaintRollerRibbonSourceMark,
} from "./studio-paint-roller-ribbon-carrier";

function settings() {
  const result = materializeStudioBrushPackDynamics("paint-roller");
  if (!result) throw new Error("missing paint roller dynamics");
  return result;
}

function identity() {
  const result = resolveStudioDynamicBrushMaterialIdentity(
    "dry-media",
    "paint-roller",
  );
  if (!result) throw new Error("missing paint roller identity");
  return result;
}

function dabFrame(index: number): StudioDynamicBrushSegmentStartFrame {
  const direction = index === 0 ? 0 : 4 + index * 0.7;
  return {
    index,
    sourceX: 28 + index * Math.cos(direction * Math.PI / 180) * 6,
    sourceY: 64 + index * Math.sin(direction * Math.PI / 180) * 6,
    direction,
    size: 42 + Math.sin(index * 0.31) * 2,
    roundness: 0.52,
  };
}

function dab(index: number): StudioDynamicBrushDab {
  const frame = dabFrame(index);
  const previous = index > 0 ? dabFrame(index - 1) : undefined;
  const distance = previous
    ? Math.hypot(
        frame.sourceX - previous.sourceX,
        frame.sourceY - previous.sourceY,
      )
    : 0;
  return {
    index,
    progress: index / 24,
    sourceX: frame.sourceX,
    sourceY: frame.sourceY,
    direction: frame.direction,
    distanceFromPrevious: distance,
    ...(previous ? { segmentStartFrame: previous } : {}),
    x: frame.sourceX + 1.7,
    y: frame.sourceY - 1.2,
    size: frame.size,
    opacity: 0.84,
    flow: 0.64,
    spacing: 6,
    scatter: 3.2,
    angle: frame.direction + 1.5,
    roundness: frame.roundness,
  };
}

function markForDab(
  source: StudioDynamicBrushDab,
): StudioPaintRollerRibbonSourceMark {
  const dynamics = settings();
  const alphaMap = buildStudioBrushTipAlphaMap(dynamics.tip);
  return {
    x: source.x,
    y: source.y,
    radiusX: source.size / 2,
    radiusY: source.size / 2 * source.roundness,
    angleRadians: source.angle * Math.PI / 180,
    alpha: source.opacity * source.flow,
    color: "#284b63",
    texture: { kind: "alpha-map", alphaMap },
  };
}

function sourceMark(index: number): StudioPaintRollerRibbonSourceMark {
  return markForDab(dab(index));
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

function expectSegmentReceipts(
  dabs: readonly StudioDynamicBrushDab[],
): void {
  for (let index = 1; index < dabs.length; index += 1) {
    const previous = dabs[index - 1]!;
    expect(dabs[index]?.segmentStartFrame).toEqual({
      index: previous.index,
      sourceX: previous.sourceX,
      sourceY: previous.sourceY,
      direction: previous.direction ?? previous.angle,
      size: previous.size,
      roundness: previous.roundness,
      distanceFromStrokeStart: previous.distanceFromStrokeStart,
      contactLoadFromStrokeStart: previous.contactLoadFromStrokeStart,
      contactFactor: previous.contactFactor,
    });
  }
}

describe("paint roller connected ribbon carrier", () => {
  it("claims only the exact audited built-in paint roller material", () => {
    const dynamics = settings();
    expect(studioPaintRollerRibbonCarrierOwnsMaterial(
      identity(),
      dynamics,
    )).toBe(true);
    expect(studioPaintRollerRibbonCarrierOwnsMaterial(
      resolveStudioDynamicBrushMaterialIdentity("dry-media", "crayon-wax-bold")!,
      dynamics,
    )).toBe(false);
    expect(studioPaintRollerRibbonCarrierOwnsMaterial(
      identity(),
      normalizeStudioBrushDynamicsSettings({
        ...dynamics,
        grain: { ...dynamics.grain, amount: 0.2 },
      }),
    )).toBe(false);
  });

  it("sweeps one broad body with three opposite-winding intermittent dry streaks", () => {
    const result = planStudioPaintRollerRibbonCarrier({
      dabs: [dab(0), dab(1)],
      marks: [sourceMark(0), sourceMark(1)],
      materialIdentity: identity(),
      dynamics: settings(),
    });
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.marks).toHaveLength(2);
    expect(result.marks[0]?.ribbon).toMatchObject({
      kind: "paint-roller-ribbon-polygon",
      version: STUDIO_PAINT_ROLLER_RIBBON_CARRIER_VERSION,
      role: "tap",
    });
    expect(result.marks[1]?.ribbon.role).toBe("segment");
    expect(result.marks.every((mark) => (
      mark.ribbon.polygons.length === 4
      && mark.ribbon.polygons.every((points) => (
        points.length === 8
        && points.every(Number.isFinite)
      ))
      && !("texture" in mark)
      && !("falloff" in mark)
    ))).toBe(true);
    const [body, ...dryStreaks] = result.marks[1]!.ribbon.polygons;
    const bodyWidth = Math.hypot(
      body![6]! - body![0]!,
      body![7]! - body![1]!,
    );
    const dryStreakWidths = dryStreaks.map((points) => (
      Math.hypot(
        points[6]! - points[0]!,
        points[7]! - points[1]!,
      )
    ));
    expect(bodyWidth).toBeGreaterThan(Math.max(...dryStreakWidths) * 20);
    const bodyArea = signedArea(body!);
    expect(Math.abs(bodyArea)).toBeGreaterThan(1);
    expect(dryStreaks.some((points) => Math.abs(signedArea(points)) < 1e-6))
      .toBe(true);
    expect(dryStreaks.filter((points) => Math.abs(signedArea(points)) >= 1e-6)
      .every((points) => Math.sign(signedArea(points)) === -Math.sign(bodyArea)))
      .toBe(true);
  });

  it("is byte-identical across incremental live prefixes and committed full replay", () => {
    const dabs = Array.from({ length: 96 }, (_, index) => dab(index));
    const marks = dabs.map((_, index) => sourceMark(index));
    const shared = {
      materialIdentity: identity(),
      dynamics: settings(),
    };
    const full = planStudioPaintRollerRibbonCarrier({
      ...shared,
      dabs,
      marks,
    });
    const prefix = planStudioPaintRollerRibbonCarrier({
      ...shared,
      dabs: dabs.slice(0, 43),
      marks: marks.slice(0, 43),
    });
    const suffix = planStudioPaintRollerRibbonCarrier({
      ...shared,
      dabs: dabs.slice(43),
      marks: marks.slice(43),
    });
    expect(full.applied).toBe(true);
    expect(prefix.applied).toBe(true);
    expect(suffix.applied).toBe(true);
    if (!full.applied || !prefix.applied || !suffix.applied) return;
    expect(prefix.marks).toEqual(full.marks.slice(0, prefix.marks.length));
    expect(suffix.marks).toEqual(full.marks.slice(prefix.marks.length));
  });

  it("joins 90-degree and S-curve width changes with byte-identical body and hole vertices", () => {
    const frames: readonly StudioDynamicBrushSegmentStartFrame[] = [
      { index: 0, sourceX: 36, sourceY: 40, direction: 0, size: 24, roundness: 0.4 },
      { index: 1, sourceX: 86, sourceY: 40, direction: 90, size: 34, roundness: 0.5 },
      { index: 2, sourceX: 86, sourceY: 88, direction: 180, size: 48, roundness: 0.62 },
      { index: 3, sourceX: 42, sourceY: 88, direction: 120, size: 30, roundness: 0.46 },
      { index: 4, sourceX: 68, sourceY: 132, direction: 45, size: 42, roundness: 0.58 },
      { index: 5, sourceX: 110, sourceY: 152, direction: -35, size: 27, roundness: 0.43 },
    ];
    const dabs = frames.map((frame, index): StudioDynamicBrushDab => {
      const previous = frames[index - 1];
      return {
        index,
        progress: index / (frames.length - 1),
        sourceX: frame.sourceX,
        sourceY: frame.sourceY,
        direction: frame.direction,
        distanceFromPrevious: previous
          ? Math.hypot(
              frame.sourceX - previous.sourceX,
              frame.sourceY - previous.sourceY,
            )
          : 0,
        ...(previous ? { segmentStartFrame: previous } : {}),
        x: frame.sourceX,
        y: frame.sourceY,
        size: frame.size,
        opacity: 0.86,
        flow: 0.64,
        spacing: 6,
        scatter: 0,
        angle: frame.direction + 1.5,
        roundness: frame.roundness,
      };
    });
    const marks = dabs.map(markForDab);
    const shared = {
      materialIdentity: identity(),
      dynamics: settings(),
    };
    const full = planStudioPaintRollerRibbonCarrier({
      ...shared,
      dabs,
      marks,
    });
    const prefix = planStudioPaintRollerRibbonCarrier({
      ...shared,
      dabs: dabs.slice(0, 4),
      marks: marks.slice(0, 4),
    });
    const suffix = planStudioPaintRollerRibbonCarrier({
      ...shared,
      dabs: dabs.slice(4),
      marks: marks.slice(4),
    });
    expect(full.applied).toBe(true);
    expect(prefix.applied).toBe(true);
    expect(suffix.applied).toBe(true);
    if (!full.applied || !prefix.applied || !suffix.applied) return;
    expect(prefix.marks).toEqual(full.marks.slice(0, 4));
    expect(suffix.marks).toEqual(full.marks.slice(4));

    for (let markIndex = 1; markIndex < full.marks.length - 1; markIndex += 1) {
      const previousEnd = full.marks[markIndex]!.ribbon.polygons;
      const nextStart = full.marks[markIndex + 1]!.ribbon.polygons;
      for (let bandIndex = 0; bandIndex < previousEnd.length; bandIndex += 1) {
        const endBand = previousEnd[bandIndex]!;
        const startBand = nextStart[bandIndex]!;
        expect(startBand.slice(0, 2)).toEqual(endBand.slice(2, 4));
        expect(startBand.slice(6, 8)).toEqual(endBand.slice(4, 6));
      }
    }
  });

  it("preserves segment-start receipts through canonical, causal V2/V3 and symmetry plans", () => {
    const points = [
      20, 20,
      110, 20,
      110, 100,
      45, 145,
      128, 184,
    ];
    const pressures = [0.35, 0.72, 0.95, 0.48, 0.82];
    const dynamics = settings();
    const canonical = planStudioDynamicBrush({
      points,
      pressures,
      baseWidth: 42,
      baseOpacity: 0.76,
      settings: dynamics,
    });
    expectSegmentReceipts(canonical.dabs);

    const causalV2 = planStudioCausalDynamicBrushDepositsV2({
      points,
      pressures,
      settings: dynamics,
    });
    const causalV3 = planStudioCausalDynamicBrushDepositsV3({
      points,
      pressures,
      settings: dynamics,
    });
    expect(causalV2.ok).toBe(true);
    expect(causalV3.ok).toBe(true);
    if (!causalV2.ok || !causalV3.ok) return;
    expectSegmentReceipts(causalV2.dabs);
    expectSegmentReceipts(causalV3.dabs);

    const source = causalV3.dabs.at(-1)!;
    const rotated = transformStudioDynamicBrushDab(source, {
      a: 0,
      b: 1,
      c: -1,
      d: 0,
      e: 240,
      f: 0,
    });
    expect(rotated.segmentStartFrame).toMatchObject({
      index: source.segmentStartFrame?.index,
      sourceX: 240 - (source.segmentStartFrame?.sourceY ?? 0),
      sourceY: source.segmentStartFrame?.sourceX,
      size: source.segmentStartFrame?.size,
      roundness: source.segmentStartFrame?.roundness,
    });
    expect(rotated.segmentStartFrame?.direction).toBeCloseTo(
      (source.segmentStartFrame?.direction ?? 0) + 90,
    );
  });

  it("removes deterministic stamp scatter while preserving causal source stations", () => {
    const source = dab(4);
    const ordinaryMark = sourceMark(4);
    const scatteredMark = {
      ...ordinaryMark,
      x: ordinaryMark.x + 28,
      y: ordinaryMark.y - 19,
    };
    const shared = {
      dabs: [source],
      materialIdentity: identity(),
      dynamics: settings(),
    };
    const ordinary = planStudioPaintRollerRibbonCarrier({
      ...shared,
      marks: [ordinaryMark],
    });
    const scattered = planStudioPaintRollerRibbonCarrier({
      ...shared,
      marks: [scatteredMark],
    });
    expect(ordinary.applied).toBe(true);
    expect(scattered.applied).toBe(true);
    if (!ordinary.applied || !scattered.applied) return;
    expect(scattered.marks[0]?.ribbon).toEqual(ordinary.marks[0]?.ribbon);
  });

  it("bypasses the five-lane dry-media stamp bridge in the shared coverage planner", () => {
    const dabs = Array.from({ length: 18 }, (_, index) => dab(index));
    const plan = planStudioDynamicBrushCoverageMarks({
      dabVariations: [dabs],
      dynamics: settings(),
      materialIdentity: identity(),
      dynamicSeed: 91,
      stroke: "#284b63",
      stampGrid: 7,
      markBudget: 2_048,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.marks).toHaveLength(dabs.length);
    expect(plan.marks.every((mark) => (
      mark.ribbon?.kind === "paint-roller-ribbon-polygon"
      && mark.texture === undefined
    ))).toBe(true);

    const calls: string[] = [];
    const context = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      beginPath: () => calls.push("begin"),
      moveTo: () => calls.push("move"),
      lineTo: () => calls.push("line"),
      closePath: () => calls.push("close"),
      fill: () => calls.push("fill"),
      ellipse: () => calls.push("ellipse"),
      arc: () => calls.push("arc"),
      drawImage: () => calls.push("image"),
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} }),
    } as never;
    renderStudioDynamicBrushCoverageMark(context, plan.marks[1]!);
    expect(calls).toContain("fill");
    expect(calls.filter((call) => call === "move")).toHaveLength(4);
    expect(calls).not.toContain("ellipse");
    expect(calls).not.toContain("arc");
    expect(calls).not.toContain("image");
  });

  it("serializes the same connected roller tracks to SVG", () => {
    const exported = exportPageToSvg({
      width: 360,
      height: 200,
      bg: "#ffffff",
      elements: [{
        id: "paint-roller-svg-parity",
        type: "draw",
        kind: "freehand",
        mode: "pen",
        brush: "dry-media",
        brushCatalogId: "paint-roller",
        brushDynamics: settings(),
        paintModel: "bounded-flow-v2",
        points: [26, 105, 92, 88, 166, 112, 244, 82, 326, 104],
        pressures: [0.48, 0.62, 0.8, 0.7, 0.58],
        stroke: "#284b63",
        strokeWidth: 42,
        opacity: 0.76,
      }],
    });
    expect(exported.skipped).toEqual([]);
    expect(exported.svg).toContain(
      'data-brush-coverage="paint-roller-ribbon"',
    );
    expect(exported.svg).not.toContain(
      'data-brush-coverage="alpha-map"',
    );
    expect(exported.svg).not.toContain(
      'data-brush-coverage="ellipse"',
    );
  });

  it("keeps invalid geometry and station work limits explicit and fail-closed", () => {
    expect(planStudioPaintRollerRibbonCarrier({
      dabs: [{ ...dab(1), direction: undefined }],
      marks: [sourceMark(1)],
      materialIdentity: identity(),
      dynamics: settings(),
    })).toMatchObject({
      applied: false,
      reason: "invalid-geometry",
    });

    const hugeDabs = {
      length: STUDIO_PAINT_ROLLER_RIBBON_MAX_STATIONS + 1,
    } as unknown as readonly StudioDynamicBrushDab[];
    const hugeMarks = {
      length: STUDIO_PAINT_ROLLER_RIBBON_MAX_STATIONS + 1,
    } as unknown as readonly StudioPaintRollerRibbonSourceMark[];
    expect(planStudioPaintRollerRibbonCarrier({
      dabs: hugeDabs,
      marks: hugeMarks,
      materialIdentity: identity(),
      dynamics: settings(),
    })).toMatchObject({
      applied: false,
      reason: "station-budget",
    });
  });
});
