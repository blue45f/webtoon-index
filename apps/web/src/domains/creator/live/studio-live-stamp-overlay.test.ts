import { afterEach, describe, expect, it, vi } from "vitest";

import {
  drawStampStroke,
  STUDIO_STAMP_BRUSH_DEFAULTS,
  type StudioStampBrushKind,
  type StudioStampBrushStyle,
} from "../brush/studio-brush-stamp-engine";

import { StudioLiveStampOverlayRenderer } from "./studio-live-stamp-overlay";

import type { StudioLiveInkSurface } from "./studio-live-ink-overlay";

interface RecordedMark {
  readonly kind: "fill" | "stroke";
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
  readonly lineWidth: number;
}

interface RecordedContextState {
  readonly alpha: number;
  readonly lineWidth: number;
  readonly fillStyle: string | CanvasGradient | CanvasPattern;
  readonly strokeStyle: string | CanvasGradient | CanvasPattern;
  readonly lineCap: CanvasLineCap;
  readonly lineJoin: CanvasLineJoin;
  readonly composite: GlobalCompositeOperation;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

/** Records stamp footprints without requiring a native Canvas implementation in the node worker. */
function recordingCanvas() {
  const marks: RecordedMark[] = [];
  const clearRect = vi.fn();
  const setTransform = vi.fn();
  const stateStack: RecordedContextState[] = [];
  let alpha = 1;
  let lineWidth = 1;
  let fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  let strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  let lineCap: CanvasLineCap = "butt";
  let lineJoin: CanvasLineJoin = "miter";
  let composite: GlobalCompositeOperation = "source-over";
  let pathArc: { x: number; y: number; radius: number } | null = null;

  const record = (kind: RecordedMark["kind"]): void => {
    if (!pathArc) return;
    marks.push({
      kind,
      x: rounded(pathArc.x),
      y: rounded(pathArc.y),
      radius: rounded(pathArc.radius),
      alpha: rounded(alpha),
      // Canvas fill coverage is independent of the retained stroke width. Watercolor changes the
      // width only for its following wet-edge ring, so recording it on a fill creates a false
      // incremental-vs-whole mismatch across context save/restore boundaries.
      lineWidth: kind === "stroke" ? rounded(lineWidth) : 0,
    });
  };

  const context = {
    save: () => {
      stateStack.push({
        alpha,
        lineWidth,
        fillStyle,
        strokeStyle,
        lineCap,
        lineJoin,
        composite,
      });
    },
    restore: () => {
      const state = stateStack.pop();
      if (!state) return;
      alpha = state.alpha;
      lineWidth = state.lineWidth;
      fillStyle = state.fillStyle;
      strokeStyle = state.strokeStyle;
      lineCap = state.lineCap;
      lineJoin = state.lineJoin;
      composite = state.composite;
    },
    setTransform,
    clearRect,
    createRadialGradient: () => ({ addColorStop: () => undefined } as unknown as CanvasGradient),
    beginPath: () => {
      pathArc = null;
    },
    arc: (x: number, y: number, radius: number) => {
      pathArc = { x, y, radius };
    },
    fill: () => record("fill"),
    stroke: () => record("stroke"),
    set globalAlpha(value: number) {
      alpha = value;
    },
    get globalAlpha() {
      return alpha;
    },
    set lineWidth(value: number) {
      lineWidth = value;
    },
    get lineWidth() {
      return lineWidth;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      strokeStyle = value;
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set lineCap(value: CanvasLineCap) {
      lineCap = value;
    },
    get lineCap() {
      return lineCap;
    },
    set lineJoin(value: CanvasLineJoin) {
      lineJoin = value;
    },
    get lineJoin() {
      return lineJoin;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      composite = value;
    },
    get globalCompositeOperation() {
      return composite;
    },
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, clearRect, context, marks, setTransform };
}

const SURFACE: StudioLiveInkSurface = {
  left: 0,
  top: 0,
  width: 160,
  height: 120,
  documentScale: 1,
  documentWidth: 160,
  flipX: false,
};

function style(kind: StudioStampBrushKind): StudioStampBrushStyle {
  return {
    kind,
    color: "#25364a",
    size: 14,
    opacity: 0.82,
    ...STUDIO_STAMP_BRUSH_DEFAULTS[kind],
  };
}

const POINTS = [0, 8, 5, 9, 12, 8, 21, 13, 34, 11, 48, 18] as const;
const PRESSURES = [0.2, 0.35, 0.5, 0.72, 0.9, 0.65] as const;

function replayMarks(
  brushStyle: StudioStampBrushStyle,
  points: readonly number[],
  pressures: readonly number[]
): readonly RecordedMark[] {
  const recording = recordingCanvas();
  drawStampStroke(recording.context, brushStyle, points, pressures);
  return recording.marks;
}

function beginAndAppend(
  renderer: StudioLiveStampOverlayRenderer,
  brushStyle: StudioStampBrushStyle,
  points: readonly number[],
  pressures: readonly number[]
): void {
  expect(renderer.begin(brushStyle, points[0]!, points[1]!, pressures[0]!)).toBe(true);
  renderer.appendFrom(points, pressures);
}

function addSettledStroke(
  renderer: StudioLiveStampOverlayRenderer,
  brushStyle: StudioStampBrushStyle,
  points: readonly number[],
  pressures: readonly number[]
): void {
  beginAndAppend(renderer, brushStyle, points, pressures);
  renderer.end();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StudioLiveStampOverlayRenderer", () => {
  it("does not authorize native geometry when a 2D context is unavailable", () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const renderer = new StudioLiveStampOverlayRenderer();
    renderer.attach(canvas);
    renderer.setSurface(SURFACE);

    expect(renderer.surfaceResolutionDecision?.ok).toBe(true);
    expect(renderer.isNativeSurfaceReady).toBe(false);
    expect(renderer.begin(style("ink"), 10, 10, 0.5)).toBe(false);
  });

  it("keeps mobile native DPR and fails closed instead of accepting a reduced 4K surface", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const recording = recordingCanvas();
    const renderer = new StudioLiveStampOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface({
      ...SURFACE,
      width: 430,
      height: 932,
      documentWidth: 430,
    });

    expect(renderer.isNativeSurfaceReady).toBe(true);
    expect(renderer.surfaceResolutionDecision).toMatchObject({
      ok: true,
      mode: "native",
      devicePixelRatio: 3,
    });
    expect(recording.canvas.width).toBe(1_290);
    expect(recording.canvas.height).toBe(2_796);
    expect(renderer.begin(style("ink"), 10, 10, 0.5)).toBe(true);
    renderer.resetActive();
    const nativeMarkCount = recording.marks.length;

    vi.stubGlobal("devicePixelRatio", 2);
    renderer.setSurface({
      ...SURFACE,
      width: 3_840,
      height: 2_160,
      documentWidth: 3_840,
    });

    expect(renderer.isNativeSurfaceReady).toBe(false);
    expect(renderer.surfaceResolutionDecision).toEqual({
      ok: false,
      mode: "retained-exact-fallback",
      reason: "native-backing-pixel-budget-exceeded",
    });
    expect(recording.canvas.width).toBe(1);
    expect(recording.canvas.height).toBe(1);
    expect(renderer.begin(style("watercolor"), 10, 10, 0.5)).toBe(false);
    expect(renderer.isActive).toBe(false);
    expect(recording.marks).toHaveLength(nativeMarkCount);
  });

  it.each(["airbrush", "pencil", "ink", "watercolor"] as const)(
    "keeps a tap-only %s mark identical across live, settled, and replay handoff",
    (kind) => {
      const recording = recordingCanvas();
      const renderer = new StudioLiveStampOverlayRenderer();
      const brushStyle = style(kind);
      const tapPoints = [18, 27] as const;
      const tapPressures = [0.63] as const;
      renderer.attach(recording.canvas);
      renderer.setSurface(SURFACE);

      expect(renderer.begin(
        brushStyle,
        tapPoints[0],
        tapPoints[1],
        tapPressures[0]
      )).toBe(true);
      const expected = replayMarks(brushStyle, tapPoints, tapPressures);
      expect(recording.marks).toEqual(expected);

      renderer.end();
      expect(recording.marks).toEqual(expected);
      expect(renderer.settledStrokeCount).toBe(1);

      const replacement = recordingCanvas();
      renderer.attach(replacement.canvas);
      expect(replacement.marks).toEqual(expected);
    }
  );

  it.each(["airbrush", "pencil", "ink", "watercolor"] as const)(
    "matches whole-stroke %s replay while appending in multiple pointer batches",
    (kind) => {
      const recording = recordingCanvas();
      const renderer = new StudioLiveStampOverlayRenderer();
      const brushStyle = style(kind);
      renderer.attach(recording.canvas);
      renderer.setSurface(SURFACE);

      expect(renderer.begin(brushStyle, POINTS[0], POINTS[1], PRESSURES[0])).toBe(true);
      renderer.appendFrom(POINTS.slice(0, 8), PRESSURES.slice(0, 4));
      renderer.appendFrom(POINTS, PRESSURES);
      renderer.end();

      expect(recording.marks).toEqual(replayMarks(brushStyle, POINTS, PRESSURES));
      expect(renderer.isActive).toBe(false);
      expect(renderer.settledStrokeCount).toBe(1);
    }
  );

  it("never clears or rewrites an already painted low-alpha prefix during append", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveStampOverlayRenderer();
    const brushStyle = style("airbrush");
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    expect(renderer.begin(brushStyle, POINTS[0], POINTS[1], PRESSURES[0])).toBe(true);

    const prefixPoints = POINTS.slice(0, 8);
    const prefixPressures = PRESSURES.slice(0, 4);
    renderer.appendFrom(prefixPoints, prefixPressures);
    const stablePrefix = recording.marks.map((mark) => ({ ...mark }));
    const clearsBeforeSuffix = recording.clearRect.mock.calls.length;

    renderer.appendFrom(POINTS, PRESSURES);

    expect(recording.clearRect).toHaveBeenCalledTimes(clearsBeforeSuffix);
    expect(recording.marks.slice(0, stablePrefix.length)).toEqual(stablePrefix);
    expect(recording.marks.length).toBeGreaterThan(stablePrefix.length);

    const countAfterSuffix = recording.marks.length;
    renderer.appendFrom(POINTS, PRESSURES);
    expect(recording.marks).toHaveLength(countAfterSuffix);
  });

  it("releases only the committed FIFO prefix and replays the retained suffix", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveStampOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    const first = [2, 6, 10, 8, 19, 6];
    const second = [38, 16, 47, 12, 59, 17];
    const third = [82, 30, 91, 34, 106, 31];
    const pressures = [0.3, 0.6, 0.9];
    addSettledStroke(renderer, style("ink"), first, pressures);
    addSettledStroke(renderer, style("pencil"), second, pressures);
    addSettledStroke(renderer, style("watercolor"), third, pressures);
    expect(renderer.settledStrokeCount).toBe(3);

    const beforeRelease = recording.marks.length;
    recording.clearRect.mockClear();
    expect(renderer.releaseSettledPrefix(2)).toBe(2);

    expect(renderer.settledStrokeCount).toBe(1);
    expect(renderer.hasSettledStrokes).toBe(true);
    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    expect(recording.marks.slice(beforeRelease)).toEqual(
      replayMarks(style("watercolor"), third, pressures)
    );

    const beforeNoop = recording.marks.length;
    recording.clearRect.mockClear();
    expect(renderer.releaseSettledPrefix(0)).toBe(0);
    expect(renderer.releaseSettledPrefix(Number.NaN)).toBe(0);
    expect(recording.clearRect).not.toHaveBeenCalled();
    expect(recording.marks).toHaveLength(beforeNoop);

    expect(renderer.clearSettled()).toBe(1);
    expect(renderer.settledStrokeCount).toBe(0);
    expect(renderer.hasSettledStrokes).toBe(false);
  });

  it("replays settled and active strokes with the live-ink DPR and flipped viewport transform", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const recording = recordingCanvas();
    const renderer = new StudioLiveStampOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);

    const settledPoints = [4, 10, 16, 12, 27, 9];
    const settledPressures = [0.25, 0.55, 0.8];
    const activePoints = [58, 38, 66, 42, 78, 39];
    const activePressures = [0.4, 0.7, 1];
    const settledStyle = style("pencil");
    const activeStyle = style("airbrush");
    addSettledStroke(renderer, settledStyle, settledPoints, settledPressures);
    beginAndAppend(renderer, activeStyle, activePoints, activePressures);

    const expectedReplay = [
      ...replayMarks(settledStyle, settledPoints, settledPressures),
      ...replayMarks(activeStyle, activePoints, activePressures),
    ];
    const beforeSurfaceReplay = recording.marks.length;
    const flippedSurface: StudioLiveInkSurface = {
      left: 5,
      top: 7,
      width: 120,
      height: 90,
      documentScale: 1.5,
      documentWidth: 100,
      flipX: true,
    };
    recording.clearRect.mockClear();
    renderer.setSurface(flippedSurface);

    expect(recording.canvas.width).toBe(240);
    expect(recording.canvas.height).toBe(180);
    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    expect(recording.marks.slice(beforeSurfaceReplay)).toEqual(expectedReplay);
    expect(recording.setTransform).toHaveBeenLastCalledWith(-3, 0, 0, 3, 290, -14);

    const replacement = recordingCanvas();
    renderer.attach(replacement.canvas);
    expect(replacement.canvas.width).toBe(240);
    expect(replacement.canvas.height).toBe(180);
    expect(replacement.marks).toEqual(expectedReplay);
    expect(replacement.setTransform).toHaveBeenLastCalledWith(-3, 0, 0, 3, 290, -14);
  });

  it("cancels only active pixels, then clear removes every retained stroke", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveStampOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    const settledPoints = [4, 50, 16, 48, 25, 53];
    const settledPressures = [0.3, 0.55, 0.85];
    const settledStyle = style("ink");
    addSettledStroke(renderer, settledStyle, settledPoints, settledPressures);
    beginAndAppend(renderer, style("airbrush"), [62, 50, 75, 45], [0.4, 0.8]);
    const beforeReset = recording.marks.length;

    expect(renderer.resetActive()).toBe(true);
    expect(renderer.isActive).toBe(false);
    expect(renderer.settledStrokeCount).toBe(1);
    expect(recording.marks.slice(beforeReset)).toEqual(
      replayMarks(settledStyle, settledPoints, settledPressures)
    );
    expect(renderer.resetActive()).toBe(false);

    recording.clearRect.mockClear();
    renderer.clear();
    expect(renderer.settledStrokeCount).toBe(0);
    expect(recording.clearRect).toHaveBeenCalledTimes(1);
  });
});
