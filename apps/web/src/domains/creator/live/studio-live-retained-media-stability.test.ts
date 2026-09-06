import { describe, expect, it } from "vitest";

import { StudioLiveRetainedMediaOverlayRenderer } from "./studio-live-retained-media-overlay";

import type { DrawEl } from "../studio-element-model";

interface PaintMark {
  readonly path: readonly (readonly [string, ...number[]])[];
  readonly alpha: number;
  readonly operation: string;
}

/** Record the public Canvas2D paint program; geometry and pressure planners remain real. */
function recordingCanvas() {
  let marks: PaintMark[] = [];
  let path: [string, ...number[]][] = [];
  const stack: number[] = [];
  let clears = 0;
  const context = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "round",
    lineJoin: "round",
    save() { stack.push(this.globalAlpha); },
    restore() { this.globalAlpha = stack.pop() ?? 1; },
    setTransform() {},
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    beginPath() { path = []; },
    closePath() { path.push(["close"]); },
    moveTo(x: number, y: number) { path.push(["move", x, y]); },
    lineTo(x: number, y: number) { path.push(["line", x, y]); },
    arc(x: number, y: number, radius: number, start: number, end: number) {
      path.push(["arc", x, y, radius, start, end]);
    },
    fill() { marks.push({ path: [...path], alpha: this.globalAlpha, operation: "fill" }); },
    stroke() { marks.push({ path: [...path, ["width", this.lineWidth]], alpha: this.globalAlpha, operation: "stroke" }); },
    clearRect() { marks = []; clears += 1; },
    drawImage(source: HTMLCanvasElement) {
      marks.push(...(source as unknown as { readMarks(): PaintMark[] }).readMarks());
    },
  };
  const canvas = {
    width: 800,
    height: 160,
    getContext: () => context,
    readMarks: () => [...marks],
  } as unknown as HTMLCanvasElement;
  return { canvas, read: () => [...marks], clears: () => clears, stackDepth: () => stack.length };
}

function attached(scale = 1) {
  const renderer = new StudioLiveRetainedMediaOverlayRenderer();
  const active = recordingCanvas();
  const settled = recordingCanvas();
  renderer.attach({ activeCanvas: active.canvas, settledCanvas: settled.canvas });
  renderer.setSurface({ left: 0, top: 0, width: 800, height: 160, documentScale: scale, documentWidth: 800, flipX: false });
  return { renderer, active, settled };
}

function stroke(brush: NonNullable<DrawEl["brush"]>, points: number[], id = "accepted"): DrawEl {
  return {
    id, brush, points, type: "draw", kind: "freehand", mode: "pen",
    pressures: Array.from({ length: points.length / 2 }, (_, index) => 0.3 + index * 0.09),
    stroke: "#563cc7", strokeWidth: 14, opacity: 0.65,
    materialPressureModel: "canonical-material-v1",
  };
}

const BRUSHES = ["pencil", "pencil--side-shade", "calligraphy", "highlighter"] as const;
const POINTS = [50, 80, 200, 82, 350, 84, 500, 86, 650, 88];

describe("retained media session stability", () => {
  it.each(BRUSHES)("rejects a foreign pointer-up without committing or dropping accepted %s", (brush) => {
    const { renderer, settled } = attached();
    expect(renderer.begin(stroke(brush, POINTS)).status).toBe("started");
    expect(renderer.end(stroke(brush, POINTS, "foreign")))
      .toEqual({ status: "rejected", reason: "stroke-identity" });
    expect(renderer.isActive).toBe(true);
    expect(renderer.settledStrokeCount).toBe(0);
    expect(settled.read()).toEqual([]);
    expect(renderer.resetActive()).toBe(true);
    expect(renderer.begin(stroke(brush, POINTS, "next")).status).toBe("started");
    expect(renderer.end(stroke(brush, POINTS, "next")).status).toBe("settled");
  });

  it("rejects a same-id pointer-up that changed retained media kind", () => {
    const { renderer } = attached();
    renderer.begin(stroke("highlighter", POINTS));
    expect(renderer.end(stroke("pencil", POINTS)))
      .toEqual({ status: "rejected", reason: "stroke-identity" });
    expect(renderer.isActive).toBe(true);
    expect(renderer.settledStrokeCount).toBe(0);
  });

  it.each(["pencil", "pencil--side-shade", "calligraphy"] as const)(
    "retires the %s pointerdown hint once, not on every append", (brush) => {
      const { renderer, active } = attached();
      renderer.begin(stroke(brush, POINTS.slice(0, 2)));
      const before = active.clears();
      renderer.appendFrom(stroke(brush, POINTS.slice(0, 6)));
      expect(active.clears()).toBe(before + 1);
      renderer.appendFrom(stroke(brush, POINTS));
      expect(active.clears()).toBe(before + 1);
      expect(active.stackDepth()).toBe(0);
    },
  );

  it.each(["pencil", "pencil--side-shade"] as const)(
    "keeps finalized %s geometry, caps and alpha identical across hide/show and surface replay", (brush) => {
      const { renderer, active, settled } = attached();
      renderer.begin(stroke(brush, POINTS.slice(0, 2)));
      renderer.appendFrom(stroke(brush, POINTS.slice(0, 6)));
      renderer.appendFrom(stroke(brush, POINTS));
      expect(renderer.end(stroke(brush, POINTS)).status).toBe("settled");
      const committed = settled.read();
      expect(committed.length).toBeGreaterThan(0);
      renderer.hideSettledPixels();
      renderer.showSettledPixels();
      expect(settled.read()).toEqual(committed);
      renderer.setSurface({ left: 1, top: 0, width: 800, height: 160, documentScale: 1, documentWidth: 800, flipX: false });
      expect(settled.read()).toEqual(committed);
      expect(active.stackDepth()).toBe(0);
      expect(settled.stackDepth()).toBe(0);
    },
  );

  it("does not bake a zoom-dependent live visibility floor into a finalized pencil tap", () => {
    const normal = attached(1);
    const zoomedOut = attached(0.05);
    const tap = { ...stroke("pencil--side-shade", [50, 80]), strokeWidth: 0.5 };
    for (const state of [normal, zoomedOut]) {
      state.renderer.begin(tap);
      state.renderer.end(tap);
    }
    expect(zoomedOut.settled.read()).toEqual(normal.settled.read());
    zoomedOut.renderer.hideSettledPixels();
    zoomedOut.renderer.showSettledPixels();
    expect(zoomedOut.settled.read()).toEqual(normal.settled.read());
  });

  it("releases retained strokes and balances context state across 400 consecutive gestures", () => {
    const { renderer, active, settled } = attached();
    for (let index = 0; index < 400; index++) {
      const brush = BRUSHES[index % BRUSHES.length]!;
      const element = stroke(brush, POINTS, `round-${index}`);
      expect(renderer.begin({ ...element, points: POINTS.slice(0, 2), pressures: element.pressures!.slice(0, 1) }).status).toBe("started");
      renderer.appendFrom(element);
      expect(renderer.end(element).status).toBe("settled");
      renderer.hideSettledPixels();
      renderer.showSettledPixels();
      expect(renderer.releaseSettledPrefix(1)).toBe(1);
      expect(renderer.settledStrokeCount).toBe(0);
      expect(renderer.retainedPencilCommandCount).toBe(0);
      expect(renderer.isActive).toBe(false);
      expect(active.read()).toEqual([]);
      expect(settled.read()).toEqual([]);
      expect(active.stackDepth()).toBe(0);
      expect(settled.stackDepth()).toBe(0);
    }
  });
});


describe("retained pencil paint-program ownership", () => {
  it("keeps pointer-up suffix-only after travel rather than repainting the accepted prefix", () => {
    const { renderer, active } = attached();
    const element = stroke("pencil--side-shade", POINTS);
    renderer.begin(stroke("pencil--side-shade", POINTS.slice(0, 2)));
    renderer.appendFrom(element);
    const beforeClear = active.clears();
    const beforeCommands = renderer.retainedPencilCommandCount;
    expect(beforeCommands).toBeGreaterThan(0);
    renderer.end(element);
    // Only the normal post-flatten active-surface clear is allowed, not a pre-flatten full rebuild.
    expect(active.clears()).toBe(beforeClear + 1);
    expect(renderer.retainedPencilCommandCount).toBeGreaterThan(beforeCommands);
    renderer.clear();
    expect(renderer.retainedPencilCommandCount).toBe(0);
  });

  it("releases only the requested prefix and drops an aborted active program", () => {
    const { renderer, settled } = attached();
    for (const id of ["first", "second"]) {
      const element = stroke("pencil", POINTS, id);
      renderer.begin(element);
      renderer.end(element);
    }
    expect(renderer.releaseSettledPrefix(1)).toBe(1);
    expect(renderer.settledStrokeCount).toBe(1);
    expect(renderer.retainedPencilCommandCount).toBeGreaterThan(0);
    const second = settled.read();
    renderer.hideSettledPixels();
    renderer.showSettledPixels();
    expect(settled.read()).toEqual(second);
    renderer.begin(stroke("pencil", POINTS, "cancelled"));
    renderer.resetActive();
    expect(renderer.releaseSettledPrefix(Infinity)).toBe(1);
    expect(renderer.retainedPencilCommandCount).toBe(0);
  });
});
