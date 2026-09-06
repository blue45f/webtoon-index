import { describe, expect, it } from "vitest";

import { planStudioCausalInk } from "../studio-causal-ink";
import { fillStudioCausalInkDabs } from "../studio-causal-ink-canvas";
import { STUDIO_PIXEL_PENCIL_RENDER_MODE } from "../studio-pixel-pencil";

import { drawStampStroke } from "./studio-brush-stamp-engine";
import {
  drawBounds,
  drawFreehandPenSegments,
  drawLiveFreehandDraftToContext,
  drawStudioCausalInkContract,
  drawStudioCausalInkDabs,
  executeStudioDraftPreviewBackdropBoundary,
  getSymmetricPoints,
  isDirectLiveDraftEl,
  isDirectLiveStampDraftEl,
  planStudioDraftPreviewBackdropBoundary,
  planStudioDraftPreviewCompositeRuns,
  resolveStudioCausalInkDrawContract,
  resolveStudioDraftPreviewCompositeMode,
  resolveStudioLiveInkStrokeStyle,
  studioLiveBrushEffectiveDiameter,
  studioLiveBrushPressure,
  studioLiveBrushPressureSamples,
} from "./studio-draw-rendering";
import {
  drawStudioStampStrokeWithSymmetry,
  planStudioStampSymmetryRender,
} from "./studio-stamp-symmetry-rendering";

import type { StudioStampBrushStyle } from "./studio-brush-stamp-engine";
import type { DrawEl } from "../studio-element-model";
import type { StudioStrokePaintModel } from "./studio-stroke-paint-model";
import type Konva from "konva";

class RecordingContext {
  readonly operations: string[] = [];
  private currentFillStyle: string | CanvasGradient | CanvasPattern = "";
  private currentGlobalAlpha = 1;
  private currentGlobalCompositeOperation: GlobalCompositeOperation = "source-over";
  private currentLineCap: CanvasLineCap = "butt";
  private currentLineJoin: CanvasLineJoin = "miter";
  private currentLineWidth = 1;
  private currentStrokeStyle: string | CanvasGradient | CanvasPattern = "";

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.currentFillStyle;
  }

  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.currentFillStyle = value;
    this.operations.push(`fillStyle:${String(value)}`);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.operations.push(`fillRect:${x},${y},${width},${height}`);
  }

  get globalAlpha(): number {
    return this.currentGlobalAlpha;
  }

  set globalAlpha(value: number) {
    this.currentGlobalAlpha = value;
    this.operations.push(`alpha:${value}`);
  }

  get globalCompositeOperation(): GlobalCompositeOperation {
    return this.currentGlobalCompositeOperation;
  }

  set globalCompositeOperation(value: GlobalCompositeOperation) {
    this.currentGlobalCompositeOperation = value;
    this.operations.push(`composite:${value}`);
  }

  get lineCap(): CanvasLineCap {
    return this.currentLineCap;
  }

  set lineCap(value: CanvasLineCap) {
    this.currentLineCap = value;
    this.operations.push(`lineCap:${value}`);
  }

  get lineJoin(): CanvasLineJoin {
    return this.currentLineJoin;
  }

  set lineJoin(value: CanvasLineJoin) {
    this.currentLineJoin = value;
    this.operations.push(`lineJoin:${value}`);
  }

  get lineWidth(): number {
    return this.currentLineWidth;
  }

  set lineWidth(value: number) {
    this.currentLineWidth = value;
    this.operations.push(`lineWidth:${value}`);
  }

  get strokeStyle(): string | CanvasGradient | CanvasPattern {
    return this.currentStrokeStyle;
  }

  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    this.currentStrokeStyle = value;
    this.operations.push(`strokeStyle:${String(value)}`);
  }

  save(): void {
    this.operations.push("save");
  }

  restore(): void {
    this.operations.push("restore");
  }

  beginPath(): void {
    this.operations.push("begin");
  }

  moveTo(x: number, y: number): void {
    this.operations.push(`move:${x},${y}`);
  }

  lineTo(x: number, y: number): void {
    this.operations.push(`line:${x},${y}`);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.operations.push(`quadratic:${cpx},${cpy},${x},${y}`);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.operations.push(`transform:${a},${b},${c},${d},${e},${f}`);
  }

  closePath(): void {
    this.operations.push("close");
  }

  createRadialGradient(): CanvasGradient {
    return { addColorStop: () => undefined } as unknown as CanvasGradient;
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.operations.push(`arc:${x},${y},${radius},${startAngle},${endAngle}`);
  }

  fill(): void {
    this.operations.push("fill");
  }

  stroke(): void {
    this.operations.push("stroke");
  }
}

function asKonvaContext(context: RecordingContext): Konva.Context {
  return context as unknown as Konva.Context;
}

function drawEl(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "stroke-1",
    type: "draw",
    points: [0, 0, 10, 0],
    stroke: "#123456",
    strokeWidth: 10,
    ...overrides,
  };
}

function roundedVariations(variations: readonly number[][]): number[][] {
  return variations.map((points) => points.map((value) => {
    if (Math.abs(value) < 1e-10) return 0;
    return Number(value.toFixed(10));
  }));
}

function stampStyle(
  kind: StudioStampBrushStyle["kind"] = "ink"
): StudioStampBrushStyle {
  return {
    kind,
    color: "#123456",
    size: 10,
    opacity: 0.8,
    flow: 0.7,
    hardness: 0.9,
    minSizeRatio: 0.25,
  };
}

describe("studio draw rendering bounds and symmetry", () => {
  it("normalizes missing, forward, and reverse drag bounds", () => {
    expect(drawBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(drawBounds([8, 4])).toEqual({ x: 8, y: 4, width: 0, height: 0 });
    expect(drawBounds([2, 3, 9, 11])).toEqual({ x: 2, y: 3, width: 7, height: 8 });
    expect(drawBounds([9, 11, 2, 3])).toEqual({ x: 2, y: 3, width: 7, height: 8 });
  });

  it("preserves identity and vertical/horizontal ordering exactly", () => {
    const points = [2, 3, 8, 11];
    expect(getSymmetricPoints(points, undefined)).toEqual([points]);
    expect(getSymmetricPoints(points, {
      type: "vertical",
      centerX: 10,
      centerY: 20,
    })).toEqual([
      points,
      [18, 3, 12, 11],
    ]);
    expect(getSymmetricPoints(points, {
      type: "horizontal",
      centerX: 10,
      centerY: 20,
    })).toEqual([
      points,
      [2, 37, 8, 29],
    ]);
  });

  it("keeps radial rotations in source-first clockwise canvas array order", () => {
    const points = [2, 1, 1, 2];
    const variations = getSymmetricPoints(points, {
      type: "radial",
      centerX: 1,
      centerY: 1,
      radialCount: 4,
    });

    expect(variations[0]).toBe(points);
    expect(roundedVariations(variations)).toEqual([
      [2, 1, 1, 2],
      [1, 2, 0, 1],
      [0, 1, 1, 0],
      [1, 0, 2, 1],
    ]);
  });

  it("bounds imported radial fans and replaces non-finite centers without emitting NaN", () => {
    const variations = getSymmetricPoints([2, 1], {
      type: "kaleidoscope",
      centerX: Number.NaN,
      centerY: Number.POSITIVE_INFINITY,
      radialCount: Number.MAX_SAFE_INTEGER,
    });

    expect(variations).toHaveLength(64);
    expect(variations.flat().every(Number.isFinite)).toBe(true);
  });
});

describe("studio draft preview destination-aware composition", () => {
  it("limits backdrop multiplication to unfilled freehand highlighter paint", () => {
    expect(resolveStudioDraftPreviewCompositeMode(drawEl({
      brush: "highlighter",
      mode: "pen",
    }))).toBe("backdrop-multiply");
    expect(resolveStudioDraftPreviewCompositeMode(drawEl({
      brush: "chisel-highlighter",
      mode: "pen",
      kind: "freehand",
    }))).toBe("backdrop-multiply");
    expect(resolveStudioDraftPreviewCompositeMode(drawEl({
      brush: "highlighter",
      fill: "#ffffff",
      kind: "rect",
      mode: "pen",
    }))).toBe("source-over");
    expect(resolveStudioDraftPreviewCompositeMode(drawEl({
      brush: "oil",
      mode: "pen",
    }))).toBe("source-over");
    expect(resolveStudioDraftPreviewCompositeMode(drawEl({
      brush: "highlighter",
      mode: "eraser",
    }))).toBe("source-over");
  });

  it("groups only adjacent equivalent modes and never reorders the bounded retained FIFO", () => {
    const highlighterA = drawEl({ id: "highlighter-a", brush: "highlighter", mode: "pen" });
    const highlighterB = drawEl({ id: "highlighter-b", brush: "pastel-highlighter", mode: "pen" });
    const normalAfter = drawEl({ id: "normal-after", brush: "oil", mode: "pen" });

    const runs = planStudioDraftPreviewCompositeRuns([
      highlighterA,
      highlighterB,
      normalAfter,
    ]);
    expect(runs.map(({ elements, mode }) => ({
      ids: elements.map(({ id }) => id),
      mode,
    }))).toEqual([
      {
        ids: ["highlighter-a", "highlighter-b"],
        mode: "backdrop-multiply",
      },
      { ids: ["normal-after"], mode: "source-over" },
    ]);
  });

  it("plans a synchronous boundary for erasing pending ink, retained DOM ink, and a third blend transition", () => {
    const pen = drawEl({ id: "pen", brush: "pen", mode: "pen" });
    const wash = drawEl({ id: "wash", brush: "highlighter", mode: "pen" });
    const oil = drawEl({ id: "oil", brush: "oil", mode: "pen" });
    const eraser = drawEl({ id: "eraser", brush: "kneaded-eraser", mode: "eraser" });

    expect(planStudioDraftPreviewBackdropBoundary({
      incoming: eraser,
      pending: [pen],
      hasRetainedDomBackdrop: false,
    })).toEqual({ action: "flush", reason: "eraser-backdrop" });
    expect(planStudioDraftPreviewBackdropBoundary({
      incoming: eraser,
      pending: [pen],
      hasRetainedDomBackdrop: true,
    })).toEqual({ action: "flush", reason: "eraser-backdrop" });
    expect(planStudioDraftPreviewBackdropBoundary({
      incoming: eraser,
      pending: [],
      hasRetainedDomBackdrop: false,
    })).toEqual({ action: "continue", reason: "within-layer-bound" });

    expect(planStudioDraftPreviewBackdropBoundary({
      incoming: wash,
      pending: [pen],
      hasRetainedDomBackdrop: true,
    })).toEqual({ action: "flush", reason: "retained-dom-backdrop" });
    expect(planStudioDraftPreviewBackdropBoundary({
      incoming: oil,
      pending: [pen, wash],
      hasRetainedDomBackdrop: false,
    })).toEqual({ action: "flush", reason: "third-blend-run" });
    expect(planStudioDraftPreviewBackdropBoundary({
      incoming: oil,
      pending: [wash],
      hasRetainedDomBackdrop: false,
    })).toEqual({ action: "continue", reason: "within-layer-bound" });
    expect(planStudioDraftPreviewBackdropBoundary({
      incoming: wash,
      pending: [wash],
      hasRetainedDomBackdrop: true,
      overlayOwnsPendingAndIncoming: true,
    })).toEqual({ action: "continue", reason: "overlay-owned-fifo" });
    expect(planStudioDraftPreviewBackdropBoundary({
      incoming: eraser,
      pending: [pen],
      hasRetainedDomBackdrop: true,
      overlayOwnsPendingAndIncoming: true,
    })).toEqual({ action: "continue", reason: "overlay-owned-fifo" });
  });

  it("flushes before restoring the pointer and never admits a first sample after failure", () => {
    const events: string[] = [];
    const plan = { action: "flush", reason: "retained-dom-backdrop" } as const;
    const success = executeStudioDraftPreviewBackdropBoundary({
      plan,
      flushSynchronously: (flush) => {
        events.push("flush-sync:start");
        flush();
        events.push("flush-sync:end");
      },
      flushPending: () => {
        events.push("commit:pending-pen");
        return true;
      },
      restorePointerPosition: () => events.push("pointer:first-sample-restored"),
    });
    events.push("crdt:begin-highlighter");

    expect(success).toEqual({ ready: true, synchronized: true });
    expect(events).toEqual([
      "flush-sync:start",
      "commit:pending-pen",
      "flush-sync:end",
      "pointer:first-sample-restored",
      "crdt:begin-highlighter",
    ]);

    const failedEvents: string[] = [];
    const failure = executeStudioDraftPreviewBackdropBoundary({
      plan,
      flushSynchronously: (flush) => flush(),
      flushPending: () => false,
      restorePointerPosition: () => failedEvents.push("must-not-run"),
    });
    expect(failure).toEqual({ ready: false, synchronized: false });
    expect(failedEvents).toEqual([]);
  });

  it("rejects a third settled full-stage run instead of allocating canvases without a bound", () => {
    expect(() => planStudioDraftPreviewCompositeRuns([
      drawEl({ id: "normal-before", brush: "watercolor", mode: "pen" }),
      drawEl({ id: "wash", brush: "highlighter", mode: "pen" }),
      drawEl({ id: "normal-after", brush: "oil", mode: "pen" }),
    ])).toThrow(/two-layer blend boundary/u);
  });
});

describe("v2 stamp symmetry render plan", () => {
  it("deduplicates a center tap and an axis-aligned mirror before translucent buildup", () => {
    const center = planStudioStampSymmetryRender(
      stampStyle("airbrush"),
      [50, 40],
      [0.5],
      { type: "kaleidoscope", centerX: 50, centerY: 40, radialCount: 16 },
    );
    expect(center.transforms).toHaveLength(1);
    expect(center.dabs).toHaveLength(1);
    expect(center.totalDabCount).toBe(1);

    const mirrorAxis = planStudioStampSymmetryRender(
      stampStyle(),
      [10, 0, 10, 20],
      [0.4, 0.8],
      { type: "vertical", centerX: 10, centerY: 0 },
    );
    expect(mirrorAxis.transforms).toHaveLength(1);
  });

  it("uses the canonical source-first affine transforms for radial and kaleidoscope copies", () => {
    const points = [2, 1, 1, 2];
    for (const type of ["radial", "kaleidoscope"] as const) {
      const symmetry = { type, centerX: 1, centerY: 1, radialCount: 4 };
      const expected = roundedVariations(getSymmetricPoints(points, symmetry));
      const plan = planStudioStampSymmetryRender(
        stampStyle(),
        points,
        [0.5, 0.5],
        symmetry,
      );
      const actual = plan.transforms.map((transform) => {
        const mapped: number[] = [];
        for (let index = 0; index < points.length; index += 2) {
          mapped.push(
            transform.a * points[index]! + transform.c * points[index + 1]! + transform.e,
            transform.b * points[index]! + transform.d * points[index + 1]! + transform.f,
          );
        }
        return mapped;
      });
      expect(roundedVariations(actual)).toEqual(expected);
    }
  });

  it("stops at the finite coordinate prefix and normalizes corrupt pressure samples", () => {
    const plan = planStudioStampSymmetryRender(
      stampStyle(),
      [0, 0, 8, 0, Number.NaN, 4, 100, 100],
      [Number.NaN, Number.POSITIVE_INFINITY],
      { type: "vertical", centerX: 20, centerY: 0 },
      100,
    );

    expect(plan.sourcePointCount).toBe(2);
    expect(plan.dabs.length).toBeGreaterThan(1);
    expect(plan.dabs.every((dab) =>
      [dab.x, dab.y, dab.radius, dab.alpha].every(Number.isFinite)
    )).toBe(true);
  });

  it("enforces one total dab budget across a corrupt fan and an enormous segment", () => {
    const plan = planStudioStampSymmetryRender(
      stampStyle(),
      [0, 0, 1_000_000_000, 0],
      [0.5, 0.5],
      {
        type: "kaleidoscope",
        centerX: 5,
        centerY: 5,
        radialCount: Number.MAX_SAFE_INTEGER,
      },
      37,
    );

    expect(plan.transforms).toHaveLength(37);
    expect(plan.totalDabCount).toBeLessThanOrEqual(37);
    expect(plan.dabs).toHaveLength(1);
  });

  it("keeps finite output and the global budget across deterministic generated inputs", () => {
    let state = 0x51f15e;
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const types = ["vertical", "horizontal", "radial", "kaleidoscope"] as const;
    const radialCounts = [1, 4, 16, 32, 1_000_000, Number.NaN] as const;

    for (let sample = 0; sample < 96; sample += 1) {
      const centerX = random() * 2_000 - 1_000;
      const centerY = random() * 2_000 - 1_000;
      const points = sample % 11 === 0
        ? [centerX, centerY]
        : Array.from({ length: 8 }, () => random() * 4_000 - 2_000);
      const maximumOutputDabs = 1 + Math.floor(random() * 257);
      const plan = planStudioStampSymmetryRender(
        stampStyle(sample % 2 === 0 ? "pencil" : "airbrush"),
        points,
        Array.from({ length: points.length / 2 }, () => random()),
        {
          type: types[sample % types.length]!,
          centerX,
          centerY,
          radialCount: radialCounts[sample % radialCounts.length],
        },
        maximumOutputDabs,
      );

      expect(plan.totalDabCount).toBeLessThanOrEqual(maximumOutputDabs);
      expect(plan.transforms.length).toBeLessThanOrEqual(64);
      expect(plan.dabs.every((dab) =>
        [dab.x, dab.y, dab.radius, dab.alpha].every(Number.isFinite)
      )).toBe(true);
      for (const transform of plan.transforms) {
        expect([
          transform.a,
          transform.b,
          transform.c,
          transform.d,
          transform.e,
          transform.f,
        ].every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("plans each symmetry copy in document space with SVG-procedure tip jitter", () => {
    const context = new RecordingContext();
    const plan = drawStudioStampStrokeWithSymmetry(
      context as unknown as CanvasRenderingContext2D,
      stampStyle("pencil"),
      [2, 3],
      [0.7],
      { type: "vertical", centerX: 10, centerY: 0 },
    );

    expect(plan.transforms).toHaveLength(2);
    expect(plan.dabVariations).toHaveLength(2);
    expect(plan.dabs).toBe(plan.dabVariations[0]);
    // Dab copies draw without a context transform: the mirrored copy is planned at its true
    // document position and re-derives index-keyed tip jitter there, exactly like the SVG
    // per-variation serializer (and the shared paper sheet for pinned lanes).
    expect(
      context.operations.some((operation) => operation.startsWith("transform:"))
    ).toBe(false);
    const perCopyArcCount = 3;
    const arcs = context.operations
      .filter((operation) => operation.startsWith("arc:"))
      .map((operation) => operation.slice("arc:".length).split(",").map(Number));
    expect(arcs).toHaveLength(perCopyArcCount * 2);
    const sourceArcs = arcs.slice(0, perCopyArcCount);
    const mirroredArcs = arcs.slice(perCopyArcCount);
    mirroredArcs.forEach((arc, index) => {
      const source = sourceArcs[index]!;
      // Same jitter offsets around the mirrored dab centre: x shifts by 2·(centerX − x₀) = 16.
      expect(arc[0]).toBeCloseTo(source[0]! + 16, 12);
      expect(arc.slice(1)).toEqual(source.slice(1));
    });
  });

  it("keeps the identity Canvas fallback byte-for-operation equivalent to direct replay", () => {
    const points = [0, 0, 8, 0, 14, 3];
    const pressures = [0.3, 0.7, 1];
    for (const kind of ["pencil", "airbrush", "watercolor"] as const) {
      const direct = new RecordingContext();
      drawStampStroke(direct as unknown as CanvasRenderingContext2D, stampStyle(kind), points, pressures);

      const symmetric = new RecordingContext();
      const plan = drawStudioStampStrokeWithSymmetry(
        symmetric as unknown as CanvasRenderingContext2D,
        stampStyle(kind),
        points,
        pressures,
        undefined,
      );

      expect(plan.transforms).toHaveLength(1);
      expect(symmetric.operations[0]).toBe("save");
      expect(symmetric.operations.at(-1)).toBe("restore");
      // Identity plans on the untouched source array and draws without a context transform,
      // so a symmetry-off stroke stays byte-for-operation identical to direct replay.
      expect(
        symmetric.operations.some((operation) => operation.startsWith("transform:"))
      ).toBe(false);
      expect(symmetric.operations.slice(1, -1)).toEqual(direct.operations);
    }

    const ink = new RecordingContext();
    const inkPlan = drawStudioStampStrokeWithSymmetry(
      ink as unknown as CanvasRenderingContext2D,
      stampStyle("ink"),
      points,
      pressures,
      undefined,
    );
    expect(inkPlan.transforms).toHaveLength(1);
    // The ink ribbon keeps its affine-replay path: one shared silhouette per copy.
    expect(ink.operations.slice(0, 2)).toEqual(["save", "transform:1,0,0,1,0,0"]);
    expect(ink.operations.filter((operation) => operation === "fill")).toHaveLength(1);
    expect(ink.operations.some((operation) => operation.startsWith("arc:"))).toBe(false);
    expect(ink.operations.some((operation) => operation.startsWith("move:"))).toBe(true);
    expect(ink.operations.some((operation) => operation === "close")).toBe(true);
  });
});

describe("default freehand Canvas2D operation contract", () => {
  it("does not touch the context for malformed paths shorter than two points", () => {
    for (const points of [[], [1], [1, 2], [1, 2, 3]]) {
      const context = new RecordingContext();
      drawFreehandPenSegments(asKonvaContext(context), points, null, "#abc", 7);
      expect(context.operations).toEqual([]);
    }
  });

  it("records a two-point segment with a pressure-derived width", () => {
    const context = new RecordingContext();
    drawFreehandPenSegments(
      asKonvaContext(context),
      [0, 1, 10, 5],
      [0.2, 0.75],
      "#abcdef",
      8,
    );

    expect(context.operations).toEqual([
      "lineCap:round",
      "lineJoin:round",
      "strokeStyle:#abcdef",
      "begin",
      "move:0,1",
      "line:10,5",
      "lineWidth:10.799999999999999",
      "stroke",
    ]);
  });

  it("records midpoint quadratics in order for a three-point segment", () => {
    const context = new RecordingContext();
    drawFreehandPenSegments(
      asKonvaContext(context),
      [0, 0, 10, 0, 20, 10],
      [0, 0.5, 1],
      "#111111",
      10,
    );

    expect(context.operations).toEqual([
      "lineCap:round",
      "lineJoin:round",
      "strokeStyle:#111111",
      "begin",
      "move:0,0",
      "quadratic:0,0,5,0",
      "lineWidth:10",
      "stroke",
      "begin",
      "move:5,0",
      "quadratic:10,0,20,10",
      "lineWidth:17",
      "stroke",
    ]);
  });

  it("clamps very small pressure widths and uses the missing-pressure fallback", () => {
    const context = new RecordingContext();
    drawFreehandPenSegments(
      asKonvaContext(context),
      [0, 0, 2, 0, 4, 0],
      [-100],
      "#000000",
      0.1,
    );

    expect(context.operations.filter((operation) => operation.startsWith("lineWidth:"))).toEqual([
      "lineWidth:0.5",
      "lineWidth:0.5",
    ]);
  });
});

describe("causal ink Canvas2D parity", () => {
  const points = [0, 0, 9, 0, 15, 3];
  const pressures = [0.2, 0.8, 1];

  function expectMatchesCanonicalPlan(paintModel?: StudioStrokePaintModel): RecordingContext {
    const actual = new RecordingContext();
    drawStudioCausalInkDabs(
      asKonvaContext(actual),
      points,
      pressures,
      "#336699",
      8,
      2,
      undefined,
      paintModel,
    );

    const expected = new RecordingContext();
    const plan = planStudioCausalInk({ points, pressures, minDistance: 2, size: 8 });
    fillStudioCausalInkDabs(expected, plan.dabs, "#336699", paintModel);
    expect(actual.operations).toEqual(expected.operations);
    return actual;
  }

  it("matches the canonical plan with frozen legacy per-dab fills", () => {
    const context = expectMatchesCanonicalPlan();
    const fillCount = context.operations.filter((operation) => operation === "fill").length;
    const arcCount = context.operations.filter((operation) => operation.startsWith("arc:")).length;
    expect(fillCount).toBe(arcCount);
    expect(fillCount).toBeGreaterThan(1);
    expect(context.operations.some((operation) => operation.startsWith("move:"))).toBe(false);
  });

  it("matches the canonical layered-flow compound path and fills once", () => {
    const context = expectMatchesCanonicalPlan("layered-flow-v1");
    const fillCount = context.operations.filter((operation) => operation === "fill").length;
    const arcCount = context.operations.filter((operation) => operation.startsWith("arc:")).length;
    const moveCount = context.operations.filter((operation) => operation.startsWith("move:")).length;
    expect(fillCount).toBe(1);
    expect(moveCount).toBe(arcCount);
    expect(arcCount).toBeGreaterThan(1);
  });
});

describe("direct-live eligibility", () => {
  it.each([
    ["default freehand pen", drawEl(), true],
    ["explicit fineliner", drawEl({ brush: "fineliner", mode: "pen" }), true],
    ["marker", drawEl({ brush: "marker", mode: "pen" }), true],
    ["G-pen with stale residual metadata", drawEl({
      brush: "gpen",
      mode: "pen",
      pressureModel: "linear-residual-path-v3",
      sampleSpacing: 0,
    }), false],
    ["legacy G-pen outline", drawEl({ brush: "gpen", mode: "pen" }), false],
    ["pixel pencil", drawEl({ brush: STUDIO_PIXEL_PENCIL_RENDER_MODE, mode: "pen" }), true],
    ["eraser ignores specialty family", drawEl({ brush: "watercolor", mode: "eraser" }), true],
    ["shape", drawEl({ kind: "rect", mode: "pen" }), false],
    ["dynamic alias", drawEl({ brush: "spray", mode: "pen" }), false],
    ["dynamic preset", drawEl({ brush: "ink-particle", mode: "pen" }), false],
    ["non-default family", drawEl({ brush: "watercolor", mode: "pen" }), false],
  ])("classifies %s", (_label, element, expected) => {
    expect(isDirectLiveDraftEl(element)).toBe(expected);
  });

  it.each([
    ["ink uses retained stroke-local ribbon", drawEl({ mode: "pen", brush: "ink-brush", stampPipeline: "causal-walker-v2" }), false],
    ["eligible stamp", drawEl({ mode: "pen", brush: "airbrush-fine", stampPipeline: "causal-walker-v2" }), true],
    ["default mode is not explicit pen", drawEl({ brush: "ink-brush", stampPipeline: "causal-walker-v2" }), false],
    ["eraser", drawEl({ mode: "eraser", brush: "ink-brush", stampPipeline: "causal-walker-v2" }), false],
    ["shape", drawEl({ kind: "line", mode: "pen", brush: "ink-brush", stampPipeline: "causal-walker-v2" }), false],
    ["closed fill", drawEl({ mode: "pen", brush: "ink-brush", fill: "#fff", stampPipeline: "causal-walker-v2" }), false],
    ["legacy pipeline", drawEl({ mode: "pen", brush: "ink-brush" }), false],
    ["non-stamp brush", drawEl({ mode: "pen", brush: "fineliner", stampPipeline: "causal-walker-v2" }), false],
    ["non-identity symmetry", drawEl({
      mode: "pen",
      brush: "airbrush-fine",
      stampPipeline: "causal-walker-v2",
      symmetry: { type: "vertical", centerX: 0, centerY: 0 },
    }), false],
    ["identity symmetry", drawEl({
      mode: "pen",
      brush: "airbrush-fine",
      stampPipeline: "causal-walker-v2",
      symmetry: { type: "none", centerX: 0, centerY: 0 },
    }), true],
  ])("classifies %s", (_label, element, expected) => {
    expect(isDirectLiveStampDraftEl(element)).toBe(expected);
  });
});

describe("live freehand Canvas2D fixtures", () => {
  it("keeps the historical causal G-pen helper deterministic without direct-live admission", () => {
    const gpen = drawEl({
      brush: "gpen",
      mode: "pen",
      points: [2, 3, 9, 7, 16, 5, 24, 11],
      pressures: [0.18, 0.42, 0.9, 0.64],
      stroke: "#251812",
      strokeWidth: 18,
      opacity: 0.72,
      pressureModel: "linear-residual-path-v3",
      sampleSpacing: 0,
    });
    const contract = resolveStudioCausalInkDrawContract(gpen);
    const retained = new RecordingContext();
    drawStudioCausalInkContract(asKonvaContext(retained), contract);
    const live = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(live), gpen);

    expect(isDirectLiveDraftEl(gpen)).toBe(false);
    expect(resolveStudioLiveInkStrokeStyle(gpen)).toEqual({
      color: contract.strokeColor,
      strokeWidthDoc: contract.strokeWidth,
      pressureModel: contract.pressureModel,
      paintModel: contract.paintModel,
      opacity: contract.opacity,
      minDistanceDoc: contract.minDistance,
    });
    expect(live.operations).toEqual([
      "save",
      `alpha:${contract.opacity}`,
      `composite:${contract.composite}`,
      ...retained.operations,
      "restore",
    ]);
  });

  it("paints a visible causal G-pen dab on the first contact sample", () => {
    const gpen = drawEl({
      brush: "gpen",
      mode: "pen",
      points: [4, 7],
      pressures: undefined,
      strokeWidth: 18,
      pressureModel: "linear-residual-path-v3",
      sampleSpacing: 0,
    });
    const context = new RecordingContext();
    drawStudioCausalInkContract(
      asKonvaContext(context),
      resolveStudioCausalInkDrawContract(gpen)
    );

    const firstArc = context.operations.find((operation) => operation.startsWith("arc:"));
    expect(firstArc).toBeDefined();
    expect(Number(firstArc?.split(",")[2])).toBeGreaterThan(0);
  });

  it("keeps legacy overlay thinning while causal strokes share retained zero spacing", () => {
    expect(resolveStudioLiveInkStrokeStyle(drawEl()).minDistanceDoc).toBe(3);
    expect(resolveStudioLiveInkStrokeStyle(drawEl({
      pressureModel: "linear-residual-path-v3",
    })).minDistanceDoc).toBe(0);
  });

  it("uses the same alias diameter and pressure mapping for live pen families", () => {
    const fineliner = drawEl({
      mode: "pen",
      brush: "fineliner",
      points: [4, 7],
      pressures: [0],
    });
    const markerBold = drawEl({
      mode: "pen",
      brush: "marker-bold",
      points: [4, 7],
      pressures: [0],
    });

    expect(studioLiveBrushEffectiveDiameter(fineliner)).toBe(4.8);
    expect(studioLiveBrushPressure(fineliner, 0)).toBe(0.8);
    expect(studioLiveBrushPressureSamples(fineliner)).toEqual([0.8]);
    expect(studioLiveBrushEffectiveDiameter(markerBold)).toBe(15);
    expect(studioLiveBrushPressure(markerBold, 0)).toBe(0.92);

    const fineContext = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(fineContext), fineliner);
    const boldContext = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(boldContext), markerBold);

    expect(fineContext.operations).toContain(`arc:4,7,3.408,0,${Math.PI * 2}`);
    expect(boldContext.operations).toContain(`arc:4,7,11.91,0,${Math.PI * 2}`);
    expect(fineContext.operations).not.toEqual(boldContext.operations);
  });

  it("keeps eraser diameter independent from the previously selected alias", () => {
    const eraser = drawEl({
      mode: "eraser",
      brush: "marker-bold",
      strokeWidth: 10,
      points: [0, 0, 2, 0],
      pressures: [0, 1],
    });

    expect(studioLiveBrushEffectiveDiameter(eraser)).toBe(10);
    expect(studioLiveBrushPressureSamples(eraser)).toEqual([0, 1]);
  });

  it("maps omitted live samples with the persisted pressure-model fallback", () => {
    const liner = drawEl({
      mode: "pen",
      brush: "liner",
      pressureModel: "linear-residual-path-v3",
      points: [0, 0, 2, 0],
      pressures: undefined,
    });

    expect(studioLiveBrushPressureSamples(liner)).toEqual([0.92, 0.92]);
  });

  it("renders pixel-pencil samples as de-duplicated integer fillRect cells", () => {
    const context = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(context), drawEl({
      brush: STUDIO_PIXEL_PENCIL_RENDER_MODE,
      points: [0.8, 2.2, 3.9, 2.7, 1.1, 2.1],
      pressures: [1, 1, 1],
      stroke: "#123456",
      strokeWidth: 1,
      opacity: 0.7,
    }));

    expect(context.operations).toEqual([
      "save",
      "alpha:0.7",
      "composite:source-over",
      "fillStyle:#123456",
      "fillRect:0,2,1,1",
      "fillRect:1,2,1,1",
      "fillRect:2,2,1,1",
      "fillRect:3,2,1,1",
      "restore",
    ]);
  });

  it("wraps a one-point pen dab with clamped alpha and source-over state", () => {
    const context = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(context), drawEl({
      points: [4, 7],
      pressures: [1],
      opacity: 4,
    }));

    expect(context.operations).toEqual([
      "save",
      "alpha:1",
      "composite:source-over",
      "begin",
      `arc:4,7,8.5,0,${Math.PI * 2}`,
      "fillStyle:#123456",
      "fill",
      "restore",
    ]);
  });

  it("uses destination-out, the eraser color, and minimum dab radius for a one-point eraser", () => {
    const context = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(context), drawEl({
      mode: "eraser",
      points: [2, 3],
      pressures: [-10],
      opacity: -2,
      strokeWidth: 0,
    }));

    expect(context.operations).toEqual([
      "save",
      "alpha:0",
      "composite:destination-out",
      "begin",
      `arc:2,3,0.35,0,${Math.PI * 2}`,
      "fillStyle:#16100c",
      "fill",
      "restore",
    ]);
  });

  it("renders fill then outline for the original and vertical mirror", () => {
    const context = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(context), drawEl({
      points: [0, 0, 10, 0, 10, 10],
      fill: "#fedcba",
      opacity: 0.4,
      symmetry: { type: "vertical", centerX: 10, centerY: 5 },
    }));

    expect(context.operations.slice(0, 3)).toEqual([
      "save",
      "alpha:0.4",
      "composite:source-over",
    ]);
    expect(context.operations.at(-1)).toBe("restore");
    expect(context.operations.filter((operation) => operation === "close")).toHaveLength(2);
    expect(context.operations.filter((operation) => operation === "fill")).toHaveLength(2);
    expect(context.operations.filter((operation) => operation === "stroke")).toHaveLength(4);
    expect(context.operations).toContain("move:0,0");
    expect(context.operations).toContain("move:20,0");
    expect(context.operations.filter((operation) => operation === "fillStyle:#fedcba")).toHaveLength(2);
  });

  it("routes ink and low-density eraser unions once while generic erasers keep legacy buildup", () => {
    const pen = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(pen), drawEl({
      points: [0, 0, 8, 0],
      pressures: [0.5, 1],
      sampleSpacing: 1,
      paintModel: "layered-flow-v1",
    }));
    expect(pen.operations[0]).toBe("save");
    expect(pen.operations).toContain("composite:source-over");
    expect(pen.operations.filter((operation) => operation === "fill")).toHaveLength(1);
    expect(pen.operations.at(-1)).toBe("restore");

    const eraser = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(eraser), drawEl({
      mode: "eraser",
      points: [0, 0, 8, 0],
      pressures: [0.5, 1],
      sampleSpacing: 1,
      paintModel: "layered-flow-v1",
    }));
    expect(eraser.operations).toContain("composite:destination-out");
    expect(eraser.operations.filter((operation) => operation === "fill").length).toBeGreaterThan(1);
    expect(eraser.operations).not.toContain("fillStyle:#123456");
    expect(eraser.operations).toContain("fillStyle:#16100c");
    expect(eraser.operations.at(-1)).toBe("restore");

    const kneaded = new RecordingContext();
    drawLiveFreehandDraftToContext(asKonvaContext(kneaded), drawEl({
      mode: "eraser",
      brush: "kneaded-eraser",
      opacity: 0.38,
      points: [0, 0, 8, 0],
      pressures: [0.5, 1],
      sampleSpacing: 1,
      paintModel: "layered-flow-v1",
    }));
    expect(kneaded.operations).toContain("alpha:0.38");
    expect(kneaded.operations).toContain("composite:destination-out");
    expect(kneaded.operations.filter((operation) => operation === "fill")).toHaveLength(1);
    expect(kneaded.operations.filter((operation) => operation.startsWith("arc:")).length)
      .toBeGreaterThan(1);
  });
});
