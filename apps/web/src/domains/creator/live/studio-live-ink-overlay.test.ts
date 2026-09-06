import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveStudioCausalInkDrawContract,
  resolveStudioLiveInkStrokeStyle,
} from "../brush/studio-draw-rendering";
import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
} from "../brush/studio-ink-pressure-model";
import { planStudioCausalInk } from "../studio-causal-ink";

import {
  StudioLiveInkOverlayRenderer,
  StudioLiveInkPredictionRenderer,
  studioLiveInkFastOverlaySupportsStyle,
  type StudioLiveInkStrokeStyle,
  type StudioLiveInkSurface,
} from "./studio-live-ink-overlay";

import type { DrawEl } from "../studio-element-model";

interface RecordedDab {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

/** Records the exact round-dab footprint without depending on a native canvas implementation. */
function recordingCanvas() {
  const dabs: RecordedDab[] = [];
  const clearRect = vi.fn();
  let current: RecordedDab | null = null;
  const context = {
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    clearRect,
    beginPath: () => {
      current = null;
    },
    arc: (x: number, y: number, radius: number) => {
      current = { x: rounded(x), y: rounded(y), radius: rounded(radius) };
    },
    fill: () => {
      if (current) dabs.push(current);
    },
    lineCap: "butt",
    lineJoin: "miter",
    strokeStyle: "#000000",
    fillStyle: "#000000",
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, clearRect, dabs };
}

const SURFACE: StudioLiveInkSurface = {
  left: 0,
  top: 0,
  width: 100,
  height: 80,
  documentScale: 1,
  documentWidth: 100,
  flipX: false,
};

const STYLE: StudioLiveInkStrokeStyle = {
  color: "#24180f",
  strokeWidthDoc: 10,
  opacity: 1,
  minDistanceDoc: 0,
};

function setup(style: StudioLiveInkStrokeStyle = STYLE) {
  const recording = recordingCanvas();
  const renderer = new StudioLiveInkOverlayRenderer();
  renderer.attach(recording.canvas);
  renderer.setSurface(SURFACE);
  expect(renderer.begin(style, 0, 0, 0.25)).toBe(true);
  return { renderer, ...recording };
}

function addStroke(
  renderer: StudioLiveInkOverlayRenderer,
  points: readonly number[],
  pressures: readonly number[],
  style: StudioLiveInkStrokeStyle = STYLE
): void {
  expect(points.length).toBeGreaterThanOrEqual(2);
  expect(renderer.begin(style, points[0]!, points[1]!, pressures[0] ?? 0.5)).toBe(true);
  renderer.appendFrom(points, pressures);
  renderer.end();
}

function canonicalStrokeDabs(
  points: readonly number[],
  pressures: readonly number[],
  style: StudioLiveInkStrokeStyle = STYLE
): readonly RecordedDab[] {
  const recording = recordingCanvas();
  const renderer = new StudioLiveInkOverlayRenderer();
  renderer.attach(recording.canvas);
  renderer.setSurface(SURFACE);
  addStroke(renderer, points, pressures, style);
  return recording.dabs;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StudioLiveInkOverlayRenderer", () => {
  it("keeps a core G-pen first dab and settled footprint identical to its retained contract", () => {
    const element: DrawEl = {
      id: "gpen-contract",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      brush: "gpen",
      points: [2, 3, 9, 7, 16, 5, 24, 11],
      pressures: [0.18, 0.42, 0.9, 0.64],
      stroke: "#251812",
      strokeWidth: 18,
      opacity: 0.72,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
      sampleSpacing: 0,
    };
    const contract = resolveStudioCausalInkDrawContract(element);
    const style = resolveStudioLiveInkStrokeStyle(element);
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);

    expect(
      renderer.begin(
        style,
        contract.points[0]!,
        contract.points[1]!,
        contract.pressures[0]!
      )
    ).toBe(true);
    expect(recording.dabs[0]?.radius).toBeGreaterThan(0);
    renderer.appendFrom(contract.points, contract.pressures);
    renderer.end();

    const expected = planStudioCausalInk({
      points: contract.points,
      pressures: contract.pressures,
      minDistance: contract.minDistance,
      size: contract.strokeWidth,
      pressureModel: contract.pressureModel,
    }).dabs.map((dab) => ({
      x: rounded(dab.x),
      y: rounded(dab.y),
      radius: rounded(dab.radius),
    }));
    expect(recording.dabs).toEqual(expected);
    recording.clearRect.mockClear();
    expect(renderer.reauthorLastSettledFromDocumentPoints({
      style,
      points: contract.points,
      pressures: contract.pressures,
    })).toBe(true);
    expect(recording.clearRect).not.toHaveBeenCalled();
    expect(recording.dabs).toEqual(expected);
  });

  it("does not authorize native geometry when a 2D context is unavailable", () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(canvas);
    renderer.setSurface(SURFACE);

    expect(renderer.surfaceResolutionDecision?.ok).toBe(true);
    expect(renderer.isNativeSurfaceReady).toBe(false);
    expect(renderer.begin(STYLE, 0, 0, 0.5)).toBe(false);
  });

  it("uses exact native DPR for ordinary surfaces and fails closed for 4K DPR2", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface({
      ...SURFACE,
      width: 1_920,
      height: 1_080,
      documentWidth: 1_920,
    });

    expect(renderer.isNativeSurfaceReady).toBe(true);
    expect(renderer.surfaceResolutionDecision).toMatchObject({
      ok: true,
      mode: "native",
      devicePixelRatio: 2,
    });
    expect(recording.canvas.width).toBe(3_840);
    expect(recording.canvas.height).toBe(2_160);
    expect(renderer.begin(STYLE, 0, 0, 0.5)).toBe(true);
    renderer.resetActive();
    const nativeDabCount = recording.dabs.length;

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
    expect(renderer.begin(STYLE, 0, 0, 0.5)).toBe(false);
    expect(renderer.beginDeferred(STYLE)).toBe(false);
    expect(renderer.isActive).toBe(false);
    expect(recording.dabs).toHaveLength(nativeDabCount);
  });

  it("fails closed for layered-flow without painting or mutating a settled stable prefix", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    addStroke(renderer, [0, 0, 10, 0, 20, 0], [1, 1, 1]);
    const settledPrefix = recording.dabs.map((dab) => ({ ...dab }));
    const layeredStyle = {
      ...STYLE,
      opacity: 0.6,
      paintModel: "layered-flow-v1",
    } as const;

    expect(studioLiveInkFastOverlaySupportsStyle(layeredStyle)).toBe(false);
    expect(renderer.begin(layeredStyle, 30, 0, 1)).toBe(false);
    renderer.appendFrom([30, 0, 40, 0, 50, 0], [1, 1, 1]);
    renderer.end();
    expect(renderer.beginDeferred(layeredStyle)).toBe(false);

    expect(renderer.isActive).toBe(false);
    expect(renderer.settledStrokeCount).toBe(1);
    expect(recording.dabs).toEqual(settledPrefix);
  });

  it("carries residual spacing across live appends and replays the identical settled footprint", () => {
    const style = {
      ...STYLE,
      strokeWidthDoc: 16,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    } as const;
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    expect(renderer.begin(style, 0, 0, 1)).toBe(true);
    renderer.appendFrom([0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0], [1, 1, 1, 1, 1, 1]);
    const firstPrefix = recording.dabs.map((dab) => ({ ...dab }));
    expect(firstPrefix.map(({ x }) => x)).toEqual([0, 3.2]);

    renderer.appendFrom(
      [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 0, 10, 0, 11, 0, 12, 0],
      Array.from({ length: 13 }, () => 1)
    );
    expect(recording.dabs.slice(0, firstPrefix.length)).toEqual(firstPrefix);
    expect(recording.dabs.map(({ x }) => x)).toEqual([0, 3.2, 6.4, 9.6]);
    renderer.end();
    const settled = recording.dabs.map((dab) => ({ ...dab }));

    recording.dabs.splice(0);
    renderer.setSurface({ ...SURFACE, width: 101 });
    expect(recording.dabs).toEqual(settled);
  });

  it("reauthors the last settled stroke from document points to match sealed causal planning", () => {
    const style = {
      ...STYLE,
      strokeWidthDoc: 16,
      minDistanceDoc: 2,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
    } as const;
    // Live append thins mid samples under minDistance=2; reauthor seals the full document route
    // so the settled footprint jumps to the canonical sealed plan (intentional geometry fix).
    const livePoints = [0, 0, 8, 0, 12, 0];
    const documentPoints = [0, 0, 1, 0, 2, 0, 4, 0, 8, 0, 12, 0];
    const pressures = [1, 1, 1, 1, 1, 1];
    const recording = recordingCanvas();
    // replay() clearRect must drop prior dab recordings so we only observe the sealed footprint.
    recording.clearRect.mockImplementation(() => {
      recording.dabs.length = 0;
    });
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    expect(renderer.begin(style, livePoints[0]!, livePoints[1]!, pressures[0]!)).toBe(true);
    renderer.appendFrom(livePoints, pressures);
    renderer.end();

    expect(
      renderer.reauthorLastSettledFromDocumentPoints({
        style,
        points: documentPoints,
        pressures,
      })
    ).toBe(true);
    expect(renderer.settledStrokeCount).toBe(1);
    expect(recording.clearRect).toHaveBeenCalled();
    // Sealed reauthor must equal a fresh full stroke planned from the same document points.
    expect(recording.dabs).toEqual(canonicalStrokeDabs(documentPoints, pressures, style));
  });

  it("skips clearRect when reauthor samples already match the settled live footprint", () => {
    const style = {
      ...STYLE,
      strokeWidthDoc: 16,
      minDistanceDoc: 0,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
    } as const;
    const points = [0, 0, 4, 0, 8, 0, 12, 0];
    const pressures = [1, 1, 1, 1];
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    expect(renderer.begin(style, points[0]!, points[1]!, pressures[0]!)).toBe(true);
    renderer.appendFrom(points, pressures);
    renderer.end();
    const settled = recording.dabs.map((dab) => ({ ...dab }));
    recording.clearRect.mockClear();

    expect(
      renderer.reauthorLastSettledFromDocumentPoints({
        style,
        points,
        pressures,
      })
    ).toBe(true);
    // Pointerup must not blank the overlay when live residual already matches sealed planning.
    expect(recording.clearRect).not.toHaveBeenCalled();
    expect(recording.dabs).toEqual(settled);
    expect(renderer.settledStrokeCount).toBe(1);
  });

  it("finishes residual ink synchronously without scheduling a post-release reveal", () => {
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const style = {
      ...STYLE,
      strokeWidthDoc: 16,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    } as const;
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    addStroke(
      renderer,
      [0, 0, 4, 0, 8, 0, 12, 0],
      [1, 1, 1, 1],
      style
    );
    const afterPointerUp = recording.dabs.map((dab) => ({ ...dab }));

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(recording.dabs).toEqual(afterPointerUp);
  });

  it("keeps V3 stationary pressure state append-only and identical after replay", () => {
    const style = {
      ...STYLE,
      strokeWidthDoc: 50,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
    } as const;
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    expect(renderer.begin(style, 0, 0, 1)).toBe(true);
    renderer.appendFrom([0, 0, 9, 0], [1, 1]);
    const paintedPrefix = recording.dabs.map((dab) => ({ ...dab }));
    renderer.appendFrom([0, 0, 9, 0, 9, 0, 10, 0], [1, 1, 0, 0]);
    renderer.end();

    expect(recording.dabs.slice(0, paintedPrefix.length)).toEqual(paintedPrefix);
    expect(recording.dabs).toEqual([
      { x: 0, y: 0, radius: 25 },
      { x: 9.05, y: 0, radius: 0 },
      { x: 9.55, y: 0, radius: 0 },
    ]);
    const settled = recording.dabs.map((dab) => ({ ...dab }));
    recording.dabs.splice(0);
    renderer.setSurface({ ...SURFACE, width: 101 });
    expect(recording.dabs).toEqual(settled);
    expect(canonicalStrokeDabs(
      [0, 0, 9, 0, 9, 0, 10, 0],
      [1, 1, 0, 0],
      style
    )).toEqual(settled);
  });

  it("uses the linear-full style for live, settled, and replayed dab radii", () => {
    const style = {
      ...STYLE,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    } as const;
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    expect(renderer.begin(style, 0, 0, 0)).toBe(true);
    renderer.appendFrom([0, 0, 5, 0, 10, 0], [0, 0.5, 1]);
    renderer.end();
    const final = recording.dabs.map((dab) => ({ ...dab }));

    expect(final[0]?.radius).toBe(0);
    expect(final.find(({ x }) => x === 5)?.radius).toBe(2.5);
    expect(final.at(-1)?.radius).toBe(5);

    recording.dabs.splice(0);
    renderer.setSurface({ ...SURFACE, width: 101 });
    expect(recording.dabs).toEqual(final);
  });

  it("resolves missing live samples to full linear pressure and legacy half pressure", () => {
    const linear = recordingCanvas();
    const linearRenderer = new StudioLiveInkOverlayRenderer();
    linearRenderer.attach(linear.canvas);
    linearRenderer.setSurface(SURFACE);
    expect(linearRenderer.begin({
      ...STYLE,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    }, 0, 0, Number.NaN)).toBe(true);
    linearRenderer.appendFrom([0, 0, 10, 0], []);
    expect(linear.dabs[0]?.radius).toBe(5);
    expect(linear.dabs.at(-1)?.radius).toBe(5);

    const legacy = setup();
    legacy.renderer.appendFrom([0, 0, 10, 0], []);
    expect(legacy.dabs.at(-1)?.radius).toBe(5);
  });

  it("appends only causal suffix dabs and reaches the active pointer endpoint", () => {
    const { renderer, clearRect, dabs } = setup();
    renderer.appendFrom([0, 0, 10, 0, 20, 10], [0.25, 0.5, 0.75]);
    const finalizedPrefix = dabs.map((dab) => ({ ...dab }));
    const clearsBeforeAppend = clearRect.mock.calls.length;

    renderer.appendFrom(
      [0, 0, 10, 0, 20, 10, 30, 10],
      [0.25, 0.5, 0.75, 1]
    );

    expect(clearRect).toHaveBeenCalledTimes(clearsBeforeAppend);
    expect(dabs.slice(0, finalizedPrefix.length)).toEqual(finalizedPrefix);
    expect(dabs.length).toBeGreaterThan(finalizedPrefix.length);
    expect(dabs.at(-1)).toMatchObject({ x: 30, y: 10, radius: 8.5 });

    const dabCount = dabs.length;
    renderer.appendFrom(
      [0, 0, 10, 0, 20, 10, 30, 10],
      [0.25, 0.5, 0.75, 1]
    );
    expect(dabs).toHaveLength(dabCount);
  });

  it("synchronously seals a skipped raw pointerup endpoint without repainting its prefix", () => {
    const { renderer, clearRect, dabs } = setup({ ...STYLE, minDistanceDoc: 5 });
    // 12px is only 2px from the last retained point, so live thinning defers it until end().
    renderer.appendFrom([0, 0, 10, 0, 12, 0], [0.25, 0.5, 1]);
    const prefixBeforeEnd = dabs.map((dab) => ({ ...dab }));
    expect(dabs.at(-1)).toMatchObject({ x: 10, y: 0 });

    renderer.end();

    expect(clearRect).not.toHaveBeenCalled();
    expect(dabs.slice(0, prefixBeforeEnd.length)).toEqual(prefixBeforeEnd);
    expect(dabs.at(-1)).toMatchObject({ x: 12, y: 0, radius: 8.5 });
    expect(renderer.isActive).toBe(false);
    expect(renderer.hasSettledStrokes).toBe(true);

    const sealedCount = dabs.length;
    renderer.end();
    expect(dabs).toHaveLength(sealedCount);
  });

  it("replays a settled stroke with the exact same canonical dab sequence", () => {
    const { renderer, clearRect, dabs } = setup();
    renderer.appendFrom(
      [0, 0, 10, 0, 20, 10, 30, 10],
      [0.25, 0.5, 0.75, 1]
    );
    renderer.end();
    const finalized = dabs.map((dab) => ({ ...dab }));
    expect(finalized.at(-1)).toMatchObject({ x: 30, y: 10 });

    dabs.splice(0);
    clearRect.mockClear();
    renderer.setSurface({ ...SURFACE, width: 120 });

    expect(clearRect).toHaveBeenCalledTimes(1);
    expect(dabs).toEqual(finalized);
  });

  it("accepts fixed-lag corrected spans without drawing or rewriting a premature head", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);

    expect(renderer.beginDeferred(STYLE)).toBe(true);
    expect(recording.dabs).toEqual([]);
    renderer.appendSettledSpan([0, 0, 10, 2], [0.25, 0.5, 0.75], 1);
    const stablePrefix = recording.dabs.map((dab) => ({ ...dab }));
    renderer.appendSettledSpan([20, 4], [0.25, 0.5, 0.75], 2);

    expect(recording.dabs.slice(0, stablePrefix.length)).toEqual(stablePrefix);
    expect(recording.dabs.at(-1)).toMatchObject({ x: 20, y: 4, radius: 6.75 });
  });

  it("releases only the committed settled prefix and exactly replays newer settled ink", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    const first = [0, 4, 12, 4, 20, 8];
    const second = [30, 10, 38, 14, 46, 10];
    const third = [58, 16, 66, 20, 78, 18];
    const pressures = [0.25, 0.5, 0.75];
    addStroke(renderer, first, pressures);
    addStroke(renderer, second, pressures);
    addStroke(renderer, third, pressures);
    expect(renderer.settledStrokeCount).toBe(3);

    const beforeRelease = recording.dabs.length;
    recording.clearRect.mockClear();
    expect(renderer.releaseSettledPrefix(2)).toBe(2);

    expect(renderer.settledStrokeCount).toBe(1);
    expect(renderer.hasSettledStrokes).toBe(true);
    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    expect(recording.clearRect).toHaveBeenLastCalledWith(
      0,
      0,
      recording.canvas.width,
      recording.canvas.height
    );
    expect(recording.dabs.slice(beforeRelease)).toEqual(
      canonicalStrokeDabs(third, pressures)
    );
  });

  it("suppresses a canonical-drawn prefix without releasing FIFO accounting or active ink", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    const first = [0, 4, 12, 4, 20, 8];
    const second = [30, 10, 38, 14, 46, 10];
    const third = [58, 16, 66, 20, 78, 18];
    const pressures = [0.25, 0.5, 0.75];
    addStroke(renderer, first, pressures);
    addStroke(renderer, second, pressures);
    addStroke(renderer, third, pressures);
    const beforeSuppression = recording.dabs.length;
    recording.clearRect.mockClear();

    expect(renderer.suppressSettledPrefix(2)).toBe(2);
    expect(renderer.settledStrokeCount).toBe(3);
    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    expect(recording.dabs.slice(beforeSuppression)).toEqual(
      canonicalStrokeDabs(third, pressures)
    );

    const beforeRelease = recording.dabs.length;
    expect(renderer.releaseSettledPrefix(2)).toBe(2);
    expect(renderer.settledStrokeCount).toBe(1);
    expect(recording.dabs.slice(beforeRelease)).toEqual(
      canonicalStrokeDabs(third, pressures)
    );
  });

  it("preserves and exactly replays an active stroke while its settled prefix is released", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    addStroke(renderer, [0, 0, 10, 0, 18, 4], [0.25, 0.5, 0.75]);

    const activePoints = [40, 24, 48, 24, 56, 30];
    const activePressures = [0.4, 0.6, 0.8];
    expect(renderer.begin(
      STYLE,
      activePoints[0]!,
      activePoints[1]!,
      activePressures[0]!
    )).toBe(true);
    renderer.appendFrom(activePoints, activePressures);
    const expectedActive = canonicalStrokeDabs(activePoints, activePressures);
    const beforeRelease = recording.dabs.length;
    recording.clearRect.mockClear();

    expect(renderer.clearSettled()).toBe(1);

    expect(renderer.isActive).toBe(true);
    expect(renderer.settledStrokeCount).toBe(0);
    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    expect(recording.dabs.slice(beforeRelease)).toEqual(expectedActive);

    const stableReplay = recording.dabs.slice(beforeRelease).map((dab) => ({ ...dab }));
    renderer.appendFrom(
      [...activePoints, 68, 34],
      [...activePressures, 1]
    );
    expect(recording.dabs.slice(beforeRelease, beforeRelease + stableReplay.length)).toEqual(
      stableReplay
    );
    expect(recording.dabs.at(-1)).toMatchObject({ x: 68, y: 34, radius: 8.5 });
  });

  it("treats a zero release as a no-op and clamps an excess release without orphan pixels", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    addStroke(renderer, [4, 6, 12, 6], [0.3, 0.6]);
    addStroke(renderer, [30, 8, 42, 12], [0.5, 0.9]);
    const beforeNoop = recording.dabs.map((dab) => ({ ...dab }));
    recording.clearRect.mockClear();

    expect(renderer.releaseSettledPrefix(0)).toBe(0);
    expect(renderer.releaseSettledPrefix(Number.NaN)).toBe(0);
    expect(renderer.releaseSettledPrefix(-2)).toBe(0);
    expect(renderer.settledStrokeCount).toBe(2);
    expect(recording.clearRect).not.toHaveBeenCalled();
    expect(recording.dabs).toEqual(beforeNoop);

    const beforeExcessRelease = recording.dabs.length;
    expect(renderer.releaseSettledPrefix(99)).toBe(2);
    expect(renderer.settledStrokeCount).toBe(0);
    expect(renderer.hasSettledStrokes).toBe(false);
    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    // With no newer settled or active ink, replay must leave the cleared backing empty.
    expect(recording.dabs.slice(beforeExcessRelease)).toEqual([]);
  });

  it("resets only active ink and replays settled ink without losing its exact footprint", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkOverlayRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    const settledPoints = [6, 50, 18, 46, 28, 52];
    const settledPressures = [0.25, 0.55, 0.85];
    addStroke(renderer, settledPoints, settledPressures);
    expect(renderer.begin(STYLE, 50, 50, 0.5)).toBe(true);
    renderer.appendFrom([50, 50, 60, 44, 72, 48], [0.5, 0.7, 1]);
    const beforeReset = recording.dabs.length;
    recording.clearRect.mockClear();

    expect(renderer.resetActive()).toBe(true);

    expect(renderer.isActive).toBe(false);
    expect(renderer.settledStrokeCount).toBe(1);
    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    expect(recording.dabs.slice(beforeReset)).toEqual(
      canonicalStrokeDabs(settledPoints, settledPressures)
    );

    recording.clearRect.mockClear();
    expect(renderer.resetActive()).toBe(false);
    expect(recording.clearRect).not.toHaveBeenCalled();
  });
});

describe("StudioLiveInkPredictionRenderer", () => {
  it("does not authorize prediction when a 2D context is unavailable", () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const renderer = new StudioLiveInkPredictionRenderer();
    renderer.attach(canvas);
    renderer.setSurface(SURFACE);

    expect(renderer.surfaceResolutionDecision?.ok).toBe(true);
    expect(renderer.isNativeSurfaceReady).toBe(false);
  });

  it("does not paint a lower-resolution prediction when native 4K DPR2 exceeds the budget", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkPredictionRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface({
      ...SURFACE,
      width: 3_840,
      height: 2_160,
      documentWidth: 3_840,
    });

    expect(renderer.isNativeSurfaceReady).toBe(false);
    expect(recording.canvas.width).toBe(1);
    expect(recording.canvas.height).toBe(1);
    renderer.apply({
      kind: "replace",
      anchor: { x: 0, y: 0, pressure: 0.5 },
      samples: [{ x: 20, y: 20, pressure: 0.75 }],
    }, STYLE);
    expect(recording.dabs).toEqual([]);
  });

  it("clears and rejects layered-flow prediction tails instead of darkening canonical ink", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkPredictionRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    renderer.apply({
      kind: "replace",
      anchor: { x: 0, y: 0, pressure: 1 },
      samples: [{ x: 10, y: 0, pressure: 1 }],
    }, STYLE);
    const opaqueDabCount = recording.dabs.length;
    recording.clearRect.mockClear();
    const layeredStyle = {
      ...STYLE,
      opacity: 0.6,
      paintModel: "layered-flow-v1",
    } as const;

    renderer.apply({
      kind: "replace",
      anchor: { x: 10, y: 0, pressure: 1 },
      samples: [{ x: 20, y: 0, pressure: 1 }],
    }, layeredStyle);
    renderer.applyPointTail({
      kind: "replace",
      anchor: null,
      startSampleIndex: 0,
      points: [30, 0, 40, 0],
    }, layeredStyle, [1, 1]);

    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    expect(recording.dabs).toHaveLength(opaqueDabCount);
  });

  it("replaces only its transient tail and clears a bounded dirty rectangle", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkPredictionRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    recording.clearRect.mockClear();

    renderer.apply({
      kind: "replace",
      anchor: { x: 0, y: 0, pressure: 0.25 },
      samples: [
        { x: 10, y: 0, pressure: 0.5 },
        { x: 20, y: 0, pressure: 0.75 },
      ],
    }, STYLE);
    const firstTailDabCount = recording.dabs.length;
    expect(recording.dabs.at(-1)).toMatchObject({ x: 20, y: 0 });

    renderer.apply({
      kind: "replace",
      anchor: { x: 0, y: 0, pressure: 0.25 },
      samples: [
        { x: 8, y: 4, pressure: 0.45 },
        { x: 12, y: 8, pressure: 0.6 },
      ],
    }, STYLE);

    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    const [, , clearedWidth, clearedHeight] = recording.clearRect.mock.calls[0]!;
    expect(clearedWidth).toBeLessThan(recording.canvas.width);
    expect(clearedHeight).toBeLessThan(recording.canvas.height);
    expect(recording.dabs.slice(firstTailDabCount).at(-1)).toMatchObject({ x: 12, y: 8 });
  });

  it("matches the committed DPR transform and clears predictions without touching a full viewport", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkPredictionRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    expect(recording.canvas.width).toBe(SURFACE.width * 3);
    expect(recording.canvas.height).toBe(SURFACE.height * 3);
    recording.clearRect.mockClear();

    renderer.apply({
      kind: "replace",
      anchor: { x: 40, y: 40, pressure: 0.5 },
      samples: [{ x: 45, y: 45, pressure: 0.75 }],
    }, STYLE);
    renderer.apply({ kind: "clear" }, STYLE);

    expect(recording.clearRect).toHaveBeenCalledTimes(1);
    const [left, top, width, height] = recording.clearRect.mock.calls[0]!;
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    expect(width).toBeLessThan(recording.canvas.width);
    expect(height).toBeLessThan(recording.canvas.height);
  });

  it("treats keep as a true no-op for a late prediction event", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkPredictionRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);
    renderer.apply({
      kind: "replace",
      anchor: { x: 0, y: 0, pressure: 0.5 },
      samples: [{ x: 10, y: 10, pressure: 0.75 }],
    }, STYLE);
    recording.clearRect.mockClear();
    const dabCount = recording.dabs.length;

    renderer.apply({ kind: "keep" }, STYLE);

    expect(recording.clearRect).not.toHaveBeenCalled();
    expect(recording.dabs).toHaveLength(dabCount);
  });

  it("renders a complete short corrected tail before any settled anchor exists", () => {
    const recording = recordingCanvas();
    const renderer = new StudioLiveInkPredictionRenderer();
    renderer.attach(recording.canvas);
    renderer.setSurface(SURFACE);

    renderer.applyPointTail({
      kind: "replace",
      anchor: null,
      startSampleIndex: 0,
      points: [4, 6, 12, 10],
    }, STYLE, [0.25, 0.75]);

    expect(recording.dabs[0]).toMatchObject({ x: 4, y: 6, radius: 3.25 });
    expect(recording.dabs.at(-1)).toMatchObject({ x: 12, y: 10, radius: 6.75 });
  });
});
