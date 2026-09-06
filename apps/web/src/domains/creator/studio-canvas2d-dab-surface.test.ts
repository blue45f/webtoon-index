import { describe, expect, it } from "vitest";

import {
  clearStudioCanvas2dDabSurface,
  renderStudioCanvas2dDabSurface,
  type StudioCanvas2dDabViewport,
} from "./studio-canvas2d-dab-surface";

import type {
  StudioGpuDab,
  StudioGpuDabRenderUpdate,
} from "./render/studio-webgpu-dab-plan-contract";

interface RecordingCanvas2d {
  readonly context: CanvasRenderingContext2D;
  readonly operations: string[];
}

function recordingCanvas2d(): RecordingCanvas2d {
  const operations: string[] = [];
  let composite: GlobalCompositeOperation = "source-over";
  let fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  const context = {
    save: () => operations.push("save"),
    restore: () => operations.push("restore"),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      operations.push(`setTransform:${a},${b},${c},${d},${e},${f}`);
    },
    clearRect: (x: number, y: number, width: number, height: number) => {
      operations.push(`clearRect:${x},${y},${width},${height}`);
    },
    beginPath: () => operations.push("beginPath"),
    arc: (x: number, y: number, radius: number, start: number, end: number) => {
      operations.push(`arc:${x},${y},${radius},${start},${end}`);
    },
    fill: () => operations.push("fill"),
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperties(context, {
    globalCompositeOperation: {
      get: () => composite,
      set: (value: GlobalCompositeOperation) => {
        composite = value;
        operations.push(`composite:${value}`);
      },
    },
    fillStyle: {
      get: () => fillStyle,
      set: (value: string | CanvasGradient | CanvasPattern) => {
        fillStyle = value;
        operations.push(`fillStyle:${String(value)}`);
      },
    },
  });
  return { context, operations };
}

function viewport(
  overrides: Partial<StudioCanvas2dDabViewport> = {}
): StudioCanvas2dDabViewport {
  return {
    logicalWidth: 100,
    logicalHeight: 50,
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
    flipX: false,
    ...overrides,
  };
}

function dab(overrides: Partial<StudioGpuDab> = {}): StudioGpuDab {
  return {
    x: 10,
    y: 20,
    radius: 4,
    red: 0.1,
    green: 0.5,
    blue: 1,
    alpha: 0.375,
    composite: "normal",
    ...overrides,
  };
}

function update(
  mode: StudioGpuDabRenderUpdate["mode"],
  dabs: StudioGpuDab[] = []
): StudioGpuDabRenderUpdate {
  return { mode, dabs, batches: [], complete: true };
}

function renderedOperations(input: {
  readonly surfaceWidth: number;
  readonly surfaceHeight: number;
  readonly viewport: StudioCanvas2dDabViewport;
  readonly update?: StudioGpuDabRenderUpdate;
}): string[] {
  const recording = recordingCanvas2d();
  renderStudioCanvas2dDabSurface({
    context: recording.context,
    surfaceWidth: input.surfaceWidth,
    surfaceHeight: input.surfaceHeight,
    viewport: input.viewport,
    update: input.update ?? update("append"),
  });
  return recording.operations;
}

describe("studio Canvas2D dab surface", () => {
  it("maps identity, zoom/offset, and flipX viewports to exact physical-pixel matrices", () => {
    const identity = renderedOperations({
      surfaceWidth: 100,
      surfaceHeight: 50,
      viewport: viewport(),
    });
    const zoomed = renderedOperations({
      surfaceWidth: 200,
      surfaceHeight: 100,
      viewport: viewport({ scaleX: 2, scaleY: 3, offsetX: -10, offsetY: 5 }),
    });
    const flipped = renderedOperations({
      surfaceWidth: 200,
      surfaceHeight: 100,
      viewport: viewport({
        scaleX: 2,
        scaleY: 3,
        offsetX: -10,
        offsetY: 5,
        flipX: true,
      }),
    });

    expect(identity).toContain("setTransform:1,0,0,1,0,0");
    expect(zoomed).toContain("setTransform:4,0,0,6,-20,10");
    expect(flipped).toContain("setTransform:-4,0,0,6,380,10");
  });

  it("clears a rebuild in physical coordinates before painting and balances state", () => {
    const operations = renderedOperations({
      surfaceWidth: 200,
      surfaceHeight: 100,
      viewport: viewport(),
      update: update("rebuild", [dab()]),
    });

    expect(operations.slice(0, 5)).toEqual([
      "save",
      "setTransform:1,0,0,1,0,0",
      "clearRect:0,0,200,100",
      "restore",
      "save",
    ]);
    expect(operations.indexOf("clearRect:0,0,200,100"))
      .toBeLessThan(operations.indexOf("beginPath"));
    expect(operations.filter((operation) => operation === "save")).toHaveLength(2);
    expect(operations.filter((operation) => operation === "restore")).toHaveLength(2);
  });

  it("does not clear an append update and balances one paint state", () => {
    const operations = renderedOperations({
      surfaceWidth: 200,
      surfaceHeight: 100,
      viewport: viewport(),
      update: update("append", [dab()]),
    });

    expect(operations.some((operation) => operation.startsWith("clearRect:"))).toBe(false);
    expect(operations.filter((operation) => operation === "save")).toHaveLength(1);
    expect(operations.filter((operation) => operation === "restore")).toHaveLength(1);
  });

  it("preserves normal/erase composites and exact rounded RGBA/alpha paint values", () => {
    const operations = renderedOperations({
      surfaceWidth: 100,
      surfaceHeight: 50,
      viewport: viewport(),
      update: update("append", [
        dab(),
        dab({
          x: 30,
          y: 40,
          radius: 6,
          red: 0.999,
          green: 0.001,
          blue: 0.5,
          alpha: 1,
          composite: "erase",
        }),
      ]),
    });

    expect(operations.filter((operation) => operation.startsWith("composite:"))).toEqual([
      "composite:source-over",
      "composite:destination-out",
    ]);
    expect(operations.filter((operation) => operation.startsWith("fillStyle:"))).toEqual([
      "fillStyle:rgba(26, 128, 255, 0.375)",
      "fillStyle:rgba(255, 0, 128, 1)",
    ]);
    expect(operations.filter((operation) => operation.startsWith("arc:"))).toEqual([
      `arc:10,20,4,0,${Math.PI * 2}`,
      `arc:30,40,6,0,${Math.PI * 2}`,
    ]);
  });

  it("keeps an empty append update side-effect free apart from balanced transform state", () => {
    const operations = renderedOperations({
      surfaceWidth: 100,
      surfaceHeight: 50,
      viewport: viewport(),
    });

    expect(operations).toEqual([
      "save",
      "setTransform:1,0,0,1,0,0",
      "restore",
    ]);
  });

  it("keeps direct clear null-safe and restores the caller's context state", () => {
    const recording = recordingCanvas2d();

    expect(() => clearStudioCanvas2dDabSurface(null, 200, 100)).not.toThrow();
    clearStudioCanvas2dDabSurface(recording.context, 200, 100);

    expect(recording.operations).toEqual([
      "save",
      "setTransform:1,0,0,1,0,0",
      "clearRect:0,0,200,100",
      "restore",
    ]);
  });
});
