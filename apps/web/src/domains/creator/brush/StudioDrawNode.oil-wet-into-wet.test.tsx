// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioDrawNode } from "./StudioDrawNode";

import type { DrawEl } from "../studio-element-model";

interface CapturedKonvaNode {
  kind: string;
  props: Record<string, unknown>;
}

const konvaCapture = vi.hoisted(() => ({
  nodes: [] as CapturedKonvaNode[],
}));

vi.mock("react-konva/lib/ReactKonvaCore", async () => {
  const { Fragment, createElement } = await import("react");
  const capture = (kind: string, renderChildren = false) =>
    (props: Record<string, unknown>) => {
      konvaCapture.nodes.push({ kind, props });
      return renderChildren
        ? createElement(Fragment, null, props.children as import("react").ReactNode)
        : null;
    };
  return {
    Arrow: capture("Arrow"),
    Circle: capture("Circle"),
    Ellipse: capture("Ellipse"),
    Group: capture("Group", true),
    Line: capture("Line"),
    Path: capture("Path"),
    Rect: capture("Rect"),
    Shape: capture("Shape"),
    Star: capture("Star"),
  };
});

const YELLOW = { r: 252, g: 211, b: 0 };
const BLUE = [0, 33, 133, 255] as const;

class FakeNative2D {
  readonly canvas: { width: number; height: number };
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas = { width, height };
  }

  getTransform() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }

  getImageData(x: number, y: number, w: number, h: number) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row += 1) {
      for (let col = 0; col < w; col += 1) {
        const sx = x + col;
        const sy = y + row;
        const dst = (row * w + col) * 4;
        if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) continue;
        const src = (sy * this.width + sx) * 4;
        out[dst] = this.data[src]!;
        out[dst + 1] = this.data[src + 1]!;
        out[dst + 2] = this.data[src + 2]!;
        out[dst + 3] = this.data[src + 3]!;
      }
    }
    return { data: out, width: w, height: h };
  }

  putImageData(image: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) {
    for (let row = 0; row < image.height; row += 1) {
      for (let col = 0; col < image.width; col += 1) {
        const dx = x + col;
        const dy = y + row;
        if (dx < 0 || dy < 0 || dx >= this.width || dy >= this.height) continue;
        const dst = (dy * this.width + dx) * 4;
        const src = (row * image.width + col) * 4;
        this.data[dst] = image.data[src]!;
        this.data[dst + 1] = image.data[src + 1]!;
        this.data[dst + 2] = image.data[src + 2]!;
        this.data[dst + 3] = image.data[src + 3]!;
      }
    }
  }
}

class OilSceneContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  lineWidth = 1;
  constructor(readonly _context: FakeNative2D) {}
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  fill(): void {}
  stroke(): void {}
}

function oilEl(): DrawEl {
  return {
    id: "oil-wet-into-wet-node",
    type: "draw",
    kind: "freehand",
    brush: "oil",
    points: [10, 16, 70, 16],
    pressures: [0.8, 0.8],
    stroke: "#fcd300",
    strokeWidth: 18,
  };
}

beforeEach(() => {
  konvaCapture.nodes.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("StudioDrawNode oil path — wet-into-wet", () => {
  it("picks up existing canvas paint instead of stamping raw yellow", () => {
    const width = 80;
    const height = 32;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        const left = x < 40;
        pixels[idx] = left ? BLUE[0] : 255;
        pixels[idx + 1] = left ? BLUE[1] : 255;
        pixels[idx + 2] = left ? BLUE[2] : 255;
        pixels[idx + 3] = 255;
      }
    }

    render(<StudioDrawNode el={oilEl()} />);
    const shapes = konvaCapture.nodes.filter(({ kind }) => kind === "Shape");
    expect(shapes.length).toBeGreaterThan(0);
    const sceneFunc = shapes[0]!.props.sceneFunc as (context: OilSceneContext) => void;
    const native = new FakeNative2D(pixels, width, height);
    sceneFunc(new OilSceneContext(native));

    const idx = (16 * width + 22) * 4;
    const r = pixels[idx]!;
    const g = pixels[idx + 1]!;
    const b = pixels[idx + 2]!;
    expect(r).not.toBe(YELLOW.r);
    expect(g).not.toBe(YELLOW.g);
    expect(b).not.toBe(YELLOW.b);
    expect(r).not.toBe(BLUE[0]);
    expect(g).toBeGreaterThan(BLUE[1]);
  });

  it("uses a path-only hitFunc and does not punch the hit canvas via sceneFunc", () => {
    class HitCanvas {
      hitCanvas = true as const;
      width = 80;
      height = 32;
    }
    class HitContext {
      fillStyle: string | CanvasGradient | CanvasPattern = "";
      strokeStyle: string | CanvasGradient | CanvasPattern = "";
      globalAlpha = 1;
      globalCompositeOperation = "source-over";
      lineCap: CanvasLineCap = "butt";
      lineJoin: CanvasLineJoin = "miter";
      lineWidth = 1;
      fills = 0;
      readonly canvas = new HitCanvas();
      constructor(readonly _context: FakeNative2D) {}
      save(): void {}
      restore(): void {}
      beginPath(): void {}
      closePath(): void {}
      moveTo(): void {}
      lineTo(): void {}
      fill(): void {
        this.fills += 1;
      }
      stroke(): void {}
    }

    const width = 80;
    const height = 32;
    const pixels = new Uint8ClampedArray(width * height * 4);
    pixels.fill(40);
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    const before = pixels.slice();

    render(<StudioDrawNode el={oilEl()} />);
    const shapes = konvaCapture.nodes.filter(({ kind }) => kind === "Shape");
    expect(shapes.length).toBeGreaterThan(0);
    const hitFunc = shapes[0]!.props.hitFunc as
      | ((context: { beginPath(): void; fillStrokeShape(shape: unknown): void; moveTo(): void; lineTo(): void; closePath(): void }, shape: unknown) => void)
      | undefined;
    expect(typeof hitFunc).toBe("function");
    const hit = {
      beginPathCount: 0,
      fillStroke: 0,
      beginPath() { this.beginPathCount += 1; },
      fillStrokeShape() { this.fillStroke += 1; },
      moveTo() {},
      lineTo() {},
      closePath() {},
    };
    hitFunc!(hit, { colorKey: "#010203" });
    expect(hit.beginPathCount).toBe(1);
    expect(hit.fillStroke).toBe(1);

    const sceneFunc = shapes[0]!.props.sceneFunc as (context: HitContext) => void;
    const native = new FakeNative2D(pixels, width, height);
    const originalPut = native.putImageData.bind(native);
    let putCount = 0;
    native.putImageData = ((...args: Parameters<FakeNative2D["putImageData"]>) => {
      putCount += 1;
      return originalPut(...args);
    }) as FakeNative2D["putImageData"];
    const hitScene = new HitContext(native);
    sceneFunc(hitScene);
    expect(putCount).toBe(0);
    expect(Array.from(pixels)).toEqual(Array.from(before));
    expect(hitScene.fills).toBeGreaterThan(0);
  });
});
