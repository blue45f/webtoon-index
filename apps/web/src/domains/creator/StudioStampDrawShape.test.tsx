import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  processFreehandPoints,
  resampleStrokePressures,
} from "./studio-brush";
import { StudioStampDrawShape } from "./StudioStampDrawShape";

import type { DrawEl } from "./studio-element-model";

const stampRendererCapture = vi.hoisted(() => ({
  draw: vi.fn(),
}));

vi.mock("./brush/studio-stamp-symmetry-rendering", () => ({
  drawStudioStampStrokeWithSymmetry: stampRendererCapture.draw,
}));

function element(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "stamp-test",
    type: "draw",
    mode: "pen",
    brush: "ink-brush",
    points: [0, 0],
    stroke: "#111111",
    strokeWidth: 12,
    ...overrides,
  };
}

function invokeScene(el: DrawEl): void {
  const node = StudioStampDrawShape({
    composite: "source-over",
    el,
    opacity: 0.8,
    renderSampleDistance: 3,
    stampKind: "ink",
    stroke: "#111111",
    strokeWidth: 12,
  });
  const sceneFunc = (node.props as {
    sceneFunc: (context: CanvasRenderingContext2D) => void;
  }).sceneFunc;
  sceneFunc({
    restore: vi.fn(),
    save: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
}

beforeEach(() => {
  stampRendererCapture.draw.mockReset();
});

describe("StudioStampDrawShape render-path ownership", () => {
  it("keeps modern accepted points and pressures index-aligned without an explicit pipeline tag", () => {
    const points = [0, 0, 1, 0, 2, 0, 10, 0];
    const pressures = [0.1, 0.2, 0.3, 0.9];

    invokeScene(element({
      points,
      pressures,
      sampleSpacing: 1,
      stampPipeline: undefined,
    }));

    expect(stampRendererCapture.draw).toHaveBeenCalledOnce();
    const [, , renderedPoints, renderedPressures] =
      stampRendererCapture.draw.mock.calls[0]!;
    expect(renderedPoints).toBe(points);
    expect(renderedPressures).toBe(pressures);
  });

  it("preserves the explicit causal walker stream even when legacy metadata is incomplete", () => {
    const points = [0, 0, 1, 0, 2, 0, 10, 0];
    const pressures = [0.1, 0.2, 0.3, 0.9];

    invokeScene(element({
      points,
      pressures,
      sampleSpacing: undefined,
      stampPipeline: "causal-walker-v2",
    }));

    const [, , renderedPoints, renderedPressures] =
      stampRendererCapture.draw.mock.calls[0]!;
    expect(renderedPoints).toBe(points);
    expect(renderedPressures).toBe(pressures);
  });

  it("retains legacy cleanup while resampling pressures to the cleaned point count", () => {
    const points = [0, 0, 1, 0, 2, 0, 10, 0];
    const pressures = [0.1, 0.2, 0.3, 0.9];
    const expectedPoints = processFreehandPoints(points, 3);
    const expectedPressures = resampleStrokePressures(
      pressures,
      expectedPoints.length / 2,
      0.5
    );

    invokeScene(element({
      points,
      pressures,
      sampleSpacing: undefined,
      stampPipeline: undefined,
    }));

    const [, , renderedPoints, renderedPressures] =
      stampRendererCapture.draw.mock.calls[0]!;
    expect(renderedPoints).toEqual(expectedPoints);
    expect(renderedPoints).not.toBe(points);
    expect(renderedPressures).toEqual(expectedPressures);
    expect(renderedPressures).toHaveLength(renderedPoints.length / 2);
  });
});
