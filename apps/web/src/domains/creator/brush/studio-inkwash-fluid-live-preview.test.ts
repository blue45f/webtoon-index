import { describe, expect, it } from "vitest";

import {
  appendStudioInkwashFluidPreviewStroke,
  createStudioInkwashFluidPreviewPlanner,
  createStudioInkwashFluidSession,
  planStudioInkwashFluidPreviewStamps,
  resolveStudioInkwashFluidDisplay,
} from "./studio-inkwash-fluid";

const WIDTH = 1_024;
const HEIGHT = 160;

function samples(count = 97) {
  return Array.from({ length: count }, (_, index) => {
    const amount = index / (count - 1);
    return {
      x: 24 + amount * 960,
      y: 80 + Math.sin(amount * Math.PI * 4) * 18,
      pressure: 0.22 + amount * 0.72,
    };
  });
}

function planner() {
  return createStudioInkwashFluidPreviewPlanner({
    tool: "pen",
    radius: 8,
    pigmentLoad: 1.45,
    wetnessLoad: 0.16,
    inkColor: { r: 28, g: 21, b: 118 },
    spectralAbsorption: { r: 1, g: 0.96, b: 0.88 },
  });
}

function render(chunks: readonly (readonly ReturnType<typeof samples>[number][])[]) {
  const session = createStudioInkwashFluidSession({ width: WIDTH, height: HEIGHT });
  const state = planner();
  for (const chunk of chunks) {
    appendStudioInkwashFluidPreviewStroke(session, state, chunk);
  }
  return {
    pigment: session.fluid.pigment.slice(),
    wet: session.fluid.wet.slice(),
    rgba: resolveStudioInkwashFluidDisplay(session).rgba,
  };
}

describe("causal InkWash live preview", () => {
  it("is byte-identical whether accepted samples arrive together or as pointer suffixes", () => {
    const all = samples();
    const once = render([all]);
    const chunked = render([
      all.slice(0, 1),
      all.slice(1, 7),
      all.slice(7, 31),
      all.slice(31, 64),
      all.slice(64),
    ]);
    expect(chunked.pigment).toEqual(once.pigment);
    expect(chunked.wet).toEqual(once.wet);
    expect(chunked.rgba).toEqual(once.rgba);
  });

  it("keeps the pointer suffix dirty region bounded instead of repainting the full stroke", () => {
    const state = planner();
    const all = samples(9);
    const first = planStudioInkwashFluidPreviewStamps(state, all.slice(0, 5));
    const suffix = planStudioInkwashFluidPreviewStamps(state, all.slice(5));
    expect(first.stamps.length).toBeGreaterThan(0);
    expect(suffix.stamps.length).toBeGreaterThan(0);
    expect(suffix.dirtyBounds).not.toBeNull();
    expect(suffix.dirtyBounds!.width).toBeLessThan(WIDTH * 0.65);
  });

  it("preserves pressure as both width and optical-density information", () => {
    const state = planner();
    // Two sparse endpoints ensure the segment interpolates pressure instead of using only its tail.
    const planned = planStudioInkwashFluidPreviewStamps(state, [
      { x: 40, y: 80, pressure: 0.1 },
      { x: 480, y: 80, pressure: 1 },
    ]);
    expect(planned.stamps.length).toBeGreaterThan(20);
    const early = planned.stamps[Math.floor(planned.stamps.length * 0.1)]!;
    const late = planned.stamps[Math.floor(planned.stamps.length * 0.9)]!;
    expect(late.radius).toBeGreaterThan(early.radius * 1.35);
    expect(late.pigment[0]).toBeGreaterThan(early.pigment[0] * 1.2);
  });

  it("produces a soft optical edge wider than the flat nominal pen without touching commit math", () => {
    const result = render([samples(33)]);
    const alpha = result.rgba;
    let occupied = 0;
    let soft = 0;
    for (let index = 3; index < alpha.length; index += 4) {
      const value = alpha[index]!;
      if (value > 8) occupied += 1;
      if (value > 8 && value < 224) soft += 1;
    }
    expect(occupied).toBeGreaterThan(2_500);
    expect(soft / occupied).toBeGreaterThan(0.24);
  });
});