import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getStudioInkwashWash,
  planStudioWetInkBrushReplay,
  readStudioInkwashWashDocumentCell,
  resetStudioInkwashWash,
  STUDIO_WET_INK_BRUSH_SIMULATION_STEPS,
} from "../brush/studio-wet-ink-brush-runtime";

import {
  resolveStudioLiveWetInkSimulationSteps,
  StudioLiveWetInkOverlayRenderer,
  studioLiveWetInkOverlaySupportsElement,
} from "./studio-live-wet-ink-overlay";

import type { DrawEl } from "../studio-element-model";
import type { StudioLiveInkSurface } from "./studio-live-ink-overlay";
import type {
  StudioWetInkBrushSurface,
  StudioWetInkBrushSurfaceFactory,
} from "../brush/studio-wet-ink-brush-runtime";

interface RecordingCanvas extends HTMLCanvasElement {
  readonly clears: Array<readonly number[]>;
  readonly paths: number[];
  readonly draws: Array<{
    readonly alpha: number;
    readonly arguments: readonly unknown[];
  }>;
}

function recordingCanvas(): RecordingCanvas {
  const clears: Array<readonly number[]> = [];
  /** lineTo count of every stroked path, in order (one entry per moveTo). */
  const paths: number[] = [];
  const draws: Array<{ alpha: number; arguments: readonly unknown[] }> = [];
  const stack: Array<{
    readonly alpha: number;
    readonly composite: GlobalCompositeOperation;
  }> = [];
  let alpha = 1;
  let composite: GlobalCompositeOperation = "source-over";
  const context = {
    save: () => {
      stack.push({ alpha, composite });
    },
    restore: () => {
      const state = stack.pop();
      if (!state) return;
      alpha = state.alpha;
      composite = state.composite;
    },
    setTransform: () => undefined,
    beginPath: () => undefined,
    moveTo: () => {
      paths.push(0);
    },
    lineTo: () => {
      paths[paths.length - 1] = (paths[paths.length - 1] ?? 0) + 1;
    },
    stroke: () => undefined,
    imageSmoothingEnabled: true,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    lineWidth: 1,
    strokeStyle: "#000",
    clearRect: (...args: number[]) => {
      clears.push(args);
    },
    drawImage: (...args: unknown[]) => {
      draws.push({ alpha, arguments: args });
    },
    set globalAlpha(value: number) {
      alpha = value;
    },
    get globalAlpha() {
      return alpha;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      composite = value;
    },
    get globalCompositeOperation() {
      return composite;
    },
  } as unknown as CanvasRenderingContext2D;
  return {
    width: 0,
    height: 0,
    style: { opacity: "1" },
    clears,
    draws,
    paths,
    getContext: () => context,
  } as unknown as RecordingCanvas;
}

function tileSurfaceFactory(): StudioWetInkBrushSurfaceFactory {
  return (width, height) => {
    const context = {
      createImageData: (imageWidth: number, imageHeight: number) => ({
        width: imageWidth,
        height: imageHeight,
        colorSpace: "srgb",
        data: new Uint8ClampedArray(imageWidth * imageHeight * 4),
      }) as ImageData,
      putImageData: () => undefined,
    };
    return {
      width,
      height,
      getContext: () => context,
    } as unknown as StudioWetInkBrushSurface;
  };
}

const SURFACE: StudioLiveInkSurface = {
  left: 0,
  top: 0,
  width: 320,
  height: 240,
  documentScale: 1,
  documentWidth: 320,
  flipX: false,
};

function wetStroke(
  points: readonly number[],
  overrides: Partial<DrawEl> = {},
): DrawEl {
  const count = Math.floor(points.length / 2);
  return {
    id: "live-wet-stroke",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [...points],
    pressures: Array.from({ length: count }, (_, index) => 0.25 + index * 0.1),
    stroke: "rgba(40, 76, 120, 0.8)",
    strokeWidth: 6,
    opacity: 0.65,
    brush: "watercolor",
    watercolorPipeline: "causal-walker-v2",
    ...overrides,
  };
}

function attachedRenderer(surface: StudioLiveInkSurface = SURFACE) {
  const activeCanvas = recordingCanvas();
  const settledCanvas = recordingCanvas();
  const renderer = new StudioLiveWetInkOverlayRenderer({
    surfaceFactory: tileSurfaceFactory(),
  });
  renderer.attach({ activeCanvas, settledCanvas });
  renderer.setSurface(surface);
  return { activeCanvas, renderer, settledCanvas };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StudioLiveWetInkOverlayRenderer", () => {
  beforeEach(() => {
    resetStudioInkwashWash();
  });

  it("keeps the interactive tile overlay fail-closed until its async backend is available", () => {
    expect(studioLiveWetInkOverlaySupportsElement(wetStroke([10, 10]))).toBe(false);
    expect(studioLiveWetInkOverlaySupportsElement(wetStroke(
      [10, 10],
      { brush: "watercolor" },
    ))).toBe(false);
    expect(studioLiveWetInkOverlaySupportsElement(wetStroke(
      [10, 10],
      { watercolorPipeline: undefined },
    ))).toBe(false);
    expect(studioLiveWetInkOverlaySupportsElement(wetStroke(
      [10, 10],
      { mode: "eraser" },
    ))).toBe(false);
    expect(studioLiveWetInkOverlaySupportsElement(wetStroke(
      [10, 10],
      { brush: "ink-wash" },
    ))).toBe(true);
    expect(studioLiveWetInkOverlaySupportsElement(wetStroke(
      [10, 10],
      { brush: "inkwash-pen" },
    ))).toBe(true);
    expect(studioLiveWetInkOverlaySupportsElement(wetStroke(
      [10, 10],
      { brush: "inkwash-water-brush" },
    ))).toBe(true);
    expect(studioLiveWetInkOverlaySupportsElement(wetStroke(
      [10, 10],
      { brush: "inkwash-pen", watercolorPipeline: undefined },
    ))).toBe(false);
  });

  it("renders InkWash pigment through bounded optical tile uploads", () => {
    const { activeCanvas, renderer } = attachedRenderer();
    const start = wetStroke([20, 40], {
      brush: "inkwash-pen",
      id: "inkwash-pen-live-preview",
    });
    expect(renderer.begin(start, { pageEpoch: 5 }).status).toBe("started");
    expect(activeCanvas.paths).toEqual([]);
    expect(activeCanvas.draws.length).toBeGreaterThan(0);
    const drawsAfterBegin = activeCanvas.draws.length;

    const grown = wetStroke([20, 40, 60, 42, 100, 47], {
      brush: "inkwash-pen",
      id: "inkwash-pen-live-preview",
    });
    expect(renderer.appendFrom(grown, { pageEpoch: 5 })).toMatchObject({
      status: "appended",
      consumedSourcePoints: 3,
    });
    expect(activeCanvas.paths).toEqual([]);
    expect(activeCanvas.draws.length).toBeGreaterThan(drawsAfterBegin);
    const drawsAfterGrowth = activeCanvas.draws.length;

    const longer = wetStroke([20, 40, 60, 42, 100, 47, 140, 50], {
      brush: "inkwash-pen",
      id: "inkwash-pen-live-preview",
    });
    expect(renderer.appendFrom(longer, { pageEpoch: 5 })).toMatchObject({
      status: "appended",
      consumedSourcePoints: 4,
    });
    expect(activeCanvas.paths).toEqual([]);
    expect(activeCanvas.draws.length).toBeGreaterThan(drawsAfterGrowth);
  });

  it("keeps InkWash pen and water on one live wash field", () => {
    const { renderer } = attachedRenderer();
    const penStart = wetStroke([24, 30], { brush: "inkwash-pen", id: "inkwash-pen-live" });
    const pen = wetStroke([24, 30, 32, 30, 40, 30], {
      brush: "inkwash-pen",
      id: "inkwash-pen-live",
    });
    const water = wetStroke([40, 30, 56, 30, 80, 30], {
      brush: "inkwash-water-brush",
      id: "inkwash-water-live",
    });
    expect(renderer.begin(penStart, { pageEpoch: 3 }).status).toBe("started");
    expect(renderer.appendFrom(pen, { pageEpoch: 3 }).status).toBe("appended");
    expect(renderer.end(pen, { pageEpoch: 3 }).status).toBe("settled");
    expect(renderer.begin(water, { pageEpoch: 3 }).status).toBe("started");
    expect(renderer.end(water, { pageEpoch: 3 }).status).toBe("settled");
    expect(renderer.hasSettledStrokes).toBe(true);
    expect(planStudioWetInkBrushReplay(water, { phase: "committed" }).ok).toBe(true);
    const wash = getStudioInkwashWash();
    expect(wash).not.toBeNull();
    const onPen = readStudioInkwashWashDocumentCell(wash!, 32, 30);
    const offPen = readStudioInkwashWashDocumentCell(wash!, 46, 30);
    expect((onPen?.mobile[0] ?? 0) + (onPen?.fixed[0] ?? 0)).toBeGreaterThan(0);
    expect((offPen?.mobile[0] ?? 0) + (offPen?.fixed[0] ?? 0)).toBeGreaterThan(0);
    expect(onPen!.fixed[0]).toBeGreaterThan(onPen!.mobile[0]);
  });

  it("grows the wash after a one-point begin so a long append is not clipped", () => {
    const { renderer } = attachedRenderer();
    const start = wetStroke([20, 40], { brush: "inkwash-pen", id: "inkwash-pen-long" });
    const long = wetStroke([20, 40, 80, 40, 140, 40, 220, 40], {
      brush: "inkwash-pen",
      id: "inkwash-pen-long",
    });
    expect(renderer.begin(start, { pageEpoch: 11 }).status).toBe("started");
    expect(renderer.appendFrom(long, { pageEpoch: 11 }).status).toBe("appended");
    expect(renderer.end(long, { pageEpoch: 11 }).status).toBe("settled");
    expect(planStudioWetInkBrushReplay(long, { phase: "committed" }).ok).toBe(true);
    const wash = getStudioInkwashWash();
    expect(wash).not.toBeNull();
    const nearStart = readStudioInkwashWashDocumentCell(wash!, 20, 40);
    const far = readStudioInkwashWashDocumentCell(wash!, 200, 40);
    expect((nearStart?.mobile[0] ?? 0) + (nearStart?.fixed[0] ?? 0)).toBeGreaterThan(0);
    expect((far?.mobile[0] ?? 0) + (far?.fixed[0] ?? 0)).toBeGreaterThan(0);
  });

  it("cancels an in-flight InkWash stroke with resetActive", () => {
    const { renderer } = attachedRenderer();
    const pen = wetStroke([24, 30, 40, 30], { brush: "inkwash-pen" });
    expect(renderer.begin(pen, { pageEpoch: 4 }).status).toBe("started");
    expect(renderer.isActive).toBe(true);
    expect(renderer.resetActive()).toBe(true);
    expect(renderer.isActive).toBe(false);
  });

  it("does not grow or deposit the wash field while an InkWash stroke is live", () => {
    const { renderer } = attachedRenderer();
    const start = wetStroke([24, 30], { brush: "inkwash-pen", id: "inkwash-live-cheap" });
    const live = wetStroke(
      Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? 24 + index * 4 : 30)),
      { brush: "inkwash-pen", id: "inkwash-live-cheap" },
    );
    expect(renderer.begin(start, { pageEpoch: 9 }).status).toBe("started");
    expect(renderer.appendFrom(live, { pageEpoch: 9 }).status).toBe("appended");
    expect(getStudioInkwashWash()).toBeNull();

    expect(renderer.end(live, { pageEpoch: 9 }).status).toBe("settled");
    const afterPen = getStudioInkwashWash();
    expect(afterPen).not.toBeNull();
    const revision = afterPen!.session.revision;
    const width = afterPen!.session.fluid.width;

    const waterStart = wetStroke([40, 30], {
      brush: "inkwash-water-brush",
      id: "inkwash-live-cheap-water",
    });
    const water = wetStroke([40, 30, 80, 30, 120, 30, 180, 30], {
      brush: "inkwash-water-brush",
      id: "inkwash-live-cheap-water",
    });
    expect(renderer.begin(waterStart, { pageEpoch: 9 }).status).toBe("started");
    expect(renderer.appendFrom(water, { pageEpoch: 9 }).status).toBe("appended");
    const duringWater = getStudioInkwashWash();
    expect(duringWater).not.toBeNull();
    expect(duringWater!.session.revision).toBe(revision);
    expect(duringWater!.session.fluid.width).toBe(width);
    expect(renderer.end(water, { pageEpoch: 9 }).status).toBe("settled");
  });

  it("reads only the unseen suffix and uploads dirty physical tiles", () => {
    const { activeCanvas, renderer } = attachedRenderer();
    const prefix = wetStroke([10, 20, 34, 22, 62, 29]);
    expect(renderer.begin(prefix, { pageEpoch: 7 }).status).toBe("started");
    expect(renderer.appendFrom(prefix, { pageEpoch: 7 })).toMatchObject({
      status: "appended",
      consumedSourcePoints: 3,
    });
    const fullCanvasClears = activeCanvas.clears.filter(
      (args) => args[0] === 0
        && args[1] === 0
        && args[2] === activeCanvas.width
        && args[3] === activeCanvas.height,
    ).length;
    const numericReads: number[] = [];
    const points = new Proxy(
      [10, 20, 34, 22, 62, 29, 90, 38, 118, 48],
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) {
            numericReads.push(Number(property));
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const extended = wetStroke(points, { points });
    numericReads.length = 0;

    const appended = renderer.appendFrom(extended, { pageEpoch: 7 });

    expect(appended).toMatchObject({
      status: "appended",
      consumedSourcePoints: 5,
    });
    expect(Math.min(...numericReads)).toBe(4);
    expect(activeCanvas.clears.some((args) => args.length === 4)).toBe(true);
    expect(activeCanvas.clears.filter(
      (args) => args[0] === 0
        && args[1] === 0
        && args[2] === activeCanvas.width
        && args[3] === activeCanvas.height,
    )).toHaveLength(fullCanvasClears);
  });

  it("seals the exact endpoint with the committed runtime digest before handoff", () => {
    const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
    const prefix = wetStroke([12, 18, 40, 23]);
    const complete = wetStroke([12, 18, 40, 23, 76, 37, 111, 62]);
    expect(renderer.begin(prefix, { pageEpoch: "page-a" }).status).toBe("started");
    expect(renderer.appendFrom(prefix, { pageEpoch: "page-a" }).status).toBe("appended");
    const committed = planStudioWetInkBrushReplay(complete, { phase: "committed" });
    if (!committed.ok) throw new Error(committed.detail);

    const ended = renderer.end(complete, { pageEpoch: "page-a" });

    expect(ended).toMatchObject({
      status: "settled",
      fieldDigest: committed.value.fieldDigest,
      revision: committed.value.revision,
      seed: committed.value.seed,
      uploadedTiles: committed.value.uploads.length,
    });
    expect(renderer.isActive).toBe(false);
    expect(renderer.settledStrokeCount).toBe(1);
    expect(settledCanvas.draws).toHaveLength(1);
    expect(settledCanvas.draws[0]!.alpha).toBeCloseTo(
      committed.value.compositeOpacity,
    );
    expect(activeCanvas.style.opacity).toBe("1");
    expect(renderer.releaseSettledPrefix(1)).toBe(1);
    expect(renderer.settledStrokeCount).toBe(0);
  });

  it("atomically replaces a release-time corrected prefix with the exact committed replay", () => {
    const { renderer } = attachedRenderer();
    const live = wetStroke([12, 18, 40, 23, 76, 37]);
    const corrected = wetStroke([12, 18, 38, 20, 73, 34, 108, 58]);
    expect(renderer.begin(live, { pageEpoch: "page-a" }).status).toBe("started");
    expect(renderer.appendFrom(live, { pageEpoch: "page-a" }).status).toBe("appended");
    const committed = planStudioWetInkBrushReplay(corrected, { phase: "committed" });
    if (!committed.ok) throw new Error(committed.detail);

    expect(renderer.end(corrected, { pageEpoch: "page-a" })).toMatchObject({
      status: "settled",
      fieldDigest: committed.value.fieldDigest,
      revision: committed.value.revision,
      seed: committed.value.seed,
    });
  });

  it("keeps rejected pointer-up source authoritative until an explicit reset", () => {
    const { renderer, settledCanvas } = attachedRenderer();
    const element = wetStroke([10, 10, 50, 20, 84, 36]);
    expect(renderer.begin(element, { pageEpoch: "page-a" }).status).toBe("started");

    expect(renderer.end(element, { pageEpoch: "page-b" })).toEqual({
      status: "rejected",
      reason: "stale-page",
    });
    expect(renderer.isActive).toBe(true);
    expect(renderer.lastOperationFailureReason).toBe("stale-page");
    expect(renderer.settledStrokeCount).toBe(0);
    expect(settledCanvas.draws).toHaveLength(0);
    expect(renderer.end(element, { pageEpoch: "page-a" })).toEqual({
      status: "rejected",
      reason: "stale-page",
    });
    expect(renderer.resetActive()).toBe(true);
    expect(renderer.isActive).toBe(false);
  });

  it("keeps unavailable pointer-up source authoritative without creating a settled receipt", () => {
    const { renderer, settledCanvas } = attachedRenderer();
    const element = wetStroke([10, 10, 50, 20, 84, 36]);
    expect(renderer.begin(element, { pageEpoch: "page-a" }).status).toBe("started");
    renderer.attach(null);

    expect(renderer.end(element, { pageEpoch: "page-a" })).toEqual({
      status: "unavailable",
      reason: "surface-render",
    });
    expect(renderer.isActive).toBe(true);
    expect(renderer.lastOperationFailureReason).toBe("surface-render");
    expect(renderer.settledStrokeCount).toBe(0);
    expect(settledCanvas.draws).toHaveLength(0);
    expect(renderer.resetActive()).toBe(true);
    expect(renderer.isActive).toBe(false);
  });

  it("preserves the last accepted source until rejected sessions are explicitly cancelled", () => {
    const { renderer } = attachedRenderer();
    const element = wetStroke([10, 10, 50, 20]);
    expect(renderer.begin(element, { pageEpoch: 1 }).status).toBe("started");
    expect(renderer.appendFrom(element, { pageEpoch: 2 })).toEqual({
      status: "rejected",
      reason: "stale-page",
    });
    expect(renderer.isActive).toBe(true);
    expect(renderer.lastOperationFailureReason).toBe("stale-page");
    expect(renderer.resetActive()).toBe(true);
    expect(renderer.isActive).toBe(false);

    expect(renderer.begin(element, { pageEpoch: 3 }).status).toBe("started");
    expect(renderer.appendFrom(element, {
      pageEpoch: 3,
      signal: { aborted: true },
    })).toEqual({ status: "rejected", reason: "aborted" });
    expect(renderer.isActive).toBe(true);
    expect(renderer.resetActive()).toBe(true);
    expect(renderer.isActive).toBe(false);

    expect(renderer.begin(element, { pageEpoch: 4 }).status).toBe("started");
    expect(renderer.appendFrom(element, {
      pageEpoch: 4,
      hidden: true,
    })).toEqual({ status: "rejected", reason: "hidden" });
    expect(renderer.isActive).toBe(true);
    expect(renderer.resetActive()).toBe(true);
    expect(renderer.isActive).toBe(false);
  });

  it("fails closed when native presentation would exceed the authoritative 4x field", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const { renderer } = attachedRenderer({
      ...SURFACE,
      documentScale: 2.01,
    });
    expect(renderer.isNativeSurfaceReady).toBe(false);
    expect(renderer.begin(wetStroke([10, 10]), { pageEpoch: 1 })).toEqual({
      status: "unavailable",
      reason: "native-scale-unsupported",
    });
  });
});

describe("resolveStudioLiveWetInkSimulationSteps", () => {
  it("runs deeper local diffusion than the old 1-step live path while remaining below full settle", () => {
    expect(resolveStudioLiveWetInkSimulationSteps(null)).toBe(0);
    const small = resolveStudioLiveWetInkSimulationSteps({ width: 32, height: 32 });
    const large = resolveStudioLiveWetInkSimulationSteps({ width: 400, height: 400 });
    expect(small).toBeGreaterThanOrEqual(3);
    expect(small).toBeLessThanOrEqual(STUDIO_WET_INK_BRUSH_SIMULATION_STEPS);
    expect(large).toBeGreaterThanOrEqual(3);
    expect(large).toBeLessThan(small);
    const catchUp = resolveStudioLiveWetInkSimulationSteps(
      { width: 64, height: 64 },
      { catchUpDebt: 8 },
    );
    expect(catchUp).toBeGreaterThan(small);
  });
});
