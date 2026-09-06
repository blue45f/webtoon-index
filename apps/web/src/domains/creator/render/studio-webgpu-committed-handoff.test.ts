import { describe, expect, it } from "vitest";

import { STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 } from "../brush/studio-ink-pressure-model";
import { selectStudioCausalInkSamples } from "../studio-causal-ink";

import {
  createStudioWebGpuCommittedHandoff,
  type StudioWebGpuCommittedHandoffElement,
} from "./studio-webgpu-committed-handoff";

function draw(
  id: string,
  overrides: Partial<StudioWebGpuCommittedHandoffElement> = {}
): StudioWebGpuCommittedHandoffElement {
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0, 1, 1, 8, 4, 15, 10],
    pressures: [0.2, 0.4, 0.8, 1],
    stroke: "#24180f",
    strokeWidth: 0.6,
    opacity: 1,
    brush: "pen",
    sampleSpacing: 0.75,
    panelClip: "none",
    ...overrides,
  };
}

describe("createStudioWebGpuCommittedHandoff", () => {
  it("converts the frontmost compatible suffix without changing scene order", () => {
    const handoff = createStudioWebGpuCommittedHandoff({
      elements: [
        draw("behind"),
        { id: "barrier", type: "image", panelClip: "none" },
        draw("front-a"),
        draw("front-b", { brush: "fineliner", stroke: "rgb(20 30 40)" }),
      ],
    });

    expect(handoff.status).toBe("ready");
    expect(handoff.elementIds).toEqual(["front-a", "front-b"]);
    expect(handoff.strokes.map((stroke) => stroke.id)).toEqual(["front-a", "front-b"]);
    expect(handoff.lowerBarrier).toEqual({ elementId: "barrier", reason: "non-draw" });
    expect(handoff.strokes.every((stroke) => stroke.orderKey === undefined)).toBe(true);
  });

  it("uses StudioDrawNode's point, pressure, and minimum-width contracts exactly", () => {
    const element = draw("ink");
    const handoff = createStudioWebGpuCommittedHandoff({ elements: [element] });
    const expectedSamples = selectStudioCausalInkSamples({
      points: element.points as number[],
      pressures: element.pressures as number[],
      minDistance: element.sampleSpacing as number,
    });
    const expectedPoints = expectedSamples.flatMap(({ x, y }) => [x, y]);

    expect(handoff.strokes).toEqual([{
      id: "ink",
      points: expectedPoints,
      pressures: expectedSamples.map(({ pressure }) => pressure),
      color: "#24180f",
      size: 1,
      opacity: 1,
      composite: "normal",
    }]);
  });

  it("keeps fineliner diameter and pressure identity distinct from the default pen", () => {
    const handoff = createStudioWebGpuCommittedHandoff({
      elements: [
        draw("pen", { strokeWidth: 10, pressures: [0.2, 0.4, 0.8, 1] }),
        draw("fineliner", {
          brush: "fineliner",
          strokeWidth: 10,
          pressures: [0.2, 0.4, 0.8, 1],
        }),
      ],
    });

    expect(handoff.strokes[0]).toMatchObject({
      id: "pen",
      size: 10,
      pressures: [0.2, 0.4, 0.8, 1],
    });
    expect(handoff.strokes[1]).toMatchObject({
      id: "fineliner",
      size: 4.8,
    });
    const expectedFinelinerPressures = [
      0.8 + 0.2 * Math.pow(0.2, 0.72),
      0.8 + 0.2 * Math.pow(0.4, 0.72),
      0.8 + 0.2 * Math.pow(0.8, 0.72),
      1,
    ];
    expect(handoff.strokes[1]?.pressures).toHaveLength(expectedFinelinerPressures.length);
    expectedFinelinerPressures.forEach((pressure, index) => {
      expect(handoff.strokes[1]?.pressures?.[index]).toBeCloseTo(pressure, 12);
    });
  });

  it("carries an explicit linear pressure model without changing legacy handoffs", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const linear = createStudioWebGpuCommittedHandoff({
      elements: [draw("linear", { pressureModel })],
    });
    const legacy = createStudioWebGpuCommittedHandoff({ elements: [draw("legacy")] });

    expect(linear.strokes[0]?.pressureModel).toBe(pressureModel);
    expect(Object.hasOwn(legacy.strokes[0]!, "pressureModel")).toBe(false);
  });

  it("treats missing linear-model samples as nominal full pressure", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const handoff = createStudioWebGpuCommittedHandoff({
      elements: [draw("linear-short", {
        points: [0, 0, 10, 0],
        pressures: [0],
        pressureModel,
        sampleSpacing: 0,
      })],
    });

    expect(handoff.strokes[0]).toMatchObject({
      points: [0, 0, 10, 0],
      pressures: [0, 1],
      pressureModel,
    });
  });

  it("keeps no-spacing explicit-model geometry causal instead of legacy smoothing", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const points = [0, 0, 1, 1, 8, 4, 15, 10];
    const handoff = createStudioWebGpuCommittedHandoff({
      elements: [draw("linear-no-spacing", {
        points,
        pressures: [0],
        pressureModel,
        sampleSpacing: undefined,
      })],
    });

    expect(handoff.strokes[0]).toMatchObject({
      points,
      pressures: [0, 1, 1, 1],
      pressureModel,
    });
  });

  it("keeps all committed pixels on Konva while an editor-wide gate is active", () => {
    const handoff = createStudioWebGpuCommittedHandoff({
      elements: [draw("ink")],
      gates: { editActive: true },
    });

    expect(handoff).toMatchObject({
      status: "gated",
      gateReason: "edit",
      elementIds: [],
      strokes: [],
    });
  });

  it("fails closed behind a legacy segment stroke with no sample spacing or pressure model", () => {
    const handoff = createStudioWebGpuCommittedHandoff({
      elements: [draw("legacy", { sampleSpacing: undefined, pressureModel: undefined })],
    });

    expect(handoff).toMatchObject({
      status: "empty",
      elementIds: [],
      strokes: [],
      frontBarrier: { elementId: "legacy", reason: "invalid-geometry" },
    });
  });

  it("fails closed behind a frontmost unsupported draw operation", () => {
    const handoff = createStudioWebGpuCommittedHandoff({
      elements: [draw("safe"), draw("eraser", { mode: "eraser" })],
    });

    expect(handoff).toMatchObject({
      status: "empty",
      elementIds: [],
      strokes: [],
      frontBarrier: { elementId: "eraser", reason: "non-pen-mode" },
    });
  });
});
